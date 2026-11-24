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
import { ConflictError, type Store } from './store';

// HTTP backend — the "case" storage mode. Active only when the SPA is
// served by crm_store.py (the unified CRM on the case box, which injects
// <meta name="x-crm-store"> into index.html). All requests go same-origin;
// the server maps Store calls onto the case's own Postgres tables, so what
// the app edits is what the legacy desks and send_center already read.
const BASE = '';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, init);
  if (r.status === 409) {
    const body = (await r.json().catch(() => ({}))) as {
      conflicts?: Appointment[];
    };
    if (body.conflicts) throw new ConflictError(body.conflicts);
    throw new Error(`409 ${path}`);
  }
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error || `${r.status} ${path}`);
  }
  return (await r.json()) as T;
}

function put<T>(path: string, body: unknown): Promise<T> {
  return req<T>(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function del(path: string): Promise<void> {
  return req<void>(path, { method: 'DELETE' });
}

export class HttpStore implements Store {
  readonly mode = 'case' as const;

  async getPluginData(
    plugin: string,
    key: string,
  ): Promise<Record<string, unknown> | null> {
    const r = await req<{ value: Record<string, unknown> | null }>(
      `/api/plugin_data?plugin=${encodeURIComponent(plugin)}&key=${encodeURIComponent(key)}`,
    );
    return r.value;
  }

  async setPluginData(
    plugin: string,
    key: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await put('/api/plugin_data', { plugin, key, data });
  }

  listContacts(): Promise<Contact[]> {
    return req<Contact[]>('/api/contacts');
  }

  async upsertContact(input: ContactInput): Promise<Contact> {
    const path = input.id
      ? `/api/contacts/${encodeURIComponent(input.id)}`
      : '/api/contacts';
    return put<Contact>(path, input);
  }

  deleteContact(id: string): Promise<void> {
    return del(`/api/contacts/${encodeURIComponent(id)}`);
  }

  listMatters(contactId?: string): Promise<Matter[]> {
    return req<Matter[]>(
      `/api/matters${contactId ? `?contact_id=${encodeURIComponent(contactId)}` : ''}`,
    );
  }

  async upsertMatter(input: MatterInput): Promise<Matter> {
    const path = input.id
      ? `/api/matters/${encodeURIComponent(input.id)}`
      : '/api/matters';
    return put<Matter>(path, input);
  }

  deleteMatter(id: string): Promise<void> {
    return del(`/api/matters/${encodeURIComponent(id)}`);
  }

  listAppointments(range?: { from: string; to: string }): Promise<Appointment[]> {
    const qs = range
      ? `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
      : '';
    return req<Appointment[]>(`/api/appointments${qs}`);
  }

  async upsertAppointment(input: AppointmentInput): Promise<Appointment> {
    const path = input.id
      ? `/api/appointments/${encodeURIComponent(input.id)}`
      : '/api/appointments';
    return put<Appointment>(path, input);
  }

  deleteAppointment(id: string): Promise<void> {
    return del(`/api/appointments/${encodeURIComponent(id)}`);
  }

  async findConflicts(
    startsAt: string,
    endsAt: string,
    excludeId?: string,
    recurRule?: string | null,
    recurUntil?: string | null,
  ): Promise<Appointment[]> {
    const r = await req<{ conflicts: Appointment[] }>(
      `/api/appointments/conflicts?starts_at=${encodeURIComponent(startsAt)}` +
        `&ends_at=${encodeURIComponent(endsAt)}` +
        (excludeId ? `&exclude=${encodeURIComponent(excludeId)}` : '') +
        (recurRule ? `&recur_rule=${encodeURIComponent(recurRule)}` : '') +
        (recurUntil ? `&recur_until=${encodeURIComponent(recurUntil)}` : ''),
    );
    return r.conflicts;
  }

  listInteractions(contactId?: string): Promise<Interaction[]> {
    return req<Interaction[]>(
      `/api/interactions${contactId ? `?contact_id=${encodeURIComponent(contactId)}` : ''}`,
    );
  }

  async addInteraction(input: InteractionInput): Promise<Interaction> {
    const r = await fetch(`${BASE}/api/interactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!r.ok) throw new Error(`${r.status} /api/interactions`);
    return (await r.json()) as Interaction;
  }

  async upsertInteraction(input: InteractionInput): Promise<Interaction> {
    const path = input.id
      ? `/api/interactions/${encodeURIComponent(input.id)}`
      : '/api/interactions';
    return put<Interaction>(path, input);
  }

  deleteInteraction(id: string): Promise<void> {
    return del(`/api/interactions/${encodeURIComponent(id)}`);
  }

  listAttachments(filter: {
    contactId?: string;
    matterId?: string;
  }): Promise<Attachment[]> {
    const qs = new URLSearchParams();
    if (filter.contactId) qs.set('contact_id', filter.contactId);
    if (filter.matterId) qs.set('matter_id', filter.matterId);
    const s = qs.toString();
    return req<Attachment[]>(`/api/attachments${s ? `?${s}` : ''}`);
  }

  async addAttachment(
    input: AttachmentInput,
    bytes: ArrayBuffer | Blob,
  ): Promise<Attachment> {
    const fd = new FormData();
    fd.set('meta', JSON.stringify(input));
    fd.set('file', new Blob([bytes]), input.filename);
    const r = await fetch(`${BASE}/api/attachments`, {
      method: 'POST',
      body: fd,
    });
    if (!r.ok) throw new Error(`${r.status} /api/attachments`);
    return (await r.json()) as Attachment;
  }

  async getAttachmentContent(id: string): Promise<Blob> {
    const r = await fetch(
      `${BASE}/api/attachments/${encodeURIComponent(id)}/content`,
    );
    if (!r.ok) throw new Error(`${r.status} attachment content`);
    return r.blob();
  }

  deleteAttachment(id: string): Promise<void> {
    return del(`/api/attachments/${encodeURIComponent(id)}`);
  }

  search(q: string): Promise<SearchResults> {
    return req<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`);
  }
}

// Case mode engages when crm_store.py serves this build — it stamps the
// marker meta into index.html on the way out. Standalone hosting (Render,
// dev server, file open) has no marker and falls through to the other
// stores unchanged.
export function isCaseServed(): boolean {
  if (typeof document === 'undefined') return false;
  return (
    document
      .querySelector('meta[name="x-crm-store"]')
      ?.getAttribute('content') === 'same-origin'
  );
}
