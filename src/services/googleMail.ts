// ---------------------------------------------------------------------------
// Gmail transport — sends and reads mail straight from the browser against
// gmail.googleapis.com, same zero-server posture as driveStore. Auth is a
// SECOND Google Identity Services token client on the same OAuth client ID:
// the Drive store keeps its narrow drive.appdata token; this module holds a
// gmail.send + gmail.readonly token so sending/reading mail doesn't widen
// what the storage layer can touch.
//
// One-time console setup: the OAuth consent screen should list the two
// gmail scopes (sensitive — fine for a test-user app; unverified-app
// warning shows during consent). No new origins are needed beyond the
// ones already registered for Drive mode.
// ---------------------------------------------------------------------------

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
export const isGmailConfigured = Boolean(CLIENT_ID);

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ');
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SESSION_KEY = 'semptify.gmail.token';

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
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GisOauth2 } };
  }
}

let tokenClient: GisTokenClient | null = null;
let accessToken: string | null = null;
let expiresAt = 0;
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

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
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: accessToken, expiresAt }));
  } catch {
    /* memory only */
  }
}

function clearToken(): void {
  accessToken = null;
  expiresAt = 0;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google sign-in failed to load.'));
    document.head.appendChild(s);
  });
}

async function ensureTokenClient(): Promise<GisTokenClient> {
  if (tokenClient) return tokenClient;
  if (!CLIENT_ID) throw new Error('VITE_GOOGLE_CLIENT_ID is not set.');
  await loadGis();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error('Google Identity Services unavailable.');
  tokenClient = oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (resp) => {
      const p = pending;
      pending = null;
      if (resp.access_token) {
        persistToken(resp.access_token, resp.expires_in ?? 3600);
        p?.resolve(resp.access_token);
      } else {
        p?.reject(new Error(resp.error ?? 'Google sign-in failed.'));
      }
    },
    error_callback: (err) => {
      const p = pending;
      pending = null;
      p?.reject(err instanceof Error ? err : new Error('Google sign-in was cancelled.'));
    },
  });
  return tokenClient;
}

function requestToken(prompt: '' | 'consent'): Promise<string> {
  return ensureTokenClient().then(
    (client) =>
      new Promise<string>((resolve, reject) => {
        pending = { resolve, reject };
        client.requestAccessToken({ prompt });
      }),
  );
}

export function getGmailSession(): boolean {
  return Boolean(accessToken && expiresAt > Date.now());
}

/** Interactive sign-in — silent first, consent popup as fallback. */
export async function signInToGmail(): Promise<void> {
  try {
    await requestToken('');
  } catch {
    await requestToken('consent');
  }
}

async function ensureToken(): Promise<string> {
  if (accessToken && expiresAt - 60_000 > Date.now()) return accessToken;
  return requestToken('');
}

async function gmailFetch(
  url: string,
  init: RequestInit = {},
  retried = false,
): Promise<Response> {
  const token = await ensureToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && !retried) {
    clearToken();
    return gmailFetch(url, init, true);
  }
  return res;
}

// --- Encoding helpers ---------------------------------------------------------

function base64url(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeUtf8Base64url(text: string): string {
  return base64url(new TextEncoder().encode(text));
}

function decodeBase64url(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(u8);
}

// --- Send ---------------------------------------------------------------------

/**
 * Send an email as the signed-in user. First call prompts Google consent
 * for gmail.send if the token isn't already held. Caller is responsible
 * for logging it afterward (EmailPlugin.logThread).
 */
export async function sendGmailMessage(msg: {
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  // RFC 5322 — plain text, CRLF line endings. Headers are encoded-word
  // UTF-8 so non-ASCII subjects survive.
  const encodedSubject = /[^\x20-\x7e]/.test(msg.subject)
    ? `=?utf-8?B?${btoa(unescape(encodeURIComponent(msg.subject)))}?=`
    : msg.subject;
  const raw = [
    `To: ${msg.to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBase64Wrap(msg.body),
  ].join('\r\n');
  const res = await gmailFetch(`${API}/messages/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: encodeUtf8Base64url(raw) }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Gmail send failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
}

function encodeBase64Wrap(text: string): string {
  const b64 = encodeUtf8Base64url(text)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  return b64.replace(/.{1,76}/g, '$&\r\n').replace(/\r\n$/, '');
}

// --- Read (inbound feed for the smart-brain plugin) ---------------------------

interface GmailListResponse {
  messages?: { id: string }[];
}
interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: GmailHeader[] };
}

export interface GmailInbound {
  id: string;
  from: string;
  subject: string;
  body?: string;
  date?: string;
}

function findPlainText(part: GmailPart | undefined): string | null {
  if (!part) return null;
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return decodeBase64url(part.body.data);
  }
  for (const sub of part.parts ?? []) {
    const found = findPlainText(sub);
    if (found) return found;
  }
  return null;
}

/**
 * Recent inbox messages in the smart-brain feed shape. `q` defaults to the
 * last 30 days of inbox mail; message bodies come from the text/plain part
 * (or Gmail's snippet when a message has none).
 */
export async function listGmailInbound(maxResults = 50): Promise<GmailInbound[]> {
  const list = await gmailFetch(
    `${API}/messages?q=${encodeURIComponent('in:inbox newer_than:30d')}&maxResults=${maxResults}`,
  );
  if (!list.ok) throw new Error(`Gmail list failed (${list.status}).`);
  const { messages = [] } = (await list.json()) as GmailListResponse;
  const out: GmailInbound[] = [];
  for (const { id } of messages) {
    const res = await gmailFetch(`${API}/messages/${id}?format=full`);
    if (!res.ok) continue;
    const m = (await res.json()) as GmailMessage;
    const headers = m.payload?.headers ?? [];
    const header = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
    out.push({
      id: m.id,
      from: header('From'),
      subject: header('Subject'),
      body: findPlainText(m.payload) ?? m.snippet ?? '',
      date: header('Date') || (m.internalDate ? new Date(Number(m.internalDate)).toISOString() : ''),
    });
  }
  return out;
}
