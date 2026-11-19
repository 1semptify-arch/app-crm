import { useMemo, useRef, useState } from 'react';
import { mergeContacts } from '../lib/mergeContacts';
import { normalizeName } from '../lib/names';
import { getStore } from '../lib/store';
import type { Contact } from '../types';
import { GhostButton, PrimaryButton } from './ui';

// Possible-duplicate detection, all client-side: a pair is a candidate when
// the contacts share a normalized name, the same phone digits (>=7), or the
// same non-empty email. Dismissals live in component state only (v1).

interface Pair {
  a: Contact;
  b: Contact;
  reasons: string[];
  key: string;
}

function digits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

function findPairs(contacts: Contact[]): Pair[] {
  const pairs: Pair[] = [];
  for (let i = 0; i < contacts.length; i++) {
    for (let j = i + 1; j < contacts.length; j++) {
      const a = contacts[i];
      const b = contacts[j];
      const reasons: string[] = [];
      const an = normalizeName(a.name);
      const bn = normalizeName(b.name);
      if (an && an === bn) reasons.push('same name');
      const ap = digits(a.phone);
      const bp = digits(b.phone);
      if (ap.length >= 7 && ap === bp) reasons.push('same phone');
      const ae = (a.email ?? '').trim().toLowerCase();
      const be = (b.email ?? '').trim().toLowerCase();
      if (ae && ae === be) reasons.push('same email');
      if (reasons.length > 0) {
        pairs.push({ a, b, reasons, key: `${a.id}|${b.id}` });
      }
    }
  }
  return pairs;
}

function summary(c: Contact): string {
  return [c.org, c.phone, c.email, c.tags.length > 0 ? c.tags.join(', ') : null]
    .filter(Boolean)
    .join(' · ');
}

export function DedupeView({
  contacts,
  onChanged,
}: {
  contacts: Contact[];
  onChanged: () => void;
}) {
  const pairs = useMemo(() => findPairs(contacts), [contacts]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // Merged pairs are kept (with their old contacts) so "Merged." stays
  // visible after the contact list refreshes and the pair drops out.
  const mergedPairs = useRef(new Map<string, Pair>());
  const [merged, setMerged] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState<{ key: string; primary: 'a' | 'b' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = pairs.filter((p) => !dismissed.has(p.key) && !merged.has(p.key));

  async function doMerge(pair: Pair, primaryKey: 'a' | 'b') {
    const primary = primaryKey === 'a' ? pair.a : pair.b;
    const secondary = primaryKey === 'a' ? pair.b : pair.a;
    setBusy(true);
    setError(null);
    try {
      await mergeContacts(getStore(), primary, secondary);
      mergedPairs.current.set(pair.key, pair);
      setMerged((s) => new Set(s).add(pair.key));
      setMerging(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Merge failed.');
    } finally {
      setBusy(false);
    }
  }

  // Keep rendering merged cards after the contact list refresh empties
  // `pairs` — otherwise the "Merged." confirmation never appears.
  if (pairs.length === 0 && merged.size === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-400">
        No possible duplicates found.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Pairs match on name, phone, or email. Dismissals reset when this drawer
        closes.
      </p>
      {visible.length === 0 && merged.size === 0 && (
        <p className="py-8 text-center text-sm text-gray-400">
          All pairs dismissed.
        </p>
      )}
      <ul className="space-y-3">
        {[...mergedPairs.current.values()].map((pair) => (
          <li key={pair.key} className="rounded-xl border border-gray-200 p-4">
            <p className="text-sm font-medium text-gray-900">
              {pair.a.name} / {pair.b.name}
            </p>
            <p className="text-sm font-medium text-green-600">Merged.</p>
          </li>
        ))}
        {visible.map((pair) => (
          <li key={pair.key} className="rounded-xl border border-gray-200 p-4">
            {merging?.key === pair.key ? (
              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-900">
                  Keep which record?
                </p>
                {(['a', 'b'] as const).map((side) => {
                  const c = side === 'a' ? pair.a : pair.b;
                  return (
                    <label
                      key={side}
                      className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3"
                    >
                      <input
                        type="radio"
                        name={`primary-${pair.key}`}
                        className="mt-1"
                        checked={merging.primary === side}
                        onChange={() => setMerging({ key: pair.key, primary: side })}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-gray-900">
                          {c.name}
                        </span>
                        <span className="block truncate text-xs text-gray-500">
                          {summary(c) || 'No details'}
                        </span>
                      </span>
                    </label>
                  );
                })}
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="flex gap-3">
                  <PrimaryButton
                    onClick={() => doMerge(pair, merging.primary)}
                    disabled={busy}
                  >
                    {busy ? 'Merging…' : 'Merge'}
                  </PrimaryButton>
                  <GhostButton onClick={() => setMerging(null)}>Cancel</GhostButton>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-900">
                  {pair.a.name} / {pair.b.name}
                </p>
                <p className="text-xs text-gray-500">{pair.reasons.join(', ')}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setMerging({ key: pair.key, primary: 'a' });
                    }}
                    className="inline-flex min-h-[44px] items-center rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700"
                  >
                    Merge
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDismissed((s) => new Set(s).add(pair.key))
                    }
                    className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium text-gray-500 hover:bg-gray-100"
                  >
                    Not duplicates
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
