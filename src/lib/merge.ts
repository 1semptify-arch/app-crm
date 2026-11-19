import { format } from 'date-fns';
import type { Contact } from '../types';

// Act!-style mail merge — plain string replacement only, no templating
// engine. Supported fields:
//   {{name}}  → the contact's full name
//   {{first}} → the first word of the contact's name
//   {{org}}   → the contact's organization
//   {{date}}  → today, e.g. "November 18, 2026"
export function applyTemplate(text: string, contact: Contact | null | undefined): string {
  const name = contact?.name ?? '';
  const first = name.trim().split(/\s+/)[0] ?? '';
  return text
    .replace(/\{\{name\}\}/g, name)
    .replace(/\{\{first\}\}/g, first)
    .replace(/\{\{org\}\}/g, contact?.org ?? '')
    .replace(/\{\{date\}\}/g, format(new Date(), 'MMMM d, yyyy'));
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
}
