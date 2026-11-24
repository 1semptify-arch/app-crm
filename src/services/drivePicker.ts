// Read-only access to the user's own Drive files — the privacy-critical
// piece of the standalone product.
//
// Scope: drive.file — the least privilege Google offers. The app can only
// EVER see the individual files the user personally selects in Google's
// own picker; it cannot list, search, or see anything else in their Drive.
// "We cannot look" — stronger than any promise not to look.
//
// Consent is DEFERRED to first use (same pattern as the Gmail transport):
// the drive.file scope is never requested at sign-in — it appears only
// when the user clicks "From Drive", and users who never pull a Drive doc
// never see the ask.
//
// What leaves the device: a read-only files.get?alt=media call. The bytes
// flow browser -> the app's own storage (the user's appDataFolder in Drive
// mode) — nothing document-related ever touches a Semptify system.
//
// Requires VITE_GOOGLE_API_KEY (Google Picker's developer key — public by
// design, like the client ID; restrict it to the Drive Picker API + HTTP
// referrer in the console). Without it the feature hides rather than errs.

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
export const isPickerConfigured = Boolean(CLIENT_ID && API_KEY);

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const GAPI_SRC = 'https://apis.google.com/js/api.js';
const SESSION_KEY = 'semptify.drivepicker.token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

export interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
}

// --- minimal GIS + Picker typings -------------------------------------------
interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
interface GisTokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void;
}
interface GisOauth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (resp: GisTokenResponse) => void;
    error_callback?: (err: unknown) => void;
  }) => GisTokenClient;
  revoke: (token: string, done: () => void) => void;
}
interface PickerDoc {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
}
interface PickerCallbackData {
  action: string;
  docs?: PickerDoc[];
}
interface PickerBuilderInst {
  setDeveloperKey: (k: string) => PickerBuilderInst;
  setOAuthToken: (t: string) => PickerBuilderInst;
  addView: (v: unknown) => PickerBuilderInst;
  setCallback: (cb: (d: PickerCallbackData) => void) => PickerBuilderInst;
  build: () => { setVisible: (v: boolean) => void };
}
interface PickerApi {
  ViewId: { DOCS: unknown };
  Action: { PICKED: string; CANCEL: string };
  PickerBuilder: new () => PickerBuilderInst;
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GisOauth2 } };
    gapi?: { load: (mod: string, cb: () => void) => void };
  }
}
const pickerApi = () =>
  (window.google as { picker?: PickerApi } | undefined)?.picker;

// --- token state (memory + sessionStorage; ~1h tokens) -----------------------
let tokenClient: GisTokenClient | null = null;
let accessToken: string | null = null;
let expiresAt = 0;
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null =
  null;

try {
  const saved = sessionStorage.getItem(SESSION_KEY);
  if (saved) {
    const parsed = JSON.parse(saved) as { token: string; expiresAt: number };
    if (parsed.expiresAt > Date.now()) {
      accessToken = parsed.token;
      expiresAt = parsed.expiresAt;
    }
  }
} catch {
  /* no storage — start unsigned */
}

function persistToken(token: string, expiresIn: number): void {
  accessToken = token;
  expiresAt = Date.now() + expiresIn * 1000;
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ token, expiresAt }),
    );
  } catch {
    /* private mode — session-only token still works */
  }
}

function loadScript(src: string): Promise<void> {
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureTokenClient(): Promise<GisTokenClient> {
  if (tokenClient) return tokenClient;
  if (!CLIENT_ID) throw new Error('VITE_GOOGLE_CLIENT_ID is not set.');
  await loadScript(GIS_SRC);
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error('Google sign-in library failed to load.');
  tokenClient = oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: (resp) => {
      if (resp.error || !resp.access_token) {
        pending?.reject(new Error(resp.error ?? 'No token returned.'));
      } else {
        persistToken(resp.access_token, resp.expires_in ?? 3600);
        pending?.resolve(resp.access_token);
      }
      pending = null;
    },
    error_callback: () => {
      pending?.reject(new Error('Google sign-in was closed.'));
      pending = null;
    },
  });
  return tokenClient;
}

async function ensureToken(): Promise<string> {
  if (accessToken && expiresAt > Date.now() + 30_000) return accessToken;
  const client = await ensureTokenClient();
  return new Promise<string>((resolve, reject) => {
    pending = { resolve, reject };
    client.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
  });
}

async function driveFetch(
  url: string,
  init?: RequestInit,
  retried = false,
): Promise<Response> {
  const token = await ensureToken();
  const r = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init?.headers },
  });
  if ((r.status === 401 || r.status === 403) && !retried) {
    accessToken = null;
    expiresAt = 0;
    return driveFetch(url, init, true);
  }
  return r;
}

/** Sign the picker consent once up front — called by the picker flow, not
 *  at app load. Returns when a usable token exists. */
export async function signInToDrivePicker(): Promise<void> {
  await ensureToken();
}

/**
 * Open Google's own file picker. The user chooses files; ONLY those file
 * IDs become reachable to this app under drive.file. Resolves [] when the
 * user cancels.
 */
export async function pickDriveFiles(): Promise<PickedFile[]> {
  if (!API_KEY) throw new Error('VITE_GOOGLE_API_KEY is not set.');
  const token = await ensureToken();
  await loadScript(GAPI_SRC);
  const gapi = window.gapi;
  const picker = pickerApi();
  if (!gapi || !picker) throw new Error('Google picker failed to load.');
  return new Promise<PickedFile[]>((resolve) => {
    gapi.load('picker', () => {
      const p = new picker.PickerBuilder()
        .setDeveloperKey(API_KEY)
        .setOAuthToken(token)
        .addView(picker.ViewId.DOCS)
        .setCallback((d) => {
          if (d.action === picker.Action.PICKED) {
            resolve(
              (d.docs ?? []).map((doc) => ({
                id: doc.id,
                name: doc.name,
                mimeType: doc.mimeType,
                sizeBytes: doc.sizeBytes,
              })),
            );
          } else if (d.action === picker.Action.CANCEL) {
            resolve([]);
          }
        })
        .build();
      p.setVisible(true);
    });
  });
}

/** Read-only download of a file the user picked — never a write call. */
export async function downloadDriveFile(fileId: string): Promise<Blob> {
  const r = await driveFetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
  );
  if (!r.ok) throw new Error(`Drive download failed (${r.status}).`);
  return r.blob();
}

// --- Semptify vault browse ---------------------------------------------------
// The flagship provisions a user-visible Semptify5.0/ tree under the SAME
// OAuth client we share, so drive.file sees it natively: we can list and
// read everything the client created or the user opened, but NOTHING else.
// The browse surface only ever queries children of the resolved root —
// the "does not reach beyond the Semptify folder" rule is structural.

export interface VaultEntry {
  id: string;
  name: string;
  isFolder: boolean;
  mimeType: string;
  sizeBytes?: number;
}

const SEMPTIFY_ROOT_NAME = 'Semptify5.0';

interface FilesListResp {
  files?: {
    id?: string;
    name?: string;
    mimeType?: string;
    size?: string;
  }[];
}

function toEntry(f: NonNullable<FilesListResp['files']>[number]): VaultEntry {
  return {
    id: f.id ?? '',
    name: f.name ?? '',
    isFolder: f.mimeType === 'application/vnd.google-apps.folder',
    mimeType: f.mimeType ?? '',
    sizeBytes: f.size ? Number(f.size) : undefined,
  };
}

/**
 * Locate the user's Semptify5.0/ root. Returns null when the vault isn't
 * provisioned or wasn't created under this client (falls back to picker).
 */
export async function findVaultRoot(): Promise<VaultEntry | null> {
  const q = encodeURIComponent(
    `name='${SEMPTIFY_ROOT_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const r = await driveFetch(
    `${DRIVE_API}/files?q=${q}&fields=files(id,name,mimeType)&pageSize=10`,
  );
  if (!r.ok) return null;
  const data = (await r.json()) as FilesListResp;
  const hit = data.files?.[0];
  return hit ? toEntry(hit) : null;
}

/** List one folder's children — caller passes a resolved Semptify id only. */
export async function listVaultFolder(folderId: string): Promise<VaultEntry[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const r = await driveFetch(
    `${DRIVE_API}/files?q=${q}&fields=files(id,name,mimeType,size)&pageSize=200&orderBy=name`,
  );
  if (!r.ok) throw new Error(`Drive list failed (${r.status}).`);
  const data = (await r.json()) as FilesListResp;
  return (data.files ?? []).map(toEntry);
}

// --- Lazy vault provisioning -------------------------------------------------
// Folders are created on FIRST NEED, never eagerly at onboarding — a user
// who never opens the CRM never gets CRM folders. Each module-owned folder
// carries a semptify.<module>.manifest.json stamping the storage version
// and scope, so any module can check compatibility before reading.
// These are APP-OWNED system files — the read-only rule binds user
// documents only; provisioning app folders is the same class as the
// flagship's Vault Installer.

const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

async function findChildId(
  name: string,
  parentId: string,
): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed=false`,
  );
  const r = await driveFetch(
    `${DRIVE_API}/files?q=${q}&fields=files(id,name,mimeType)&pageSize=10`,
  );
  if (!r.ok) return null;
  const data = (await r.json()) as FilesListResp;
  const hit = data.files?.find((f) => f.mimeType === FOLDER_MIME);
  return hit?.id ?? null;
}

async function createFolder(name: string, parentId: string): Promise<string> {
  const r = await driveFetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    body: new Blob(
      [
        '--x\nContent-Type: application/json\n\n' +
          JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }) +
          '\n--x--',
      ],
      { type: 'multipart/related; boundary=x' },
    ),
  });
  if (!r.ok) throw new Error(`Drive folder create failed (${r.status}).`);
  return ((await r.json()) as { id: string }).id;
}

async function ensureFolder(name: string, parentId: string): Promise<string> {
  return (await findChildId(name, parentId)) ?? createFolder(name, parentId);
}

async function fileExists(
  name: string,
  parentId: string,
): Promise<boolean> {
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed=false`,
  );
  const r = await driveFetch(`${DRIVE_API}/files?q=${q}&fields=files(id)&pageSize=1`);
  if (!r.ok) return false;
  return (((await r.json()) as FilesListResp).files ?? []).length > 0;
}

async function createJsonFile(
  name: string,
  parentId: string,
  payload: unknown,
): Promise<void> {
  const meta = JSON.stringify({ name, parents: [parentId] });
  const body = new Blob(
    [
      '--x\nContent-Type: application/json\n\n' + meta + '\n--x\n' +
        'Content-Type: application/json\n\n' + JSON.stringify(payload) +
        '\n--x--',
    ],
    { type: 'multipart/related; boundary=x' },
  );
  const r = await driveFetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    body,
  });
  if (!r.ok) throw new Error(`Drive file create failed (${r.status}).`);
}

/**
 * Resolve a path inside Semptify5.0/, creating any missing segment.
 * `parts` is the chain below the root, e.g. ['Vault', 'crm'].
 * The leaf folder gets a compat manifest on first creation. Returns the
 * leaf folder's Drive id — the only id callers should ever write under.
 */
export async function ensureVaultPath(
  parts: string[],
  moduleName = 'crm',
): Promise<string> {
  let parentId = await ensureFolder(SEMPTIFY_ROOT_NAME, 'root');
  for (const part of parts) {
    parentId = await ensureFolder(part, parentId);
  }
  const manifestName = `semptify.${moduleName}.manifest.json`;
  if (!(await fileExists(manifestName, parentId))) {
    await createJsonFile(manifestName, parentId, {
      semptify_storage: 1,
      module: moduleName,
      scope: 'drive.file',
      created: new Date().toISOString(),
    });
  }
  return parentId;
}
