export type ApptStatus = 'scheduled' | 'completed' | 'canceled';
export type RecurRule = 'daily' | 'weekly' | 'biweekly' | 'monthly';
export type InteractionType = 'call' | 'note' | 'email';
export type TaskStatus = 'new' | 'in_progress' | 'resolved';
export type MatterStage = 'new' | 'intake' | 'active' | 'waiting' | 'resolved' | 'closed';

// Fixed pipeline order — MattersView groups in this sequence.
export const MATTER_STAGES: MatterStage[] = [
  'new',
  'intake',
  'active',
  'waiting',
  'resolved',
  'closed',
];

// Outreach pipeline states the case desk actually uses (contacts.status).
export const CONTACT_STATUSES = [
  'new',
  'target',
  'not_called',
  'intake_sent',
  'replied',
  'contacted',
  'consult_set',
  'active',
  'open',
  'declined',
  'conflicted',
  'closed',
] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

// Who this person is in the case (contacts.kind).
export const CONTACT_KINDS = [
  'attorney',
  'party',
  'opposing',
  'witness',
  'agency',
  'court',
  'organization',
  'other',
] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export interface Contact {
  id: string;
  user_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  org?: string | null;
  role?: string | null;
  address?: string | null;
  website?: string | null;
  tags: string[];
  kind?: string | null;
  status?: string | null;
  lane?: string | null;
  notes?: string | null;
  plugin_data: Record<string, unknown>;
  created_at: string;
}

export interface Matter {
  id: string;
  user_id: string;
  contact_id: string | null;
  title: string;
  stage: MatterStage;
  summary: string | null;
  opened_at: string;
  closed_at: string | null;
  plugin_data: Record<string, unknown>;
  created_at: string;
}

export interface Appointment {
  id: string;
  user_id: string;
  contact_id: string | null;
  matter_id?: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  status: ApptStatus;
  recur_rule?: RecurRule | null;
  recur_until?: string | null;
  // Non-persisted fields set only by expandAppointments() on emitted
  // occurrences — never written back to a store.
  occurrence_of?: string;
  series_starts_at?: string;
  series_ends_at?: string;
  plugin_data: Record<string, unknown>;
  created_at: string;
}

export interface Interaction {
  id: string;
  user_id: string;
  contact_id: string | null;
  appointment_id: string | null;
  matter_id?: string | null;
  type: InteractionType;
  subject_outline: string | null;
  notes: string | null;
  duration_sec: number | null;
  outcome: string | null;
  occurred_at: string;
  status: TaskStatus;
  resolved_at: string | null;
  due_at: string | null;
  plugin_data: Record<string, unknown>;
  created_at: string;
}

export interface ContactInput {
  id?: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  org?: string | null;
  role?: string | null;
  address?: string | null;
  website?: string | null;
  tags?: string[];
  kind?: string | null;
  status?: string | null;
  lane?: string | null;
  notes?: string | null;
  plugin_data?: Record<string, unknown>;
}

export interface MatterInput {
  id?: string;
  contact_id?: string | null;
  title: string;
  stage?: MatterStage;
  summary?: string | null;
  opened_at?: string;
  closed_at?: string | null;
  plugin_data?: Record<string, unknown>;
}

export interface AppointmentInput {
  id?: string;
  contact_id?: string | null;
  matter_id?: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  status?: ApptStatus;
  recur_rule?: RecurRule | null;
  recur_until?: string | null;
  plugin_data?: Record<string, unknown>;
}

export interface InteractionInput {
  id?: string;
  contact_id?: string | null;
  appointment_id?: string | null;
  matter_id?: string | null;
  type: InteractionType;
  subject_outline?: string | null;
  notes?: string | null;
  duration_sec?: number | null;
  outcome?: string | null;
  occurred_at?: string;
  status?: TaskStatus;
  resolved_at?: string | null;
  due_at?: string | null;
  plugin_data?: Record<string, unknown>;
}

// Document attachment — metadata row + content stored per backend:
// Drive: real file in the user's appDataFolder (drive_file_id set).
// Local: base64 body inline (body_b64 set). Supabase: object in the
// private `crm-documents` storage bucket (storage_path set).
export interface Attachment {
  id: string;
  user_id: string;
  contact_id: string | null;
  matter_id: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  drive_file_id: string | null;
  body_b64: string | null;
  storage_path?: string | null;
  created_at: string;
}

export interface AttachmentInput {
  id?: string;
  contact_id?: string | null;
  matter_id?: string | null;
  filename: string;
  mime_type?: string;
  size_bytes?: number;
}

export interface SearchResults {
  contacts: Contact[];
  matters: Matter[];
  appointments: Appointment[];
  interactions: Interaction[];
}
