import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import { expandAppointments } from '../../lib/recurrence';
import { getStore } from '../../lib/store';
import type { Appointment, Contact, Interaction } from '../../types';
import { isOverdue } from '../TaskCard';
import { Icon, statusText, typeLabel } from '../ui';

type Mode = 'month' | 'week' | 'day';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CalendarView({
  contacts,
  reloadKey,
  onOpenAppointment,
  onChanged,
}: {
  contacts: Contact[];
  reloadKey: number;
  onOpenAppointment: (a: Appointment) => void;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);

  const contactName = useMemo(() => {
    const map = new Map(contacts.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? map.get(id) ?? '' : '');
  }, [contacts]);

  useEffect(() => {
    const from = startOfWeek(startOfMonth(addMonths(cursor, -1)), { weekStartsOn: 1 });
    const to = endOfWeek(endOfMonth(addMonths(cursor, 1)), { weekStartsOn: 1 });
    getStore()
      .listAppointments({ from: from.toISOString(), to: to.toISOString() })
      .then((rows) => setAppointments(expandAppointments(rows, from, to)))
      .catch(() => setAppointments([]));
  }, [cursor, reloadKey]);

  useEffect(() => {
    getStore()
      .listInteractions()
      .then(setInteractions)
      .catch(() => setInteractions([]));
  }, [reloadKey]);

  function shift(dir: -1 | 1) {
    if (mode === 'month') setCursor((c) => addMonths(c, dir));
    else if (mode === 'week') setCursor((c) => addWeeks(c, dir));
    else setCursor((c) => addDays(c, dir));
  }

  function onDay(d: Date) {
    return appointments.filter((a) => isSameDay(new Date(a.starts_at), d));
  }

  async function toggleDone(a: Appointment) {
    // Status toggles the whole series — write back the anchor times, not the
    // clicked occurrence's shifted times (series_starts_at is set only on
    // generated occurrences).
    await getStore().upsertAppointment({
      id: a.id,
      contact_id: a.contact_id,
      title: a.title,
      starts_at: a.series_starts_at ?? a.starts_at,
      ends_at: a.series_ends_at ?? a.ends_at,
      status: a.status === 'completed' ? 'scheduled' : 'completed',
    });
    onChanged();
  }

  async function resolveInteraction(i: Interaction) {
    await getStore().upsertInteraction({
      id: i.id,
      type: i.type,
      status: 'resolved',
      resolved_at: new Date().toISOString(),
    });
    onChanged();
  }

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    const days: Date[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
    return days;
  }, [cursor]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(cursor, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [cursor]);

  const agenda = onDay(selected).sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous"
            onClick={() => shift(-1)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <Icon name="chevron-left" />
          </button>
          <h2 className="min-w-[10rem] text-center text-lg font-semibold text-gray-900">
            {mode === 'day'
              ? format(cursor, 'EEEE, MMM d')
              : format(cursor, 'MMMM yyyy')}
          </h2>
          <button
            type="button"
            aria-label="Next"
            onClick={() => shift(1)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <Icon name="chevron-right" />
          </button>
        </div>
        <div className="flex gap-1 text-sm">
          {(['month', 'week', 'day'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`min-h-[44px] rounded-lg px-3 capitalize ${
                mode === m ? 'font-semibold text-indigo-600' : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {m}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setCursor(new Date());
              setSelected(new Date());
            }}
            className="min-h-[44px] rounded-lg px-3 text-gray-500 hover:bg-gray-100"
          >
            Today
          </button>
        </div>
      </div>

      {mode === 'month' && (
        <div>
          <div className="grid grid-cols-7 text-center text-xs font-medium uppercase tracking-wide text-gray-400">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px rounded-xl bg-gray-100">
            {monthDays.map((d) => {
              const dayAppts = onDay(d);
              const sel = isSameDay(d, selected);
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  onClick={() => setSelected(d)}
                  className={`min-h-[64px] bg-white p-1.5 text-left align-top sm:min-h-[88px] ${
                    sel ? 'ring-2 ring-inset ring-indigo-600' : ''
                  }`}
                >
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-sm ${
                      isToday(d)
                        ? 'bg-indigo-600 font-semibold text-white'
                        : isSameMonth(d, cursor)
                          ? 'text-gray-900'
                          : 'text-gray-300'
                    }`}
                  >
                    {format(d, 'd')}
                  </span>
                  <span className="mt-1 hidden space-y-0.5 sm:block">
                    {dayAppts.slice(0, 2).map((a) => (
                      <span
                        key={a.id}
                        className="block truncate text-xs text-indigo-600"
                      >
                        {format(new Date(a.starts_at), 'h:mm a')} {a.title}
                      </span>
                    ))}
                    {dayAppts.length > 2 && (
                      <span className="block text-xs text-gray-400">
                        +{dayAppts.length - 2} more
                      </span>
                    )}
                  </span>
                  {dayAppts.length > 0 && (
                    <span className="mt-1 flex gap-0.5 sm:hidden">
                      {dayAppts.slice(0, 3).map((a) => (
                        <span key={a.id} className="h-1.5 w-1.5 rounded-full bg-indigo-600" />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {mode === 'week' && (
        <div className="grid grid-cols-7 gap-px rounded-xl bg-gray-100">
          {weekDays.map((d) => (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => {
                setSelected(d);
                setCursor(d);
              }}
              className="min-h-[140px] bg-white p-2 text-left align-top"
            >
              <span
                className={`text-xs font-medium uppercase ${isToday(d) ? 'text-indigo-600' : 'text-gray-400'}`}
              >
                {format(d, 'EEE d')}
              </span>
              <span className="mt-2 block space-y-1">
                {onDay(d).map((a) => (
                  <span
                    key={a.id}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenAppointment(a);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.stopPropagation();
                        onOpenAppointment(a);
                      }
                    }}
                    className={`block cursor-pointer truncate rounded px-1 py-0.5 text-xs hover:bg-indigo-50 ${
                      a.status === 'completed'
                        ? 'text-gray-400 line-through'
                        : a.status === 'canceled'
                          ? 'text-gray-300 line-through'
                          : 'text-indigo-600'
                    }`}
                  >
                    {format(new Date(a.starts_at), 'h:mm a')} {a.title}
                  </span>
                ))}
              </span>
            </button>
          ))}
        </div>
      )}

      {mode === 'day' && (
        <AgendaList
          day={cursor}
          appointments={onDay(cursor)}
          interactions={interactions}
          contactName={contactName}
          onOpen={onOpenAppointment}
          onToggle={toggleDone}
          onResolve={resolveInteraction}
        />
      )}

      {mode !== 'day' && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Agenda — {format(selected, 'EEEE, MMM d')}
          </h3>
          <AgendaList
            day={selected}
            appointments={agenda}
            interactions={interactions}
            contactName={contactName}
            onOpen={onOpenAppointment}
            onToggle={toggleDone}
            onResolve={resolveInteraction}
          />
        </section>
      )}
    </div>
  );
}

function AgendaList({
  day,
  appointments,
  interactions,
  contactName,
  onOpen,
  onToggle,
  onResolve,
}: {
  day: Date;
  appointments: Appointment[];
  interactions: Interaction[];
  contactName: (id: string | null) => string;
  onOpen: (a: Appointment) => void;
  onToggle: (a: Appointment) => void;
  onResolve: (i: Interaction) => void;
}) {
  const dayKey = format(day, 'yyyy-MM-dd');
  const dueDay = (i: Interaction) => format(parseISO(i.due_at as string), 'yyyy-MM-dd');
  const followUps = interactions
    .filter(
      (i) => (i.status ?? 'new') !== 'resolved' && Boolean(i.due_at) && dueDay(i) <= dayKey,
    )
    .sort(
      (a, b) =>
        Number(isOverdue(b)) - Number(isOverdue(a)) ||
        dueDay(a).localeCompare(dueDay(b)) ||
        a.occurred_at.localeCompare(b.occurred_at),
    );

  return (
    <div>
      {appointments.length === 0 ? (
        <p className="py-12 text-center text-gray-400">Nothing scheduled.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {appointments.map((a) => {
            const st = statusText(a.status);
            return (
              <li key={a.id} className="flex items-center gap-3 py-3">
                <button
                  type="button"
                  aria-label={a.status === 'completed' ? 'Mark scheduled' : 'Mark completed'}
                  onClick={() => onToggle(a)}
                  className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border ${
                    a.status === 'completed'
                      ? 'border-green-600 bg-green-600 text-white'
                      : 'border-gray-200 text-transparent hover:border-indigo-600 hover:text-indigo-600'
                  }`}
                >
                  <Icon name="check" className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => onOpen(a)}
                  className="min-w-0 flex-1 py-1 text-left"
                >
                  <span
                    className={`block text-base ${
                      a.status === 'canceled'
                        ? 'text-gray-400 line-through'
                        : a.status === 'completed'
                          ? 'text-gray-500'
                          : 'font-medium text-gray-900'
                    }`}
                  >
                    {format(new Date(a.starts_at), 'h:mm a')} –{' '}
                    {format(new Date(a.ends_at), 'h:mm a')} {a.title}
                  </span>
                  <span className="block text-sm text-gray-500">
                    {contactName(a.contact_id)}
                    {contactName(a.contact_id) ? ' · ' : ''}
                    <span className={st.className}>{st.text}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {followUps.length > 0 && (
        <section className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Follow-ups
          </h4>
          <ul className="divide-y divide-gray-100">
            {followUps.map((i) => {
              const overdue = isOverdue(i);
              const name = contactName(i.contact_id);
              return (
                <li key={i.id} className="flex items-center gap-3 py-2.5">
                  <span className="shrink-0 text-gray-400">
                    <Icon
                      name={
                        i.type === 'call' ? 'phone' : i.type === 'email' ? 'mail' : 'note'
                      }
                      className="h-4 w-4"
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
                    {name ? `${typeLabel(i.type)} — ${name}` : typeLabel(i.type)}
                  </span>
                  <span
                    className={`shrink-0 text-xs font-medium ${
                      overdue ? 'text-red-600' : 'text-amber-600'
                    }`}
                  >
                    {overdue
                      ? 'Overdue'
                      : `Due ${format(parseISO(i.due_at as string), 'MMM d')}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => onResolve(i)}
                    className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Icon name="check" className="h-4 w-4" /> Done
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
