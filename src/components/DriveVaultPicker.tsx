import { useCallback, useEffect, useState } from 'react';
import {
  downloadDriveFile,
  findVaultRoot,
  listVaultFolder,
  pickDriveFiles,
  type PickedFile,
  type VaultEntry,
} from '../services/drivePicker';
import { Icon } from './ui';

// In-app browser for the user's Semptify5.0/ vault — folders tap to open,
// files tap to attach. The listing surface is structurally confined to the
// resolved vault root; nothing outside it can appear here. Files the user
// placed via the Drive UI aren't client-visible under drive.file — the
// "Pick other files…" path opens Google's own picker for those.

export function DriveVaultPicker({
  pickerEnabled,
  onAttach,
  onClose,
}: {
  pickerEnabled: boolean;
  onAttach: (files: { name: string; mimeType: string; blob: Blob }[]) => void;
  onClose: () => void;
}) {
  const [path, setPath] = useState<VaultEntry[]>([]);
  const [entries, setEntries] = useState<VaultEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [vaultFound, setVaultFound] = useState<boolean | null>(null);

  const enter = useCallback(async (folder: VaultEntry | null) => {
    setEntries(null);
    setError(null);
    try {
      if (folder === null) {
        const root = await findVaultRoot();
        if (!root) {
          setVaultFound(false);
          setEntries([]);
          return;
        }
        setVaultFound(true);
        setPath([root]);
        setEntries(await listVaultFolder(root.id));
      } else {
        setPath((p) => {
          const idx = p.findIndex((e) => e.id === folder.id);
          return idx >= 0 ? p.slice(0, idx + 1) : [...p, folder];
        });
        setEntries(await listVaultFolder(folder.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not list folder.');
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    void enter(null);
  }, [enter]);

  async function attachEntry(e: VaultEntry) {
    setBusy(true);
    setError(null);
    try {
      const blob = await downloadDriveFile(e.id);
      onAttach([{ name: e.name, mimeType: e.mimeType, blob }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      setBusy(false);
    }
  }

  async function viaGooglePicker() {
    setBusy(true);
    setError(null);
    try {
      const picked: PickedFile[] = await pickDriveFiles();
      const out: { name: string; mimeType: string; blob: Blob }[] = [];
      for (const f of picked) {
        out.push({
          name: f.name,
          mimeType: f.mimeType,
          blob: await downloadDriveFile(f.id),
        });
      }
      if (out.length > 0) onAttach(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Picker failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h3 className="text-base font-semibold text-gray-900">From Drive</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-gray-400 hover:bg-gray-50"
          >
            ✕
          </button>
        </div>

        {path.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto border-b border-gray-100 px-4 py-2 text-sm">
            {path.map((seg, i) => (
              <span key={seg.id} className="flex items-center gap-1 whitespace-nowrap">
                {i > 0 && <span className="text-gray-300">/</span>}
                <button
                  type="button"
                  onClick={() => enter(seg)}
                  className="rounded px-1 py-0.5 text-indigo-600 hover:bg-indigo-50"
                >
                  {seg.name}
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {error && <p className="px-2 py-1 text-sm text-red-600">{error}</p>}
          {entries === null ? (
            <p className="px-2 py-6 text-center text-sm text-gray-400">
              Loading…
            </p>
          ) : entries.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-gray-400">
              {vaultFound === false
                ? 'No Semptify folder found in your Drive yet.'
                : 'This folder is empty.'}
            </p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {entries.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => (e.isFolder ? enter(e) : attachEntry(e))}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-gray-50 disabled:opacity-50"
                  >
                    <Icon
                      name={e.isFolder ? 'folder' : 'file'}
                      className="h-5 w-5 shrink-0 text-gray-400"
                    />
                    <span className="min-w-0 flex-1 truncate text-base text-gray-900">
                      {e.name}
                    </span>
                    {e.isFolder && (
                      <span className="text-gray-300">›</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-gray-100 px-4 py-3">
          {pickerEnabled && (
            <button
              type="button"
              disabled={busy}
              onClick={viaGooglePicker}
              className="w-full rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Pick other files…
            </button>
          )}
          <p className="mt-2 text-center text-xs text-gray-400">
            We only ever see files you choose — and we only read them.
          </p>
        </div>
      </div>
    </div>
  );
}
