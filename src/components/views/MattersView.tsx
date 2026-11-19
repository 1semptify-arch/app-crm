import { format, isValid, parseISO } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import { downloadCSV } from '../../lib/csv';
import { getStore } from '../../lib/store';
import { MATTER_STAGES, type Contact, type Matter, type MatterStage } from '../../types';
import { matterStageText } from '../ui';

type Filter = 'all' | MatterStage;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  ...MATTER_STAGES.map((s) => ({ key: s as Filter, label: matterStageText(s).text })),
];

function fmtDay(iso: string): string {
  const d = parseISO(iso);
  return isValid(d) ? format(d, 'MMM d, yyyy') : iso;
}

export function MattersView({
  contacts,
  reloadKey,
  onOpenMatter,
}: {
  contacts: Contact[];
  reloadKey: number;
  onOpenMatter: (m: Matter) => void;
}) {
  const [matters, setMatters] = useState<Matter[]>([]);
  const [filter, setFilter] = useState<Filter>('all');

  const contactById = useMemo(
    () => new Map(contacts.map((c) => [c.id, c])),
    [contacts],
  );

  useEffect(() => {
    getStore()
      .listMatters()
      .then(setMatters)
      .catch(() => setMatters([]));
  }, [reloadKey]);

  const shown = filter === 'all' ? matters : matters.filter((m) => m.stage === filter);

  function exportCSV() {
    const rows = [
      ['title', 'contact_name', 'stage', 'opened_at', 'closed_at', 'summary'],
      ...shown.map((m) => [
        m.title,
        m.contact_id ? (contactById.get(m.contact_id)?.name ?? '') : '',
        m.stage,
        m.opened_at,
        m.closed_at ?? '',
        m.summary ?? '',
      ]),
    ];
    downloadCSV(`matters-${format(new Date(), 'yyyy-MM-dd')}.csv`, rows);
  }

  // Fixed pipeline order; empty groups are skipped.
  const groups = MATTER_STAGES.map((stage) => ({
    stage,
    items: shown.filter((m) => m.stage === stage),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1 text-sm">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`min-h-[44px] rounded-lg px-3 ${
              filter === f.key
                ? 'font-semibold text-indigo-600'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            {f.label}
          </button>
        ))}
        <button
          type="button"
          onClick={exportCSV}
          className="ml-auto inline-flex min-h-[44px] items-center rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Export
        </button>
      </div>
      {groups.length === 0 ? (
        <p className="py-12 text-center text-gray-400">
          {matters.length === 0 ? 'No matters yet.' : 'No matches.'}
        </p>
      ) : (
        groups.map((g) => {
          const st = matterStageText(g.stage);
          return (
            <section key={g.stage}>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                {st.text}
              </h3>
              <ul className="divide-y divide-gray-100">
                {g.items.map((m) => {
                  const contact = m.contact_id ? contactById.get(m.contact_id) : undefined;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => onOpenMatter(m)}
                        className="flex w-full items-baseline gap-4 py-3 text-left"
                      >
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate text-base ${
                              m.stage === 'closed'
                                ? 'text-gray-400 line-through'
                                : 'font-medium text-gray-900'
                            }`}
                          >
                            {m.title}
                          </span>
                          <span className="block truncate text-sm text-gray-500">
                            {[contact?.name, `Opened ${fmtDay(m.opened_at)}`]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        <span className={`shrink-0 text-sm font-medium ${st.className}`}>
                          {st.text}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
