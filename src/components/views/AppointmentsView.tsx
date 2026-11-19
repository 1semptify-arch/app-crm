import { addYears, format, isSameDay, parseISO, startOfToday } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import { downloadCSV } from '../../lib/csv';
import { expandAppointments } from '../../lib/recurrence';
import { getStore } from '../../lib/store';
import type { Appointment, Contact } from '../../types';
import { statusText } from '../ui';

export function AppointmentsView({
  contacts,
  reloadKey,
  onOpenAppointment,
}: {
  contacts: Contact[];
  reloadKey: number;
  onOpenAppointment: (a: Appointment) => void;
}) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  const contactName = useMemo(() => {
    const map = new Map(contacts.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? map.get(id) ?? '' : '');
  }, [contacts]);

  useEffect(() => {
    // Recurring series expand over a bounded window: today through +1 year.
    // Non-recurring rows pass through untouched (including past history).
    const from = startOfToday();
    const to = addYears(from, 1);
    getStore()
      .listAppointments()
      .then((rows) => setAppointments(expandAppointments(rows, from, to)))
      .catch(() => setAppointments([]));
  }, [reloadKey]);

  const groups = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const key = format(parseISO(a.starts_at), 'yyyy-MM-dd');
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [appointments]);

  function exportCSV() {
    const rows = [
      ['title', 'contact_name', 'starts_at', 'ends_at', 'status'],
      ...appointments.map((a) => [
        a.title,
        contactName(a.contact_id),
        a.starts_at,
        a.ends_at,
        a.status,
      ]),
    ];
    downloadCSV(`appointments-${format(new Date(), 'yyyy-MM-dd')}.csv`, rows);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={exportCSV}
          className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Export
        </button>
      </div>
      {groups.length === 0 ? (
        <p className="py-12 text-center text-gray-400">No bookings scheduled.</p>
      ) : (
        <div className="space-y-8">
          {groups.map(([day, list]) => (
        <section key={day}>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
            {isSameDay(parseISO(day), new Date())
              ? `Today — ${format(parseISO(day), 'MMM d')}`
              : format(parseISO(day), 'EEEE, MMM d, yyyy')}
          </h3>
          <ul className="divide-y divide-gray-100">
            {list.map((a) => {
              const st = statusText(a.status);
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => onOpenAppointment(a)}
                    className="flex w-full items-baseline gap-4 py-3 text-left"
                  >
                    <span className="w-32 shrink-0 text-sm text-gray-500">
                      {format(parseISO(a.starts_at), 'h:mm a')} –{' '}
                      {format(parseISO(a.ends_at), 'h:mm a')}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-base ${
                          a.status === 'canceled'
                            ? 'text-gray-400 line-through'
                            : 'font-medium text-gray-900'
                        }`}
                      >
                        {a.title}
                      </span>
                      {contactName(a.contact_id) && (
                        <span className="block truncate text-sm text-gray-500">
                          {contactName(a.contact_id)}
                        </span>
                      )}
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
          ))}
        </div>
      )}
    </div>
  );
}
