import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { registerEmailPlugin } from './services/email';
import {
  createGmailBrainPlugin,
  createSmartBrainEmailPlugin,
} from './services/smartBrainEmail';

// Email plugin: an explicit inbound-mail URL wins (tools/inbox_endpoint.py
// or any JSON feed); otherwise the Gmail transport registers itself when a
// Google client ID is present — Sync inbox and Send-via-Gmail light up in
// every storage mode.
const inboundMailUrl = import.meta.env.VITE_CRM_INBOUND_MAIL_URL as string | undefined;
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
if (inboundMailUrl) {
  registerEmailPlugin(createSmartBrainEmailPlugin(inboundMailUrl));
} else if (googleClientId) {
  registerEmailPlugin(createGmailBrainPlugin());
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
