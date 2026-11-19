import { format } from 'date-fns';
import { useMemo, useRef, useState } from 'react';
import { downloadCSV, parseCSV } from '../../lib/csv';
import { normalizeName } from '../../lib/names';
import { getStore } from '../../lib/store';
import type { Contact } from '../../types';
import { Icon, inputClass } from '../ui';

const EXPORT_COLUMNS = [
  'name',
  'phone',
  'email',
  'org',
  'role',
  'address',
  'website',
  'tags',
] as const;

// Advanced lookup — Act!-style "field contains text" rows, ANDed together.
type CondField = 'name' | 'org' | 'role' | 'address' | 'email' | 'phone' | 'tag';
type SortKey = 'name' | 'newest' | 'org';

const COND_FIELDS: { key: CondField; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'org', label: 'Org' },
  { key: 'role', label: 'Role' },
  { key: 'address', label: 'Address' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'tag', label: 'Tag' },
];

// Values a condition tests against — tag matches when ANY tag contains the text.
const FIELD_VALUES: Record<CondField, (c: Contact) => string[]> = {
  name: (c) => [c.name],
  org: (c) => [c.org ?? ''],
  role: (c) => [c.role ?? ''],
  address: (c) => [c.address ?? ''],
  email: (c) => [c.email ?? ''],
  phone: (c) => [c.phone ?? ''],
  tag: (c) => c.tags,
};

const EMPTY_CONDITIONS: { field: CondField; text: string }[] = [
  { field: 'name', text: '' },
  { field: 'name', text: '' },
  { field: 'name', text: '' },
];

export function ContactsView({
  contacts,
  onOpenContact,
  onOpenDedupe,
  onChanged,
}: {
  contacts: Contact[];
  onOpenContact: (c: Contact) => void;
  onOpenDedupe: () => void;
  onChanged: () => void;
}) {
  const [q, setQ] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [conditions, setConditions] =
    useState<{ field: CondField; text: string }[]>(EMPTY_CONDITIONS);
  const [sort, setSort] = useState<SortKey>('name');
  const [importNote, setImportNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const allTags = useMemo(
    () => [...new Set(contacts.flatMap((c) => c.tags))].sort((a, b) => a.localeCompare(b)),
    [contacts],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const active = conditions
      .map((c) => ({ ...c, needle: c.text.trim().toLowerCase() }))
      .filter((c) => c.needle);
    return contacts.filter(
      (c) =>
        selectedTags.every((t) => c.tags.includes(t)) &&
        (!needle ||
          c.name.toLowerCase().includes(needle) ||
          (c.email ?? '').toLowerCase().includes(needle) ||
          (c.phone ?? '').toLowerCase().includes(needle) ||
          (c.org ?? '').toLowerCase().includes(needle) ||
          c.tags.some((t) => t.toLowerCase().includes(needle))) &&
        active.every((cond) =>
          FIELD_VALUES[cond.field](c).some((v) =>
            v.toLowerCase().includes(cond.needle),
          ),
        ),
    );
  }, [contacts, q, selectedTags, conditions]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sort === 'newest') {
      arr.sort((a, b) => b.created_at.localeCompare(a.created_at));
    } else if (sort === 'org') {
      arr.sort((a, b) => {
        const ao = (a.org ?? '').toLowerCase();
        const bo = (b.org ?? '').toLowerCase();
        if (!ao && bo) return 1;
        if (ao && !bo) return -1;
        return ao.localeCompare(bo) || a.name.localeCompare(b.name);
      });
    } else {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    }
    return arr;
  }, [filtered, sort]);

  function setCondition(i: number, patch: Partial<{ field: CondField; text: string }>) {
    setConditions((conds) =>
      conds.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    );
  }

  function toggleTag(tag: string) {
    setSelectedTags((sel) =>
      sel.includes(tag) ? sel.filter((t) => t !== tag) : [...sel, tag],
    );
  }

  function exportCSV() {
    const rows = [
      [...EXPORT_COLUMNS],
      ...sorted.map((c) => [
        c.name,
        c.phone ?? '',
        c.email ?? '',
        c.org ?? '',
        c.role ?? '',
        c.address ?? '',
        c.website ?? '',
        c.tags.join(';'),
      ]),
    ];
    downloadCSV(`contacts-${format(new Date(), 'yyyy-MM-dd')}.csv`, rows);
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // re-picking the same file still fires onChange
    if (!file) return;
    setImportNote(null);
    try {
      const rows = parseCSV(await file.text()).filter((r) =>
        r.some((cell) => cell.trim()),
      );
      const header = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
      if (!header.includes('name')) {
        setImportNote('Import failed: CSV needs a "name" column.');
        return;
      }
      const idx = (k: string) => header.indexOf(k);
      const col = {
        name: idx('name'),
        phone: idx('phone'),
        email: idx('email'),
        org: idx('org'),
        role: idx('role'),
        address: idx('address'),
        website: idx('website'),
        tags: idx('tags'),
      };
      const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
      const existingByName = new Map(
        contacts.map((c) => [normalizeName(c.name), c]),
      );
      let added = 0;
      let updated = 0;
      for (const r of rows.slice(1)) {
        const name = cell(r, col.name);
        if (!name) continue;
        const key = normalizeName(name);
        const existing = existingByName.get(key);
        const tagsCell = cell(r, col.tags);
        const tags = tagsCell
          ? tagsCell
              .split(';')
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined;
        const saved = await getStore().upsertContact({
          id: existing?.id,
          name,
          phone: cell(r, col.phone) || existing?.phone || null,
          email: cell(r, col.email) || existing?.email || null,
          org: cell(r, col.org) || existing?.org || null,
          role: cell(r, col.role) || existing?.role || null,
          address: cell(r, col.address) || existing?.address || null,
          website: cell(r, col.website) || existing?.website || null,
          tags: tags ?? existing?.tags,
          plugin_data: existing?.plugin_data,
        });
        existingByName.set(key, saved);
        if (existing) updated += 1;
        else added += 1;
      }
      setImportNote(`Imported: ${added} added, ${updated} updated`);
      onChanged();
    } catch (err) {
      setImportNote(
        `Import failed: ${err instanceof Error ? err.message : 'could not parse CSV.'}`,
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Icon
            name="search"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          />
          <input
            className={`${inputClass} pl-9`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search contacts"
          />
        </div>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Import
        </button>
        <button
          type="button"
          onClick={exportCSV}
          className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Export
        </button>
        <button
          type="button"
          onClick={onOpenDedupe}
          className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium text-gray-500 hover:bg-gray-100"
        >
          Duplicates
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={onImportFile}
        />
      </div>
      {importNote && <p className="text-sm text-gray-500">{importNote}</p>}
      <div>
        <button
          type="button"
          onClick={() => setAdvancedOpen((o) => !o)}
          aria-expanded={advancedOpen}
          className="min-h-[44px] text-sm font-medium text-gray-500 hover:text-gray-700"
        >
          Advanced {advancedOpen ? '▾' : '▸'}
        </button>
        {advancedOpen && (
          <div className="mt-1 space-y-2">
            {conditions.map((cond, i) => (
              <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <select
                  aria-label={`Condition ${i + 1} field`}
                  value={cond.field}
                  onChange={(e) =>
                    setCondition(i, { field: e.target.value as CondField })
                  }
                  className={`${inputClass} sm:w-40`}
                >
                  {COND_FIELDS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <span className="hidden shrink-0 text-sm text-gray-400 sm:inline">
                  contains
                </span>
                <input
                  aria-label={`Condition ${i + 1} text`}
                  className={inputClass}
                  value={cond.text}
                  onChange={(e) => setCondition(i, { text: e.target.value })}
                  placeholder="contains"
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() => setConditions(EMPTY_CONDITIONS)}
              className="min-h-[44px] text-sm text-gray-500 hover:text-gray-700"
            >
              Clear
            </button>
          </div>
        )}
      </div>
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1 text-sm">
          {allTags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggleTag(t)}
              className={`min-h-[44px] rounded-lg px-3 ${
                selectedTags.includes(t)
                  ? 'font-semibold text-indigo-600'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          {filtered.length} contact{filtered.length === 1 ? '' : 's'}
        </p>
        <select
          aria-label="Sort contacts"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="min-h-[44px] rounded-lg border-0 bg-transparent text-sm text-gray-500 hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-indigo-600"
        >
          <option value="name">Name A–Z</option>
          <option value="newest">Newest</option>
          <option value="org">Org</option>
        </select>
      </div>
      {filtered.length === 0 ? (
        <p className="py-12 text-center text-gray-400">
          {contacts.length === 0 ? 'No contacts yet — add your first.' : 'No matches.'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {sorted.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onOpenContact(c)}
                className="flex w-full items-center gap-4 py-3.5 text-left"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-500">
                  {c.name
                    .split(' ')
                    .map((p) => p[0])
                    .filter(Boolean)
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium text-gray-900">
                    {c.name}
                  </span>
                  <span className="block truncate text-sm text-gray-500">
                    {[c.org, c.phone, c.email].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {c.tags.length > 0 && (
                  <span className="hidden shrink-0 text-xs text-gray-400 sm:block">
                    {c.tags.join(', ')}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
