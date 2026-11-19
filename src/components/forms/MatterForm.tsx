import { format, isValid, parseISO } from 'date-fns';
import { useState } from 'react';
import { getStore } from '../../lib/store';
import { MATTER_STAGES, type Contact, type Matter, type MatterStage } from '../../types';
import { Field, GhostButton, PrimaryButton, inputClass, matterStageText } from '../ui';

const CLOSED_STAGES: MatterStage[] = ['resolved', 'closed'];

export function MatterForm({
  matter,
  presetContactId,
  contacts,
  onSaved,
  onCancel,
}: {
  matter?: Matter;
  presetContactId?: string;
  contacts: Contact[];
  onSaved: (m: Matter) => void;
  onCancel: () => void;
}) {
  const [contactId, setContactId] = useState(matter?.contact_id ?? presetContactId ?? '');
  const [title, setTitle] = useState(matter?.title ?? '');
  const [stage, setStage] = useState<MatterStage>(matter?.stage ?? 'new');
  const [summary, setSummary] = useState(matter?.summary ?? '');
  const [closedAt, setClosedAt] = useState<string | null>(matter?.closed_at ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Entering resolved/closed stamps closed_at once; reopening clears it.
  function onStageChange(next: MatterStage) {
    setStage(next);
    if (CLOSED_STAGES.includes(next)) {
      setClosedAt((c) => c ?? new Date().toISOString());
    } else {
      setClosedAt(null);
    }
  }

  const canSave = Boolean(contactId) && Boolean(title.trim());

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const saved = await getStore().upsertMatter({
        id: matter?.id,
        contact_id: contactId,
        title: title.trim(),
        stage,
        summary: summary.trim() || null,
        opened_at: matter?.opened_at,
        closed_at: closedAt,
        plugin_data: matter?.plugin_data,
      });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the matter.');
      setSaving(false);
    }
  }

  const closedLabel = (() => {
    if (!closedAt) return null;
    const d = parseISO(closedAt);
    return isValid(d) ? format(d, 'MMM d, yyyy · h:mm a') : closedAt;
  })();

  return (
    <div className="space-y-5">
      <Field label="Contact">
        <select
          className={inputClass}
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
        >
          <option value="">Choose a contact</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Title">
        <input
          className={inputClass}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Deposit dispute"
        />
      </Field>
      <Field label="Stage">
        <select
          className={inputClass}
          value={stage}
          onChange={(e) => onStageChange(e.target.value as MatterStage)}
        >
          {MATTER_STAGES.map((s) => (
            <option key={s} value={s}>
              {matterStageText(s).text}
            </option>
          ))}
        </select>
      </Field>
      {closedLabel && (
        <p className="text-sm text-gray-500">Closed {closedLabel}</p>
      )}
      <Field label="Summary">
        <textarea
          className={`${inputClass} min-h-[120px]`}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="What is this matter about?"
        />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <PrimaryButton onClick={save} disabled={saving || !canSave}>
          {saving ? 'Saving…' : matter ? 'Save changes' : 'Create matter'}
        </PrimaryButton>
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
      </div>
    </div>
  );
}
