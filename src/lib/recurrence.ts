import { addDays, addMonths, format } from 'date-fns';
import type { Appointment, RecurRule } from '../types';

// Recurring appointments (simple, honest):
// - The stored row IS the series anchor (occurrence #0). It is never
//   duplicated in storage — expandAppointments() materializes occurrences
//   in memory for a view window only.
// - Emitted occurrences keep the series id and get occurrence_of set;
//   series_starts_at/series_ends_at carry the anchor times so status
//   toggles don't re-anchor the series to the clicked occurrence.
// - Edits, deletes, and status changes apply to the whole series.
// - Conflict checks expand both sides: a candidate (recurring or not) is
//   checked occurrence-by-occurrence against the expanded occurrences of
//   every stored row over a bounded horizon (findSeriesConflicts below).

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_OCCURRENCES = 200;
// An open-ended series is conflict-checked ~2 years out. That covers every
// real cadence combination (the slowest beat is monthly — 24 occurrences);
// clashes that would only begin further out are reported as "no conflict"
// and surface naturally as the calendar fills. Honest bound, not infinity.
const CONFLICT_HORIZON_DAYS = 370 * 2;

function stepDate(d: Date, rule: RecurRule, n: number): Date {
  switch (rule) {
    case 'daily':
      return addDays(d, n);
    case 'weekly':
      return addDays(d, 7 * n);
    case 'biweekly':
      return addDays(d, 14 * n);
    case 'monthly':
      return addMonths(d, n);
  }
}

// Rough index of the first occurrence that could still intersect `from`,
// so a forever series anchored long ago doesn't iterate day-by-day.
function firstCandidateIndex(start: Date, from: Date, rule: RecurRule): number {
  const diffMs = from.getTime() - start.getTime();
  let n = 0;
  if (rule === 'monthly') {
    n =
      (from.getFullYear() - start.getFullYear()) * 12 +
      (from.getMonth() - start.getMonth());
  } else {
    const days = rule === 'daily' ? 1 : rule === 'weekly' ? 7 : 14;
    n = Math.floor(diffMs / (days * DAY_MS));
  }
  // Back off a couple of steps: occurrences starting before `from` can
  // still overlap it, and month-length arithmetic is approximate.
  return Math.max(0, n - 2);
}

export function expandAppointments(
  appts: Appointment[],
  from: Date,
  to: Date,
): Appointment[] {
  const out: Appointment[] = [];
  const fromMs = from.getTime();
  const toMs = to.getTime();

  for (const a of appts) {
    const rule = a.recur_rule ?? null;
    if (!rule) {
      out.push(a); // plain appointment — pass through untouched
      continue;
    }
    const anchorStart = new Date(a.starts_at);
    const anchorEnd = new Date(a.ends_at);
    const durationMs = anchorEnd.getTime() - anchorStart.getTime();
    const until = a.recur_until ?? null; // 'YYYY-MM-DD' or null = forever

    let n = firstCandidateIndex(anchorStart, from, rule);
    let emitted = 0;
    while (emitted < MAX_OCCURRENCES) {
      const start = stepDate(anchorStart, rule, n);
      if (until && format(start, 'yyyy-MM-dd') > until) break;
      if (start.getTime() > toMs) break;
      const end = new Date(start.getTime() + durationMs);
      if (end.getTime() >= fromMs && start.getTime() <= toMs) {
        out.push(
          n === 0
            ? a
            : {
                ...a,
                starts_at: start.toISOString(),
                ends_at: end.toISOString(),
                occurrence_of: a.id,
                series_starts_at: a.starts_at,
                series_ends_at: a.ends_at,
              },
        );
        emitted += 1;
      }
      n += 1;
    }
  }
  return out.sort((x, y) => x.starts_at.localeCompare(y.starts_at));
}

// What the booking form is trying to save — stored-row fields plus an
// optional series rule. `id` lets an edit exclude the row it replaces.
export interface ConflictCandidate {
  id?: string;
  starts_at: string;
  ends_at: string;
  recur_rule?: RecurRule | null;
  recur_until?: string | null;
}

/**
 * Series-aware conflict check. Expands the candidate and every non-canceled
 * stored row over a common window, then reports each clashing stored
 * occurrence (series clashes report the occurrence, not just the anchor, so
 * the user sees WHEN it collides). Capped at 8 reported clashes.
 *
 * Window: a non-recurring candidate checks only its own span; a recurring
 * candidate checks from its start to its `recur_until` or CONFLICT_HORIZON_DAYS
 * out, whichever is first.
 */
export function findSeriesConflicts(
  candidate: ConflictCandidate,
  existing: Appointment[],
): Appointment[] {
  const start = new Date(candidate.starts_at);
  const end = new Date(candidate.ends_at);
  const horizonEnd = candidate.recur_rule
    ? candidate.recur_until
      ? new Date(
          Math.min(
            addDays(start, CONFLICT_HORIZON_DAYS).getTime(),
            // Check through the whole until-day, not just its midnight.
            addDays(new Date(`${candidate.recur_until}T00:00:00`), 1).getTime(),
          ),
        )
      : addDays(start, CONFLICT_HORIZON_DAYS)
    : end;

  const pseudo: Appointment = {
    id: candidate.id ?? '__candidate__',
    user_id: '',
    contact_id: null,
    title: '',
    starts_at: candidate.starts_at,
    ends_at: candidate.ends_at,
    status: 'scheduled',
    recur_rule: candidate.recur_rule ?? null,
    recur_until: candidate.recur_until ?? null,
    plugin_data: {},
    created_at: '',
  };

  const candidateOcc = expandAppointments([pseudo], start, horizonEnd);
  const existingOcc = expandAppointments(
    existing.filter((a) => a.id !== candidate.id && a.status !== 'canceled'),
    start,
    horizonEnd,
  );
  const candSpans = candidateOcc.map(
    (c) => [new Date(c.starts_at).getTime(), new Date(c.ends_at).getTime()] as const,
  );

  const clashes: Appointment[] = [];
  for (const occ of existingOcc) {
    const oStart = new Date(occ.starts_at).getTime();
    const oEnd = new Date(occ.ends_at).getTime();
    if (candSpans.some(([s, e]) => s < oEnd && oStart < e)) {
      clashes.push(occ);
      if (clashes.length >= 8) break;
    }
  }
  return clashes;
}
