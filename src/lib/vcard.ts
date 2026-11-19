import type { Contact } from '../types';

// vCard 3.0 export — one card per contact, best-effort field mapping.
// Values escape RFC 2426 reserved chars (comma, semicolon, backslash,
// newline) before joining into CRLF property lines.

function esc(v: string): string {
  return v
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function revStamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
    : d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
}

export function contactToVCard(c: Contact): string {
  // N best-effort split: first token = given name, the rest = family name.
  const parts = c.name.trim().split(/\s+/);
  const given = parts[0] ?? '';
  const family = parts.slice(1).join(' ');

  const custom = c.plugin_data?.custom_fields;
  const note =
    custom && typeof custom === 'object' && !Array.isArray(custom)
      ? Object.entries(custom as Record<string, unknown>)
          .filter(([k, v]) => k && typeof v === 'string' && v)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n')
      : '';

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${esc(c.name)}`,
    `N:${esc(family)};${esc(given)};;;`,
  ];
  if (c.phone) lines.push(`TEL;TYPE=CELL:${esc(c.phone)}`);
  if (c.email) lines.push(`EMAIL:${esc(c.email)}`);
  if (c.org) lines.push(`ORG:${esc(c.org)}`);
  if (c.role) lines.push(`TITLE:${esc(c.role)}`);
  if (c.address) lines.push(`ADR:;;${esc(c.address)};;;;`); // single-line, best effort
  if (note) lines.push(`NOTE:${esc(note)}`);
  if (c.website) lines.push(`URL:${esc(c.website)}`);
  lines.push(`REV:${revStamp(c.created_at)}`);
  lines.push('END:VCARD');
  return lines.join('\r\n') + '\r\n';
}

// Same download pattern as csv.ts downloadCSV, for a .vcf blob.
export function downloadVCard(c: Contact): void {
  const blob = new Blob([contactToVCard(c)], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${c.name.trim().replace(/\s+/g, ' ') || 'contact'}.vcf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
