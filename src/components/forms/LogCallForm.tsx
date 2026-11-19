import { format } from 'date-fns';
import { useEffect, useState } from 'react';
import { getStore } from '../../lib/store';
import type { Contact, Interaction, Matter } from '../../types';
import { Field, GhostButton, PrimaryButton, inputClass } from '../ui';

function nowLocal(): string {
  return format(new Date(), "yyyy-MM-dd'T'HH:mm");
}

export function LogCallForm({
  contactId,
  presetMatterId,
  contacts,
  onSaved,
  onCancel,
}: {
  contactId?: string;
  presetMatterId?: string;
  contacts: Contact[];
  onSaved: (i: Interaction) => void;
  onCancel: () => void;
}) {
  const [selectedContact, setSelectedContact] = useState(contactId ?? '');
  const [matters, setMatters] = useState<Matter[]>([]);
  const [matterId, setMatterId] = useState(presetMatterId ?? '');
  const [minutes, setMinutes] = useState('');
  const [outcome, setOutcome] = useState('connected');
  const [outline, setOutline] = useState('');
  const [note, setNote] = useState('');
  const [when, setWhen] = useState(nowLocal());
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Open matters only (anything but closed); keep the preset selectable.
  useEffect(() => {
    getStore()
      .listMatters()
      .then((all) =>
        setMatters(all.filter((m) => m.stage !== 'closed' || m.id === presetMatterId)),
      )
      .catch(() => setMatters([]));
  }, [presetMatterId]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const saved = await getStore().addInteraction({
        contact_id: selectedContact || null,
        matter_id: matterId || null,
        type: 'call',
        duration_sec: minutes ? Math.round(Number(minutes) * 60) : null,
        outcome,
        subject_outline: outline.trim() || null,
        notes: note.trim() || null,
        occurred_at: when ? new Date(when).toISOString() : new Date().toISOString(),
        // A follow-up date means real open work — keep the card unresolved.
        due_at: dueDate ? new Date(`${dueDate}T00:00:00`).toISOString() : null,
        status: dueDate ? 'new' : undefined,
      });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not log the call.');
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {!contactId && (
        <Field label="Contact">
          <select
            className={inputClass}
            value={selectedContact}
            onChange={(e) => setSelectedContact(e.target.value)}
          >
            <option value="">No contact</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Duration (minutes)">
          <input
            className={inputClass}
            type="number"
            min="0"
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="15"
          />
        </Field>
        <Field label="Outcome">
          <select
            className={inputClass}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          >
            <option value="connected">Connected</option>
            <option value="voicemail">Voicemail</option>
            <option value="no answer">No answer</option>
            <option value="other">Other</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="When">
          <input
            className={inputClass}
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </Field>
        <Field label="Follow up by">
          <input
            className={inputClass}
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Subject outline (one point per line)">
        <textarea
          className={`${inputClass} min-h-[88px]`}
          value={outline}
          onChange={(e) => setOutline(e.target.value)}
          placeholder={'- Discussed timing\n- Sent follow-up'}
        />
      </Field>
      <Field label="Notes">
        <textarea
          className={`${inputClass} min-h-[88px]`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything worth remembering"
        />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <PrimaryButton onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Log call'}
        </PrimaryButton>
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
      </div>
    </div>
  );
}
