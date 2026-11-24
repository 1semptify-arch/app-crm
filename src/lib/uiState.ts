import type { IconName } from '../components/ui';
import type { Appointment, ApptStatus, Contact, Interaction, Matter } from '../types';

export type ViewKey =
  | 'today'
  | 'desk'
  | 'calendar'
  | 'appointments'
  | 'contacts'
  | 'inbox'
  | 'matters'
  | 'flows';

export type DrawerState =
  | { kind: 'contact'; contactId: string }
  | { kind: 'appointment'; appointment: Appointment }
  | { kind: 'matter'; matter: Matter }
  | {
      kind: 'booking';
      appointment?: Appointment;
      presetContactId?: string;
      presetMatterId?: string;
    }
  | { kind: 'contact-form'; contact?: Contact }
  | { kind: 'matter-form'; matter?: Matter; presetContactId?: string }
  | { kind: 'log-call'; contactId?: string; presetMatterId?: string }
  | {
      kind: 'log-email';
      contactId?: string;
      presetMatterId?: string;
      // Deep-link prefill (crm_store /compose shim): recipient override when
      // the caller named an address that isn't a contact, plus subject/body.
      presetTo?: string;
      presetSubject?: string;
      presetBody?: string;
    }
  | { kind: 'note'; contactId?: string; presetMatterId?: string }
  | { kind: 'edit-interaction'; interaction: Interaction }
  | { kind: 'dedupe' }
  | null;

export type ToolbarMode = 'default' | 'selection' | 'form';

// Form drawers suppress every entity quick action — the form owns the drawer
// and its own Save button enforces required fields.
const FORM_KINDS: ReadonlySet<NonNullable<DrawerState>['kind']> = new Set([
  'booking',
  'contact-form',
  'matter-form',
  'log-call',
  'log-email',
  'note',
  'edit-interaction',
  'dedupe', // drawer owns the list — no entity quick actions
]);

export function toolbarMode(drawer: DrawerState): ToolbarMode {
  if (!drawer) return 'default';
  if (FORM_KINDS.has(drawer.kind)) return 'form';
  if (drawer.kind === 'contact' || drawer.kind === 'appointment' || drawer.kind === 'matter')
    return 'selection';
  return 'default';
}

export interface ToolbarAction {
  id: string;
  label: string;
  icon: IconName;
  primary?: boolean;
  href?: string; // anchor-styled action (tel:/mailto:) when set
  run?: () => void;
}

export interface ToolbarContext {
  view: ViewKey;
  drawer: DrawerState;
  contact?: Contact; // resolved contact when drawer.kind === 'contact'
  open: (d: NonNullable<DrawerState>) => void;
  setAppointmentStatus: (a: Appointment, status: ApptStatus) => void;
}

interface ActionSpec {
  id: string;
  label: string;
  icon: IconName;
  primary?: boolean;
}

// ---------------------------------------------------------------------------
// MODE MAP — read top to bottom: which buttons the toolbar shows per mode.
//
//   mode        drawer kind            actions
//   ---------   --------------------   --------------------------------------
//   default     none                   per-view primary (DEFAULT_BY_VIEW below)
//   selection   'contact'              Edit · Call(tel) · Book · Log call ·
//                                      Note · Log email
//   selection   'appointment'          Edit booking · Mark completed ·
//                                      Cancel appointment (scheduled only)
//   form        booking/contact-form/  none — context label only
//               log-call/log-email/note/edit-interaction/dedupe
// ---------------------------------------------------------------------------

const DEFAULT_BY_VIEW: Record<ViewKey, ActionSpec[]> = {
  today: [{ id: 'book', label: 'New booking', icon: 'plus', primary: true }],
  desk: [],
  calendar: [{ id: 'book', label: 'New booking', icon: 'plus', primary: true }],
  appointments: [{ id: 'book', label: 'New booking', icon: 'plus', primary: true }],
  contacts: [{ id: 'new-contact', label: 'Contact', icon: 'plus', primary: true }],
  matters: [{ id: 'new-matter', label: 'New matter', icon: 'plus', primary: true }],
  inbox: [
    { id: 'log-call', label: 'Log call', icon: 'phone', primary: true },
    { id: 'quick-note', label: 'Quick note', icon: 'note' },
  ],
  flows: [],
};

function defaultRun(id: string, ctx: ToolbarContext): () => void {
  switch (id) {
    case 'book':
      return () => ctx.open({ kind: 'booking' });
    case 'new-contact':
      return () => ctx.open({ kind: 'contact-form' });
    case 'new-matter':
      return () => ctx.open({ kind: 'matter-form' });
    case 'log-call':
      return () => ctx.open({ kind: 'log-call' });
    case 'quick-note':
      return () => ctx.open({ kind: 'note' });
    default:
      return () => {};
  }
}

function contactActions(contact: Contact, ctx: ToolbarContext): ToolbarAction[] {
  const actions: ToolbarAction[] = [
    {
      id: 'edit-contact',
      label: 'Edit contact',
      icon: 'pencil',
      run: () => ctx.open({ kind: 'contact-form', contact }),
    },
  ];
  if (contact.phone) {
    actions.push({ id: 'call', label: 'Call', icon: 'phone', href: `tel:${contact.phone}` });
  }
  actions.push(
    {
      id: 'book',
      label: 'Book',
      icon: 'calendar',
      run: () => ctx.open({ kind: 'booking', presetContactId: contact.id }),
    },
    {
      id: 'log-call',
      label: 'Log call',
      icon: 'phone',
      run: () => ctx.open({ kind: 'log-call', contactId: contact.id }),
    },
    {
      id: 'note',
      label: 'Note',
      icon: 'note',
      run: () => ctx.open({ kind: 'note', contactId: contact.id }),
    },
    {
      id: 'log-email',
      label: 'Log email',
      icon: 'mail',
      run: () => ctx.open({ kind: 'log-email', contactId: contact.id }),
    },
  );
  return actions;
}

function appointmentActions(appointment: Appointment, ctx: ToolbarContext): ToolbarAction[] {
  const actions: ToolbarAction[] = [
    {
      id: 'edit-booking',
      label: 'Edit booking',
      icon: 'pencil',
      run: () => ctx.open({ kind: 'booking', appointment }),
    },
  ];
  if (appointment.status === 'scheduled') {
    actions.push(
      {
        id: 'complete',
        label: 'Mark completed',
        icon: 'check',
        run: () => ctx.setAppointmentStatus(appointment, 'completed'),
      },
      {
        id: 'cancel',
        label: 'Cancel appointment',
        icon: 'x',
        run: () => ctx.setAppointmentStatus(appointment, 'canceled'),
      },
    );
  }
  return actions;
}

function matterActions(matter: Matter, ctx: ToolbarContext): ToolbarAction[] {
  const actions: ToolbarAction[] = [
    {
      id: 'edit-matter',
      label: 'Edit matter',
      icon: 'pencil',
      run: () => ctx.open({ kind: 'matter-form', matter }),
    },
  ];
  if (matter.contact_id) {
    actions.push({
      id: 'log-call',
      label: 'Log call',
      icon: 'phone',
      run: () =>
        ctx.open({ kind: 'log-call', contactId: matter.contact_id!, presetMatterId: matter.id }),
    });
  }
  actions.push({
    id: 'book',
    label: 'Book',
    icon: 'calendar',
    run: () =>
      ctx.open({
        kind: 'booking',
        presetContactId: matter.contact_id ?? undefined,
        presetMatterId: matter.id,
      }),
  });
  return actions;
}

export function toolbarActions(mode: ToolbarMode, ctx: ToolbarContext): ToolbarAction[] {
  if (mode === 'form') return [];
  if (mode === 'selection') {
    if (ctx.drawer?.kind === 'contact' && ctx.contact) {
      return contactActions(ctx.contact, ctx);
    }
    if (ctx.drawer?.kind === 'appointment') {
      return appointmentActions(ctx.drawer.appointment, ctx);
    }
    if (ctx.drawer?.kind === 'matter') {
      return matterActions(ctx.drawer.matter, ctx);
    }
    return [];
  }
  return DEFAULT_BY_VIEW[ctx.view].map((spec) => ({ ...spec, run: defaultRun(spec.id, ctx) }));
}
