import { format, parseISO } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import { downloadCSV } from '../../lib/csv';
import { getStore } from '../../lib/store';
import type { DrawerState } from '../../lib/uiState';
import { getEmailPlugin } from '../../services/email';
import {
  extractAddress,
  isInboxCapable,
  type InboxSyncReport,
} from '../../services/smartBrainEmail';
import type { Appointment, Contact, Interaction, InteractionType, Matter } from '../../types';
import { TaskCard } from '../TaskCard';
import { Icon, typeLabel } from '../ui';

type Filter = 'needs' | 'all' | InteractionType;

/** Display name for a `From:` value — "Name <a@b.c>" → "Name", bare
 *  address → its local part. */
function senderName(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</);
  if (m?.[1]) return m[1].trim();
  return extractAddress(from)?.split('@')[0] ?? from;
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'needs', label: 'Needs action' },
  { key: 'all', label: 'All' },
  { key: 'call', label: 'Calls' },
  { key: 'email', label: 'Emails' },
  { key: 'note', label: 'Notes' },
];

export function InboxView({
  contacts,
  reloadKey,
  onOpenDrawer,
  onChanged,
}: {
  contacts: Contact[];
  reloadKey: number;
  onOpenDrawer: (d: NonNullable<DrawerState>) => void;
  onChanged: () => void;
}) {
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [matters, setMatters] = useState<Matter[]>([]);
  const [filter, setFilter] = useState<Filter>('needs');
  const [syncTick, setSyncTick] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [lastReport, setLastReport] = useState<InboxSyncReport | null>(null);
  const plugin = getEmailPlugin();
  const canSync = isInboxCapable(plugin);

  const contactById = useMemo(
    () => new Map(contacts.map((c) => [c.id, c])),
    [contacts],
  );
  const appointmentById = useMemo(
    () => new Map(appointments.map((a) => [a.id, a])),
    [appointments],
  );
  const matterById = useMemo(() => new Map(matters.map((m) => [m.id, m])), [matters]);

  useEffect(() => {
    const store = getStore();
    store
      .listInteractions()
      .then(setInteractions)
      .catch(() => setInteractions([]));
    store
      .listAppointments()
      .then(setAppointments)
      .catch(() => setAppointments([]));
    store
      .listMatters()
      .then(setMatters)
      .catch(() => setMatters([]));
  }, [reloadKey, syncTick]);

  async function syncInbox() {
    if (!isInboxCapable(plugin) || syncing) return;
    setSyncing(true);
    setSyncNote(null);
    try {
      const report = await plugin.syncInbox();
      const parts = [`${report.logged} new`];
      if (report.held > 0) parts.push(`${report.held} held for next sync`);
      if (report.unmatched.length > 0) parts.push(`${report.unmatched.length} unmatched`);
      if (report.fetched === 0) parts.push('inbox empty');
      setSyncNote(`Synced: ${parts.join(', ')}`);
      setLastReport(report);
      setSyncTick((t) => t + 1);
    } catch (e) {
      setSyncNote(e instanceof Error ? `Sync failed: ${e.message}` : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  // Auto-sync once per tab session when this view is opened — machines log
  // what they saw; the button stays for a manual refresh, and the feed is
  // TTL-cached server-side so a refresh doesn't re-login to Gmail. Gated
  // on canSyncSilently: a not-yet-consented Gmail transport must never
  // fire a surprise OAuth popup on open.
  useEffect(() => {
    if (!canSync || !plugin.canSyncSilently()) return;
    if (sessionStorage.getItem('sb_auto_synced')) return;
    sessionStorage.setItem('sb_auto_synced', '1');
    void syncInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSync]);

  // Needs action: overdue first, then due today, then newest.
  const needsOrder = (i: Interaction): number => {
    if (!i.due_at) return 2;
    const today = format(new Date(), 'yyyy-MM-dd');
    const due = format(parseISO(i.due_at), 'yyyy-MM-dd');
    if (due < today) return 0;
    if (due === today) return 1;
    return 2;
  };

  const shown =
    filter === 'needs'
      ? interactions
          .filter((i) => (i.status ?? 'new') !== 'resolved')
          .sort(
            (a, b) => needsOrder(a) - needsOrder(b) || b.occurred_at.localeCompare(a.occurred_at),
          )
      : filter === 'all'
        ? interactions
        : interactions.filter((i) => i.type === filter);

  function exportCSV() {
    const rows = [
      [
        'type',
        'contact_name',
        'matter_title',
        'occurred_at',
        'subject_outline',
        'notes',
        'duration_sec',
        'outcome',
        'status',
        'due_at',
        'resolved_at',
      ],
      ...shown.map((i) => [
        i.type,
        i.contact_id ? (contactById.get(i.contact_id)?.name ?? '') : '',
        i.matter_id ? (matterById.get(i.matter_id)?.title ?? '') : '',
        i.occurred_at,
        i.subject_outline ?? '',
        i.notes ?? '',
        i.duration_sec != null ? String(i.duration_sec) : '',
        i.outcome ?? '',
        i.status ?? '',
        i.due_at ?? '',
        i.resolved_at ?? '',
      ]),
    ];
    downloadCSV(`interactions-${format(new Date(), 'yyyy-MM-dd')}.csv`, rows);
  }

  return (
    <div className="space-y-4">
      {canSync && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={syncInbox}
            disabled={syncing}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Icon name="mail" className="h-4 w-4" />
            {syncing ? 'Syncing…' : 'Sync inbox'}
          </button>
          {syncNote && <p className="text-sm text-gray-500">{syncNote}</p>}
        </div>
      )}
      {lastReport && lastReport.unmatched.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
          <p className="mb-2 font-medium text-gray-700">
            {lastReport.unmatched.length} sender
            {lastReport.unmatched.length === 1 ? '' : 's'} not in contacts —
            nothing was logged
          </p>
          <ul className="space-y-1.5">
            {lastReport.unmatched.slice(0, 12).map((u, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-gray-600">
                  <span className="font-medium text-gray-800">
                    {senderName(u.from)}
                  </span>
                  {u.subject && (
                    <span className="text-gray-400"> — {u.subject}</span>
                  )}
                </span>
                <button
                  type="button"
                  className="rounded border border-indigo-200 px-2 py-0.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                  onClick={() =>
                    onOpenDrawer({
                      kind: 'contact-form',
                      contact: {
                        name: senderName(u.from),
                        email: extractAddress(u.from) ?? '',
                        kind: 'other',
                        status: 'new',
                      } as Contact,
                    })
                  }
                >
                  Add contact
                </button>
              </li>
            ))}
            {lastReport.unmatched.length > 12 && (
              <li className="text-xs text-gray-400">
                +{lastReport.unmatched.length - 12} more
              </li>
            )}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1 text-sm">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`min-h-[44px] rounded-lg px-3 ${
              filter === f.key
                ? 'font-semibold text-indigo-600'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            {f.key === 'all' || f.key === 'needs' ? f.label : `${typeLabel(f.key)}s`}
          </button>
        ))}
        <button
          type="button"
          onClick={exportCSV}
          className="ml-auto inline-flex min-h-[44px] items-center rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Export
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="py-12 text-center text-gray-400">
          {filter === 'needs' ? 'Nothing needs action.' : 'Nothing logged yet.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((i) => (
            <li key={i.id}>
              <TaskCard
                interaction={i}
                contact={i.contact_id ? contactById.get(i.contact_id) : undefined}
                appointment={
                  i.appointment_id ? appointmentById.get(i.appointment_id) : undefined
                }
                matter={i.matter_id ? matterById.get(i.matter_id) : undefined}
                onOpenDrawer={onOpenDrawer}
                onChanged={onChanged}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
