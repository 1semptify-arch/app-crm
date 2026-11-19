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

const KEYS = {
  contacts: 'crm.contacts',
  matters: 'crm.matters',
  appointments: 'crm.appointments',
  interactions: 'crm.interactions',
  attachments: 'crm.attachments',
  pluginData: 'crm.pluginData',
} as const;

// Local demo mode keeps attachment bodies inline (base64 in localStorage),
// so file size is capped — Drive mode has no cap.
const LOCAL_ATTACHMENT_CAP = 1024 * 1024;
const LOCAL_ATTACHMENT_CAP_ERROR =
  'Local demo mode keeps files under 1 MB — connect Drive for full attachments.';

async function bytesToBase64(bytes: ArrayBuffer | Blob): Promise<string> {
  const buf = bytes instanceof Blob ? await bytes.arrayBuffer() : bytes;
  const u8 = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBlob(b64: string, mimeType: string): Blob {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: mimeType });
}

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, rows: T[]): void {
  localStorage.setItem(key, JSON.stringify(rows));
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export class LocalStore implements Store {
  readonly mode = 'local' as const;

  async getPluginData(
    plugin: string,
    key: string,
  ): Promise<Record<string, unknown> | null> {
    const rows = read<PluginDataRow>(KEYS.pluginData);
    return rows.find((r) => isSettingRow(r, plugin, key))?.data?.value ?? null;
  }

  async setPluginData(
    plugin: string,
    key: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const rows = read<PluginDataRow>(KEYS.pluginData);
    write(KEYS.pluginData, [
      ...rows.filter((r) => !isSettingRow(r, plugin, key)),
      settingRow(plugin, key, data),
    ]);
  }

  async listContacts(): Promise<Contact[]> {
    return read<Contact>(KEYS.contacts).sort((a, b) => a.name.localeCompare(b.name));
  }

  async upsertContact(input: ContactInput): Promise<Contact> {
    const rows = read<Contact>(KEYS.contacts);
    const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
    const row: Contact = {
      id: existing?.id ?? crypto.randomUUID(),
      user_id: existing?.user_id ?? 'local',
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
    write(KEYS.contacts, [...rows.filter((r) => r.id !== row.id), row]);
    return row;
  }

  async deleteContact(id: string): Promise<void> {
    write(
      KEYS.contacts,
      read<Contact>(KEYS.contacts).filter((r) => r.id !== id),
    );
    write(
      KEYS.appointments,
      read<Appointment>(KEYS.appointments).filter((r) => r.contact_id !== id),
    );
    write(
      KEYS.interactions,
      read<Interaction>(KEYS.interactions).filter((r) => r.contact_id !== id),
    );
    // Match the FK's `on delete set null`: matters stay, unlinked.
    write(
      KEYS.matters,
      read<Matter>(KEYS.matters).map((r) =>
        r.contact_id === id ? { ...r, contact_id: null } : r,
      ),
    );
    // Contact's documents go with the contact (FK: on delete cascade).
    write(
      KEYS.attachments,
      read<Attachment>(KEYS.attachments).filter((r) => r.contact_id !== id),
    );
  }

  async listMatters(contactId?: string): Promise<Matter[]> {
    let rows = read<Matter>(KEYS.matters);
    if (contactId) rows = rows.filter((r) => r.contact_id === contactId);
    return rows.sort((a, b) => b.opened_at.localeCompare(a.opened_at));
  }

  async upsertMatter(input: MatterInput): Promise<Matter> {
    const rows = read<Matter>(KEYS.matters);
    const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
    const stage = input.stage ?? existing?.stage ?? 'new';
    const row: Matter = {
      id: existing?.id ?? crypto.randomUUID(),
      user_id: existing?.user_id ?? 'local',
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
    write(KEYS.matters, [...rows.filter((r) => r.id !== row.id), row]);
    return row;
  }

  async deleteMatter(id: string): Promise<void> {
    write(
      KEYS.matters,
      read<Matter>(KEYS.matters).filter((r) => r.id !== id),
    );
    // Match the FK's `on delete set null`: linked rows stay, unlinked.
    write(
      KEYS.interactions,
      read<Interaction>(KEYS.interactions).map((r) =>
        r.matter_id === id ? { ...r, matter_id: null } : r,
      ),
    );
    write(
      KEYS.appointments,
      read<Appointment>(KEYS.appointments).map((r) =>
        r.matter_id === id ? { ...r, matter_id: null } : r,
      ),
    );
    write(
      KEYS.attachments,
      read<Attachment>(KEYS.attachments).map((r) =>
        r.matter_id === id ? { ...r, matter_id: null } : r,
      ),
    );
  }

  async listAppointments(range?: { from: string; to: string }): Promise<Appointment[]> {
    let rows = read<Appointment>(KEYS.appointments);
    if (range) rows = rows.filter((r) => r.starts_at < range.to && r.ends_at > range.from);
    return rows.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }

  async upsertAppointment(input: AppointmentInput): Promise<Appointment> {
    const rows = read<Appointment>(KEYS.appointments);
    const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
    const row: Appointment = {
      id: existing?.id ?? crypto.randomUUID(),
      user_id: existing?.user_id ?? 'local',
      contact_id: input.contact_id ?? null,
      matter_id: input.matter_id !== undefined ? input.matter_id : (existing?.matter_id ?? null),
      title: input.title,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      status: input.status ?? existing?.status ?? 'scheduled',
      // Preserve-if-undefined: partial updates (e.g. status toggles) don't
      // mention recur fields and must not clear the series.
      recur_rule:
        input.recur_rule !== undefined ? input.recur_rule : (existing?.recur_rule ?? null),
      recur_until:
        input.recur_until !== undefined
          ? input.recur_until
          : (existing?.recur_until ?? null),
      plugin_data: input.plugin_data ?? existing?.plugin_data ?? {},
      created_at: existing?.created_at ?? new Date().toISOString(),
    };
    write(KEYS.appointments, [...rows.filter((r) => r.id !== row.id), row]);
    return row;
  }

  async deleteAppointment(id: string): Promise<void> {
    write(
      KEYS.appointments,
      read<Appointment>(KEYS.appointments).filter((r) => r.id !== id),
    );
    // Match the FK's `on delete set null`: linked log entries stay, unlinked.
    write(
      KEYS.interactions,
      read<Interaction>(KEYS.interactions).map((r) =>
        r.appointment_id === id ? { ...r, appointment_id: null } : r,
      ),
    );
  }

  async findConflicts(startsAt: string, endsAt: string, excludeId?: string): Promise<Appointment[]> {
    const rows = read<Appointment>(KEYS.appointments).filter(
      (r) => r.id !== excludeId && r.status !== 'canceled',
    );
    // Expand recurring rows so a series occurrence (not just the anchor
    // row) counts as a conflict in this window.
    return expandAppointments(rows, new Date(startsAt), new Date(endsAt)).filter(
      (r) => overlaps(r.starts_at, r.ends_at, startsAt, endsAt),
    );
  }

  async listInteractions(contactId?: string): Promise<Interaction[]> {
    let rows = read<Interaction>(KEYS.interactions);
    if (contactId) rows = rows.filter((r) => r.contact_id === contactId);
    return rows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }

  async addInteraction(input: InteractionInput): Promise<Interaction> {
    return this.upsertInteraction(input);
  }

  async upsertInteraction(input: InteractionInput): Promise<Interaction> {
    const rows = read<Interaction>(KEYS.interactions);
    const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
    const status =
      input.status ?? existing?.status ?? (input.type === 'note' ? 'resolved' : 'new');
    const resolvedAt =
      input.resolved_at !== undefined
        ? input.resolved_at
        : status === 'resolved'
          ? (existing?.resolved_at ?? new Date().toISOString())
          : null;
    const pick = <T>(v: T | undefined, fallback: T | null | undefined): T | null =>
      v !== undefined ? v : (fallback ?? null);
    const row: Interaction = {
      id: existing?.id ?? crypto.randomUUID(),
      user_id: existing?.user_id ?? 'local',
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
    write(KEYS.interactions, [...rows.filter((r) => r.id !== row.id), row]);
    return row;
  }

  async deleteInteraction(id: string): Promise<void> {
    write(
      KEYS.interactions,
      read<Interaction>(KEYS.interactions).filter((r) => r.id !== id),
    );
  }

  async listAttachments(filter: {
    contactId?: string;
    matterId?: string;
  }): Promise<Attachment[]> {
    let rows = read<Attachment>(KEYS.attachments);
    if (filter.contactId) rows = rows.filter((r) => r.contact_id === filter.contactId);
    if (filter.matterId) rows = rows.filter((r) => r.matter_id === filter.matterId);
    return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async addAttachment(input: AttachmentInput, bytes: ArrayBuffer | Blob): Promise<Attachment> {
    const size = input.size_bytes ?? (bytes instanceof Blob ? bytes.size : bytes.byteLength);
    if (size > LOCAL_ATTACHMENT_CAP) throw new Error(LOCAL_ATTACHMENT_CAP_ERROR);
    const row: Attachment = {
      id: input.id ?? crypto.randomUUID(),
      user_id: 'local',
      contact_id: input.contact_id ?? null,
      matter_id: input.matter_id ?? null,
      filename: input.filename,
      mime_type:
        input.mime_type ??
        (bytes instanceof Blob && bytes.type ? bytes.type : 'application/octet-stream'),
      size_bytes: size,
      drive_file_id: null,
      body_b64: await bytesToBase64(bytes),
      created_at: new Date().toISOString(),
    };
    write(KEYS.attachments, [
      ...read<Attachment>(KEYS.attachments).filter((r) => r.id !== row.id),
      row,
    ]);
    return row;
  }

  async getAttachmentContent(id: string): Promise<Blob> {
    const row = read<Attachment>(KEYS.attachments).find((r) => r.id === id);
    if (!row) throw new Error('Attachment not found.');
    if (!row.body_b64) throw new Error('Attachment has no stored file content.');
    return base64ToBlob(row.body_b64, row.mime_type);
  }

  async deleteAttachment(id: string): Promise<void> {
    write(
      KEYS.attachments,
      read<Attachment>(KEYS.attachments).filter((r) => r.id !== id),
    );
  }

  async search(q: string): Promise<SearchResults> {
    const needle = q.trim().toLowerCase();
    if (!needle) return { contacts: [], matters: [], appointments: [], interactions: [] };
    const has = (v: string | null | undefined) => (v ?? '').toLowerCase().includes(needle);
    return {
      contacts: read<Contact>(KEYS.contacts).filter(
        (c) => has(c.name) || has(c.email) || has(c.phone) || has(c.org) || has(c.role),
      ),
      matters: read<Matter>(KEYS.matters).filter((m) => has(m.title) || has(m.summary)),
      appointments: read<Appointment>(KEYS.appointments).filter((a) => has(a.title)),
      interactions: read<Interaction>(KEYS.interactions).filter(
        (i) => has(i.subject_outline) || has(i.notes),
      ),
    };
  }
}
