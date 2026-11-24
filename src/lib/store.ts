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
import { DriveStore, isDriveConfigured } from './driveStore';
import { HttpStore, isCaseServed } from './httpStore';
import { LocalStore } from './localStore';
import { SupabaseStore, isSupabaseConfigured } from './supabaseStore';

export interface Store {
  readonly mode: 'local' | 'supabase' | 'drive' | 'case';
  // Cross-module plugin state (settings-style): one row per (plugin, key).
  // Same shape on all three backends — plugin_data rows with
  // entity_type 'setting' and data { key, value }.
  getPluginData(plugin: string, key: string): Promise<Record<string, unknown> | null>;
  setPluginData(
    plugin: string,
    key: string,
    data: Record<string, unknown>,
  ): Promise<void>;
  listContacts(): Promise<Contact[]>;
  upsertContact(input: ContactInput): Promise<Contact>;
  deleteContact(id: string): Promise<void>;
  listMatters(contactId?: string): Promise<Matter[]>;
  upsertMatter(input: MatterInput): Promise<Matter>;
  deleteMatter(id: string): Promise<void>;
  listAppointments(range?: { from: string; to: string }): Promise<Appointment[]>;
  upsertAppointment(input: AppointmentInput): Promise<Appointment>;
  deleteAppointment(id: string): Promise<void>;
  findConflicts(startsAt: string, endsAt: string, excludeId?: string): Promise<Appointment[]>;
  listInteractions(contactId?: string): Promise<Interaction[]>;
  addInteraction(input: InteractionInput): Promise<Interaction>;
  upsertInteraction(input: InteractionInput): Promise<Interaction>;
  deleteInteraction(id: string): Promise<void>;
  listAttachments(filter: { contactId?: string; matterId?: string }): Promise<Attachment[]>;
  addAttachment(input: AttachmentInput, bytes: ArrayBuffer | Blob): Promise<Attachment>;
  getAttachmentContent(id: string): Promise<Blob>;
  deleteAttachment(id: string): Promise<void>;
  search(q: string): Promise<SearchResults>;
}

export class ConflictError extends Error {
  conflicts: Appointment[];
  constructor(conflicts: Appointment[]) {
    super('Appointment overlaps an existing booking');
    this.name = 'ConflictError';
    this.conflicts = conflicts;
  }
}

export { isSupabaseConfigured, isDriveConfigured };

let instance: Store | null = null;

export function getStore(): Store {
  if (!instance) {
    // Case-served builds (crm_store.py injects the marker meta) bind to the
    // case's Postgres via /api — that IS the data, it wins over configured
    // personal stores. Standalone hosting keeps the original precedence.
    instance = isCaseServed()
      ? new HttpStore()
      : isSupabaseConfigured
        ? new SupabaseStore()
        : isDriveConfigured
          ? new DriveStore()
          : new LocalStore();
  }
  return instance;
}

// Drop the singleton so a sign-out / backend switch re-instantiates lazily.
export function resetStore(): void {
  instance = null;
}
