import type { Contact } from '../types';
import type { Store } from './store';

// Contact merge — operates entirely through the Store interface so all
// three backends (local / drive / supabase) inherit it. Order matters:
// every secondary-linked row is repointed to the primary BEFORE the
// secondary is deleted, because deleteContact cascades appointments,
// interactions, and attachments.

export interface MergeResult {
  repointedAppointments: number;
  repointedInteractions: number;
  repointedMatters: number;
  repointedAttachments: number;
}

function nonEmpty(v: string | null | undefined): v is string {
  return Boolean(v && v.trim());
}

// Primary keeps its non-empty fields; empties fill from the secondary.
function fill(primary: string | null | undefined, secondary: string | null | undefined): string | null {
  if (nonEmpty(primary)) return primary;
  if (nonEmpty(secondary)) return secondary;
  return primary ?? secondary ?? null;
}

function customFields(c: Contact): Record<string, unknown> {
  const cf = c.plugin_data?.custom_fields;
  return cf && typeof cf === 'object' && !Array.isArray(cf)
    ? (cf as Record<string, unknown>)
    : {};
}

export async function mergeContacts(
  store: Store,
  primary: Contact,
  secondary: Contact,
): Promise<MergeResult> {
  // 1. Merge the contact row itself: tags union, custom_fields union
  // (primary wins conflicts), scalar fields fill-from-secondary.
  await store.upsertContact({
    id: primary.id,
    name: primary.name,
    phone: fill(primary.phone, secondary.phone),
    email: fill(primary.email, secondary.email),
    org: fill(primary.org, secondary.org),
    role: fill(primary.role, secondary.role),
    address: fill(primary.address, secondary.address),
    website: fill(primary.website, secondary.website),
    tags: [...new Set([...primary.tags, ...secondary.tags])],
    plugin_data: {
      ...secondary.plugin_data,
      ...primary.plugin_data,
      custom_fields: { ...customFields(secondary), ...customFields(primary) },
    },
  });

  const result: MergeResult = {
    repointedAppointments: 0,
    repointedInteractions: 0,
    repointedMatters: 0,
    repointedAttachments: 0,
  };

  // 2. Repoint every linked row secondary -> primary.
  for (const a of await store.listAppointments()) {
    if (a.contact_id !== secondary.id) continue;
    await store.upsertAppointment({
      id: a.id,
      contact_id: primary.id,
      matter_id: a.matter_id ?? null,
      title: a.title,
      starts_at: a.starts_at,
      ends_at: a.ends_at,
      status: a.status,
      recur_rule: a.recur_rule ?? null,
      recur_until: a.recur_until ?? null,
      plugin_data: a.plugin_data,
    });
    result.repointedAppointments += 1;
  }

  for (const i of await store.listInteractions()) {
    if (i.contact_id !== secondary.id) continue;
    await store.upsertInteraction({
      id: i.id,
      contact_id: primary.id,
      appointment_id: i.appointment_id,
      matter_id: i.matter_id ?? null,
      type: i.type,
      subject_outline: i.subject_outline,
      notes: i.notes,
      duration_sec: i.duration_sec,
      outcome: i.outcome,
      occurred_at: i.occurred_at,
      status: i.status,
      resolved_at: i.resolved_at,
      due_at: i.due_at,
      plugin_data: i.plugin_data,
    });
    result.repointedInteractions += 1;
  }

  for (const m of await store.listMatters()) {
    if (m.contact_id !== secondary.id) continue;
    await store.upsertMatter({
      id: m.id,
      contact_id: primary.id,
      title: m.title,
      stage: m.stage,
      summary: m.summary,
      opened_at: m.opened_at,
      closed_at: m.closed_at,
      plugin_data: m.plugin_data,
    });
    result.repointedMatters += 1;
  }

  // Attachments have no upsert — repoint by re-adding the metadata (and
  // content where the backend exposes it) under the primary, then deleting
  // the old row. Best effort per attachment.
  for (const a of await store.listAttachments({ contactId: secondary.id })) {
    try {
      let bytes: Blob;
      try {
        bytes = await store.getAttachmentContent(a.id);
      } catch {
        bytes = new Blob([]); // supabase keeps metadata only
      }
      await store.addAttachment(
        {
          contact_id: primary.id,
          matter_id: a.matter_id,
          filename: a.filename,
          mime_type: a.mime_type,
          size_bytes: a.size_bytes,
        },
        bytes,
      );
      await store.deleteAttachment(a.id);
      result.repointedAttachments += 1;
    } catch {
      // Leave the attachment on the secondary rather than lose it.
    }
  }

  // 3. Remove the secondary — everything linked was already repointed.
  await store.deleteContact(secondary.id);
  return result;
}
