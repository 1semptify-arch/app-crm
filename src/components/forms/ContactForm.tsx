import { useState } from 'react';
import { getStore } from '../../lib/store';
import type { Contact } from '../../types';
import { Field, GhostButton, Icon, PrimaryButton, inputClass } from '../ui';

const ROLE_SUGGESTIONS = [
  'Tenant',
  'Landlord',
  'Attorney',
  'Advocate',
  'Agency',
  'Vendor',
  'Other',
];

interface CustomFieldRow {
  label: string;
  value: string;
}

function customFieldRows(contact?: Contact): CustomFieldRow[] {
  const raw = contact?.plugin_data?.custom_fields;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter(([k, v]) => k && typeof v === 'string')
    .map(([label, value]) => ({ label, value: value as string }));
}

export function ContactForm({
  contact,
  onSaved,
  onCancel,
}: {
  contact?: Contact;
  onSaved: (c: Contact) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(contact?.name ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [org, setOrg] = useState(contact?.org ?? '');
  const [role, setRole] = useState(contact?.role ?? '');
  const [address, setAddress] = useState(contact?.address ?? '');
  const [website, setWebsite] = useState(contact?.website ?? '');
  const [tags, setTags] = useState((contact?.tags ?? []).join(', '));
  const [customFields, setCustomFields] = useState<CustomFieldRow[]>(() =>
    customFieldRows(contact),
  );
  const [newLabel, setNewLabel] = useState('');
  const [newValue, setNewValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function addCustomField() {
    const label = newLabel.trim();
    if (!label) return;
    setCustomFields((rows) => [
      ...rows.filter((r) => r.label !== label),
      { label, value: newValue.trim() },
    ]);
    setNewLabel('');
    setNewValue('');
  }

  async function save() {
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Merge: other plugin_data keys (e.g. seed notes) survive the save.
      const plugin_data: Record<string, unknown> = { ...(contact?.plugin_data ?? {}) };
      const custom_fields = Object.fromEntries(
        customFields.filter((r) => r.label).map((r) => [r.label, r.value]),
      );
      if (Object.keys(custom_fields).length > 0) {
        plugin_data.custom_fields = custom_fields;
      } else {
        delete plugin_data.custom_fields;
      }
      const saved = await getStore().upsertContact({
        id: contact?.id,
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        org: org.trim() || null,
        role: role.trim() || null,
        address: address.trim() || null,
        website: website.trim() || null,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        plugin_data,
      });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save contact.');
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <Field label="Name">
        <input
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jane Doe"
          autoFocus
        />
      </Field>
      <Field label="Organization">
        <input
          className={inputClass}
          value={org}
          onChange={(e) => setOrg(e.target.value)}
          placeholder="Acme Properties"
        />
      </Field>
      <Field label="Role">
        <input
          className={inputClass}
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="Tenant"
          list="crm-role-suggestions"
        />
        <datalist id="crm-role-suggestions">
          {ROLE_SUGGESTIONS.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </Field>
      <Field label="Address">
        <input
          className={inputClass}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="123 Main St, Minneapolis MN 55401"
        />
      </Field>
      <Field label="Website">
        <input
          className={inputClass}
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="https://example.com"
        />
      </Field>
      <Field label="Phone">
        <input
          className={inputClass}
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(555) 123-4567"
        />
      </Field>
      <Field label="Email">
        <input
          className={inputClass}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="jane@example.com"
        />
      </Field>
      <Field label="Tags (comma separated)">
        <input
          className={inputClass}
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="client, vip"
        />
      </Field>

      <section>
        <h3 className="mb-2 text-sm font-medium text-gray-600">Custom fields</h3>
        {customFields.length > 0 && (
          <ul className="mb-3 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {customFields.map((r) => (
              <li key={r.label} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                  <span className="font-medium">{r.label}</span>
                  {r.value && <span className="text-gray-500">: {r.value}</span>}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setCustomFields((rows) => rows.filter((x) => x.label !== r.label))
                  }
                  aria-label={`Remove ${r.label}`}
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-gray-400 hover:bg-gray-50 hover:text-gray-600"
                >
                  <Icon name="x" className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <Field label="Label">
            <input
              className={inputClass}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Case #"
            />
          </Field>
          <Field label="Value">
            <input
              className={inputClass}
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="27-CV-12345"
            />
          </Field>
          <button
            type="button"
            onClick={addCustomField}
            disabled={!newLabel.trim()}
            className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <PrimaryButton onClick={save} disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : contact ? 'Save changes' : 'Add contact'}
        </PrimaryButton>
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
      </div>
    </div>
  );
}
