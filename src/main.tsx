import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

// registerType 'autoUpdate' reloads when a NEW sw.js is found — but the
// browser only LOOKS for one on navigation. Poll so a fresh deploy lands
// within minutes instead of on the next cold start (stale-bundle class
// of bug, verified 2026-11-21/23).
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, r) {
    if (r) setInterval(() => r.update(), 10 * 60 * 1000);
  },
});
import { registerEmailPlugin } from './services/email';
import { isCaseServed } from './lib/httpStore';
import {
  createGmailBrainPlugin,
  createSmartBrainEmailPlugin,
} from './services/smartBrainEmail';

// Email plugin: an explicit inbound-mail URL wins (tools/inbox_endpoint.py
// or any JSON feed); case-served builds self-wire to the same-origin
// /api/mail/inbound feed (crm_store's Gmail-IMAP read); otherwise the Gmail
// transport registers itself when a Google client ID is present — Sync
// inbox and Send-via-Gmail light up in every storage mode.
const inboundMailUrl = import.meta.env.VITE_CRM_INBOUND_MAIL_URL as string | undefined;
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
if (inboundMailUrl) {
  registerEmailPlugin(createSmartBrainEmailPlugin(inboundMailUrl));
} else if (isCaseServed()) {
  registerEmailPlugin(createSmartBrainEmailPlugin('/api/mail/inbound'));
} else if (googleClientId) {
  registerEmailPlugin(createGmailBrainPlugin());
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
