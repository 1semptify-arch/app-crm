import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getStore } from '../../lib/store';
import type { DrawerState } from '../../lib/uiState';
import {
  CONTACT_STATUSES,
  type Appointment,
  type Contact,
  type Interaction,
  type Matter,
} from '../../types';
import { AttachmentsSection } from '../AttachmentsSection';
import { matterStageText } from '../ui';
import { isOverdue } from '../TaskCard';
import { Timeline } from '../Timeline';
import { Icon } from '../ui';
import { projectToolbar, type ToolbarAction } from '../../lib/toolbar';

// One-tap call outcomes — same vocabulary as the legacy /call page.
// statusMap advances the contact's pipeline status when the outcome lands.
const OUTCOMES: { key: string; label: string; statusMap?: string }[] = [
  { key: 'reached', label: 'Reached', statusMap: 'contacted' },
  { key: 'voicemail', label: 'Voicemail' },
  { key: 'no answer', label: 'No answer' },
  { key: 'interested', label: 'Interested', statusMap: 'contacted' },
  { key: 'booked consult', label: 'Booked consult', statusMap: 'consult_set' },
  { key: 'declined', label: 'Declined', statusMap: 'declined' },
  { key: 'conflicted', label: 'Conflicted', statusMap: 'conflicted' },
];

// Pipeline order for "next target" — who the desk sends you to after a
// no-answer/decline on an attorney card.
const PIPELINE_ORDER = ['target', 'not_called', 'intake_sent', 'replied'];

interface ScriptPayload {
  name: string;
  org: string | null;
  phone: string | null;
  status: string | null;
  level: string | null;
  script: string;
  voicemail: string;
}

const SECTION_H =
  'mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500';
const ACTION_CLS =
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 px-3.5 text-sm font-medium text-gray-700 hover:bg-gray-50';
const PRIMARY_CLS =
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 text-sm font-medium text-white hover:bg-indigo-700';
const OUTCOME_CLS =
  'inline-flex min-h-[44px] items-center rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50';

function fmtShort(iso: string | null): string {
  if (!iso) return '';
  const d = parseISO(iso);
  return isValid(d) ? format(d, 'MMM d, yyyy') : iso;
}

function rel(iso: string | null): string {
  if (!iso) return 'never';
  const d = parseISO(iso);
  return isValid(d) ? `${formatDistanceToNow(d)} ago` : iso;
}

function statusClass(s: string | null | undefined): string {
  switch (s) {
    case 'active':
    case 'contacted':
    case 'replied':
    case 'consult_set':
      return 'text-green-700';
    case 'declined':
    case 'conflicted':
    case 'closed':
      return 'text-red-600';
    case 'intake_sent':
      return 'text-amber-600';
    default:
      return 'text-gray-500';
  }
}

export function DeskView({
  contacts,
  contactId,
  reloadKey,
  onSelectContact,
  onOpenDrawer,
  onChanged,
}: {
  contacts: Contact[];
  contactId: string | null;
  reloadKey: number;
  onSelectContact: (id: string | null) => void;
  onOpenDrawer: (d: NonNullable<DrawerState>) => void;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [matters, setMatters] = useState<Matter[]>([]);
  const [script, setScript] = useState<ScriptPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [quickNote, setQuickNote] = useState('');

  const contact = contacts.find((c) => c.id === contactId) ?? null;
  const caseMode = getStore().mode === 'case';

  const load = useCallback(() => {
    if (!contactId) return;
    const store = getStore();
    store
      .listInteractions(contactId)
      .then(setInteractions)
      .catch(() => setInteractions([]));
    store
      .listAppointments()
      .then((all) =>
        setAppointments(all.filter((a) => a.contact_id === contactId)),
      )
      .catch(() => setAppointments([]));
    store
      .listMatters(contactId)
      .then(setMatters)
      .catch(() => setMatters([]));
  }, [contactId]);

  useEffect(load, [load, reloadKey]);

  useEffect(() => {
    setScript(null);
    if (!contactId || !caseMode) return;
    fetch(`/api/script?contact_id=${encodeURIComponent(contactId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setScript)
      .catch(() => setScript(null));
  }, [contactId, caseMode, reloadKey]);

  const openFollowUps = useMemo(
    () =>
      interactions
        .filter((i) => i.due_at && i.status !== 'resolved')
        .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? '')),
    [interactions],
  );

  const lastTouch = useMemo(
    () =>
      interactions.find(
        (i) => !i.due_at || i.status === 'resolved',
      ) ?? null,
    [interactions],
  );

  const nextTarget = useMemo(() => {
    if (contact?.kind !== 'attorney') return null;
    for (const st of PIPELINE_ORDER) {
      const nxt = contacts.find(
        (c) => c.kind === 'attorney' && c.status === st && c.id !== contact.id,
      );
      if (nxt) return nxt;
    }
    return null;
  }, [contacts, contact]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const base = needle
      ? contacts.filter(
          (c) =>
            c.name.toLowerCase().includes(needle) ||
            (c.org ?? '').toLowerCase().includes(needle) ||
            (c.email ?? '').toLowerCase().includes(needle),
        )
      : contacts;
    return [...base].sort((a, b) => {
      const oa = PIPELINE_ORDER.indexOf(a.status ?? '');
      const ob = PIPELINE_ORDER.indexOf(b.status ?? '');
      const pa = oa === -1 ? 99 : oa;
      const pb = ob === -1 ? 99 : ob;
      return pa - pb || a.name.localeCompare(b.name);
    });
  }, [contacts, filter]);

  // Prev/next cycling through the filtered rail — work the list without
  // ever leaving the page (the contact-card tab-through pattern).
  const cursor = filtered.findIndex((c) => c.id === contactId);
  const prevContact = cursor > 0 ? filtered[cursor - 1] : null;
  const nextContact =
    cursor >= 0 && cursor < filtered.length - 1 ? filtered[cursor + 1] : null;

  // ---- inline actions (resolve in place, advance state) ----

  async function setStatus(next: string) {
    if (!contact) return;
    setBusy('status');
    try {
      await getStore().upsertContact({
        id: contact.id,
        name: contact.name,
        status: next,
        plugin_data: contact.plugin_data,
      });
      onChanged();
    } catch (e) {
      console.error('status update failed', e);
    } finally {
      setBusy(null);
    }
  }

  async function logOutcome(key: string) {
    if (!contact) return;
    setBusy(key);
    try {
      const store = getStore();
      const spec = OUTCOMES.find((o) => o.key === key);
      await store.addInteraction({
        contact_id: contact.id,
        type: 'call',
        outcome: key,
        occurred_at: new Date().toISOString(),
        status: 'resolved',
      });
      if (spec?.statusMap) {
        await store.upsertContact({
          id: contact.id,
          name: contact.name,
          status: spec.statusMap,
          plugin_data: contact.plugin_data,
        });
      }
      onChanged();
    } catch (e) {
      console.error('outcome log failed', e);
    } finally {
      setBusy(null);
    }
  }

  async function finishFollowUp(i: Interaction) {
    setBusy(i.id);
    try {
      await getStore().upsertInteraction({
        id: i.id,
        type: i.type,
        contact_id: i.contact_id,
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        // Keep the due date — the register row updates in place.
        due_at: i.due_at,
      });
      onChanged();
    } catch (e) {
      console.error('finish follow-up failed', e);
    } finally {
      setBusy(null);
    }
  }

  async function saveQuickNote() {
    const text = quickNote.trim();
    if (!contact || !text) return;
    setBusy('note');
    try {
      await getStore().addInteraction({
        contact_id: contact.id,
        type: 'note',
        notes: text,
        occurred_at: new Date().toISOString(),
        status: 'resolved',
      });
      setQuickNote('');
      onChanged();
    } catch (e) {
      console.error('quick note failed', e);
    } finally {
      setBusy(null);
    }
  }

  async function snoozeFollowUp(i: Interaction, days: number) {
    setBusy(i.id);
    try {
      const d = new Date();
      d.setDate(d.getDate() + days);
      await getStore().upsertInteraction({
        id: i.id,
        type: i.type,
        contact_id: i.contact_id,
        due_at: d.toISOString(),
        status: 'new',
        resolved_at: null,
      });
      onChanged();
    } catch (e) {
      console.error('snooze failed', e);
    } finally {
      setBusy(null);
    }
  }

  // ---- render ----

  return (
    <div className="flex gap-6">
      {/* rail — who to work on next, pipeline order */}
      <aside className={`${contact ? 'hidden lg:block' : 'block'} w-full shrink-0 lg:w-72`}>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find a person…"
          aria-label="Find a person"
          className="mb-3 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-base text-gray-900 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
        />
        <ul className="divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200 bg-white lg:max-h-[75vh]">
          {filtered.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelectContact(c.id)}
                className={`flex w-full items-baseline gap-2 px-3 py-2.5 text-left hover:bg-gray-50 ${
                  c.id === contactId ? 'bg-indigo-50' : ''
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-base font-medium text-gray-900">
                  {c.name}
                </span>
                <span className={`shrink-0 text-xs font-medium ${statusClass(c.status)}`}>
                  {c.kind === 'attorney' ? '⚖ ' : ''}
                  {(c.status ?? 'new').replaceAll('_', ' ')}
                </span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-gray-400">
              Nobody matches.
            </li>
          )}
        </ul>
      </aside>

      {/* workspace */}
      {contact && (
        <div className="min-w-0 flex-1 space-y-6">
          <button
            type="button"
            onClick={() => onSelectContact(null)}
            className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline lg:hidden"
          >
            <Icon name="chevron-left" className="h-4 w-4" /> All contacts
          </button>

          {/* OBJECTIVE — one sentence, status editable in place */}
          <header className="space-y-1.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => prevContact && onSelectContact(prevContact.id)}
                  disabled={!prevContact}
                  aria-label={prevContact ? `Previous: ${prevContact.name}` : 'No previous contact'}
                  title={prevContact ? prevContact.name : ''}
                  className="flex min-h-[44px] min-w-[36px] items-center justify-center rounded-lg text-gray-400 hover:bg-gray-50 hover:text-indigo-600 disabled:opacity-30"
                >
                  <Icon name="chevron-left" className="h-5 w-5" />
                </button>
                <h2 className="text-2xl font-semibold tracking-tight text-gray-900">
                  {contact.name}
                </h2>
                <button
                  type="button"
                  onClick={() => nextContact && onSelectContact(nextContact.id)}
                  disabled={!nextContact}
                  aria-label={nextContact ? `Next: ${nextContact.name}` : 'No next contact'}
                  title={nextContact ? nextContact.name : ''}
                  className="flex min-h-[44px] min-w-[36px] items-center justify-center rounded-lg text-gray-400 hover:bg-gray-50 hover:text-indigo-600 disabled:opacity-30"
                >
                  <Icon name="chevron-right" className="h-5 w-5" />
                </button>
              </span>
              {contact.kind && (
                <span className="text-base text-gray-500">{contact.kind}</span>
              )}
              <select
                value={contact.status ?? 'new'}
                onChange={(e) => setStatus(e.target.value)}
                disabled={busy === 'status'}
                aria-label="Pipeline status"
                className={`min-h-[44px] rounded-lg border border-gray-200 bg-white px-2 text-base font-medium focus:border-indigo-600 focus:outline-none ${statusClass(contact.status)}`}
              >
                {CONTACT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
            {(contact.org || contact.role) && (
              <p className="text-base text-gray-600">
                {[contact.role, contact.org].filter(Boolean).join(' · ')}
              </p>
            )}
            {contact.tags.length > 0 && (
              <p className="text-sm text-gray-400">{contact.tags.join(', ')}</p>
            )}
            <p className="space-x-4 text-base">
              {contact.phone && (
                <a href={`tel:${contact.phone}`} className="text-indigo-600">
                  {contact.phone}
                </a>
              )}
              {contact.email && (
                <a href={`mailto:${contact.email}`} className="text-indigo-600">
                  {contact.email}
                </a>
              )}
            </p>
          </header>

          {/* WHERE IT STANDS — one sentence */}
          <p className="text-base text-gray-600">
            Last touch{' '}
            <strong className="font-semibold text-gray-900">
              {lastTouch ? rel(lastTouch.occurred_at) : 'never'}
            </strong>
            {lastTouch?.outcome ? ` — ${lastTouch.outcome}` : ''}.
            {' '}
            {openFollowUps.length === 0
              ? 'Nothing owed.'
              : `${openFollowUps.length} open follow-up${openFollowUps.length === 1 ? '' : 's'}.`}
          </p>

          {/* NEXT ACTION — every outcome resolves in place */}
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className={SECTION_H}>Next action</h3>
            <div className="flex flex-wrap gap-2">
              {contact.phone && (
                <a href={`tel:${contact.phone}`} className={PRIMARY_CLS}>
                  <Icon name="phone" className="h-4 w-4" /> Call
                </a>
              )}
              {OUTCOMES.slice(0, 3).map((o) => (
                <button
                  key={o.key}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => logOutcome(o.key)}
                  className={OUTCOME_CLS}
                >
                  {busy === o.key ? '…' : o.label}
                </button>
              ))}
              {OUTCOMES.slice(3).map((o) => (
                <button
                  key={o.key}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => logOutcome(o.key)}
                  className={OUTCOME_CLS}
                >
                  {busy === o.key ? '…' : o.label}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(() => {
                // Secondary actions — projected: ≤3 visible, rest in More…
                const secs: ToolbarAction[] = [
                  { key: 'log-email', label: 'Log email', kind: 'ghost', icon: 'mail',
                    run: () => onOpenDrawer({ kind: 'log-email', contactId: contact.id }) },
                  { key: 'book', label: 'Book', kind: 'ghost', icon: 'calendar',
                    run: () => onOpenDrawer({ kind: 'booking', presetContactId: contact.id }) },
                  { key: 'note', label: 'Note', kind: 'ghost', icon: 'note',
                    run: () => onOpenDrawer({ kind: 'note', contactId: contact.id }) },
                  { key: 'log-call', label: 'Log call', kind: 'ghost', icon: 'phone',
                    run: () => onOpenDrawer({ kind: 'log-call', contactId: contact.id }) },
                  { key: 'edit', label: 'Edit', kind: 'ghost', icon: 'pencil',
                    run: () => onOpenDrawer({ kind: 'contact-form', contact }) },
                ];
                const tb = projectToolbar(secs, 3);
                const btn = (a: ToolbarAction) => (
                  <button key={a.key} type="button" onClick={a.run} className={ACTION_CLS}>
                    {a.icon && <Icon name={a.icon} className="h-4 w-4" />} {a.label}
                  </button>
                );
                return (
                  <>
                    {tb.visible.map(btn)}
                    {tb.overflow.length > 0 && (
                      <details className="relative">
                        <summary className={`${ACTION_CLS} cursor-pointer list-none select-none`}>
                          More…
                        </summary>
                        <div className="absolute left-0 z-10 mt-1 flex min-w-[180px] flex-col gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
                          {tb.overflow.map(btn)}
                        </div>
                      </details>
                    )}
                  </>
                );
              })()}
              {nextTarget && (
                <button
                  type="button"
                  onClick={() => onSelectContact(nextTarget.id)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
                >
                  Next target → {nextTarget.name}
                </button>
              )}
            </div>
            {/* Quick note — mid-call jot; logs straight to the timeline
                without opening a form (the "on a call" journey). */}
            <div className="mt-3 flex items-center gap-2">
              <input
                type="text"
                value={quickNote}
                onChange={(e) => setQuickNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveQuickNote();
                }}
                placeholder="Quick note — who said what…"
                aria-label="Quick note"
                className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-gray-200 px-3 text-base text-gray-900 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
              />
              <button
                type="button"
                onClick={saveQuickNote}
                disabled={!quickNote.trim() || busy !== null}
                className={`${ACTION_CLS} disabled:opacity-50`}
              >
                <Icon name="check" className="h-4 w-4" /> Log
              </button>
            </div>
          </section>

          {/* CALL SCRIPT — the real ops_live script for attorneys */}
          {(script?.script || script?.voicemail) && (
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className={SECTION_H}>
                Call script{script.level ? ` — ${script.level}` : ''}
              </h3>
              {script.script && (
                <pre className="whitespace-pre-wrap text-base leading-relaxed text-gray-800">
                  {script.script}
                </pre>
              )}
              {script.voicemail && (
                <>
                  <h4 className="mt-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
                    If voicemail
                  </h4>
                  <pre className="whitespace-pre-wrap text-base leading-relaxed text-gray-800">
                    {script.voicemail}
                  </pre>
                </>
              )}
            </section>
          )}

          {/* OPEN FOLLOW-UPS — what the desk owes this person */}
          {openFollowUps.length > 0 && (
            <section>
              <h3 className={SECTION_H}>Open follow-ups</h3>
              <ul className="space-y-2">
                {openFollowUps.map((i) => (
                  <li
                    key={i.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3"
                  >
                    <span
                      className={`text-base font-medium ${
                        isOverdue(i) ? 'text-red-600' : 'text-gray-900'
                      }`}
                    >
                      {fmtShort(i.due_at)}
                      {isOverdue(i) ? ' — overdue' : ''}
                    </span>
                    <span className="min-w-0 flex-1 text-base text-gray-600">
                      {i.subject_outline || i.notes || 'Follow up'}
                    </span>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => snoozeFollowUp(i, 7)}
                      className={OUTCOME_CLS}
                    >
                      +7d
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => finishFollowUp(i)}
                      className={PRIMARY_CLS}
                    >
                      <Icon name="check" className="h-4 w-4" /> Done
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* MATTERS — what this person is attached to */}
          {matters.length > 0 && (
            <section>
              <h3 className={SECTION_H}>Matters</h3>
              <ul className="space-y-1">
                {matters.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => onOpenDrawer({ kind: 'matter', matter: m })}
                      className="flex w-full items-baseline gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-gray-50"
                    >
                      <span className="min-w-0 flex-1 truncate text-base font-medium text-gray-900">
                        {m.title}
                      </span>
                      <span className="shrink-0 text-sm font-medium text-gray-500">
                        {matterStageText(m.stage).text}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* EVIDENCE — history + files */}
          <section>
            <h3 className={SECTION_H}>Timeline</h3>
            <Timeline
              appointments={appointments}
              interactions={interactions}
              onOpenAppointment={(a) =>
                onOpenDrawer({ kind: 'appointment', appointment: a })
              }
            />
          </section>
          <AttachmentsSection
            entity={{ contactId: contact.id }}
            onChanged={onChanged}
          />
        </div>
      )}
    </div>
  );
}
