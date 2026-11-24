# Hosting — app-crm on HTTPS

The app is a static Vite build; hosting = "serve `dist/` over HTTPS with a
stable origin." Current topology (deployed 2026-11-19):

```
1semptify-arch/app-crm-src         (canonical source — PRIVATE repo;
working dir master-repo/modules/app-crm, split 2026-11-22)
        │  tools/publish.sh  (snapshot + strip + push)
        ▼
github.com/1semptify-arch/app-crm  (deploy repo — PUBLIC, seed-stripped)
        │  Render autoSync on push
        ▼
Render static site  →  https://<service>.onrender.com
```

Render spec lives in `render.yaml` (blueprint): `npm ci && npm run build`
→ publish `dist/` → SPA rewrite `/*` → `/index.html`. Free plan, no server
sleep (static sites don't cold-start). `VITE_GOOGLE_CLIENT_ID` is set as a
build env var — it's a browser-public value by design.

## Why the deploy repo is a snapshot, not a submodule

The canonical module ships `src/data/campaignSeed.ts` (campaign targets +
working notes) — private data that must never land on a public origin.
`tools/publish.sh` re-stages the module into the deploy repo, stubs that
file to empty arrays, drops `docs/CAMPAIGN_*.md` / `OUTREACH_DRAFTS.md` /
`bill-presentation.*`, and pushes. The repo can be flipped private later
once Render's GitHub app is granted private-repo access — nothing else
needs to change.

## Ship a new build

```sh
tools/publish.sh "what changed"
```

Render rebuilds in ~2 minutes; the PWA service worker (`autoUpdate`)
picks up the new bundle on next open.

## One-time console steps (Brad)

1. **OAuth origin** — Google Cloud Console → APIs & Services → Credentials
   → the OAuth web client → **Authorized JavaScript origins** → add the
   deployed origin (e.g. `https://app-crm-xxxx.onrender.com`). Until then
   Google sign-in on the hosted site is rejected as an unregistered origin.
2. **Gmail scopes** — same client → OAuth consent screen → Scopes → add
   `gmail.send` and `gmail.readonly`. Works without this in testing mode
   (consent shows them anyway); listing them keeps the dialog clean and is
   required if the app ever goes to "published" status.
3. **Drive doc access ("From Drive" button)** — one required + one optional:
   - OAuth consent screen → Scopes → add `drive.file` (least privilege —
     the app can only see files the client created or the user picked;
     consent asks lazily on first use, not at sign-in). Required for any
     Drive reading, including the Semptify5.0/ vault browser — the vault
     is client-created, so `drive.file` sees it natively.
   - *(optional)* Credentials → **Create API key** → restrict to
     "Google Picker API" + HTTP referrers = the deployed origin → put in
     `modules/app-crm/.env.local` as `VITE_GOOGLE_API_KEY` (public by
     design — the referrer restriction is what protects it). Enables the
     "Pick other files…" fallback for files the user placed in Drive
     outside the client. Without it the button hides; vault browse still
     works.
4. **Phone install** — Android Chrome: menu → Install app / Add to Home
   screen. iPhone Safari: Share → Add to Home Screen. HTTPS + manifest +
   service worker are all in place.

## Alternatives considered

- **Cloudflare Pages/Workers** — the account exists but the stored API
  tokens are R2-scoped only; Pages/Workers deploy scopes aren't held.
- **GitHub Pages** — free tier can't serve a private repo, and a public
  Pages repo has the same seed-stripping requirement with a worse URL
  (`/app-crm/` base path breaks the PWA root scope without a vite `base`
  rebuild).
- **Netlify/Vercel** — no credentials stored.
