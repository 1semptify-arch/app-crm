# app-crm

A minimal personal CRM — contacts, appointments, and a log of calls, emails,
and notes — built as an installable PWA. It runs in three modes:

- **Local demo mode** (zero setup): data lives in your browser's localStorage.
  Good for trying it out.
- **Google Drive mode**: data lives in *your own* Google Drive (a hidden
  app-data folder) behind Google sign-in — nothing ever touches our servers.
- **Supabase mode**: data syncs to a free Supabase project behind row-level
  security, so it works across devices for a single user.

If both Supabase and Google credentials are set, Supabase wins.

## Run it locally

```sh
npm install
npm run dev
```

Open the printed URL (usually http://localhost:5173). With no `.env.local`
the app runs in local demo mode — you'll see a small "Local demo mode" note
in the toolbar.

## Connect Supabase (optional)

1. Create a free project at https://supabase.com (New project → pick a name,
   password, region).
2. In the Supabase dashboard, open **SQL Editor**, paste the contents of
   `supabase/schema.sql`, and run it. This creates the four tables
   (contacts, appointments, interactions, plugin_data) with row-level
   security — you can only ever see your own rows.
3. In **Project Settings → API**, copy the **Project URL** and the **anon
   public key**.
4. Copy `.env.example` to `.env.local` and fill in those two values.
5. Restart `npm run dev`. The app now shows a sign-in screen — create an
   account (email + password) and you're in.

## Save to your Google Drive (OAuth2)

Instead of a Semptify-hosted database, the app can store its data as JSON
files in the hidden `appDataFolder` of **your** Google Drive. You sign in
with Google, the app gets a token that can only see its own app-data files,
and every read/write goes straight from your browser to Google. No PII ever
transits Semptify servers — there are no servers in the loop at all.

One-time setup (about 5 minutes, free):

1. Go to https://console.cloud.google.com and create a project
   (or pick an existing one).
2. **OAuth consent screen**: choose **External**, give the app a name
   (e.g. "Semptify CRM") and your email. You don't need to add scopes
   manually — the app requests `drive.appdata` itself.
3. **APIs & Services → Library**: search for **Google Drive API** and
   enable it.
4. **Credentials → Create Credentials → OAuth client ID**: application
   type **Web application**. Under **Authorized JavaScript origins** add
   the URL you run the app from — `http://localhost:5173` for dev (add
   your deployed origin too when you publish it).
5. Copy the client ID (`....apps.googleusercontent.com`) into `.env.local`
   as `VITE_GOOGLE_CLIENT_ID` and restart `npm run dev`.

The app now opens on a **Continue with Google** screen. After signing in,
data is saved to `semptify.crm.*.json` files in your Drive's app-data
folder — you won't see them in the normal Drive file list (that's the
point), but any Semptify module using the same OAuth client can read them.

> **Testing mode note:** while the OAuth consent screen is in "Testing"
> status, only Google accounts listed as **test users** on the consent
> screen can sign in — add your own Gmail there. Publishing the consent
> screen removes that limit.

## Hosted build (HTTPS)

The app deploys to **Render** as a free static site from the dedicated
`1semptify-arch/app-crm` GitHub repo (public deploy mirror — canonical
source lives here in `1semptify-arch/app-crm-src`, private) — see
`docs/HOSTING.md` for the topology, the one-time OAuth-origin step, and
`tools/publish.sh` for shipping a fresh build.

## Install it on your phone (PWA)

The app must be served over HTTPS for install on phones — the Render
deploy gives it a stable `https://*.onrender.com` origin, then:

- **Android (Chrome):** open the site → menu → **Install app** /
  **Add to Home screen**.
- **iPhone (Safari):** open the site → **Share** → **Add to Home Screen**.

It then launches full-screen like a native app and keeps working offline
for previously loaded pages.

## The email plugin seam

`src/services/email.ts` defines a tiny `EmailPlugin` interface
(`sendConfirmation`, `logThread`) plus `registerEmailPlugin` /
`getEmailPlugin`. The built-in `ManualEmailPlugin` does nothing on send and
writes "Log email" entries into the interactions table.

`src/services/smartBrainEmail.ts` is the "smart brain" plugin — one seam,
two transports:

- **Gmail transport (default when `VITE_GOOGLE_CLIENT_ID` is set):**
  `src/services/googleMail.ts` holds a second GIS token client on the same
  OAuth client with `gmail.send` + `gmail.readonly` scopes (Drive keeps its
  narrow `drive.appdata` token). **Sync inbox** pulls your real Gmail inbox
  and **Send via Gmail** on the Log email form sends the merged message for
  real — both prompt Google consent on first use, no server involved.
  Add the two Gmail scopes to the OAuth consent screen's scope list for a
  clean consent dialog (works without it in testing mode).
- **JSON endpoint transport:** set `VITE_CRM_INBOUND_MAIL_URL` to an
  endpoint that returns a JSON array of `{id, from, subject, body, date}` —
  `tools/inbox_endpoint.py` is a ready-made stdlib one (POST /messages to
  push mail in, GET /inbox serves the feed). Other tools can drop inbound
  mail there for the CRM to pick up.

Either way: **Sync inbox** on the Log view pulls the feed, matches each
sender's address to a contact's email, and logs new messages as `email`
interactions. Dedupe is by `plugin_data.inbound_id`, so messages are never
double-logged even across devices. Unmatched senders are reported in the
sync note and skipped.

### Email templates & merge

The Log email form has a **Template** picker — three starters seed on first
open (stored in plugin_data as `email`/`templates`), and **Save as
template…** keeps your own. `{{name}}`, `{{first}}`, `{{org}}`, and `{{date}}`
merge against the chosen contact when you hit **Send via email app**, which
opens a `mailto:` draft and logs the sent email in one click. Log, Bookings,
and Matters views also have **Export** — a `*-YYYY-MM-DD.csv` of the
currently filtered rows (same as Contacts).

## Today view

- Bookings can **repeat** (daily / weekly / every 2 weeks / monthly, with an
  optional until date): the stored row is the series anchor and occurrences
  are materialized in memory per view — edits and status changes apply to
  the whole series (v1).
- **Today** is the landing view — a daily reading spine in fixed order:
  **Overdue** (past-due follow-ups + missed bookings, each with a one-tap
  Done), **Today** (today's bookings + follow-ups due today), **Coming
  up** (next 7 days, grouped by day, capped at 10 rows with a "More in
  Calendar" link), and **Recent** (last 5 log entries). Empty sections
  are skipped entirely.

## Toolbar modes & task cards

- The top toolbar is a deterministic state machine (`src/lib/uiState.ts`):
  **default** shows the per-view primary action (New booking / Contact /
  Log call + Quick note); **selection** (a contact or appointment drawer is
  open) shows entity actions (Edit, Call, Book, Log call, Note, Log email /
  Edit booking, Mark completed, Cancel); **form** drawers show no entity
  actions, just the form — and each form's Save stays disabled until its
  required fields are valid.
- Every interaction in the Log view is a task card with a status:
  **New → In progress → Resolved**. Acting on a card (Call, Reply, Log
  follow-up) advances it to In progress; **Mark done** resolves it (and
  **Reopen** brings it back). Notes save as resolved. The default
  **Needs action** filter hides resolved cards; **All** shows them dimmed.
- Cards can carry an optional **Follow up by** date (set it on the log
  forms or inline via **Set follow-up**). Past-due cards show a red
  **Overdue** marker and sort first under Needs action, then due-today,
  then newest. A dated follow-up reopens a resolved card.
- Deletes live where you expect them: a trash button on each task card,
  **Delete contact** at the bottom of the contact drawer (takes its
  appointments and log entries with it), and **Delete** on the booking
  drawer (log entries are kept, just unlinked). All ask to confirm first.

## Matters

- **Matters** are Act!-style opportunities — a contact's dispute, case, or
  campaign — tracked on a fixed pipeline: **New → Intake → Active → Waiting →
  Resolved → Closed**. The Matters view groups rows by stage (empty stages
  hidden) with stage filter chips up top; moving to Resolved/Closed stamps
  `closed_at` automatically, and reopening clears it.
- Log entries (calls, emails, notes) and bookings carry an optional **Matter**
  link — pick it on any of those forms, or launch them from a matter drawer,
  where the contact and matter are prefilled. The matter drawer shows a
  **Linked** timeline of everything tied to it, task cards and booking drawers
  show a small `· {title}` tag, and the contact drawer lists that contact's
  matters.
- Storage: `matters` table in Supabase (RLS like the rest),
  `semptify.crm.matters.json` in Drive mode, `crm.matters` in local demo mode.
  Deleting a contact unlinks its matters; deleting a matter unlinks its log
  entries and bookings — nothing is cascade-deleted.

## Documents (attachments)

- Contacts and matters have a **Documents** section — attach any file, then
  download or delete it later. Files live in *your* storage, never on a server:
  Drive mode stores real files in the hidden `appDataFolder` (the existing
  `drive.appdata` scope already covers it — no new consent), local demo mode
  keeps bodies inline (files capped at 1 MB), and Supabase mode stores bytes
  in a private `crm-documents` storage bucket (one folder per user — re-run
  `supabase/schema.sql` to add it to an existing project).

## Contacts

- Contacts carry **org, role, address, and website** fields alongside
  phone/email/tags, plus arbitrary **custom fields** (label → value rows
  stored under `plugin_data.custom_fields`). Both are edited in the contact
  form and shown in the drawer — custom fields under a "Details" heading.
- The Contacts view has **Import** (header-mapped CSV — `name` required;
  phone, email, org, role, address, website, and semicolon-separated `tags`
  optional; dedupes on a normalized name) and **Export**
  (`contacts-YYYY-MM-DD.csv` of the currently filtered list).
- **Tag filters** appear as plain-text chips above the list — multi-select,
  a contact must have every selected tag, and they combine with search
  (AND). The count line reflects the filtered total.
- An **Advanced** toggle opens an Act!-style lookup: up to three
  "field contains text" conditions (Name, Org, Role, Address, Email,
  Phone, Tag — a tag condition matches when ANY tag contains it) that
  AND together with the search box and tag chips. A small sort menu
  offers **Name A–Z** (default), **Newest**, or **Org** (blanks last).
- **Duplicates** opens a merge drawer: pairs matched on normalized name,
  phone digits, or email merge into one record (empties fill, tags/custom
  fields union, linked rows repoint) or dismiss; the **vCard** chip on the
  contact drawer downloads a `name.vcf` (vCard 3.0).
- The **Ctrl K** palette searches contacts (name, email, phone, org,
  role), matters (title, summary), appointments, and log entries —
  picking a matter opens its drawer.

## Other docs

- `supabase/schema.sql` — database schema (run in the SQL editor).
- `docs/OAUTH-STORAGE.md` — the cross-module "user's own Drive" storage
  pattern every Semptify module can copy.
- `docs/INTEGRATION.md` — how other modules/tools read and write CRM data.
- `tools/make-icons.mjs` — regenerates the PWA icons (`npm run icons`).
