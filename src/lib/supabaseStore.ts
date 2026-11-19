import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
import { isSettingRow, type PluginDataRow } from './pluginData';
import { expandAppointments } from './recurrence';
import { ConflictError, type Store } from './store';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string)
  : null;

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signIn(email: string, password: string) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email: string, password: string) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

function requireClient(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

export class SupabaseStore implements Store {
  readonly mode = 'supabase' as const;

  async getPluginData(
    plugin: string,
    key: string,
  ): Promise<Record<string, unknown> | null> {
    const { data, error } = await requireClient()
      .from('plugin_data')
      .select('id, data')
      .eq('plugin', plugin)
      .eq('entity_type', 'setting')
      .is('entity_id', null);
    if (error) throw error;
    const row = (data ?? []).find((r) => isSettingRow(r as PluginDataRow, plugin, key));
    return (row as PluginDataRow | undefined)?.data?.value ?? null;
  }

  async setPluginData(
    plugin: string,
    key: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const client = requireClient();
    const { data: rows, error } = await client
      .from('plugin_data')
      .select('id, data')
      .eq('plugin', plugin)
      .eq('entity_type', 'setting')
      .is('entity_id', null);
    if (error) throw error;
    const existing = (rows ?? []).find((r) => isSettingRow(r as PluginDataRow, plugin, key));
    const payload = { key, value: data };
    const query = existing
      ? client
          .from('plugin_data')
          .update({ data: payload })
          .eq('id', (existing as { id: string }).id)
      : client.from('plugin_data').insert({
          plugin,
          entity_type: 'setting',
          entity_id: null,
          data: payload,
        });
    const { error: writeError } = await query;
    if (writeError) throw writeError;
  }

  async listContacts(): Promise<Contact[]> {
    const { data, error } = await requireClient()
      .from('contacts')
      .select('*')
      .order('name', { ascending: true });
    if (error) throw error;
    return data as Contact[];
  }

  async upsertContact(input: ContactInput): Promise<Contact> {
    const client = requireClient();
    const row = {
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      org: input.org ?? null,
      role: input.role ?? null,
      address: input.address ?? null,
      website: input.website ?? null,
      tags: input.tags ?? [],
      plugin_data: input.plugin_data ?? {},
    };
    const query = input.id
      ? client.from('contacts').update(row).eq('id', input.id).select().single()
      : client.from('contacts').insert(row).select().single();
    const { data, error } = await query;
    if (error) throw error;
    return data as Contact;
  }

  async deleteContact(id: string): Promise<void> {
    // FKs cascade: appointments and interactions go with the contact;
    // matters keep their row with contact_id set null by the FK.
    const { error } = await requireClient().from('contacts').delete().eq('id', id);
    if (error) throw error;
  }

  async listMatters(contactId?: string): Promise<Matter[]> {
    let query = requireClient()
      .from('matters')
      .select('*')
      .order('opened_at', { ascending: false });
    if (contactId) query = query.eq('contact_id', contactId);
    const { data, error } = await query;
    if (error) throw error;
    return data as Matter[];
  }

  async upsertMatter(input: MatterInput): Promise<Matter> {
    const client = requireClient();
    const row: Record<string, unknown> = {
      contact_id: input.contact_id ?? null,
      title: input.title,
      stage: input.stage ?? 'new',
      summary: input.summary ?? null,
      closed_at: input.closed_at ?? null,
      plugin_data: input.plugin_data ?? {},
    };
    if (input.opened_at) row.opened_at = input.opened_at;
    const query = input.id
      ? client.from('matters').update(row).eq('id', input.id).select().single()
      : client.from('matters').insert(row).select().single();
    const { data, error } = await query;
    if (error) throw error;
    return data as Matter;
  }

  async deleteMatter(id: string): Promise<void> {
    // FK is `on delete set null`: linked rows stay, unlinked.
    const { error } = await requireClient().from('matters').delete().eq('id', id);
    if (error) throw error;
  }

  async listAppointments(range?: { from: string; to: string }): Promise<Appointment[]> {
    let query = requireClient()
      .from('appointments')
      .select('*')
      .order('starts_at', { ascending: true });
    if (range) query = query.lt('starts_at', range.to).gt('ends_at', range.from);
    const { data, error } = await query;
    if (error) throw error;
    return data as Appointment[];
  }

  async upsertAppointment(input: AppointmentInput): Promise<Appointment> {
    const client = requireClient();
    const row: Record<string, unknown> = {
      contact_id: input.contact_id ?? null,
      matter_id: input.matter_id ?? null,
      title: input.title,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      status: input.status ?? 'scheduled',
      plugin_data: input.plugin_data ?? {},
    };
    // Preserve-if-undefined on updates: partial writes (status toggles)
    // don't mention recur fields and must not clear the series.
    if (input.recur_rule !== undefined || !input.id) row.recur_rule = input.recur_rule ?? null;
    if (input.recur_until !== undefined || !input.id)
      row.recur_until = input.recur_until ?? null;
    const query = input.id
      ? client.from('appointments').update(row).eq('id', input.id).select().single()
      : client.from('appointments').insert(row).select().single();
    const { data, error } = await query;
    if (error) {
      if (error.code === '23P01') {
        throw new ConflictError(
          await this.findConflicts(input.starts_at, input.ends_at, input.id),
        );
      }
      throw error;
    }
    return data as Appointment;
  }

  async deleteAppointment(id: string): Promise<void> {
    // FK is `on delete set null`: linked interactions stay, unlinked.
    const { error } = await requireClient().from('appointments').delete().eq('id', id);
    if (error) throw error;
  }

  async findConflicts(startsAt: string, endsAt: string, excludeId?: string): Promise<Appointment[]> {
    // Fetch all active rows, then expand series client-side — a recurring
    // row's occurrence can clash even when its anchor doesn't (the
    // exclusion constraint only sees anchors).
    let query = requireClient()
      .from('appointments')
      .select('*')
      .neq('status', 'canceled')
      .order('starts_at', { ascending: true });
    if (excludeId) query = query.neq('id', excludeId);
    const { data, error } = await query;
    if (error) throw error;
    return expandAppointments(
      (data ?? []) as Appointment[],
      new Date(startsAt),
      new Date(endsAt),
    ).filter((r) => r.starts_at < endsAt && r.ends_at > startsAt);
  }

  async listInteractions(contactId?: string): Promise<Interaction[]> {
    let query = requireClient()
      .from('interactions')
      .select('*')
      .order('occurred_at', { ascending: false });
    if (contactId) query = query.eq('contact_id', contactId);
    const { data, error } = await query;
    if (error) throw error;
    return data as Interaction[];
  }

  async addInteraction(input: InteractionInput): Promise<Interaction> {
    return this.upsertInteraction(input);
  }

  async upsertInteraction(input: InteractionInput): Promise<Interaction> {
    const client = requireClient();
    if (input.id) {
      // Partial update: only keys present on the input are patched, so a
      // status-only change (e.g. "Mark done") leaves the body fields alone.
      const patch: Record<string, unknown> = {};
      if (input.contact_id !== undefined) patch.contact_id = input.contact_id;
      if (input.appointment_id !== undefined) patch.appointment_id = input.appointment_id;
      if (input.matter_id !== undefined) patch.matter_id = input.matter_id;
      if (input.type !== undefined) patch.type = input.type;
      if (input.subject_outline !== undefined) patch.subject_outline = input.subject_outline;
      if (input.notes !== undefined) patch.notes = input.notes;
      if (input.duration_sec !== undefined) patch.duration_sec = input.duration_sec;
      if (input.outcome !== undefined) patch.outcome = input.outcome;
      if (input.occurred_at !== undefined) patch.occurred_at = input.occurred_at;
      if (input.status !== undefined) patch.status = input.status;
      if (input.resolved_at !== undefined) patch.resolved_at = input.resolved_at;
      if (input.due_at !== undefined) patch.due_at = input.due_at;
      if (input.plugin_data !== undefined) patch.plugin_data = input.plugin_data;
      const { data, error } = await client
        .from('interactions')
        .update(patch)
        .eq('id', input.id)
        .select()
        .single();
      if (error) throw error;
      return data as Interaction;
    }
    const status = input.status ?? (input.type === 'note' ? 'resolved' : 'new');
    const { data, error } = await client
      .from('interactions')
      .insert({
        contact_id: input.contact_id ?? null,
        appointment_id: input.appointment_id ?? null,
        matter_id: input.matter_id ?? null,
        type: input.type,
        subject_outline: input.subject_outline ?? null,
        notes: input.notes ?? null,
        duration_sec: input.duration_sec ?? null,
        outcome: input.outcome ?? null,
        occurred_at: input.occurred_at ?? new Date().toISOString(),
        status,
        resolved_at:
          input.resolved_at !== undefined
            ? input.resolved_at
            : status === 'resolved'
              ? new Date().toISOString()
              : null,
        due_at: input.due_at ?? null,
        plugin_data: input.plugin_data ?? {},
      })
      .select()
      .single();
    if (error) throw error;
    return data as Interaction;
  }

  async deleteInteraction(id: string): Promise<void> {
    const { error } = await requireClient().from('interactions').delete().eq('id', id);
    if (error) throw error;
  }

  async listAttachments(filter: {
    contactId?: string;
    matterId?: string;
  }): Promise<Attachment[]> {
    let query = requireClient()
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false });
    if (filter.contactId) query = query.eq('contact_id', filter.contactId);
    if (filter.matterId) query = query.eq('matter_id', filter.matterId);
    const { data, error } = await query;
    if (error) throw error;
    return data as Attachment[];
  }

  async addAttachment(input: AttachmentInput, bytes: ArrayBuffer | Blob): Promise<Attachment> {
    // Bytes go to the private `crm-documents` storage bucket under the
    // user's own folder (<uid>/<doc id>); the documents row keeps the
    // metadata + storage_path. Requires the bucket + policy from
    // supabase/schema.sql (re-run it on older projects).
    const client = requireClient();
    const { data: userData, error: userErr } = await client.auth.getUser();
    if (userErr || !userData.user) throw userErr ?? new Error('Not signed in.');
    const blob = bytes instanceof Blob ? bytes : new Blob([bytes]);
    const id = input.id ?? crypto.randomUUID();
    const mime = input.mime_type ?? (blob.type || 'application/octet-stream');
    const path = `${userData.user.id}/${id}`;
    const { error: upErr } = await client.storage
      .from('crm-documents')
      .upload(path, blob, { contentType: mime });
    if (upErr) throw upErr;
    const { data, error } = await client
      .from('documents')
      .insert({
        id,
        contact_id: input.contact_id ?? null,
        matter_id: input.matter_id ?? null,
        filename: input.filename,
        mime_type: mime,
        size_bytes: input.size_bytes ?? blob.size,
        storage_path: path,
        drive_file_id: null,
        body_b64: null,
      })
      .select()
      .single();
    if (error) {
      // Metadata write failed — don't leave an orphan object behind.
      await client.storage.from('crm-documents').remove([path]).catch(() => {});
      throw error;
    }
    return data as Attachment;
  }

  async getAttachmentContent(id: string): Promise<Blob> {
    const client = requireClient();
    const { data: row, error } = await client
      .from('documents')
      .select('storage_path')
      .eq('id', id)
      .single();
    if (error) throw error;
    const path = (row as { storage_path?: string | null } | null)?.storage_path;
    if (!path) throw new Error('Attachment has no stored file content.');
    const { data, error: dlErr } = await client.storage
      .from('crm-documents')
      .download(path);
    if (dlErr) throw dlErr;
    return data;
  }

  async deleteAttachment(id: string): Promise<void> {
    const client = requireClient();
    const { data: row } = await client
      .from('documents')
      .select('storage_path')
      .eq('id', id)
      .maybeSingle();
    const { error } = await client.from('documents').delete().eq('id', id);
    if (error) throw error;
    const path = (row as { storage_path?: string | null } | null)?.storage_path;
    if (path) await client.storage.from('crm-documents').remove([path]).catch(() => {});
  }

  async search(q: string): Promise<SearchResults> {
    const needle = q.trim().replace(/[%,()]/g, '');
    if (!needle) return { contacts: [], matters: [], appointments: [], interactions: [] };
    const like = `%${needle}%`;
    const client = requireClient();
    const [contacts, matters, appointments, interactions] = await Promise.all([
      client
        .from('contacts')
        .select('*')
        .or(
          `name.ilike.${like},email.ilike.${like},phone.ilike.${like},org.ilike.${like},role.ilike.${like}`,
        )
        .limit(20),
      client
        .from('matters')
        .select('*')
        .or(`title.ilike.${like},summary.ilike.${like}`)
        .limit(20),
      client.from('appointments').select('*').ilike('title', like).limit(20),
      client
        .from('interactions')
        .select('*')
        .or(`subject_outline.ilike.${like},notes.ilike.${like}`)
        .limit(20),
    ]);
    return {
      contacts: (contacts.data ?? []) as Contact[],
      matters: (matters.data ?? []) as Matter[],
      appointments: (appointments.data ?? []) as Appointment[],
      interactions: (interactions.data ?? []) as Interaction[],
    };
  }
}
