import { getStore } from '../lib/store';
import type { Appointment, Contact } from '../types';
import type { EmailPlugin } from './email';
import { getGmailSession, listGmailInbound, sendGmailMessage, signInToGmail } from './googleMail';

/**
 * Shape of one inbound message as served by the configured mail endpoint
 * (VITE_CRM_INBOUND_MAIL_URL). `id` must be stable across fetches — it is
 * the dedupe key.
 */
export interface InboundMessage {
  id: string;
  from: string;
  subject: string;
  body?: string;
  date?: string;
}

export interface InboxSyncReport {
  fetched: number;
  logged: number;
  alreadySeen: number;
  unmatched: { from: string; subject: string }[];
}

export type InboundFetcher = () => Promise<InboundMessage[]>;

/**
 * "Smart brain" inbound-log plugin.
 *
 * Fetches inbound mail from a JSON endpoint (or an injected fetcher, for
 * tests/non-browser use), matches each sender to a contact by email address,
 * and logs every new message as an `email` interaction with
 * `plugin_data.inbound_id` set — that field is also the dedupe key, so a
 * message is never logged twice, even across devices in Supabase mode.
 *
 * Senders that match no contact are reported in `unmatched` and skipped
 * (never written to the log).
 */
export class SmartBrainEmailPlugin implements EmailPlugin {
  readonly name = 'smart-brain';
  private readonly fetcher: InboundFetcher;
  private readonly sender:
    | ((msg: { to: string; subject: string; body: string }) => Promise<void>)
    | null;
  private syncing: Promise<InboxSyncReport> | null = null;

  constructor(
    fetcher: InboundFetcher,
    sender?: (msg: { to: string; subject: string; body: string }) => Promise<void>,
  ) {
    this.fetcher = fetcher;
    this.sender = sender ?? null;
  }

  /** True when a real outbound transport (e.g. Gmail) is attached. */
  get canSend(): boolean {
    return this.sender !== null;
  }

  /** Send a message through the attached transport, then log it outbound. */
  async send(
    contactId: string,
    msg: {
      to: string;
      subject: string;
      body: string;
      matter_id?: string | null;
      due_at?: string | null;
    },
  ): Promise<void> {
    if (!this.sender) throw new Error('No outbound email transport is configured.');
    await this.sender(msg);
    await this.logThread(contactId, {
      subject: msg.subject,
      body: msg.body,
      direction: 'out',
      due_at: msg.due_at ?? null,
      matter_id: msg.matter_id ?? null,
    });
  }

  async sendConfirmation(appt: Appointment, contact: Contact): Promise<void> {
    if (!this.sender || !contact.email) return;
    const when = new Date(appt.starts_at).toLocaleString();
    await this.send(contact.id, {
      to: contact.email,
      subject: `Confirmed: ${appt.title || 'Appointment'} — ${when}`,
      body: `Hi ${contact.name.split(' ')[0]},\n\nConfirming ${
        appt.title || 'our appointment'
      } on ${when}.\n\nBest,`,
      matter_id: appt.matter_id ?? null,
    });
  }

  async logThread(
    contactId: string,
    message: {
      subject: string;
      body: string;
      direction: 'in' | 'out';
      occurred_at?: string;
      due_at?: string | null;
      matter_id?: string | null;
    },
  ): Promise<void> {
    await getStore().addInteraction({
      contact_id: contactId,
      matter_id: message.matter_id ?? null,
      type: 'email',
      subject_outline: message.subject || null,
      notes: message.body || null,
      occurred_at: message.occurred_at ?? new Date().toISOString(),
      due_at: message.due_at ?? null,
      status: message.due_at ? 'new' : undefined,
      plugin_data: { direction: message.direction, plugin: this.name },
    });
  }

  /** Whether an inbound source is wired up — used by the UI to show Sync. */
  get canSync(): boolean {
    return true;
  }

  /**
   * Pull the inbound feed once and log any new matched messages.
   * Concurrent calls share a single in-flight sync.
   */
  syncInbox(): Promise<InboxSyncReport> {
    this.syncing ??= this.doSync().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  private async doSync(): Promise<InboxSyncReport> {
    const report: InboxSyncReport = { fetched: 0, logged: 0, alreadySeen: 0, unmatched: [] };
    const messages = await this.fetcher();
    report.fetched = messages.length;
    if (messages.length === 0) return report;

    const store = getStore();
    const [contacts, interactions] = await Promise.all([
      store.listContacts(),
      store.listInteractions(),
    ]);

    const byEmail = new Map<string, Contact>();
    for (const c of contacts) {
      if (c.email) byEmail.set(c.email.trim().toLowerCase(), c);
    }

    const seen = new Set<string>();
    for (const i of interactions) {
      const id = i.plugin_data?.inbound_id;
      if (typeof id === 'string') seen.add(id);
    }

    for (const msg of messages) {
      if (!msg.id || seen.has(msg.id)) {
        report.alreadySeen += 1;
        continue;
      }
      const addr = extractAddress(msg.from);
      const contact = addr ? byEmail.get(addr) : undefined;
      if (!contact) {
        report.unmatched.push({ from: msg.from, subject: msg.subject ?? '' });
        continue;
      }
      const occurred = msg.date ? new Date(msg.date) : new Date();
      await store.addInteraction({
        contact_id: contact.id,
        type: 'email',
        subject_outline: msg.subject || null,
        notes: msg.body || null,
        occurred_at: isNaN(occurred.getTime()) ? new Date().toISOString() : occurred.toISOString(),
        plugin_data: { direction: 'in', plugin: this.name, inbound_id: msg.id },
      });
      seen.add(msg.id);
      report.logged += 1;
    }
    return report;
  }
}

/** Pull an email address out of a `From:` value like `Name <a@b.c>` or `a@b.c`. */
export function extractAddress(from: string): string | null {
  if (!from) return null;
  const angled = from.match(/<([^<>\s]+@[^<>\s]+)>/);
  const bare = angled ? angled[1] : (from.match(/[^\s]+@[^\s]+/)?.[0] ?? null);
  return bare ? bare.toLowerCase() : null;
}

/**
 * Build a plugin that reads the feed at `url`. The endpoint must return a
 * JSON array of InboundMessage. Auth, if any, is the endpoint's own concern
 * (e.g. a token in the URL or a same-origin proxy).
 */
export function createSmartBrainEmailPlugin(url: string): SmartBrainEmailPlugin {
  return new SmartBrainEmailPlugin(async () => {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Inbox feed returned ${res.status}`);
    const data: unknown = await res.json();
    if (!Array.isArray(data)) throw new Error('Inbox feed did not return a JSON array');
    return data as InboundMessage[];
  });
}

/**
 * Gmail-backed smart-brain: inbound feed is the signed-in user's own Gmail
 * inbox (gmail.readonly) and outbound goes through gmail.send. The token is
 * requested lazily — the consent popup appears on first Sync/Send, not at
 * app load. Requires VITE_GOOGLE_CLIENT_ID.
 */
export function createGmailBrainPlugin(): SmartBrainEmailPlugin {
  return new SmartBrainEmailPlugin(
    async () => {
      // First use needs interactive consent — silent token requests only
      // work after consent was granted once.
      if (!getGmailSession()) await signInToGmail();
      const msgs = await listGmailInbound();
      return msgs as InboundMessage[];
    },
    (msg) => sendGmailMessage(msg),
  );
}

export function isInboxCapable(plugin: EmailPlugin): plugin is SmartBrainEmailPlugin {
  return typeof (plugin as SmartBrainEmailPlugin).syncInbox === 'function';
}
