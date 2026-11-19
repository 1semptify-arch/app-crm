import type { Appointment, Contact } from '../types';
import { getStore } from '../lib/store';

export interface EmailPlugin {
  name: string;
  sendConfirmation(appt: Appointment, contact: Contact): Promise<void>;
  logThread(
    contactId: string,
    message: {
      subject: string;
      body: string;
      direction: 'in' | 'out';
      occurred_at?: string;
      due_at?: string | null;
      matter_id?: string | null;
    },
  ): Promise<void>;
}

class ManualEmailPlugin implements EmailPlugin {
  readonly name = 'manual';

  async sendConfirmation(): Promise<void> {
    return;
  }

  async logThread(
    contactId: string,
    message: {
      subject: string;
      body: string;
      direction: 'in' | 'out';
      occurred_at?: string;
      due_at?: string | null;
      matter_id?: string | null;
    },
  ): Promise<void> {
    await getStore().addInteraction({
      contact_id: contactId,
      matter_id: message.matter_id ?? null,
      type: 'email',
      subject_outline: message.subject || null,
      notes: message.body || null,
      occurred_at: message.occurred_at ?? new Date().toISOString(),
      due_at: message.due_at ?? null,
      status: message.due_at ? 'new' : undefined,
      plugin_data: { direction: message.direction, plugin: this.name },
    });
  }
}

let current: EmailPlugin = new ManualEmailPlugin();

export function registerEmailPlugin(plugin: EmailPlugin): void {
  current = plugin;
}

export function getEmailPlugin(): EmailPlugin {
  return current;
}
