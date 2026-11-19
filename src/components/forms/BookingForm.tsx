import { format, addHours, addMonths, setMinutes, setSeconds } from 'date-fns';
import { useEffect, useState } from 'react';
import { findSeriesConflicts } from '../../lib/recurrence';
import { ConflictError, getStore } from '../../lib/store';
import type {
  Appointment,
  ApptStatus,
  Contact,
  Matter,
  RecurRule,
} from '../../types';
import { Field, GhostButton, PrimaryButton, inputClass } from '../ui';

function toLocalInput(d: Date): string {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

function defaultStart(): string {
  const d = setSeconds(setMinutes(addHours(new Date(), 1), 0), 0);
  return toLocalInput(d);
}

function defaultEnd(): string {
  const d = setSeconds(setMinutes(addHours(new Date(), 2), 0), 0);
  return toLocalInput(d);
}

export function BookingForm({
  appointment,
  presetContactId,
  presetMatterId,
  contacts,
  onSaved,
  onCancel,
}: {
  appointment?: Appointment;
  presetContactId?: string;
  presetMatterId?: string;
  contacts: Contact[];
  onSaved: (a: Appointment) => void;
  onCancel: () => void;
}) {
  const [contactId, setContactId] = useState(
    appointment?.contact_id ?? presetContactId ?? '',
  );
  const [matters, setMatters] = useState<Matter[]>([]);
  const [matterId, setMatterId] = useState(appointment?.matter_id ?? presetMatterId ?? '');
  const [title, setTitle] = useState(appointment?.title ?? '');
  const [start, setStart] = useState(
    appointment ? toLocalInput(new Date(appointment.starts_at)) : defaultStart(),
  );
  const [end, setEnd] = useState(
    appointment ? toLocalInput(new Date(appointment.ends_at)) : defaultEnd(),
  );
  const [status, setStatus] = useState<ApptStatus>(appointment?.status ?? 'scheduled');
  const [recurRule, setRecurRule] = useState<RecurRule | ''>(appointment?.recur_rule ?? '');
  const [recurUntil, setRecurUntil] = useState(
    appointment?.recur_until ?? format(addMonths(new Date(), 3), 'yyyy-MM-dd'),
  );
  const [conflicts, setConflicts] = useState<Appointment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Open matters only (anything but closed); keep the preset selectable.
  useEffect(() => {
    const preset = appointment?.matter_id ?? presetMatterId;
    getStore()
      .listMatters()
      .then((all) => setMatters(all.filter((m) => m.stage !== 'closed' || m.id === preset)))
      .catch(() => setMatters([]));
  }, [appointment?.matter_id, presetMatterId]);

  function conflictMessage(list: Appointment[]): string {
    return list
      .map((c) => {
        const s = new Date(c.starts_at);
        const e = new Date(c.ends_at);
        return `“${c.title || 'Untitled'}” ${format(s, 'MMM d, h:mm a')} – ${format(e, 'h:mm a')}`;
      })
      .join('; ');
  }

  const timesValid = Boolean(
    start && end && new Date(end).getTime() > new Date(start).getTime(),
  );
  const canSave = Boolean(title.trim()) && timesValid;

  async function save() {
    setError(null);
    setConflicts([]);
    if (!start || !end) {
      setError('Start and end times are required.');
      return;
    }
    const startsAt = new Date(start).toISOString();
    const endsAt = new Date(end).toISOString();
    if (endsAt <= startsAt) {
      setError('End time must be after the start time.');
      return;
    }
    setSaving(true);
    try {
      // Series-aware check: expands the candidate and every stored row so
      // one-off-over-occurrence and series-vs-series clashes both count.
      const clash = findSeriesConflicts(
        {
          id: appointment?.id,
          starts_at: startsAt,
          ends_at: endsAt,
          recur_rule: recurRule || null,
          recur_until: recurRule ? recurUntil || null : null,
        },
        await getStore().listAppointments(),
      );
      if (clash.length > 0) {
        setConflicts(clash);
        setSaving(false);
        return;
      }
      const saved = await getStore().upsertAppointment({
        id: appointment?.id,
        contact_id: contactId || null,
        matter_id: matterId || null,
        title: title.trim() || 'Appointment',
        starts_at: startsAt,
        ends_at: endsAt,
        status,
        recur_rule: recurRule || null,
        recur_until: recurRule ? recurUntil || null : null,
      });
      onSaved(saved);
    } catch (e) {
      if (e instanceof ConflictError) {
        setConflicts(e.conflicts);
      } else {
        setError(e instanceof Error ? e.message : 'Could not save appointment.');
      }
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <Field label="Contact">
        <select
          className={inputClass}
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
        >
          <option value="">No contact</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      {matters.length > 0 && (
        <Field label="Matter">
          <select
            className={inputClass}
            value={matterId}
            onChange={(e) => setMatterId(e.target.value)}
          >
            <option value="">No matter</option>
            {matters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Title">
        <input
          className={inputClass}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Consultation"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts">
          <input
            className={inputClass}
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field label="Ends">
          <input
            className={inputClass}
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Status">
        <select
          className={inputClass}
          value={status}
          onChange={(e) => setStatus(e.target.value as ApptStatus)}
        >
          <option value="scheduled">Scheduled</option>
          <option value="completed">Completed</option>
          <option value="canceled">Canceled</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Repeats">
          <select
            className={inputClass}
            value={recurRule}
            onChange={(e) => setRecurRule(e.target.value as RecurRule | '')}
          >
            <option value="">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="monthly">Monthly</option>
          </select>
        </Field>
        {recurRule && (
          <Field label="Until">
            <input
              className={inputClass}
              type="date"
              value={recurUntil}
              onChange={(e) => setRecurUntil(e.target.value)}
            />
          </Field>
        )}
      </div>
      {appointment?.recur_rule && (
        <p className="text-sm text-gray-500">Edits apply to the whole series.</p>
      )}
      {conflicts.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          Conflicts with: {conflictMessage(conflicts)}. Pick a different time.
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <PrimaryButton onClick={save} disabled={saving || !canSave}>
          {saving ? 'Saving…' : appointment ? 'Save changes' : 'Book appointment'}
        </PrimaryButton>
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
      </div>
    </div>
  );
}
