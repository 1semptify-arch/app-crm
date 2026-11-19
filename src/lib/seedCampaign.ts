import { APPOINTMENTS, CONTACTS } from '../data/campaignSeed';
import { normalizeName } from './names';
import type { Store } from './store';

export interface CampaignSeedResult {
  contactsAdded: number;
  contactsUpdated: number;
  appointmentsAdded: number;
  appointmentsSkipped: number;
}

export async function seedCampaign(store: Store): Promise<CampaignSeedResult> {
  const existingContacts = await store.listContacts();
  const existingByName = new Map(
    existingContacts.map((c) => [normalizeName(c.name), c]),
  );
  const existingAppts = await store.listAppointments();
  const existingApptKeys = new Set(existingAppts.map((a) => `${a.title}|${a.starts_at}`));

  const result: CampaignSeedResult = {
    contactsAdded: 0,
    contactsUpdated: 0,
    appointmentsAdded: 0,
    appointmentsSkipped: 0,
  };

  for (const input of CONTACTS) {
    const existing = existingByName.get(normalizeName(input.name));
    await store.upsertContact({ ...input, id: existing?.id });
    if (existing) {
      result.contactsUpdated += 1;
    } else {
      result.contactsAdded += 1;
    }
  }

  for (const input of APPOINTMENTS) {
    if (existingApptKeys.has(`${input.title}|${input.starts_at}`)) {
      result.appointmentsSkipped += 1;
      continue;
    }
    await store.upsertAppointment(input);
    result.appointmentsAdded += 1;
  }

  return result;
}
