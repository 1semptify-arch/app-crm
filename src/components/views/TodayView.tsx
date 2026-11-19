import { addDays, endOfDay, format, isSameDay, isValid, parseISO, startOfToday } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import { expandAppointments } from '../../lib/recurrence';
import { getStore } from '../../lib/store';
import type { DrawerState, ViewKey } from '../../lib/uiState';
import type { Appointment, Contact, Interaction, InteractionType } from '../../types';
import { isOverdue } from '../TaskCard';
import { Icon, typeLabel, type IconName } from '../ui';

const DAY = 'yyyy-MM-dd';
// Coming up shows the next 7 days, capped at this many rows before the
// "more in Calendar" link takes over.
const COMING_UP_CAP = 10;
const RECENT_CAP = 5;

function dayKey(iso: string): string {
  const d = parseISO(iso);
  return isValid(d) ? format(d, DAY) : iso.slice(0, 10);
}

function typeIcon(t: InteractionType): IconName {
  return t === 'call' ? 'phone' : t === 'email' ? 'mail' : 'note';
}

function firstLine(s: string | null): string {
  return s?.split('\n')[0]?.trim() ?? '';
}

const SECTION_H =
  'mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500';
const DONE_CLS =
  'inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50';

export function TodayView({
  contacts,
  reloadKey,
  onOpenDrawer,
  onGoView,
  onChanged,
}: {
  contacts: Contact[];
  reloadKey: number;
  onOpenDrawer: (d: NonNullable<DrawerState>) => void;
  onGoView: (v: ViewKey) => void;
  onChanged: () => void;
}) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);

  useEffect(() => {
    const store = getStore();
    // Expand recurring series across the window Today can display:
    // start of today (overdue/today sections) through the 7-day coming-up.
    const windowEnd = endOfDay(addDays(new Date(), 7));
    store
      .listAppointments()
      .then((rows) => setAppointments(expandAppointments(rows, startOfToday(), windowEnd)))
      .catch(() => setAppointments([]));
    store
      .listInteractions()
      .then(setInteractions)
      .catch(() => setInteractions([]));
  }, [reloadKey]);

  const contactName = useMemo(() => {
    const map = new Map(contacts.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? (map.get(id) ?? '') : '');
  }, [contacts]);

  const now = new Date();
  const todayKey = format(now, DAY);
  const comingUpEnd = format(addDays(now, 7), DAY);
  const tomorrow = addDays(now, 1);

  async function resolveInteraction(i: Interaction) {
    try {
      await getStore().upsertInteraction({
        id: i.id,
        type: i.type,
        status: 'resolved',
        resolved_at: new Date().toISOString(),
      });
      onChanged();
    } catch (e) {
      console.error('resolve failed', e);
    }
  }

  async function completeAppointment(a: Appointment) {
    try {
      // Completing marks the whole series — write back anchor times, not the
      // clicked occurrence's shifted times.
      await getStore().upsertAppointment({
        id: a.id,
        contact_id: a.contact_id,
        title: a.title,
        starts_at: a.series_starts_at ?? a.starts_at,
        ends_at: a.series_ends_at ?? a.ends_at,
        status: 'completed',
        matter_id: a.matter_id ?? null,
        plugin_data: a.plugin_data,
      });
      onChanged();
    } catch (e) {
      console.error('status update failed', e);
    }
  }

  // --- Section data ---------------------------------------------------------

  // Overdue: unresolved follow-ups past their due day + scheduled
  // appointments whose end time already passed (missed meetings).
  type OverdueRow =
    | { sortKey: string; kind: 'interaction'; i: Interaction }
    | { sortKey: string; kind: 'appointment'; a: Appointment };

  const overdueRows: OverdueRow[] = [
    ...interactions
      .filter((i) => isOverdue(i))
      .map(
        (i): OverdueRow => ({
          sortKey: i.due_at ?? i.occurred_at,
          kind: 'interaction',
          i,
        }),
      ),
    ...appointments
      .filter((a) => a.status === 'scheduled' && parseISO(a.ends_at) < now)
      .map(
        (a): OverdueRow => ({ sortKey: a.ends_at, kind: 'appointment', a }),
      ),
  ].sort((x, y) => x.sortKey.localeCompare(y.sortKey));

  // Today: scheduled appointments starting today + follow-ups due today.
  const todayAppts = appointments.filter(
    (a) => a.status === 'scheduled' && dayKey(a.starts_at) === todayKey,
  );
  const dueToday = interactions.filter(
    (i) =>
      (i.status ?? 'new') !== 'resolved' &&
      Boolean(i.due_at) &&
      dayKey(i.due_at as string) === todayKey,
  );

  // Coming up: next 7 days' scheduled appointments, grouped by day.
  const comingUp = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments) {
      if (a.status !== 'scheduled') continue;
      const key = dayKey(a.starts_at);
      if (key <= todayKey || key > comingUpEnd) continue;
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    return [...map.entries()].sort(([x], [y]) => x.localeCompare(y));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments, todayKey, comingUpEnd]);

  const comingUpTotal = comingUp.reduce((n, [, list]) => n + list.length, 0);

  // Recent: listInteractions comes back newest-first.
  const recent = interactions.slice(0, RECENT_CAP);

  const allEmpty =
    overdueRows.length === 0 &&
    todayAppts.length === 0 &&
    dueToday.length === 0 &&
    comingUpTotal === 0 &&
    recent.length === 0;

  // --- Row renderers --------------------------------------------------------

  function apptTimeRange(a: Appointment): string {
    return `${format(parseISO(a.starts_at), 'h:mm')} – ${format(parseISO(a.ends_at), 'h:mm a')}`;
  }

  function interactionText(i: Interaction): string {
    const name = contactName(i.contact_id);
    const subject = firstLine(i.subject_outline);
    return [name ? `${typeLabel(i.type)} — ${name}` : typeLabel(i.type), subject]
      .filter(Boolean)
      .join(' · ');
  }

  return (
    <div className="space-y-8">
      {overdueRows.length > 0 && (
        <section>
          <h2 className={SECTION_H}>Overdue ({overdueRows.length})</h2>
          <ul className="divide-y divide-gray-100">
            {overdueRows.map((row) =>
              row.kind === 'interaction' ? (
                <li key={row.i.id} className="flex items-center gap-3 py-2.5">
                  <span className="shrink-0 text-gray-400">
                    <Icon name={typeIcon(row.i.type)} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
                    {interactionText(row.i)}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-red-600">
                    Overdue
                  </span>
                  <button
                    type="button"
                    onClick={() => resolveInteraction(row.i)}
                    className={DONE_CLS}
                  >
                    <Icon name="check" className="h-4 w-4" /> Done
                  </button>
                </li>
              ) : (
                <li key={row.a.id} className="flex items-center gap-3 py-2.5">
                  <span className="shrink-0 text-gray-400">
                    <Icon name="clock" className="h-4 w-4" />
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onOpenDrawer({ kind: 'appointment', appointment: row.a })
                    }
                    className="min-w-0 flex-1 truncate text-left text-sm text-gray-700"
                  >
                    {row.a.title || 'Appointment'}
                    {contactName(row.a.contact_id)
                      ? ` — ${contactName(row.a.contact_id)}`
                      : ''}
                  </button>
                  <span className="shrink-0 text-xs font-medium text-red-600">
                    Overdue
                  </span>
                  <button
                    type="button"
                    onClick={() => completeAppointment(row.a)}
                    className={DONE_CLS}
                  >
                    <Icon name="check" className="h-4 w-4" /> Done
                  </button>
                </li>
              ),
            )}
          </ul>
        </section>
      )}

      {(todayAppts.length > 0 || dueToday.length > 0) && (
        <section>
          <h2 className={SECTION_H}>Today — {format(now, 'EEE, MMM d')}</h2>
          <ul className="divide-y divide-gray-100">
            {todayAppts.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2.5">
                <span className="shrink-0 text-gray-400">
                  <Icon name="clock" className="h-4 w-4" />
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onOpenDrawer({ kind: 'appointment', appointment: a })
                  }
                  className="min-w-0 flex-1 truncate text-left text-sm text-gray-700"
                >
                  {apptTimeRange(a)} · {a.title || 'Appointment'}
                  {contactName(a.contact_id)
                    ? ` — ${contactName(a.contact_id)}`
                    : ''}
                </button>
              </li>
            ))}
            {dueToday.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2.5">
                <span className="shrink-0 text-gray-400">
                  <Icon name={typeIcon(i.type)} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
                  {interactionText(i)}
                </span>
                <span className="shrink-0 text-xs font-medium text-amber-600">
                  Due today
                </span>
                <button
                  type="button"
                  onClick={() => resolveInteraction(i)}
                  className={DONE_CLS}
                >
                  <Icon name="check" className="h-4 w-4" /> Done
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {comingUpTotal > 0 && (
        <section>
          <h2 className={SECTION_H}>Coming up</h2>
          {(() => {
            let shown = 0;
            return comingUp.map(([day, list]) => {
              if (shown >= COMING_UP_CAP) return null;
              const dayDate = parseISO(day);
              const label = isSameDay(dayDate, tomorrow)
                ? 'Tomorrow'
                : format(dayDate, 'EEE, MMM d');
              return (
                <div key={day}>
                  <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {label}
                  </h3>
                  <ul className="divide-y divide-gray-100">
                    {list.map((a) => {
                      if (shown >= COMING_UP_CAP) return null;
                      shown += 1;
                      return (
                        <li key={a.id} className="flex items-center gap-3 py-2.5">
                          <span className="shrink-0 text-gray-400">
                            <Icon name="clock" className="h-4 w-4" />
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              onOpenDrawer({ kind: 'appointment', appointment: a })
                            }
                            className="min-w-0 flex-1 truncate text-left text-sm text-gray-700"
                          >
                            {apptTimeRange(a)} · {a.title || 'Appointment'}
                            {contactName(a.contact_id)
                              ? ` — ${contactName(a.contact_id)}`
                              : ''}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            });
          })()}
          {comingUpTotal > COMING_UP_CAP && (
            <button
              type="button"
              onClick={() => onGoView('calendar')}
              className="mt-2 min-h-[44px] text-sm font-medium text-indigo-600 hover:underline"
            >
              More in Calendar
            </button>
          )}
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <h2 className={SECTION_H}>Recent</h2>
          <ul className="divide-y divide-gray-100">
            {recent.map((i) => {
              const name = contactName(i.contact_id);
              const time = format(parseISO(i.occurred_at), 'MMM d, h:mm a');
              const inner = (
                <>
                  <span className="shrink-0 text-gray-400">
                    <Icon name={typeIcon(i.type)} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
                    {name ? `${typeLabel(i.type)} — ${name}` : typeLabel(i.type)}
                  </span>
                  <span className="shrink-0 text-xs text-gray-400">{time}</span>
                </>
              );
              return (
                <li key={i.id} className="py-2.5">
                  {i.contact_id ? (
                    <button
                      type="button"
                      onClick={() =>
                        onOpenDrawer({
                          kind: 'contact',
                          contactId: i.contact_id as string,
                        })
                      }
                      className="flex w-full items-center gap-3 text-left"
                    >
                      {inner}
                    </button>
                  ) : (
                    <span className="flex items-center gap-3">{inner}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {allEmpty && (
        <p className="py-12 text-center text-gray-400">
          All clear — nothing overdue, nothing scheduled.
        </p>
      )}
    </div>
  );
}
