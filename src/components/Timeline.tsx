import { format, isValid, parseISO } from 'date-fns';
import type { Appointment, Interaction } from '../types';
import { Icon, statusText, typeLabel } from './ui';

interface TimelineItem {
  kind: 'appointment' | 'interaction';
  at: string;
  appointment?: Appointment;
  interaction?: Interaction;
}

function fmt(iso: string): string {
  const d = parseISO(iso);
  return isValid(d) ? format(d, 'MMM d, yyyy · h:mm a') : iso;
}

function Outline({ text }: { text: string }) {
  const lines = text.split('\n').filter((l) => l.trim());
  return (
    <ul className="mt-1 space-y-0.5">
      {lines.map((l, i) => (
        <li key={i} className="text-sm text-gray-700">
          {l.trim().startsWith('-') ? l.trim() : `- ${l.trim()}`}
        </li>
      ))}
    </ul>
  );
}

export function Timeline({
  appointments,
  interactions,
  onOpenAppointment,
}: {
  appointments: Appointment[];
  interactions: Interaction[];
  onOpenAppointment?: (a: Appointment) => void;
}) {
  const items: TimelineItem[] = [
    ...appointments.map((a) => ({ kind: 'appointment' as const, at: a.starts_at, appointment: a })),
    ...interactions.map((i) => ({
      kind: 'interaction' as const,
      at: i.occurred_at,
      interaction: i,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">Nothing yet.</p>;
  }

  return (
    <ol className="space-y-5">
      {items.map((item) =>
        item.kind === 'appointment' ? (
          <li key={`a-${item.appointment!.id}`} className="flex gap-3">
            <span className="mt-0.5 text-indigo-600">
              <Icon name="calendar" className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onOpenAppointment?.(item.appointment!)}
                className="text-left text-sm font-medium text-gray-900 hover:text-indigo-600"
              >
                {item.appointment!.title || 'Appointment'}
              </button>
              <p className="text-xs text-gray-500">{fmt(item.appointment!.starts_at)}</p>
              <p className={`text-xs font-medium ${statusText(item.appointment!.status).className}`}>
                {statusText(item.appointment!.status).text}
              </p>
            </div>
          </li>
        ) : (
          <li key={`i-${item.interaction!.id}`} className="flex gap-3">
            <span className="mt-0.5 text-gray-400">
              <Icon
                name={
                  item.interaction!.type === 'call'
                    ? 'phone'
                    : item.interaction!.type === 'email'
                      ? 'mail'
                      : 'note'
                }
                className="h-5 w-5"
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900">
                {typeLabel(item.interaction!.type)}
                {item.interaction!.duration_sec
                  ? ` · ${Math.round(item.interaction!.duration_sec / 60)} min`
                  : ''}
                {item.interaction!.outcome ? ` · ${item.interaction!.outcome}` : ''}
              </p>
              <p className="text-xs text-gray-500">
                {fmt(item.interaction!.occurred_at)}
                {item.interaction!.status === 'resolved' ? ' · resolved' : ''}
              </p>
              {item.interaction!.subject_outline && (
                <Outline text={item.interaction!.subject_outline} />
              )}
              {item.interaction!.notes && (
                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">
                  {item.interaction!.notes}
                </p>
              )}
            </div>
          </li>
        ),
      )}
    </ol>
  );
}
