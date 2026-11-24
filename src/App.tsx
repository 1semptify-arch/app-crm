import { format, isValid, parseISO } from 'date-fns';
import { useCallback, useEffect, useState } from 'react';
import { AttachmentsSection } from './components/AttachmentsSection';
import { DedupeView } from './components/DedupeView';
import { Drawer } from './components/Drawer';
import { LoginScreen } from './components/LoginScreen';
import { SearchPalette, type SearchSelection } from './components/SearchPalette';
import { isOverdue } from './components/TaskCard';
import { Timeline } from './components/Timeline';
import { BookingForm } from './components/forms/BookingForm';
import { ContactForm } from './components/forms/ContactForm';
import { EditInteractionForm } from './components/forms/EditInteractionForm';
import { LogCallForm } from './components/forms/LogCallForm';
import { LogEmailForm } from './components/forms/LogEmailForm';
import { MatterForm } from './components/forms/MatterForm';
import { NoteForm } from './components/forms/NoteForm';
import { Icon, matterStageText, statusText, type IconName } from './components/ui';
import { AppointmentsView } from './components/views/AppointmentsView';
import { CalendarView } from './components/views/CalendarView';
import { ContactsView } from './components/views/ContactsView';
import { DeskView } from './components/views/DeskView';
import { FlowsView } from './components/views/FlowsView';
import { InboxView } from './components/views/InboxView';
import { MattersView } from './components/views/MattersView';
import { TodayView } from './components/views/TodayView';
import { getDriveSession, signOutOfDrive } from './lib/driveStore';
import { isCaseServed } from './lib/httpStore';
import { seedCampaign } from './lib/seedCampaign';
import { downloadVCard } from './lib/vcard';
import { getStore, isDriveConfigured, isSupabaseConfigured, resetStore } from './lib/store';
import { getSession, signOut } from './lib/supabaseStore';
import { toolbarActions, toolbarMode, type DrawerState, type ViewKey } from './lib/uiState';
import type { Appointment, ApptStatus, Contact, Interaction, Matter } from './types';

// Case-served builds (crm_store.py) get the Send view — packet flows live
// on the case's ops_state and only exist behind its /api.
const CASE_SERVED = isCaseServed();

// :8800 one-window mount (P3): ?embed=1 means comm_center's shell IS the
// chrome — the app titlebar (CRM wordmark + mode badge) drops out, while
// the nav rail (the tool's tab row) and the action/search buttons stay so
// the surface remains fully usable inside the iframe. embed+task are
// preserved on URL rewrites so a refresh can't drop the flag.
const EMBED = new URLSearchParams(window.location.search).get('embed') === '1';

function preservedEmbedQuery(): string {
  const keep = new URLSearchParams();
  for (const k of ['embed', 'task']) {
    const v = new URLSearchParams(window.location.search).get(k);
    if (v) keep.set(k, v);
  }
  const qs = keep.toString();
  return qs ? `?${qs}` : '';
}

const NAV: {
  key: ViewKey;
  label: string;
  icon: IconName;
}[] = [
  { key: 'today', label: 'Today', icon: 'sun' },
  { key: 'desk', label: 'Desk', icon: 'phone' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar' },
  { key: 'appointments', label: 'Bookings', icon: 'clock' },
  { key: 'contacts', label: 'Contacts', icon: 'users' },
  { key: 'inbox', label: 'Log', icon: 'inbox' },
  { key: 'matters', label: 'Matters', icon: 'briefcase' },
  ...(CASE_SERVED ? [{ key: 'flows', label: 'Send', icon: 'send' } as const] : []),
];

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [view, setView] = useState<ViewKey>('today');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [deskContactId, setDeskContactId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [flowKey, setFlowKey] = useState<string | null>(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (CASE_SERVED) {
      // The case API IS the session — no OAuth round-trip to sit in front
      // of it even when Drive/Supabase envs happen to be baked into the
      // same build.
      setAuthed(true);
      return;
    }
    if (isSupabaseConfigured) {
      getSession()
        .then((s) => setAuthed(Boolean(s)))
        .catch(() => setAuthed(false));
      return;
    }
    if (isDriveConfigured) {
      setAuthed(getDriveSession());
      return;
    }
    setAuthed(true);
  }, []);

  useEffect(() => {
    if (authed !== true) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('seed') !== 'campaign') return;
    seedCampaign(getStore())
      .then((result) => {
        console.info('campaign seed', result);
        reload();
      })
      .catch((err) => console.error('campaign seed failed', err))
      .finally(() => {
        params.delete('seed');
        const qs = params.toString();
        window.history.replaceState(
          null,
          '',
          window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash,
        );
      });
  }, [authed, reload]);

  useEffect(() => {
    if (authed) {
      getStore()
        .listContacts()
        .then(setContacts)
        .catch(() => setContacts([]));
      getStore()
        .listInteractions()
        .then(setInteractions)
        .catch(() => setInteractions([]));
    }
  }, [authed, reloadKey]);

  // Deep links — the case server (crm_store.py) 302s retired :8888/:8777
  // URLs here as /?view=..&contact=..&drawer=..&flow=.. . Applied once
  // (after contacts land so names/emails resolve), then the URL is
  // replaced so refreshes and in-app nav aren't re-hijacked.
  useEffect(() => {
    if (authed !== true || contacts.length === 0) return;
    const p = new URLSearchParams(window.location.search);
    if (
      !['view', 'contact', 'contact_name', 'drawer', 'flow', 'search', 'to']
        .some((k) => p.get(k))
    )
      return;
    const rawCid = (p.get('contact') || '').replace(/^c/i, '');
    let contactId = rawCid ? `c${rawCid}` : '';
    const findByName = (name: string) =>
      contacts.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
    const findByEmail = (em: string) =>
      contacts.find((c) => (c.email || '').toLowerCase() === em.toLowerCase());
    if (!contactId && p.get('contact_name')) {
      const hit = findByName(p.get('contact_name')!);
      if (hit) contactId = hit.id;
    }
    const to = p.get('to') || '';
    if (!contactId && to) {
      const hit = findByEmail(to);
      if (hit) contactId = hit.id;
    }
    const view = p.get('view') as ViewKey | null;
    if (view === 'desk' && contactId) {
      setDeskContactId(contactId);
      setView('desk');
    } else if (view) {
      setView(view);
      if (contactId) setDeskContactId(contactId);
    }
    switch (p.get('drawer')) {
      case 'log-email':
        setDrawer({
          kind: 'log-email',
          contactId: contactId || undefined,
          presetTo: to || undefined,
          presetSubject: p.get('subject') || p.get('subj') || undefined,
          presetBody: p.get('body') || undefined,
        });
        break;
      case 'log-call':
        setDrawer({ kind: 'log-call', contactId: contactId || undefined });
        break;
      case 'contact':
        if (contactId) setDrawer({ kind: 'contact', contactId });
        break;
      case 'contact-form': {
        const c = contacts.find((x) => x.id === contactId);
        setDrawer({ kind: 'contact-form', contact: c });
        break;
      }
    }
    const flow = p.get('flow');
    if (flow) {
      setView('flows');
      setFlowKey(flow);
    }
    if (p.get('search')) setSearchOpen(true);
    window.history.replaceState(null, '', `/${preservedEmbedQuery()}`);
  }, [authed, contacts]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function onSearchSelect(sel: SearchSelection) {
    setSearchOpen(false);
    if (sel.kind === 'contact') setDrawer({ kind: 'contact', contactId: sel.contact.id });
    else if (sel.kind === 'matter') setDrawer({ kind: 'matter', matter: sel.matter });
    else if (sel.kind === 'appointment')
      setDrawer({ kind: 'appointment', appointment: sel.appointment });
    else if (sel.interaction.contact_id)
      setDrawer({ kind: 'contact', contactId: sel.interaction.contact_id });
  }

  function closeDrawer() {
    setDrawer(null);
  }

  function saved() {
    reload();
    closeDrawer();
  }

  if (authed === null) {
    return <div className="min-h-screen bg-white" />;
  }
  if (isSupabaseConfigured && !authed) {
    return <LoginScreen onSignedIn={() => setAuthed(true)} />;
  }
  if (isDriveConfigured && !authed) {
    return <LoginScreen drive onSignedIn={() => setAuthed(true)} />;
  }

  const drawerContact =
    drawer?.kind === 'contact'
      ? contacts.find((c) => c.id === drawer.contactId)
      : undefined;

  function setAppointmentStatus(a: Appointment, status: ApptStatus) {
    // Status applies to the whole series — write back anchor times when the
    // row is a generated occurrence (series_starts_at is set by expansion).
    getStore()
      .upsertAppointment({
        id: a.id,
        contact_id: a.contact_id,
        title: a.title,
        starts_at: a.series_starts_at ?? a.starts_at,
        ends_at: a.series_ends_at ?? a.ends_at,
        status,
        matter_id: a.matter_id ?? null,
        plugin_data: a.plugin_data,
      })
      .then(reload)
      .catch((e) => console.error('status update failed', e));
  }

  const unresolved = interactions.filter((i) => (i.status ?? 'new') !== 'resolved');
  const needsActionCount = unresolved.length;
  const anyOverdue = unresolved.some((i) => isOverdue(i));

  const mode = toolbarMode(drawer);
  const actions = toolbarActions(mode, {
    view,
    drawer,
    contact: drawerContact,
    open: setDrawer,
    setAppointmentStatus,
  });

  return (
    <div className="flex min-h-screen bg-white">
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-gray-100 bg-white pb-[env(safe-area-inset-bottom)] md:static md:z-auto md:w-16 md:flex-col md:border-r md:border-t-0 md:pb-0"
      >
        {NAV.map((n) => (
          <button
            key={n.key}
            type="button"
            onClick={() => setView(n.key)}
            aria-label={n.label}
            aria-current={view === n.key ? 'page' : undefined}
            className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 md:min-h-[64px] md:flex-none ${
              view === n.key ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <span className="relative">
              <Icon name={n.icon} className="h-6 w-6" />
              {n.key === 'inbox' && needsActionCount > 0 && (
                <span
                  className={`absolute -right-2.5 -top-1.5 min-w-[20px] rounded-full px-1 text-center text-[10px] font-semibold leading-4 text-white ${
                    anyOverdue ? 'bg-red-600' : 'bg-amber-500'
                  }`}
                >
                  {needsActionCount}
                </span>
              )}
            </span>
            <span className="text-[10px] font-medium md:hidden">{n.label}</span>
          </button>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col pb-[72px] md:pb-0">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-gray-100 bg-white px-4 sm:z-50 sm:px-6">
          {!EMBED && (
            <>
              <h1 className="text-lg font-semibold tracking-tight text-gray-900">CRM</h1>
              {!isSupabaseConfigured && !isDriveConfigured && (
                <span className="whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-500">
                  {CASE_SERVED ? 'Case mode' : 'Local demo mode'}
                </span>
              )}
            </>
          )}
          <div className="flex-1" />
          {mode === 'form' && drawer && (
            <span className="hidden text-sm text-gray-400 sm:inline">
              {drawerTitle(drawer, drawerContact)}
            </span>
          )}
          {actions.map((a) => {
            const cls = a.primary
              ? 'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700'
              : 'hidden min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-gray-600 hover:bg-gray-100 sm:inline-flex';
            return a.href ? (
              <a key={a.id} href={a.href} className={cls}>
                <Icon name={a.icon} className="h-4 w-4" />
                {a.label}
              </a>
            ) : (
              <button key={a.id} type="button" onClick={a.run} className={cls}>
                <Icon name={a.icon} className="h-4 w-4" />
                {a.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 sm:w-auto sm:gap-2 sm:px-3"
          >
            <Icon name="search" className="h-5 w-5" />
            <span className="hidden text-sm text-gray-400 sm:inline">Search</span>
            <kbd className="hidden rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-400 lg:inline">
              Ctrl K
            </kbd>
          </button>
          {!CASE_SERVED && isSupabaseConfigured && (
            <button
              type="button"
              onClick={() => signOut().then(() => setAuthed(false))}
              className="min-h-[44px] rounded-lg px-3 text-sm text-gray-500 hover:bg-gray-50"
            >
              Sign out
            </button>
          )}
          {!CASE_SERVED && !isSupabaseConfigured && isDriveConfigured && (
            <button
              type="button"
              onClick={() =>
                signOutOfDrive().then(() => {
                  resetStore();
                  window.location.reload();
                })
              }
              className="min-h-[44px] rounded-lg px-3 text-sm text-gray-500 hover:bg-gray-50"
            >
              Sign out
            </button>
          )}
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
          {view === 'today' && (
            <TodayView
              contacts={contacts}
              reloadKey={reloadKey}
              onOpenDrawer={setDrawer}
              onGoView={setView}
              onChanged={reload}
            />
          )}
          {view === 'desk' && (
            <DeskView
              contacts={contacts}
              contactId={deskContactId}
              reloadKey={reloadKey}
              onSelectContact={setDeskContactId}
              onOpenDrawer={setDrawer}
              onChanged={reload}
            />
          )}
          {view === 'calendar' && (
            <CalendarView
              contacts={contacts}
              reloadKey={reloadKey}
              onOpenAppointment={(a) => setDrawer({ kind: 'appointment', appointment: a })}
              onChanged={reload}
            />
          )}
          {view === 'appointments' && (
            <AppointmentsView
              contacts={contacts}
              reloadKey={reloadKey}
              onOpenAppointment={(a) => setDrawer({ kind: 'appointment', appointment: a })}
            />
          )}
          {view === 'contacts' && (
            <ContactsView
              contacts={contacts}
              onOpenContact={(c) => {
                setDeskContactId(c.id);
                setView('desk');
              }}
              onOpenDedupe={() => setDrawer({ kind: 'dedupe' })}
              onChanged={reload}
            />
          )}
          {view === 'inbox' && (
            <InboxView
              contacts={contacts}
              reloadKey={reloadKey}
              onOpenDrawer={setDrawer}
              onChanged={reload}
            />
          )}
          {view === 'matters' && (
            <MattersView
              contacts={contacts}
              reloadKey={reloadKey}
              onOpenMatter={(m) => setDrawer({ kind: 'matter', matter: m })}
            />
          )}
          {view === 'flows' && CASE_SERVED && (
            <FlowsView reloadKey={reloadKey} initialKey={flowKey} />
          )}
        </main>
      </div>

      {drawer && (
        <Drawer title={drawerTitle(drawer, drawerContact)} onClose={closeDrawer}>
          {drawer.kind === 'contact' && (
            <ContactDrawerBody
              contactId={drawer.contactId}
              contacts={contacts}
              reloadKey={reloadKey}
              onChanged={reload}
              onEdit={(c) => setDrawer({ kind: 'contact-form', contact: c })}
              onLogCall={(id) => setDrawer({ kind: 'log-call', contactId: id })}
              onLogEmail={(id) => setDrawer({ kind: 'log-email', contactId: id })}
              onNote={(id) => setDrawer({ kind: 'note', contactId: id })}
              onOpenAppointment={(a) => setDrawer({ kind: 'appointment', appointment: a })}
              onOpenMatter={(m) => setDrawer({ kind: 'matter', matter: m })}
              onOpenDesk={(id) => {
                setDeskContactId(id);
                closeDrawer();
                setView('desk');
              }}
              onDeleted={() => {
                reload();
                closeDrawer();
              }}
            />
          )}
          {drawer.kind === 'appointment' && (
            <AppointmentDrawerBody
              appointment={drawer.appointment}
              contacts={contacts}
              reloadKey={reloadKey}
              onEdit={(a) => setDrawer({ kind: 'booking', appointment: a })}
              onOpenContact={(id) => setDrawer({ kind: 'contact', contactId: id })}
              onOpenMatter={(m) => setDrawer({ kind: 'matter', matter: m })}
              onDeleted={() => {
                reload();
                closeDrawer();
              }}
            />
          )}
          {drawer.kind === 'matter' && (
            <MatterDrawerBody
              matter={drawer.matter}
              contacts={contacts}
              reloadKey={reloadKey}
              onChanged={reload}
              onEdit={(m) => setDrawer({ kind: 'matter-form', matter: m })}
              onOpenContact={(id) => setDrawer({ kind: 'contact', contactId: id })}
              onOpenAppointment={(a) => setDrawer({ kind: 'appointment', appointment: a })}
              onLogCall={(cid, mid) =>
                setDrawer({ kind: 'log-call', contactId: cid, presetMatterId: mid })
              }
              onNote={(cid, mid) =>
                setDrawer({ kind: 'note', contactId: cid, presetMatterId: mid })
              }
              onLogEmail={(cid, mid) =>
                setDrawer({ kind: 'log-email', contactId: cid, presetMatterId: mid })
              }
              onBook={(cid, mid) =>
                setDrawer({
                  kind: 'booking',
                  presetContactId: cid,
                  presetMatterId: mid,
                })
              }
              onDeleted={() => {
                reload();
                closeDrawer();
              }}
            />
          )}
          {drawer.kind === 'matter-form' && (
            <MatterForm
              matter={drawer.matter}
              presetContactId={drawer.presetContactId}
              contacts={contacts}
              onSaved={(m) => {
                reload();
                setDrawer({ kind: 'matter', matter: m });
              }}
              onCancel={closeDrawer}
            />
          )}
          {drawer.kind === 'booking' && (
            <BookingForm
              appointment={drawer.appointment}
              presetContactId={drawer.presetContactId}
              presetMatterId={drawer.presetMatterId}
              contacts={contacts}
              onSaved={saved}
              onCancel={closeDrawer}
            />
          )}
          {drawer.kind === 'contact-form' && (
            <ContactForm
              contact={drawer.contact}
              onSaved={(c) => {
                reload();
                setDrawer({ kind: 'contact', contactId: c.id });
              }}
              onCancel={closeDrawer}
            />
          )}
          {drawer.kind === 'log-call' && (
            <LogCallForm
              contactId={drawer.contactId}
              presetMatterId={drawer.presetMatterId}
              contacts={contacts}
              onSaved={saved}
              onCancel={closeDrawer}
            />
          )}
          {drawer.kind === 'log-email' && (
            <LogEmailForm
              contactId={drawer.contactId}
              presetMatterId={drawer.presetMatterId}
              presetTo={drawer.presetTo}
              presetSubject={drawer.presetSubject}
              presetBody={drawer.presetBody}
              contacts={contacts}
              onSaved={saved}
              onCancel={closeDrawer}
            />
          )}
          {drawer.kind === 'note' && (
            <NoteForm
              contactId={drawer.contactId}
              presetMatterId={drawer.presetMatterId}
              contacts={contacts}
              onSaved={saved}
              onCancel={closeDrawer}
            />
          )}
          {drawer.kind === 'dedupe' && (
            <DedupeView contacts={contacts} onChanged={reload} />
          )}
          {drawer.kind === 'edit-interaction' && (
            <EditInteractionForm
              interaction={drawer.interaction}
              onSaved={saved}
              onCancel={closeDrawer}
            />
          )}
        </Drawer>
      )}

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} onSelect={onSearchSelect} />
    </div>
  );
}

function drawerTitle(drawer: NonNullable<DrawerState>, contact?: Contact): string {
  switch (drawer.kind) {
    case 'contact':
      return contact?.name ?? 'Contact';
    case 'appointment':
      return 'Appointment';
    case 'matter':
      return drawer.matter.title || 'Matter';
    case 'matter-form':
      return drawer.matter ? 'Edit matter' : 'New matter';
    case 'booking':
      return drawer.appointment ? 'Edit booking' : 'New booking';
    case 'contact-form':
      return drawer.contact?.id ? 'Edit contact' : 'New contact';
    case 'log-call':
      return 'Log call';
    case 'log-email':
      return 'Log email';
    case 'note':
      return 'Quick note';
    case 'edit-interaction':
      return 'Edit entry';
    case 'dedupe':
      return 'Possible duplicates';
  }
}

function fmtLine(iso: string): string {
  const d = parseISO(iso);
  return isValid(d) ? format(d, 'MMM d, yyyy · h:mm a') : iso;
}

function ContactDrawerBody({
  contactId,
  contacts,
  reloadKey,
  onChanged,
  onEdit,
  onLogCall,
  onLogEmail,
  onNote,
  onOpenAppointment,
  onOpenMatter,
  onOpenDesk,
  onDeleted,
}: {
  contactId: string;
  contacts: Contact[];
  reloadKey: number;
  onChanged: () => void;
  onEdit: (c: Contact) => void;
  onLogCall: (id: string) => void;
  onLogEmail: (id: string) => void;
  onNote: (id: string) => void;
  onOpenAppointment: (a: Appointment) => void;
  onOpenMatter: (m: Matter) => void;
  onOpenDesk: (id: string) => void;
  onDeleted: () => void;
}) {
  const contact = contacts.find((c) => c.id === contactId);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [matters, setMatters] = useState<Matter[]>([]);

  useEffect(() => {
    const store = getStore();
    store.listInteractions(contactId).then(setInteractions).catch(() => setInteractions([]));
    store
      .listAppointments()
      .then((all) => setAppointments(all.filter((a) => a.contact_id === contactId)))
      .catch(() => setAppointments([]));
    store.listMatters(contactId).then(setMatters).catch(() => setMatters([]));
  }, [contactId, reloadKey]);

  if (!contact) {
    return <p className="py-8 text-center text-sm text-gray-400">Contact not found.</p>;
  }

  const customFields = contact.plugin_data?.custom_fields;
  const customEntries =
    customFields && typeof customFields === 'object' && !Array.isArray(customFields)
      ? Object.entries(customFields as Record<string, unknown>).filter(
          ([k, v]) => k && typeof v === 'string' && v,
        )
      : [];

  const websiteHref = contact.website
    ? /^https?:\/\//i.test(contact.website)
      ? contact.website
      : `https://${contact.website}`
    : null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {(contact.kind || contact.status) && (
          <p className="text-sm font-medium text-gray-500">
            {[contact.kind, (contact.status ?? '').replaceAll('_', ' ')]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
        {contact.org && <p className="text-base text-gray-700">{contact.org}</p>}
        {contact.role && <p className="text-sm text-gray-500">{contact.role}</p>}
        {contact.phone && (
          <a href={`tel:${contact.phone}`} className="block text-base text-indigo-600">
            {contact.phone}
          </a>
        )}
        {contact.email && (
          <a href={`mailto:${contact.email}`} className="block text-base text-indigo-600">
            {contact.email}
          </a>
        )}
        {contact.address && <p className="text-sm text-gray-500">{contact.address}</p>}
        {websiteHref && (
          <a
            href={websiteHref}
            target="_blank"
            rel="noreferrer"
            className="block text-base text-indigo-600"
          >
            {contact.website}
          </a>
        )}
        {contact.tags.length > 0 && (
          <p className="text-sm text-gray-500">{contact.tags.join(', ')}</p>
        )}
      </div>
      {customEntries.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Details
          </h3>
          <dl className="space-y-1">
            {customEntries.map(([label, value]) => (
              <div key={label} className="text-sm text-gray-700">
                <span className="font-medium">{label}:</span> {String(value)}
              </div>
            ))}
          </dl>
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        <ActionChip onClick={() => onLogCall(contact.id)}>Log call</ActionChip>
        <ActionChip onClick={() => onNote(contact.id)}>Note</ActionChip>
        <ActionChip onClick={() => onLogEmail(contact.id)}>Log email</ActionChip>
        <ActionChip onClick={() => onEdit(contact)}>Edit</ActionChip>
        <ActionChip onClick={() => downloadVCard(contact)}>vCard</ActionChip>
        <ActionChip onClick={() => onOpenDesk(contact.id)}>Open desk</ActionChip>
      </div>
      {matters.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Matters
          </h3>
          <ul className="divide-y divide-gray-100">
            {matters.map((m) => {
              const st = matterStageText(m.stage);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => onOpenMatter(m)}
                    className="flex w-full items-baseline gap-3 py-2.5 text-left"
                  >
                    <span
                      className={`min-w-0 flex-1 truncate text-base ${
                        m.stage === 'closed'
                          ? 'text-gray-400 line-through'
                          : 'font-medium text-gray-900'
                      }`}
                    >
                      {m.title}
                    </span>
                    <span className={`shrink-0 text-sm font-medium ${st.className}`}>
                      {st.text}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <AttachmentsSection entity={{ contactId: contact.id }} onChanged={onChanged} />
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Timeline
        </h3>
        <Timeline
          appointments={appointments}
          interactions={interactions}
          onOpenAppointment={onOpenAppointment}
        />
      </section>
      <button
        type="button"
        onClick={async () => {
          if (
            !window.confirm(
              `Delete ${contact.name}? Their appointments and log entries will be deleted too.`,
            )
          )
            return;
          try {
            await getStore().deleteContact(contact.id);
            onDeleted();
          } catch (e) {
            console.error('delete contact failed', e);
          }
        }}
        className="min-h-[44px] text-sm font-medium text-red-600 hover:underline"
      >
        Delete contact
      </button>
    </div>
  );
}

function AppointmentDrawerBody({
  appointment,
  contacts,
  reloadKey,
  onEdit,
  onOpenContact,
  onOpenMatter,
  onDeleted,
}: {
  appointment: Appointment;
  contacts: Contact[];
  reloadKey: number;
  onEdit: (a: Appointment) => void;
  onOpenContact: (id: string) => void;
  onOpenMatter: (m: Matter) => void;
  onDeleted: () => void;
}) {
  const contact = appointment.contact_id
    ? contacts.find((c) => c.id === appointment.contact_id)
    : undefined;
  const st = statusText(appointment.status);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [matter, setMatter] = useState<Matter | null>(null);

  useEffect(() => {
    const store = getStore();
    if (appointment.matter_id) {
      store
        .listMatters()
        .then((all) => setMatter(all.find((m) => m.id === appointment.matter_id) ?? null))
        .catch(() => setMatter(null));
    } else {
      setMatter(null);
    }
    if (!appointment.contact_id) return;
    store
      .listInteractions(appointment.contact_id)
      .then(setInteractions)
      .catch(() => setInteractions([]));
    store
      .listAppointments()
      .then((all) =>
        setAppointments(all.filter((a) => a.contact_id === appointment.contact_id)),
      )
      .catch(() => setAppointments([]));
  }, [appointment.contact_id, appointment.matter_id, reloadKey]);

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <p className="text-lg font-semibold text-gray-900">{appointment.title}</p>
        <p className="text-sm text-gray-500">
          {fmtLine(appointment.starts_at)} – {format(parseISO(appointment.ends_at), 'h:mm a')}
        </p>
        <p className={`text-sm font-medium ${st.className}`}>{st.text}</p>
        {matter && (
          <button
            type="button"
            onClick={() => onOpenMatter(matter)}
            className="block text-sm text-gray-400 hover:text-indigo-600"
          >
            · {matter.title}
          </button>
        )}
        {contact && (
          <button
            type="button"
            onClick={() => onOpenContact(contact.id)}
            className="text-sm text-indigo-600 hover:underline"
          >
            {contact.name}
          </button>
        )}
      </div>
      <div>
        <ActionChip onClick={() => onEdit(appointment)}>Edit booking</ActionChip>
      </div>
      {contact && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Timeline — {contact.name}
          </h3>
          <Timeline appointments={appointments} interactions={interactions} />
        </section>
      )}
      <button
        type="button"
        onClick={async () => {
          if (
            !window.confirm('Delete this booking? Log entries will be kept but unlinked.')
          )
            return;
          try {
            await getStore().deleteAppointment(appointment.id);
            onDeleted();
          } catch (e) {
            console.error('delete appointment failed', e);
          }
        }}
        className="min-h-[44px] text-sm font-medium text-red-600 hover:underline"
      >
        Delete
      </button>
    </div>
  );
}

function MatterDrawerBody({
  matter,
  contacts,
  reloadKey,
  onChanged,
  onEdit,
  onOpenContact,
  onOpenAppointment,
  onLogCall,
  onNote,
  onLogEmail,
  onBook,
  onDeleted,
}: {
  matter: Matter;
  contacts: Contact[];
  reloadKey: number;
  onChanged: () => void;
  onEdit: (m: Matter) => void;
  onOpenContact: (id: string) => void;
  onOpenAppointment: (a: Appointment) => void;
  onLogCall: (contactId: string | undefined, matterId: string) => void;
  onNote: (contactId: string | undefined, matterId: string) => void;
  onLogEmail: (contactId: string | undefined, matterId: string) => void;
  onBook: (contactId: string | undefined, matterId: string) => void;
  onDeleted: () => void;
}) {
  const contact = matter.contact_id
    ? contacts.find((c) => c.id === matter.contact_id)
    : undefined;
  const st = matterStageText(matter.stage);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const cid = matter.contact_id ?? undefined;

  useEffect(() => {
    const store = getStore();
    store
      .listInteractions()
      .then((all) => setInteractions(all.filter((i) => i.matter_id === matter.id)))
      .catch(() => setInteractions([]));
    store
      .listAppointments()
      .then((all) => setAppointments(all.filter((a) => a.matter_id === matter.id)))
      .catch(() => setAppointments([]));
  }, [matter.id, reloadKey]);

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <p className="text-lg font-semibold text-gray-900">{matter.title}</p>
        <p className={`text-sm font-medium ${st.className}`}>{st.text}</p>
        {contact && (
          <button
            type="button"
            onClick={() => onOpenContact(contact.id)}
            className="text-sm text-indigo-600 hover:underline"
          >
            {contact.name}
          </button>
        )}
        <p className="text-sm text-gray-500">
          Opened {fmtLine(matter.opened_at)}
          {matter.closed_at ? ` · Closed ${fmtLine(matter.closed_at)}` : ''}
        </p>
        {matter.summary && (
          <p className="whitespace-pre-wrap text-sm text-gray-600">{matter.summary}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <ActionChip onClick={() => onLogCall(cid, matter.id)}>Log call</ActionChip>
        <ActionChip onClick={() => onNote(cid, matter.id)}>Note</ActionChip>
        <ActionChip onClick={() => onLogEmail(cid, matter.id)}>Log email</ActionChip>
        <ActionChip onClick={() => onBook(cid, matter.id)}>Book</ActionChip>
        <ActionChip onClick={() => onEdit(matter)}>Edit matter</ActionChip>
      </div>
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Linked
        </h3>
        <Timeline
          appointments={appointments}
          interactions={interactions}
          onOpenAppointment={onOpenAppointment}
        />
      </section>
      <AttachmentsSection entity={{ matterId: matter.id }} onChanged={onChanged} />
      <button
        type="button"
        onClick={async () => {
          if (
            !window.confirm(
              'Delete this matter? Linked bookings and log entries will be kept but unlinked.',
            )
          )
            return;
          try {
            await getStore().deleteMatter(matter.id);
            onDeleted();
          } catch (e) {
            console.error('delete matter failed', e);
          }
        }}
        className="min-h-[44px] text-sm font-medium text-red-600 hover:underline"
      >
        Delete matter
      </button>
    </div>
  );
}

function ActionChip({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50"
    >
      {children}
    </button>
  );
}
