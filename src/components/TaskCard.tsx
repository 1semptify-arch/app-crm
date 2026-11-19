import { format, isValid, parseISO } from 'date-fns';
import { useState } from 'react';
import { getStore } from '../lib/store';
import type { DrawerState } from '../lib/uiState';
import type { Appointment, Contact, Interaction, Matter, TaskStatus } from '../types';
import { Icon, typeLabel } from './ui';

function fmt(iso: string): string {
  const d = parseISO(iso);
  return isValid(d) ? format(d, 'MMM d, yyyy · h:mm a') : iso;
}

// due_at is date-granular: compare by calendar day so a "due today" card
// isn't flagged overdue the moment midnight passes.
function dueDay(iso: string): string {
  const d = parseISO(iso);
  return isValid(d) ? format(d, 'yyyy-MM-dd') : iso.slice(0, 10);
}

export function isOverdue(i: Interaction, today = format(new Date(), 'yyyy-MM-dd')): boolean {
  return Boolean(i.due_at) && i.status !== 'resolved' && dueDay(i.due_at as string) < today;
}

function statusOf(i: Interaction): TaskStatus {
  return i.status ?? 'new';
}

function statusLabel(i: Interaction): { text: string; className: string } {
  const s = statusOf(i);
  if (s === 'resolved') {
    const d = i.resolved_at ? parseISO(i.resolved_at) : null;
    const when = d && isValid(d) ? ` · ${format(d, 'MMM d, yyyy')}` : '';
    return { text: `Resolved${when}`, className: 'text-gray-400' };
  }
  if (s === 'in_progress') return { text: 'In progress', className: 'text-amber-600' };
  return { text: 'New', className: 'text-amber-600' };
}

const ACTION_CLS =
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 px-3.5 text-sm font-medium text-gray-700 hover:bg-gray-50';
const PRIMARY_ACTION_CLS =
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 text-sm font-medium text-white hover:bg-indigo-700';

export function TaskCard({
  interaction,
  contact,
  appointment,
  matter,
  onOpenDrawer,
  onChanged,
}: {
  interaction: Interaction;
  contact?: Contact;
  appointment?: Appointment;
  matter?: Matter;
  onOpenDrawer: (d: NonNullable<DrawerState>) => void;
  onChanged: () => void;
}) {
  const status = statusOf(interaction);
  const resolved = status === 'resolved';
  const st = statusLabel(interaction);
  const overdue = isOverdue(interaction);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpDate, setFollowUpDate] = useState(() =>
    interaction.due_at ? dueDay(interaction.due_at) : '',
  );

  async function setStatus(next: TaskStatus) {
    try {
      await getStore().upsertInteraction({
        id: interaction.id,
        type: interaction.type,
        status: next,
        resolved_at: next === 'resolved' ? new Date().toISOString() : null,
      });
      onChanged();
    } catch {
      // local demo mode: leave the card as-is on failure
    }
  }

  // Acting on a card advances it: new -> in_progress (resolves on Mark done).
  function touch() {
    if (resolved) return;
    getStore()
      .upsertInteraction({
        id: interaction.id,
        type: interaction.type,
        status: 'in_progress',
        resolved_at: null,
      })
      .then(onChanged)
      .catch(() => {});
  }

  function openFollowUp(d: NonNullable<DrawerState>) {
    touch();
    onOpenDrawer(d);
  }

  async function saveFollowUp() {
    try {
      await getStore().upsertInteraction({
        id: interaction.id,
        type: interaction.type,
        due_at: followUpDate ? new Date(`${followUpDate}T00:00:00`).toISOString() : null,
        // A dated follow-up on a resolved card is real work again — reopen it.
        ...(resolved && followUpDate ? { status: 'new' as TaskStatus, resolved_at: null } : {}),
      });
      setFollowUpOpen(false);
      onChanged();
    } catch {
      // local demo mode: leave the card as-is on failure
    }
  }

  async function clearFollowUp() {
    try {
      await getStore().upsertInteraction({
        id: interaction.id,
        type: interaction.type,
        due_at: null,
      });
      setFollowUpDate('');
      setFollowUpOpen(false);
      onChanged();
    } catch {
      // local demo mode: leave the card as-is on failure
    }
  }

  async function remove() {
    if (!window.confirm(`Delete this ${interaction.type} log entry?`)) return;
    try {
      await getStore().deleteInteraction(interaction.id);
      onChanged();
    } catch {
      // local demo mode: leave the card as-is on failure
    }
  }

  const cid = contact?.id ?? interaction.contact_id ?? undefined;

  return (
    <article
      className={`rounded-xl border border-gray-200 bg-white p-4 ${resolved ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-gray-400">
          <Icon
            name={
              interaction.type === 'call'
                ? 'phone'
                : interaction.type === 'email'
                  ? 'mail'
                  : 'note'
            }
            className="h-5 w-5"
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-base font-medium text-gray-900">
              {typeLabel(interaction.type)}
              {contact && (
                <>
                  {' — '}
                  <button
                    type="button"
                    onClick={() => onOpenDrawer({ kind: 'contact', contactId: contact.id })}
                    className="text-indigo-600 hover:underline"
                  >
                    {contact.name}
                  </button>
                </>
              )}
            </p>
            <span className="flex shrink-0 items-center gap-1">
              <span className={`text-xs font-medium ${st.className}`}>{st.text}</span>
              <button
                type="button"
                onClick={() => onOpenDrawer({ kind: 'edit-interaction', interaction })}
                aria-label={`Edit this ${interaction.type} log entry`}
                title="Edit"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-gray-400 hover:bg-gray-50 hover:text-indigo-600"
              >
                <Icon name="pencil" className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={remove}
                aria-label={`Delete this ${interaction.type} log entry`}
                title="Delete"
                className="-mr-2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-gray-400 hover:bg-gray-50 hover:text-red-600"
              >
                <Icon name="trash" className="h-4 w-4" />
              </button>
            </span>
          </div>
          <p className="text-sm text-gray-500">
            {fmt(interaction.occurred_at)}
            {interaction.duration_sec
              ? ` · ${Math.round(interaction.duration_sec / 60)} min`
              : ''}
            {interaction.outcome ? ` · ${interaction.outcome}` : ''}
            {interaction.due_at &&
              (overdue ? (
                <span className="font-medium text-red-600"> · Overdue</span>
              ) : (
                <> · Due {format(parseISO(interaction.due_at), 'MMM d')}</>
              ))}
          </p>
          {contact && (contact.phone || contact.email) && (
            <p className="mt-0.5 space-x-3 text-sm">
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
          )}
          {appointment && (
            <button
              type="button"
              onClick={() => onOpenDrawer({ kind: 'appointment', appointment })}
              className="mt-0.5 block text-sm text-gray-500 hover:text-indigo-600"
            >
              For: {appointment.title || 'Appointment'} · {fmt(appointment.starts_at)}
            </button>
          )}
          {matter && (
            <button
              type="button"
              onClick={() => onOpenDrawer({ kind: 'matter', matter })}
              className="mt-0.5 block text-sm text-gray-400 hover:text-indigo-600"
            >
              · {matter.title}
            </button>
          )}
          {interaction.subject_outline && (
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">
              {interaction.subject_outline}
            </p>
          )}
          {interaction.notes && (
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{interaction.notes}</p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 pl-8">
        {interaction.type === 'call' && (
          <>
            {contact?.phone && (
              <a href={`tel:${contact.phone}`} onClick={touch} className={ACTION_CLS}>
                <Icon name="phone" className="h-4 w-4" /> Call
              </a>
            )}
            {cid && (
              <button
                type="button"
                onClick={() => openFollowUp({ kind: 'log-call', contactId: cid })}
                className={ACTION_CLS}
              >
                Log follow-up
              </button>
            )}
            {cid && (
              <button
                type="button"
                onClick={() => openFollowUp({ kind: 'booking', presetContactId: cid })}
                className={ACTION_CLS}
              >
                Book follow-up
              </button>
            )}
          </>
        )}
        {interaction.type === 'email' && (
          <>
            {contact?.email && (
              <a href={`mailto:${contact.email}`} onClick={touch} className={ACTION_CLS}>
                <Icon name="mail" className="h-4 w-4" /> Reply
              </a>
            )}
            {cid && (
              <button
                type="button"
                onClick={() => openFollowUp({ kind: 'log-email', contactId: cid })}
                className={ACTION_CLS}
              >
                Log email
              </button>
            )}
          </>
        )}
        <button
          type="button"
          onClick={() => setFollowUpOpen((o) => !o)}
          className={ACTION_CLS}
        >
          <Icon name="calendar" className="h-4 w-4" /> Set follow-up
        </button>
        {resolved ? (
          <button type="button" onClick={() => setStatus('new')} className={ACTION_CLS}>
            Reopen
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setStatus('resolved')}
            className={PRIMARY_ACTION_CLS}
          >
            <Icon name="check" className="h-4 w-4" /> Mark done
          </button>
        )}
      </div>
      {followUpOpen && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-8">
          <label className="text-sm text-gray-500" htmlFor={`due-${interaction.id}`}>
            Follow up by
          </label>
          <input
            id={`due-${interaction.id}`}
            type="date"
            value={followUpDate}
            onChange={(e) => setFollowUpDate(e.target.value)}
            className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          />
          <button type="button" onClick={saveFollowUp} className={PRIMARY_ACTION_CLS}>
            Save
          </button>
          {interaction.due_at && (
            <button type="button" onClick={clearFollowUp} className={ACTION_CLS}>
              Clear
            </button>
          )}
        </div>
      )}
    </article>
  );
}
