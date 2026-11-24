import { format } from 'date-fns';
import { useEffect, useState } from 'react';
import { getEmailPlugin } from '../../services/email';
import { SmartBrainEmailPlugin } from '../../services/smartBrainEmail';
import type { Contact, Interaction, Matter } from '../../types';
import { applyTemplate, type EmailTemplate } from '../../lib/merge';
import { getStore } from '../../lib/store';
import { Field, GhostButton, Icon, PrimaryButton, inputClass } from '../ui';

function nowLocal(): string {
  return format(new Date(), "yyyy-MM-dd'T'HH:mm");
}

// Seeded into plugin_data on the form's first open when nothing is stored.
const STARTER_TEMPLATES: EmailTemplate[] = [
  {
    id: 'starter-meeting-confirmation',
    name: 'Meeting confirmation',
    subject: 'Confirming {{date}}',
    body: "Hi {{first}},\n\nConfirming we're set for {{date}}.\n\nBest,",
  },
  {
    id: 'starter-follow-up',
    name: 'Follow-up',
    subject: 'Following up',
    body: 'Hi {{first}},\n\nFollowing up on our last conversation — anything else you need from me?\n\nBest,',
  },
  {
    id: 'starter-check-in',
    name: 'Check-in',
    subject: 'Checking in',
    body: 'Hi {{first}},\n\nJust checking in — let me know how things are going at {{org}}.',
  },
];

const TEMPLATES_PLUGIN = 'email';
const TEMPLATES_KEY = 'templates';
const SAVE_AS = '__save_as__';

export function LogEmailForm({
  contactId,
  presetMatterId,
  presetTo,
  presetSubject,
  presetBody,
  contacts,
  onSaved,
  onCancel,
}: {
  contactId?: string;
  presetMatterId?: string;
  presetTo?: string;
  presetSubject?: string;
  presetBody?: string;
  contacts: Contact[];
  onSaved: (i: Interaction) => void;
  onCancel: () => void;
}) {
  const [selectedContact, setSelectedContact] = useState(contactId ?? '');
  const [matters, setMatters] = useState<Matter[]>([]);
  const [matterId, setMatterId] = useState(presetMatterId ?? '');
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [subject, setSubject] = useState(presetSubject ?? '');
  const [body, setBody] = useState(presetBody ?? '');
  const [when, setWhen] = useState(nowLocal());
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [naming, setNaming] = useState(false);
  const [templateName, setTemplateName] = useState('');

  // Open matters only (anything but closed); keep the preset selectable.
  useEffect(() => {
    getStore()
      .listMatters()
      .then((all) =>
        setMatters(all.filter((m) => m.stage !== 'closed' || m.id === presetMatterId)),
      )
      .catch(() => setMatters([]));
  }, [presetMatterId]);

  // Templates live in plugin_data ('email', 'templates'). First open with
  // nothing stored seeds the three starters; a stored [] stays empty.
  useEffect(() => {
    const store = getStore();
    store
      .getPluginData(TEMPLATES_PLUGIN, TEMPLATES_KEY)
      .then(async (d) => {
        const stored = d?.templates;
        if (Array.isArray(stored)) {
          setTemplates(stored as EmailTemplate[]);
          return;
        }
        setTemplates(STARTER_TEMPLATES);
        await store
          .setPluginData(TEMPLATES_PLUGIN, TEMPLATES_KEY, {
            templates: STARTER_TEMPLATES as unknown as Record<string, unknown>[],
          })
          .catch(() => {});
      })
      .catch(() => setTemplates(STARTER_TEMPLATES));
  }, []);

  const contact = contacts.find((c) => c.id === selectedContact);
  // Deep-link recipient: an explicit to= wins over the card's address
  // (covers /compose?to=addr where addr isn't a contact yet).
  const recipient = presetTo || contact?.email || '';

  function onTemplatePick(value: string) {
    if (value === SAVE_AS) {
      setNaming(true);
      setTemplateName('');
      setTemplateId('');
      return;
    }
    setNaming(false);
    setTemplateId(value);
    const t = templates.find((x) => x.id === value);
    if (t) {
      setSubject(t.subject);
      setBody(t.body);
    }
  }

  async function saveTemplate() {
    const name = templateName.trim();
    if (!name) return;
    const existing = templates.find((t) => t.name.toLowerCase() === name.toLowerCase());
    const next: EmailTemplate = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      subject,
      body,
    };
    const list = existing
      ? templates.map((t) => (t.id === next.id ? next : t))
      : [...templates, next];
    setTemplates(list);
    setTemplateId(next.id);
    setNaming(false);
    try {
      await getStore().setPluginData(TEMPLATES_PLUGIN, TEMPLATES_KEY, {
        templates: list as unknown as Record<string, unknown>[],
      });
    } catch {
      setError('Template saved for this session only — could not persist it.');
    }
  }

  async function deleteTemplate() {
    const t = templates.find((x) => x.id === templateId);
    if (!t) return;
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    const list = templates.filter((x) => x.id !== t.id);
    setTemplates(list);
    setTemplateId('');
    try {
      await getStore().setPluginData(TEMPLATES_PLUGIN, TEMPLATES_KEY, {
        templates: list as unknown as Record<string, unknown>[],
      });
    } catch {
      setError('Template deleted for this session only — could not persist it.');
    }
  }

  async function save() {
    if (!selectedContact) {
      setError('Pick a contact for this email.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await getEmailPlugin().logThread(selectedContact, {
        subject,
        body,
        direction,
        occurred_at: when ? new Date(when).toISOString() : new Date().toISOString(),
        due_at: dueDate ? new Date(`${dueDate}T00:00:00`).toISOString() : null,
        matter_id: matterId || null,
      });
      const list = await getStore().listInteractions(selectedContact);
      onSaved(list[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not log the email.');
      setSaving(false);
    }
  }

  // Real transport: send the merged message through the attached sender
  // (Gmail) — the plugin logs it outbound after Gmail accepts it.
  async function sendViaTransport() {
    if (!selectedContact) {
      setError('Pick a contact for this email.');
      return;
    }
    if (!recipient) {
      setError('That contact has no email address.');
      return;
    }
    const plugin = getEmailPlugin();
    if (!(plugin instanceof SmartBrainEmailPlugin) || !plugin.canSend) return;
    setSaving(true);
    setError(null);
    try {
      await plugin.send(selectedContact, {
        to: recipient,
        subject: applyTemplate(subject, contact),
        body: applyTemplate(body, contact),
        due_at: dueDate ? new Date(`${dueDate}T00:00:00`).toISOString() : null,
        matter_id: matterId || null,
      });
      const list = await getStore().listInteractions(selectedContact);
      onSaved(list[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the email.');
      setSaving(false);
    }
  }

  // One click: open the user's mail app with the merged message via mailto:,
  // and log it as a sent email — same card flow as a manual log entry.
  async function sendViaApp() {
    if (!selectedContact) {
      setError('Pick a contact for this email.');
      return;
    }
    if (!recipient) {
      setError('That contact has no email address.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const mergedSubject = applyTemplate(subject, contact);
      const mergedBody = applyTemplate(body, contact);
      const mailto = `mailto:${recipient}?subject=${encodeURIComponent(
        mergedSubject,
      )}&body=${encodeURIComponent(mergedBody)}`;
      await getEmailPlugin().logThread(selectedContact, {
        subject: mergedSubject,
        body: mergedBody,
        direction: 'out',
        occurred_at: when ? new Date(when).toISOString() : new Date().toISOString(),
        due_at: dueDate ? new Date(`${dueDate}T00:00:00`).toISOString() : null,
        matter_id: matterId || null,
      });
      window.location.href = mailto;
      const list = await getStore().listInteractions(selectedContact);
      onSaved(list[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the email.');
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
            <option value="">Choose a contact</option>
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
        <Field label="Direction">
          <select
            className={inputClass}
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'in' | 'out')}
          >
            <option value="out">Sent</option>
            <option value="in">Received</option>
          </select>
        </Field>
        <Field label="When">
          <input
            className={inputClass}
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Follow up by">
        <input
          className={inputClass}
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </Field>
      <Field label="Template">
        <div className="flex items-center gap-2">
          <select
            className={inputClass}
            value={templateId}
            onChange={(e) => onTemplatePick(e.target.value)}
          >
            <option value="">No template</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value={SAVE_AS}>Save as template…</option>
          </select>
          {templateId && (
            <button
              type="button"
              onClick={deleteTemplate}
              aria-label="Delete template"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
            >
              <Icon name="x" className="h-4 w-4" />
            </button>
          )}
        </div>
        {naming && (
          <div className="mt-2 flex items-center gap-2">
            <input
              className={inputClass}
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveTemplate();
                }
              }}
              placeholder="Template name"
            />
            <GhostButton onClick={saveTemplate}>Save</GhostButton>
            <GhostButton onClick={() => setNaming(false)}>Cancel</GhostButton>
          </div>
        )}
        <span className="mt-1.5 block text-xs text-gray-400">
          {'{{name}} {{first}} {{org}} {{date}} merge when sent via email app.'}
        </span>
      </Field>
      <Field label="Subject">
        <input
          className={inputClass}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Re: scheduling"
        />
      </Field>
      <Field label="Body">
        <textarea
          className={`${inputClass} min-h-[120px]`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Summary or pasted thread"
        />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <PrimaryButton onClick={save} disabled={saving || !selectedContact}>
          {saving ? 'Saving…' : 'Log email'}
        </PrimaryButton>
        {contact?.email &&
          getEmailPlugin() instanceof SmartBrainEmailPlugin &&
          (getEmailPlugin() as SmartBrainEmailPlugin).canSend && (
            <GhostButton onClick={sendViaTransport}>
              <Icon name="mail" className="h-4 w-4" />
              Send via Gmail
            </GhostButton>
          )}
        {contact?.email && (
          <GhostButton onClick={sendViaApp}>
            <Icon name="mail" className="h-4 w-4" />
            Send via email app
          </GhostButton>
        )}
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
      </div>
    </div>
  );
}
