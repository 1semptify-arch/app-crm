import { format, isValid, parseISO } from 'date-fns';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getStore } from '../lib/store';
import type { Attachment } from '../types';
import { Icon } from './ui';

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string): string {
  const d = parseISO(iso);
  return isValid(d) ? format(d, 'MMM d, yyyy') : iso;
}

// Documents tab for a contact or matter — Act!-style attachment list.
// File bytes live in the user's own storage: Drive appDataFolder, inline
// base64 in local demo mode, or the private crm-documents bucket in
// Supabase mode.
export function AttachmentsSection({
  entity,
  onChanged,
}: {
  entity: { contactId?: string; matterId?: string };
  onChanged: () => void;
}) {
  const { contactId, matterId } = entity;
  const [items, setItems] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    getStore()
      .listAttachments({ contactId, matterId })
      .then(setItems)
      .catch(() => setItems([]));
  }, [contactId, matterId]);

  useEffect(load, [load]);

  async function attach(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        await getStore().addAttachment(
          {
            contact_id: contactId ?? null,
            matter_id: matterId ?? null,
            filename: file.name,
            mime_type: file.type || 'application/octet-stream',
            size_bytes: file.size,
          },
          file,
        );
      }
      load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Attach failed.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function download(a: Attachment) {
    setError(null);
    try {
      const blob = await getStore().getAttachmentContent(a.id);
      const url = URL.createObjectURL(blob);
      const el = document.createElement('a');
      el.href = url;
      el.download = a.filename;
      document.body.appendChild(el);
      el.click();
      el.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed.');
    }
  }

  async function remove(a: Attachment) {
    if (!window.confirm(`Delete ${a.filename}?`)) return;
    setError(null);
    try {
      await getStore().deleteAttachment(a.id);
      load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed.');
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Documents
        </h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Attach
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => attach(e.target.files)}
        />
      </div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {items.length === 0 ? (
        <p className="text-sm text-gray-400">No documents yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-1 py-2.5">
              <span className="min-w-0 flex-1 truncate text-base font-medium text-gray-900">
                {a.filename}
              </span>
              <span className="shrink-0 text-sm text-gray-400">
                {fmtSize(a.size_bytes)} · {fmtDate(a.created_at)}
              </span>
              <button
                type="button"
                onClick={() => download(a)}
                aria-label={`Download ${a.filename}`}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-gray-400 hover:bg-gray-50 hover:text-indigo-600 disabled:opacity-40"
              >
                <Icon name="download" className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => remove(a)}
                aria-label={`Delete ${a.filename}`}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-gray-400 hover:bg-gray-50 hover:text-red-600"
              >
                <Icon name="trash" className="h-5 w-5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
