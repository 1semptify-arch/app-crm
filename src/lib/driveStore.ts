import type {
  Appointment,
  AppointmentInput,
  Attachment,
  AttachmentInput,
  Contact,
  ContactInput,
  Interaction,
  InteractionInput,
  Matter,
  MatterInput,
  SearchResults,
} from '../types';
import { isSettingRow, settingRow, type PluginDataRow } from './pluginData';
import { expandAppointments } from './recurrence';
import type { Store } from './store';

// ---------------------------------------------------------------------------
// Google Drive storage backend — the user's data lives in THEIR Drive
// (hidden appDataFolder), never on Semptify servers. Auth is Google Identity
// Services (implicit token client, ~1h tokens); Drive access is plain fetch
// against REST v3. No SDK, no new dependencies.
//
// File contract (shared across Semptify modules — see docs/OAUTH-STORAGE.md):
//   semptify.<module>.<collection>.json  — one JSON array of rows per file.
// Any module using the same OAuth client can read the others' files; the
// user's own Drive is the linking layer between Semptify tools.
// ---------------------------------------------------------------------------

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
export const isDriveConfigured = Boolean(CLIENT_ID);

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SESSION_KEY = 'semptify.drive.token';

const FILES = {
  contacts: 'semptify.crm.contacts.json',
  matters: 'semptify.crm.matters.json',
  appointments: 'semptify.crm.appointments.json',
  interactions: 'semptify.crm.interactions.json',
  attachments: 'semptify.crm.attachments.json',
  pluginData: 'semptify.crm.plugin_data.json', // reserved: cross-module plugin state
} as const;

// Attachment file CONTENT lives as a real file in appDataFolder named
// `semptify.crm.attachment.<row-id>` — the metadata JSON rows point at it
// via drive_file_id. Same drive.appdata scope, no extra consent needed.

// --- Minimal GIS typings (no @types package needed) --------------------------
interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
interface GisTokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void;
}
interface GisOauth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (resp: GisTokenResponse) => void;
    error_callback?: (err: unknown) => void;
  }) => GisTokenClient;
  revoke: (token: string, done: () => void) => void;
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GisOauth2 } };
  }
}

// --- Token state (memory + sessionStorage; tokens expire ~1h) ----------------
let tokenClient: GisTokenClient | null = null;
let accessToken: string | null = null;
let expiresAt = 0;
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

try {
  const saved = sessionStorage.getItem(SESSION_KEY);
  if (saved) {
    const parsed = JSON.parse(saved) as { token: string; expiresAt: number };
    if (parsed.expiresAt > Date.now()) {
      accessToken = parsed.token;
      expiresAt = parsed.expiresAt;
    }
  }
} catch {
  /* no storage — start unsigned */
}

function persistToken(token: string, expiresIn: number): void {
  accessToken = token;
  expiresAt = Date.now() + expiresIn * 1000;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: accessToken, expiresAt }));
  } catch {
    /* memory only */
  }
}

function clearToken(): void {
  accessToken = null;
  expiresAt = 0;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google sign-in failed to load.'));
    document.head.appendChild(s);
  });
}

async function ensureTokenClient(): Promise<GisTokenClient> {
  if (tokenClient) return tokenClient;
  if (!CLIENT_ID) throw new Error('VITE_GOOGLE_CLIENT_ID is not set.');
  await loadGis();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error('Google Identity Services unavailable.');
  tokenClient = oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: (resp) => {
      const p = pending;
      pending = null;
      if (resp.access_token) {
        persistToken(resp.access_token, resp.expires_in ?? 3600);
        p?.resolve(resp.access_token);
      } else {
        p?.reject(new Error(resp.error ?? 'Google sign-in failed.'));
      }
    },
    error_callback: (err) => {
      const p = pending;
      pending = null;
      p?.reject(err instanceof Error ? err : new Error('Google sign-in was cancelled.'));
    },
  });
  return tokenClient;
}

function requestToken(prompt: '' | 'consent'): Promise<string> {
  return ensureTokenClient().then(
    (client) =>
      new Promise<string>((resolve, reject) => {
        pending = { resolve, reject };
        client.requestAccessToken({ prompt });
      }),
  );
}

// --- Public session API ------------------------------------------------------
export function getDriveSession(): boolean {
  return Boolean(accessToken && expiresAt > Date.now());
}

export async function signInToDrive(): Promise<void> {
  try {
    await requestToken(''); // silent: works when consent was granted before
  } catch {
    await requestToken('consent'); // first run / revoked: show the consent popup
  }
}

export function signOutOfDrive(): Promise<void> {
  const token = accessToken;
  clearToken();
  fileIds.clear();
  return new Promise((resolve) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (token && oauth2) oauth2.revoke(token, () => resolve());
    else resolve();
  });
}

// --- Fetch wrapper: bearer token + one silent re-auth retry on 401 -----------
async function ensureToken(): Promise<string> {
  if (accessToken && expiresAt - 60_000 > Date.now()) return accessToken;
  return requestToken(''); // silent refresh; throws if the Google session is gone
}

async function driveFetch(url: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const token = await ensureToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && !retried) {
    clearToken();
    return driveFetch(url, init, true);
  }
  return res;
}

// --- appDataFolder file plumbing ---------------------------------------------
const fileIds = new Map<string, string>();

async function findFileId(name: string): Promise<string | null> {
  const cached = fileIds.get(name);
  if (cached) return cached;
  const q = encodeURIComponent(`name='${name}'`);
  const res = await driveFetch(`${API}/files?spaces=appDataFolder&q=${q}&fields=files(id)`);
  if (!res.ok) throw new Error(`Drive list failed (${res.status}).`);
  const data = (await res.json()) as { files?: { id: string }[] };
  const id = data.files?.[0]?.id ?? null;
  if (id) fileIds.set(name, id);
  return id;
}

async function ensureFileId(name: string): Promise<string> {
  const found = await findFileId(name);
  if (found) return found;
  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify({ name, parents: ['appDataFolder'] })], {
      type: 'application/json',
    }),
  );
  form.append('file', new Blob(['[]'], { type: 'application/json' }));
  const res = await driveFetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`Drive create failed (${res.status}).`);
  const data = (await res.json()) as { id: string };
  fileIds.set(name, data.id);
  return data.id;
}

// --- Storage envelope (compat contract, semptify.storage v1) ----------------
// Every module collection file is an enveloped document so cross-module
// readers and future versions can trust what they're holding:
//   { semptify_storage: 1, module: 'crm', collection: 'contacts',
//     updated: '<iso>', rows: [...] }
// Legacy v0 files were bare JSON arrays — readRows upgrades them on read
// and the next write re-persists them enveloped. A file stamped with a
// version NEWER than we understand must fail loudly, never silently
// parse as something else.
const STORAGE_VERSION = 1;
const MODULE_NAME = 'crm';

interface StorageEnvelope<T> {
  semptify_storage: number;
  module: string;
  collection: string;
  updated: string;
  rows: T[];
}

function collectionOf(name: string): string {
  return name.replace(/^semptify\.crm\./, '').replace(/\.json$/, '');
}

function unwrap<T>(raw: unknown, name: string): T[] {
  if (Array.isArray(raw)) return raw as T[]; // v0 legacy — bare array
  const env = raw as Partial<StorageEnvelope<T>> | null;
  if (env && Array.isArray(env.rows)) {
    const v = env.semptify_storage ?? 0;
    if (v > STORAGE_VERSION) {
      throw new Error(
        `${name} was written by a newer storage version (v${v}); update the app.`,
      );
    }
    return env.rows;
  }
  throw new Error(`${name}: unrecognized storage format.`);
}

async function readRows<T>(name: string): Promise<T[]> {
  const id = await findFileId(name);
  if (!id) return [];
  const res = await driveFetch(`${API}/files/${id}?alt=media`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Drive read failed (${res.status}).`);
  const text = await res.text();
  return text ? unwrap<T>(JSON.parse(text), name) : [];
}

async function writeRows<T>(name: string, rows: T[]): Promise<void> {
  const id = await ensureFileId(name);
  const envelope: StorageEnvelope<T> = {
    semptify_storage: STORAGE_VERSION,
    module: MODULE_NAME,
    collection: collectionOf(name),
    updated: new Date().toISOString(),
    rows,
  };
  const res = await driveFetch(`${UPLOAD}/files/${id}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  if (!res.ok) throw new Error(`Drive write failed (${res.status}).`);
}

// Writes serialize per file so rapid saves can't clobber each other
// (read-modify-write of the whole JSON array — fine at this scale).
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(name: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(name) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(task);
  queues.set(name, run);
  return run;
}

// Upload file content as a real file in appDataFolder (multipart: metadata +
// bytes in one request, like ensureFileId). Returns the Drive file id.
async function uploadAttachmentFile(name: string, blob: Blob): Promise<string> {
  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify({ name, parents: ['appDataFolder'] })], {
      type: 'application/json',
    }),
  );
  form.append('file', blob);
  const res = await driveFetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`Drive upload failed (${res.status}).`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

async function deleteDriveFile(fileId: string): Promise<void> {
  const res = await driveFetch(`${API}/files/${fileId}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`Drive delete failed (${res.status}).`);
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// Row logic mirrors LocalStore exactly — same defaults, same overlap rule.
export class DriveStore implements Store {
  readonly mode = 'drive' as const;

  async listContacts(): Promise<Contact[]> {
    const rows = await enqueue(FILES.contacts, () => readRows<Contact>(FILES.contacts));
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  async upsertContact(input: ContactInput): Promise<Contact> {
    return enqueue(FILES.contacts, async () => {
      const rows = await readRows<Contact>(FILES.contacts);
      const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
      const row: Contact = {
        id: existing?.id ?? crypto.randomUUID(),
        user_id: existing?.user_id ?? 'drive',
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        org: input.org ?? existing?.org ?? null,
        role: input.role ?? existing?.role ?? null,
        address: input.address ?? existing?.address ?? null,
        website: input.website ?? existing?.website ?? null,
        tags: input.tags ?? existing?.tags ?? [],
        plugin_data: input.plugin_data ?? existing?.plugin_data ?? {},
        created_at: existing?.created_at ?? new Date().toISOString(),
      };
      await writeRows(FILES.contacts, [...rows.filter((r) => r.id !== row.id), row]);
      return row;
    });
  }

  async deleteContact(id: string): Promise<void> {
    await enqueue(FILES.contacts, async () => {
      const rows = await readRows<Contact>(FILES.contacts);
      await writeRows(FILES.contacts, rows.filter((r) => r.id !== id));
    });
    await enqueue(FILES.appointments, async () => {
      const rows = await readRows<Appointment>(FILES.appointments);
      await writeRows(FILES.appointments, rows.filter((r) => r.contact_id !== id));
    });
    await enqueue(FILES.interactions, async () => {
      const rows = await readRows<Interaction>(FILES.interactions);
      await writeRows(FILES.interactions, rows.filter((r) => r.contact_id !== id));
    });
    // Match the FK's `on delete set null`: matters stay, unlinked.
    await enqueue(FILES.matters, async () => {
      const rows = await readRows<Matter>(FILES.matters);
      await writeRows(
        FILES.matters,
        rows.map((r) => (r.contact_id === id ? { ...r, contact_id: null } : r)),
      );
    });
    // Contact's documents go with the contact (FK: on delete cascade) —
    // including their content files in appDataFolder.
    await enqueue(FILES.attachments, async () => {
      const rows = await readRows<Attachment>(FILES.attachments);
      for (const r of rows.filter((r) => r.contact_id === id)) {
        if (r.drive_file_id) await deleteDriveFile(r.drive_file_id).catch(() => {});
      }
      await writeRows(
        FILES.attachments,
        rows.filter((r) => r.contact_id !== id),
      );
    });
  }

  async listMatters(contactId?: string): Promise<Matter[]> {
    let rows = await enqueue(FILES.matters, () => readRows<Matter>(FILES.matters));
    if (contactId) rows = rows.filter((r) => r.contact_id === contactId);
    return rows.sort((a, b) => b.opened_at.localeCompare(a.opened_at));
  }

  async upsertMatter(input: MatterInput): Promise<Matter> {
    return enqueue(FILES.matters, async () => {
      const rows = await readRows<Matter>(FILES.matters);
      const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
      const stage = input.stage ?? existing?.stage ?? 'new';
      const row: Matter = {
        id: existing?.id ?? crypto.randomUUID(),
        user_id: existing?.user_id ?? 'drive',
        contact_id:
          input.contact_id !== undefined ? input.contact_id : (existing?.contact_id ?? null),
        title: input.title,
        stage,
        summary: input.summary !== undefined ? input.summary : (existing?.summary ?? null),
        opened_at:
          input.opened_at !== undefined
            ? input.opened_at
            : (existing?.opened_at ?? new Date().toISOString()),
        closed_at:
          input.closed_at !== undefined ? input.closed_at : (existing?.closed_at ?? null),
        plugin_data: input.plugin_data ?? existing?.plugin_data ?? {},
        created_at: existing?.created_at ?? new Date().toISOString(),
      };
      await writeRows(FILES.matters, [...rows.filter((r) => r.id !== row.id), row]);
      return row;
    });
  }

  async deleteMatter(id: string): Promise<void> {
    await enqueue(FILES.matters, async () => {
      const rows = await readRows<Matter>(FILES.matters);
      await writeRows(FILES.matters, rows.filter((r) => r.id !== id));
    });
    // Match the FK's `on delete set null`: linked rows stay, unlinked.
    await enqueue(FILES.interactions, async () => {
      const rows = await readRows<Interaction>(FILES.interactions);
      await writeRows(
        FILES.interactions,
        rows.map((r) => (r.matter_id === id ? { ...r, matter_id: null } : r)),
      );
    });
    await enqueue(FILES.appointments, async () => {
      const rows = await readRows<Appointment>(FILES.appointments);
      await writeRows(
        FILES.appointments,
        rows.map((r) => (r.matter_id === id ? { ...r, matter_id: null } : r)),
      );
    });
    await enqueue(FILES.attachments, async () => {
      const rows = await readRows<Attachment>(FILES.attachments);
      await writeRows(
        FILES.attachments,
        rows.map((r) => (r.matter_id === id ? { ...r, matter_id: null } : r)),
      );
    });
  }

  async listAppointments(range?: { from: string; to: string }): Promise<Appointment[]> {
    let rows = await enqueue(FILES.appointments, () =>
      readRows<Appointment>(FILES.appointments),
    );
    if (range) rows = rows.filter((r) => r.starts_at < range.to && r.ends_at > range.from);
    return rows.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }

  async upsertAppointment(input: AppointmentInput): Promise<Appointment> {
    return enqueue(FILES.appointments, async () => {
      const rows = await readRows<Appointment>(FILES.appointments);
      const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
      const row: Appointment = {
        id: existing?.id ?? crypto.randomUUID(),
        user_id: existing?.user_id ?? 'drive',
        contact_id: input.contact_id ?? null,
        matter_id:
          input.matter_id !== undefined ? input.matter_id : (existing?.matter_id ?? null),
        title: input.title,
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        status: input.status ?? existing?.status ?? 'scheduled',
        // Preserve-if-undefined, matching LocalStore: partial updates
        // (status toggles) must not clear the series.
        recur_rule:
          input.recur_rule !== undefined
            ? input.recur_rule
            : (existing?.recur_rule ?? null),
        recur_until:
          input.recur_until !== undefined
            ? input.recur_until
            : (existing?.recur_until ?? null),
        plugin_data: input.plugin_data ?? existing?.plugin_data ?? {},
        created_at: existing?.created_at ?? new Date().toISOString(),
      };
      await writeRows(FILES.appointments, [...rows.filter((r) => r.id !== row.id), row]);
      return row;
    });
  }

  async deleteAppointment(id: string): Promise<void> {
    await enqueue(FILES.appointments, async () => {
      const rows = await readRows<Appointment>(FILES.appointments);
      await writeRows(FILES.appointments, rows.filter((r) => r.id !== id));
    });
    // Match the FK's `on delete set null`: linked log entries stay, unlinked.
    await enqueue(FILES.interactions, async () => {
      const rows = await readRows<Interaction>(FILES.interactions);
      await writeRows(
        FILES.interactions,
        rows.map((r) => (r.appointment_id === id ? { ...r, appointment_id: null } : r)),
      );
    });
  }

  async findConflicts(startsAt: string, endsAt: string, excludeId?: string): Promise<Appointment[]> {
    const rows = await enqueue(FILES.appointments, () =>
      readRows<Appointment>(FILES.appointments),
    );
    const active = rows.filter((r) => r.id !== excludeId && r.status !== 'canceled');
    // Expand recurring rows so a series occurrence (not just the anchor
    // row) counts as a conflict in this window.
    return expandAppointments(active, new Date(startsAt), new Date(endsAt)).filter(
      (r) => overlaps(r.starts_at, r.ends_at, startsAt, endsAt),
    );
  }

  async listInteractions(contactId?: string): Promise<Interaction[]> {
    let rows = await enqueue(FILES.interactions, () =>
      readRows<Interaction>(FILES.interactions),
    );
    if (contactId) rows = rows.filter((r) => r.contact_id === contactId);
    return rows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }

  async addInteraction(input: InteractionInput): Promise<Interaction> {
    return this.upsertInteraction(input);
  }

  async upsertInteraction(input: InteractionInput): Promise<Interaction> {
    return enqueue(FILES.interactions, async () => {
      const rows = await readRows<Interaction>(FILES.interactions);
      const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
      const status =
        input.status ?? existing?.status ?? (input.type === 'note' ? 'resolved' : 'new');
      const resolvedAt =
        input.resolved_at !== undefined
          ? input.resolved_at
          : status === 'resolved'
            ? (existing?.resolved_at ?? new Date().toISOString())
            : null;
      const pick = <T,>(v: T | undefined, fallback: T | null | undefined): T | null =>
        v !== undefined ? v : (fallback ?? null);
      const row: Interaction = {
        id: existing?.id ?? crypto.randomUUID(),
        user_id: existing?.user_id ?? 'drive',
        contact_id: pick(input.contact_id, existing?.contact_id),
        appointment_id: pick(input.appointment_id, existing?.appointment_id),
        matter_id: pick(input.matter_id, existing?.matter_id),
        type: input.type,
        subject_outline: pick(input.subject_outline, existing?.subject_outline),
        notes: pick(input.notes, existing?.notes),
        duration_sec: pick(input.duration_sec, existing?.duration_sec),
        outcome: pick(input.outcome, existing?.outcome),
        occurred_at:
          input.occurred_at !== undefined
            ? input.occurred_at
            : (existing?.occurred_at ?? new Date().toISOString()),
        status,
        resolved_at: resolvedAt,
        due_at: pick(input.due_at, existing?.due_at),
        plugin_data: input.plugin_data ?? existing?.plugin_data ?? {},
        created_at: existing?.created_at ?? new Date().toISOString(),
      };
      await writeRows(FILES.interactions, [...rows.filter((r) => r.id !== row.id), row]);
      return row;
    });
  }

  async deleteInteraction(id: string): Promise<void> {
    await enqueue(FILES.interactions, async () => {
      const rows = await readRows<Interaction>(FILES.interactions);
      await writeRows(FILES.interactions, rows.filter((r) => r.id !== id));
    });
  }

  async listAttachments(filter: {
    contactId?: string;
    matterId?: string;
  }): Promise<Attachment[]> {
    let rows = await enqueue(FILES.attachments, () =>
      readRows<Attachment>(FILES.attachments),
    );
    if (filter.contactId) rows = rows.filter((r) => r.contact_id === filter.contactId);
    if (filter.matterId) rows = rows.filter((r) => r.matter_id === filter.matterId);
    return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async addAttachment(input: AttachmentInput, bytes: ArrayBuffer | Blob): Promise<Attachment> {
    const blob = bytes instanceof Blob ? bytes : new Blob([bytes]);
    const row: Attachment = {
      id: input.id ?? crypto.randomUUID(),
      user_id: 'drive',
      contact_id: input.contact_id ?? null,
      matter_id: input.matter_id ?? null,
      filename: input.filename,
      mime_type: input.mime_type ?? (blob.type || 'application/octet-stream'),
      size_bytes: input.size_bytes ?? blob.size,
      drive_file_id: null,
      body_b64: null, // content lives in the appDataFolder file, not the JSON row
      created_at: new Date().toISOString(),
    };
    row.drive_file_id = await uploadAttachmentFile(
      `semptify.crm.attachment.${row.id}`,
      blob,
    );
    try {
      await enqueue(FILES.attachments, async () => {
        const rows = await readRows<Attachment>(FILES.attachments);
        await writeRows(FILES.attachments, [...rows.filter((r) => r.id !== row.id), row]);
      });
    } catch (e) {
      // Metadata write failed — don't leave an orphan content file behind.
      await deleteDriveFile(row.drive_file_id).catch(() => {});
      throw e;
    }
    return row;
  }

  async getAttachmentContent(id: string): Promise<Blob> {
    const rows = await enqueue(FILES.attachments, () =>
      readRows<Attachment>(FILES.attachments),
    );
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error('Attachment not found.');
    if (!row.drive_file_id) throw new Error('Attachment has no stored file content.');
    const res = await driveFetch(`${API}/files/${row.drive_file_id}?alt=media`);
    if (!res.ok) throw new Error(`Drive download failed (${res.status}).`);
    return res.blob();
  }

  async deleteAttachment(id: string): Promise<void> {
    await enqueue(FILES.attachments, async () => {
      const rows = await readRows<Attachment>(FILES.attachments);
      const row = rows.find((r) => r.id === id);
      if (row?.drive_file_id) await deleteDriveFile(row.drive_file_id);
      await writeRows(
        FILES.attachments,
        rows.filter((r) => r.id !== id),
      );
    });
  }

  async search(q: string): Promise<SearchResults> {
    const needle = q.trim().toLowerCase();
    if (!needle) return { contacts: [], matters: [], appointments: [], interactions: [] };
    const has = (v: string | null | undefined) => (v ?? '').toLowerCase().includes(needle);
    const [contacts, matters, appointments, interactions] = await Promise.all([
      enqueue(FILES.contacts, () => readRows<Contact>(FILES.contacts)),
      enqueue(FILES.matters, () => readRows<Matter>(FILES.matters)),
      enqueue(FILES.appointments, () => readRows<Appointment>(FILES.appointments)),
      enqueue(FILES.interactions, () => readRows<Interaction>(FILES.interactions)),
    ]);
    return {
      contacts: contacts.filter(
        (c) => has(c.name) || has(c.email) || has(c.phone) || has(c.org) || has(c.role),
      ),
      matters: matters.filter((m) => has(m.title) || has(m.summary)),
      appointments: appointments.filter((a) => has(a.title)),
      interactions: interactions.filter((i) => has(i.subject_outline) || has(i.notes)),
    };
  }

  // Cross-module plugin state — not part of the Store interface; other
  // Semptify modules sharing this OAuth client can use it via the same file.
  async readPluginData<T = Record<string, unknown>>(): Promise<T[]> {
    return enqueue(FILES.pluginData, () => readRows<T>(FILES.pluginData));
  }

  async writePluginData<T>(rows: T[]): Promise<void> {
    return enqueue(FILES.pluginData, () => writeRows(FILES.pluginData, rows));
  }

  // Store-interface settings access on top of the shared plugin_data file.
  async getPluginData(
    plugin: string,
    key: string,
  ): Promise<Record<string, unknown> | null> {
    const rows = await this.readPluginData<PluginDataRow>();
    return rows.find((r) => isSettingRow(r, plugin, key))?.data?.value ?? null;
  }

  async setPluginData(
    plugin: string,
    key: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const rows = await this.readPluginData<PluginDataRow>();
    await this.writePluginData([
      ...rows.filter((r) => !isSettingRow(r, plugin, key)),
      settingRow(plugin, key, data),
    ]);
  }
}
