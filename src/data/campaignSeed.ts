import type { AppointmentInput, ContactInput } from '../types';

// Deploy-repo build: campaign seed data is stripped — it lives in the
// canonical repo (master-repo/modules/app-crm), which is private. The
// ?seed=campaign flow stays wired; it just seeds nothing here.

export const CONTACTS: ContactInput[] = [];
export const APPOINTMENTS: AppointmentInput[] = [];
