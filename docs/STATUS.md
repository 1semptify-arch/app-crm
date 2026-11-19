# app-crm — Feature Status & Remaining Gaps

Snapshot 2026-11-18. Goal: Act!-class CRM on Semptify's OAuth-storage spine
(`semptify.crm.*` files in the user's Drive appDataFolder — ADR-0011).

## Done (all browser-verified, commits on master, not pushed)

- **Contacts** — rich records (org, role, address, website, custom fields via
  `plugin_data.custom_fields`), tag groups, sort, advanced lookup
  (3-condition AND), duplicates detect + merge, vCard export, CSV
  import/export.
- **Activities/History** — unified timeline; call/email/note log with
  subject outlines; closed-loop task cards (new → in_progress → resolved),
  due dates, overdue surfacing + badge, edit + delete.
- **Calendar/Scheduling** — month/week/day, agenda checklist, conflict-
  checked bookings (Supabase: exclusion constraint; Local/Drive: app-side),
  recurring series (daily/weekly/biweekly/monthly + until; edits apply to
  whole series), status tracking.
- **Matters** — 6-stage pipeline (new/intake/active/waiting/resolved/closed),
  contacts + log entries + bookings link via `matter_id`.
- **Documents** — attachments on contacts/matters; Drive mode stores real
  files in appDataFolder (hidden), local mode <1MB, Supabase metadata-only.
- **Email** — templates with merge fields, mailto send+log one click,
  plugin seam (`EmailPlugin`) + smart-brain inbound sync stub
  (needs an inbound-mail JSON endpoint to activate).
- **Search** — Ctrl+K across contacts (name/org/role/email/phone),
  appointments, interactions, matters.
- **UI shell** — deterministic FSM toolbar (default/selection/form),
  icon rail ↔ mobile tab bar, slide-over drawer, PWA manifest + icons.
- **Storage** — three backends behind `Store`: localStorage (demo/god-mode),
  Supabase (schema + RLS in supabase/schema.sql), Google Drive appDataFolder
  (verified live: sign-in + write + reload round-trip).

## Remaining gaps (honest)

- **Hosting** — localhost only; HTTPS hosting needed for phone install and
  phone testing. Add deployed origin to the same OAuth client when hosted.
- **Real email transport** — mailto merge only; sending from the app needs
  Resend/Gmail send scope (plugin seam ready). Inbound smart-brain needs a
  JSON endpoint serving new mail.
- **Recurrence v1** — whole-series edits only; conflict check doesn't
  expand series-vs-series overlaps.
- **No report engine** — CSV exports are the reporting layer.
- **Attachments on Supabase** — metadata only (no binary store).
- **Merge on Drive/Supabase attachments** — best-effort re-add+delete;
  no upsertAttachment exists.
- **Migration A (flagship)** — token vault-first; unrelated to this app,
  gated on no-touch onboarding + Brad's OK.
