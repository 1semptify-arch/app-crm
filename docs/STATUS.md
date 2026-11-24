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
  plugin seam (`EmailPlugin`) + smart-brain inbound sync — case-served
  builds self-wire to `/api/mail/inbound` (crm_store's Gmail-IMAP read);
  standalone builds use `VITE_CRM_INBOUND_MAIL_URL` or Gmail OAuth.
- **Search** — Ctrl+K across contacts (name/org/role/email/phone),
  appointments, interactions, matters.
- **UI shell** — deterministic FSM toolbar (default/selection/form),
  icon rail ↔ mobile tab bar, slide-over drawer, PWA manifest + icons.
- **Storage** — three backends behind `Store`: localStorage (demo/god-mode),
  Supabase (schema + RLS in supabase/schema.sql), Google Drive appDataFolder
  (verified live: sign-in + write + reload round-trip).

## Remaining gaps (honest)

- **Hosting** — Render static site deploys from the `1semptify-arch/app-crm`
  repo (public deploy mirror; canonical source is private
  `1semptify-arch/app-crm-src` — see docs/HOSTING.md). One Brad-side step
  remains: add the deployed
  origin to the OAuth client's Authorized JavaScript origins, and add the
  two Gmail scopes to the consent screen.
- **Email transport** — Gmail send + inbox sync work through the plugin
  seam (gmail.send / gmail.readonly, consent on first use). No Resend
  path — Gmail covers the need with zero servers. `tools/inbox_endpoint.py`
  exists for tools that want to push mail in via JSON instead.
- **Recurrence** — conflict check is now series-aware (expands both sides
  over a ~2y horizon). Still whole-series edits only.
- **No report engine** — CSV exports are the reporting layer.
- **Merge on Drive/Supabase attachments** — best-effort re-add+delete;
  no upsertAttachment exists.
- **Migration A (flagship)** — token vault-first; unrelated to this app,
  gated on no-touch onboarding + Brad's OK.
