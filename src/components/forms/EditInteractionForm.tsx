import { format, isValid, parseISO } from 'date-fns';
import { useState } from 'react';
import { getStore } from '../../lib/store';
import type { Interaction } from '../../types';
import { Field, GhostButton, PrimaryButton, inputClass } from '../ui';

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = parseISO(iso);
  return isValid(d) ? format(d, "yyyy-MM-dd'T'HH:mm") : '';
}

function toDayInput(iso: string | null): string {
  if (!iso) return '';
  const d = parseISO(iso);
  return isValid(d) ? format(d, 'yyyy-MM-dd') : '';
}

export function EditInteractionForm({
  interaction,
  onSaved,
  onCancel,
}: {
  interaction: Interaction;
  onSaved: (i: Interaction) => void;
  onCancel: () => void;
}) {
  const isCall = interaction.type === 'call';
  const [minutes, setMinutes] = useState(
    interaction.duration_sec != null ? String(Math.round(interaction.duration_sec / 60)) : '',
  );
  const [outcome, setOutcome] = useState(interaction.outcome ?? 'connected');
  const [outline, setOutline] = useState(interaction.subject_outline ?? '');
  const [note, setNote] = useState(interaction.notes ?? '');
  const [when, setWhen] = useState(toLocalInput(interaction.occurred_at));
  const [dueDate, setDueDate] = useState(toDayInput(interaction.due_at));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const saved = await getStore().upsertInteraction({
        id: interaction.id,
        // Full update: untouched identity/state fields are written back as-is.
        contact_id: interaction.contact_id,
        appointment_id: interaction.appointment_id,
        matter_id: interaction.matter_id ?? null,
        type: interaction.type,
        status: interaction.status,
        resolved_at: interaction.resolved_at,
        plugin_data: interaction.plugin_data,
        duration_sec: isCall
          ? minutes
            ? Math.round(Number(minutes) * 60)
            : null
          : interaction.duration_sec,
        outcome: isCall ? outcome : interaction.outcome,
        subject_outline: outline.trim() || null,
        notes: note.trim() || null,
        occurred_at: when ? new Date(when).toISOString() : interaction.occurred_at,
        due_at: dueDate ? new Date(`${dueDate}T00:00:00`).toISOString() : null,
      });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the entry.');
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {isCall && (
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
      )}
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
          {saving ? 'Saving…' : 'Save entry'}
        </PrimaryButton>
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
      </div>
    </div>
  );
}
