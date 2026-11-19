# Integrating with app-crm data

There are two storage backends other modules can integrate against:

- **OAuth-storage (Google Drive) mode** — when `VITE_GOOGLE_CLIENT_ID` is
  set (and Supabase is not), all CRM data lives as JSON files in the
  *user's own* Drive `appDataFolder`, namespaced
  `semptify.crm.<collection>.json`. Any Semptify module sharing the same
  OAuth client ID can read those files directly — the user's Drive is the
  linking layer, and no CRM data ever transits a Semptify server. The file
  contract and fetch snippets are in [`docs/OAUTH-STORAGE.md`](./OAUTH-STORAGE.md);
  `src/lib/driveStore.ts` is the reference implementation.
- **Supabase mode** — the PostgREST path described below.

When the app runs in **Supabase mode**, all CRM data lives in four tables —
`contacts`, `appointments`, `interactions`, `plugin_data` — exposed through
Supabase's standard PostgREST API. Any other module (or script) that holds a
**user JWT** can read and write them. Row-level security is on: every request
sees only rows where `user_id = auth.uid()`.

Base URL:

```
https://<project-ref>.supabase.co/rest/v1
```

Required headers on every request:

```
apikey: <anon public key>
Authorization: Bearer <user JWT>
Content-Type: application/json
```

Get a user JWT by signing in with `supabase-js` (`auth.signInWithPassword`)
or via `POST /auth/v1/token?grant_type=password`.

## Create a contact

```sh
curl -X POST "$SUPABASE_URL/rest/v1/contacts" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"name": "Jane Doe", "phone": "555-123-4567", "email": "jane@example.com"}'
```

`user_id` defaults to `auth.uid()` — never send it yourself.

## Log an interaction (call / note / email)

```sh
curl -X POST "$SUPABASE_URL/rest/v1/interactions" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "contact_id": "<contact uuid>",
    "type": "call",
    "subject_outline": "- Discussed timing\n- Follow up Friday",
    "notes": "Left voicemail",
    "duration_sec": 300,
    "outcome": "voicemail"
  }'
```

`type` must be `call`, `note`, or `email`. `occurred_at` defaults to now.

## Reading

```sh
# All contacts
curl "$SUPABASE_URL/rest/v1/contacts?select=*&order=name.asc" -H ...auth headers...

# Appointments in a window (overlap-aware)
curl "$SUPABASE_URL/rest/v1/appointments?starts_at=lt.2026-01-31T00:00:00Z&ends_at=gt.2026-01-01T00:00:00Z" -H ...

# Interaction feed for one contact
curl "$SUPABASE_URL/rest/v1/interactions?contact_id=eq.<uuid>&order=occurred_at.desc" -H ...
```

## Overlap rule

Postgres enforces a `btree_gist` exclusion constraint: two non-canceled
appointments for the same user cannot overlap in time. An insert that
violates it returns HTTP `409` with Postgres error `23P01` — catch that and
re-query `findConflicts` (`starts_at < end AND ends_at > start`,
`status != canceled`) to show which bookings clash.

## Ready-made Python client

`tools/crm_client.py` is a stdlib-only reference implementation of everything
above — `CrmClient.sign_in` (password grant), `create_contact`,
`log_interaction`, `create_appointment` (raises `CrmConflictError` with the
clashing rows on `23P01`), plus list/conflict helpers. Copy it into a module
or import it directly; it reads `SUPABASE_URL` / `SUPABASE_ANON_KEY` from the
environment when not given them explicitly.

## What is NOT built yet

- A **service-role / edge-function** path (server-to-server access that
  bypasses RLS for automation) is intentionally not part of this scaffold.
  If it's ever needed, it would be a Supabase edge function holding a
  service key — the user JWT path above is the supported route today.
- Webhooks on new rows — use Supabase Database Webhooks if needed.
