# OAuth-storage pattern — the user's own Drive is the database

Every Semptify module that needs persistence has two serverless options.
This document describes the one where **the data lives in the user's own
Google Drive** — not on any Semptify server. There is nothing for Semptify
to secure, breach, back up, or subpoena: the browser talks to
`googleapis.com` directly and no user content ever transits our
infrastructure.

## The contract

- Each module stores its collections as **one JSON array of rows per file**
  in the user's hidden Drive `appDataFolder` (not visible in the normal
  Drive file list, and inaccessible to other apps).
- File names are namespaced: **`semptify.<module>.<collection>.json`**.
  app-crm uses:
  - `semptify.crm.contacts.json`
  - `semptify.crm.appointments.json`
  - `semptify.crm.interactions.json`
  - `semptify.crm.plugin_data.json` — reserved for cross-module plugin state
- Modules that share the same OAuth client ID can read each other's files.
  **The user's own Drive is the linking layer between Semptify tools** —
  e.g. a second module can look up `semptify.crm.contacts.json` to resolve
  a contact name without any Semptify API in between.
- Auth is the Google Identity Services **token client** (implicit flow,
  `drive.appdata` scope — the narrowest Drive scope; the app can only see
  files it created). Tokens last ~1 hour and are re-requested silently.

## Copy-paste reference implementation

The full working version is `src/lib/driveStore.ts` in this module. The
load-bearing snippets for a future module:

### 1. Load GIS and get a token (no SDK, no npm deps)

```ts
await new Promise<void>((resolve, reject) => {
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true; s.defer = true;
  s.onload = () => resolve();
  s.onerror = () => reject(new Error('GIS failed to load'));
  document.head.appendChild(s);
});

const tokenClient = google.accounts.oauth2.initTokenClient({
  client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
  scope: 'https://www.googleapis.com/auth/drive.appdata',
  callback: (resp) => { /* resp.access_token, resp.expires_in */ },
});
// Silent first, consent popup as fallback:
tokenClient.requestAccessToken({ prompt: '' });        // or 'consent'
```

Wrap every fetch in a helper that sets
`Authorization: Bearer <token>` and retries once on `401` by re-requesting
a token (`prompt: ''`) — GIS tokens expire in about an hour.

### 2. Find the file id in appDataFolder

```ts
const q = encodeURIComponent(`name='semptify.crm.contacts.json'`);
const res = await fetch(
  `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`,
  { headers: { Authorization: `Bearer ${token}` } },
);
const { files } = await res.json();          // files[0].id, or empty
```

Cache the id after the first lookup. Create when missing via multipart
upload:

```ts
const form = new FormData();
form.append('metadata', new Blob([JSON.stringify({
  name: 'semptify.crm.contacts.json',
  parents: ['appDataFolder'],
})], { type: 'application/json' }));
form.append('file', new Blob(['[]'], { type: 'application/json' }));
await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
  { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
```

### 3. Read a collection (missing file = empty array)

```ts
const res = await fetch(
  `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
  { headers: { Authorization: `Bearer ${token}` } },
);
const rows = res.status === 404 ? [] : await res.json();
```

### 4. Write a collection (whole-file replace)

```ts
await fetch(
  `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
  {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(rows),
  },
);
```

Writes are read-modify-write of the whole array — serialize them per file
behind a promise queue so rapid saves don't clobber each other (see
`enqueue` in `driveStore.ts`). Fine at personal-CRM scale; if a module
grows beyond ~a few MB per collection, shard by id prefix.

## OAuth client setup

One Google Cloud OAuth client ID can serve every Semptify module that runs
on the same origin list — see the README section "Save to your Google
Drive (OAuth2)" for the click-path. Each deployed origin must be added to
the client's **Authorized JavaScript origins**.

## Rules of the road for future modules

- Keep to `drive.appdata` scope — never request broader Drive access for
  this pattern.
- Namespace every file `semptify.<module>.<collection>.json`; don't write
  to another module's collection files (reading is fine — that's the link
  layer).
- Store rows as plain JSON matching the module's existing row types, so a
  `LocalStore`-style in-memory mirror can share all the row logic.
- No PII transits Semptify servers by construction — keep it that way:
  don't add a Semptify-side proxy to this flow.

## Compat contract — semptify.storage v1

One shared OAuth client ID is the keystone for every Semptify module
("Semptify Storage"). Every module authenticates through it; no module
ever gets its own OAuth consent. These rules keep files written by one
module/version safe to read by another:

- **Collection files are enveloped, never bare arrays.** Every
  `semptify.<module>.<collection>.json` file's content is:

  ```json
  {
    "semptify_storage": 1,
    "module": "crm",
    "collection": "contacts",
    "updated": "<iso>",
    "rows": [ ... ]
  }
  ```

- **v0 = bare JSON array** (pre-contract). Readers MUST accept it and
  re-persist enveloped on next write — never require a migration pass.
- **Forward-compat guard is mandatory.** If `semptify_storage` is newer
  than the reader understands, fail loudly ("written by a newer version,
  update the app"). Silently parsing an unknown format is a data-loss
  bug.
- **Version bumps are per-collection envelope, not per row.** When a
  module changes row shape it bumps `semptify_storage` and handles its
  own v→v+1 migration on read.

## Lazy vault provisioning

Folders are created on FIRST NEED, never eagerly at onboarding — a user
who never opens a module never gets its folders.

- Module-owned content lives under `Semptify5.0/<module-or-Vault-subpath>/`
  (visible Drive), provisioned via `ensureVaultPath(parts, module)` in
  `src/services/drivePicker.ts` — find-or-create each segment, then stamp
  `semptify.<module>.manifest.json` into the leaf:

  ```json
  { "semptify_storage": 1, "module": "crm", "scope": "drive.file", "created": "<iso>" }
  ```

- **Scope split:** `drive.appdata` for hidden module state
  (appDataFolder), `drive.file` — requested lazily — for the visible
  vault. Under the shared client, `drive.file` natively sees everything
  the flagship provisioned; anything user-placed needs one picker open.
- **Read-only binds user documents only.** Provisioning app-owned
  folders/manifests is the same class as the flagship's Vault Installer —
  permitted. Listing/browsing is confined to children of the resolved
  `Semptify5.0/` root; reaching beyond it is structurally impossible.
