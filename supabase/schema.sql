-- app-crm schema — run once in the Supabase SQL editor.
-- Safe to re-run: tables/policies/indexes are created only if missing.

create extension if not exists btree_gist;

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users,
  name text not null,
  phone text,
  email text,
  org text,
  role text,
  address text,
  website text,
  tags text[] default '{}',
  plugin_data jsonb default '{}',
  created_at timestamptz default now()
);

-- Richer contact columns for databases created before this migration.
alter table contacts add column if not exists org text;
alter table contacts add column if not exists role text;
alter table contacts add column if not exists address text;
alter table contacts add column if not exists website text;

-- Matters: a contact's dispute, case, or campaign (Act!-style opportunity).
-- Created before appointments/interactions so both can FK it inline.
create table if not exists matters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users,
  contact_id uuid references contacts on delete set null,
  title text not null,
  stage text not null default 'new' check (stage in ('new', 'intake', 'active', 'waiting', 'resolved', 'closed')),
  summary text,
  opened_at timestamptz default now(),
  closed_at timestamptz,
  plugin_data jsonb default '{}',
  created_at timestamptz default now()
);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users,
  contact_id uuid references contacts on delete cascade,
  matter_id uuid references matters on delete set null,
  title text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text check (status in ('scheduled', 'completed', 'canceled')) default 'scheduled',
  recur_rule text check (recur_rule in ('daily', 'weekly', 'biweekly', 'monthly')),
  recur_until date,
  plugin_data jsonb default '{}',
  created_at timestamptz default now(),
  constraint appointments_ends_after_starts check (ends_at > starts_at)
);

-- Prevent overlapping non-canceled appointments per user.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'appointments_no_overlap'
  ) then
    alter table appointments
      add constraint appointments_no_overlap
      exclude using gist (
        user_id with =,
        tstzrange(starts_at, ends_at) with &&
      )
      where (status <> 'canceled');
  end if;
end $$;

-- matter_id for databases created before this migration.
alter table appointments add column if not exists matter_id uuid references matters on delete set null;

-- Recurring bookings (v1): simple rule + optional stop date.
alter table appointments add column if not exists recur_rule text, add column if not exists recur_until date;

create table if not exists interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users,
  contact_id uuid references contacts on delete cascade,
  appointment_id uuid references appointments on delete set null,
  matter_id uuid references matters on delete set null,
  type text check (type in ('call', 'note', 'email')),
  subject_outline text,
  notes text,
  duration_sec int,
  outcome text,
  occurred_at timestamptz default now(),
  status text not null default 'new' check (status in ('new', 'in_progress', 'resolved')),
  resolved_at timestamptz,
  due_at timestamptz,
  plugin_data jsonb default '{}',
  created_at timestamptz default now()
);

-- Task-card status columns for databases created before this migration.
alter table interactions add column if not exists status text not null default 'new';
alter table interactions add column if not exists resolved_at timestamptz;
alter table interactions add column if not exists due_at timestamptz;
alter table interactions add column if not exists matter_id uuid references matters on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'interactions_status_check'
  ) then
    alter table interactions
      add constraint interactions_status_check
      check (status in ('new', 'in_progress', 'resolved'));
  end if;
end $$;

-- Documents: Act!-style attachments on contacts/matters. Metadata row only
-- in v1 — file bytes live in Drive mode (drive_file_id) or local demo mode
-- (body_b64); both stay null under Supabase. contact_id cascades like the
-- contact's other data; matter_id unlinks like other matter-linked rows.
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users,
  contact_id uuid references contacts on delete cascade,
  matter_id uuid references matters on delete set null,
  filename text not null,
  mime_type text,
  size_bytes int,
  drive_file_id text,
  body_b64 text,
  created_at timestamptz default now()
);

-- Binary attachment store (v2): file bytes live in a private Supabase
-- Storage bucket, one folder per user (<auth.uid()>/<document id>).
-- storage_path on documents points at the object. Policies mirror the
-- "own rows" rule — a user can only touch objects inside their folder.
alter table documents add column if not exists storage_path text;

insert into storage.buckets (id, name, public, file_size_limit)
values ('crm-documents', 'crm-documents', false, 52428800)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'crm documents own folder'
  ) then
    create policy "crm documents own folder" on storage.objects
      for all to authenticated
      using (
        bucket_id = 'crm-documents'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'crm-documents'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end $$;

create table if not exists plugin_data (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users,
  plugin text,
  entity_type text,
  entity_id uuid,
  data jsonb,
  created_at timestamptz default now()
);

alter table contacts enable row level security;
alter table matters enable row level security;
alter table appointments enable row level security;
alter table interactions enable row level security;
alter table documents enable row level security;
alter table plugin_data enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['contacts', 'matters', 'appointments', 'interactions', 'documents', 'plugin_data'] loop
    execute format('drop policy if exists "own rows" on %I', t);
    execute format(
      'create policy "own rows" on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t
    );
  end loop;
end $$;

create index if not exists matters_contact_id_idx on matters (contact_id);
create index if not exists appointments_contact_id_idx on appointments (contact_id);
create index if not exists appointments_matter_id_idx on appointments (matter_id);
create index if not exists appointments_starts_at_idx on appointments (starts_at);
create index if not exists interactions_contact_id_idx on interactions (contact_id);
create index if not exists interactions_matter_id_idx on interactions (matter_id);
create index if not exists interactions_occurred_at_idx on interactions (occurred_at);
create index if not exists interactions_due_at_idx on interactions (due_at);
create index if not exists documents_contact_id_idx on documents (contact_id);
create index if not exists documents_matter_id_idx on documents (matter_id);
