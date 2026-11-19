import { format, parseISO } from 'date-fns';
import { useEffect, useRef, useState } from 'react';
import { getStore } from '../lib/store';
import type { Appointment, Contact, Interaction, Matter, SearchResults } from '../types';
import { Icon, matterStageText } from './ui';

export type SearchSelection =
  | { kind: 'contact'; contact: Contact }
  | { kind: 'matter'; matter: Matter }
  | { kind: 'appointment'; appointment: Appointment }
  | { kind: 'interaction'; interaction: Interaction };

const EMPTY_RESULTS: SearchResults = {
  contacts: [],
  matters: [],
  appointments: [],
  interactions: [],
};

export function SearchPalette({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (sel: SearchSelection) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setResults(EMPTY_RESULTS);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const needle = q.trim();
    if (!needle) {
      setResults(EMPTY_RESULTS);
      return;
    }
    const t = setTimeout(() => {
      getStore()
        .search(needle)
        .then(setResults)
        .catch(() => setResults(EMPTY_RESULTS));
    }, 150);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const empty =
    q.trim() &&
    results.contacts.length === 0 &&
    results.matters.length === 0 &&
    results.appointments.length === 0 &&
    results.interactions.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-gray-900/30 px-4 pt-[12vh]">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl" role="dialog" aria-label="Search">
        <div className="flex items-center gap-3 border-b border-gray-100 px-4">
          <Icon name="search" className="h-5 w-5 shrink-0 text-gray-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search contacts, matters, appointments, logs…"
            className="min-h-[52px] w-full bg-transparent text-base text-gray-900 placeholder-gray-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-xs text-gray-400 hover:text-gray-600"
          >
            Esc
          </button>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {empty && <p className="px-3 py-6 text-center text-sm text-gray-400">No matches.</p>}
          {!q.trim() && (
            <p className="px-3 py-6 text-center text-sm text-gray-400">
              Type to search across everything.
            </p>
          )}
          {results.contacts.length > 0 && (
            <Section title="Contacts">
              {results.contacts.map((c) => (
                <ResultRow
                  key={c.id}
                  primary={c.name}
                  secondary={[c.phone, c.email].filter(Boolean).join(' · ')}
                  onClick={() => onSelect({ kind: 'contact', contact: c })}
                />
              ))}
            </Section>
          )}
          {results.matters.length > 0 && (
            <Section title="Matters">
              {results.matters.map((m) => (
                <ResultRow
                  key={m.id}
                  primary={m.title}
                  secondary={matterStageText(m.stage).text}
                  onClick={() => onSelect({ kind: 'matter', matter: m })}
                />
              ))}
            </Section>
          )}
          {results.appointments.length > 0 && (
            <Section title="Appointments">
              {results.appointments.map((a) => (
                <ResultRow
                  key={a.id}
                  primary={a.title}
                  secondary={format(parseISO(a.starts_at), 'MMM d, yyyy · h:mm a')}
                  onClick={() => onSelect({ kind: 'appointment', appointment: a })}
                />
              ))}
            </Section>
          )}
          {results.interactions.length > 0 && (
            <Section title="Logs">
              {results.interactions.map((i) => (
                <ResultRow
                  key={i.id}
                  primary={i.subject_outline?.split('\n')[0] || i.notes?.split('\n')[0] || i.type}
                  secondary={`${i.type} · ${format(parseISO(i.occurred_at), 'MMM d, yyyy')}`}
                  onClick={() => onSelect({ kind: 'interaction', interaction: i })}
                />
              ))}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-2">
      <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
        {title}
      </p>
      {children}
    </div>
  );
}

function ResultRow({
  primary,
  secondary,
  onClick,
}: {
  primary: string;
  secondary: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-lg px-3 py-2.5 text-left hover:bg-gray-50"
    >
      <span className="block truncate text-sm font-medium text-gray-900">{primary}</span>
      {secondary && <span className="block truncate text-xs text-gray-500">{secondary}</span>}
    </button>
  );
}
