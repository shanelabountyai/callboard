import { now } from '@/core/clock';
import { db } from '@/core/db';
import { ended, outcomeOf, REVIEWABLE, shownTier, TIER_LABEL, tiersFor } from './review';

// The post-event report (PRD 6): what was planned against what happened, built on read from check-in,
// alerts, help requests and reviews. Nothing is stored, so it can never disagree with its sources and a
// late review changes it the next time it is opened.
const HOUR = 3_600_000;

type CovShift = { startAt: Date; endAt: Date; needed: number; position: { id: string; minHeadcount: number }; assignments: { checkedInAt: Date | null; checkedOutAt: Date | null }[] };
export type Hour = { at: Date; planned: number; min: number; actual: number };

/**
 * Coverage hour by hour. ponytail: each hour is read at its middle (8:30 stands for 8 to 9), so a gap
 * shorter than an hour can hide; sample every 15 minutes if planners ask when exactly a position went short.
 * Hours sit on the UTC hour, which is the local hour everywhere except the half-hour timezones.
 */
export function coverage(shifts: CovShift[]): Hour[] {
  if (!shifts.length) return [];
  const from = Math.floor(Math.min(...shifts.map((s) => s.startAt.getTime())) / HOUR) * HOUR;
  const to = Math.max(...shifts.map((s) => s.endAt.getTime()));
  const hours: Hour[] = [];
  for (let h = from; h < to; h += HOUR) {
    const mid = h + HOUR / 2;
    const on = shifts.filter((s) => s.startAt.getTime() <= mid && mid < s.endAt.getTime());
    if (!on.length) continue; // overnight, or the gap between two days
    hours.push({
      at: new Date(h),
      planned: on.reduce((n, s) => n + s.needed, 0),
      min: [...new Map(on.map((s) => [s.position.id, s.position.minHeadcount])).values()].reduce((n, m) => n + m, 0),
      actual: on.flatMap((s) => s.assignments).filter((a) => a.checkedInAt && a.checkedInAt.getTime() <= mid && (!a.checkedOutAt || a.checkedOutAt.getTime() > mid)).length,
    });
  }
  return hours;
}

export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : null;
};
const tally = <T>(rows: T[], key: (r: T) => string) => [...rows.reduce((m, r) => m.set(key(r), (m.get(key(r)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
const rate = <T extends { outcome: string }>(rows: T[], key: (r: T) => string) =>
  [...new Set(rows.map(key))].sort().map((k) => {
    const mine = rows.filter((r) => key(r) === k);
    return { group: k, people: mine.length, noShows: mine.filter((r) => r.outcome === 'no_show').length };
  });

export async function buildReport(scope: { orgId: string; eventId: string }) {
  const [areas, worked, alerts] = await Promise.all([
    db.area.findMany({
      where: scope, orderBy: { name: 'asc' },
      include: { aor: true, review: true, positions: { include: { shifts: { include: { position: { select: { id: true, minHeadcount: true } }, assignments: { select: { checkedInAt: true, checkedOutAt: true } } } } } } },
    }),
    db.assignment.findMany({
      where: { ...scope, ...REVIEWABLE, ...ended() }, // a shift still to come is not a no-show
      include: { person: true, review: true, event: { select: { graceMin: true } }, shift: { select: { callAt: true, endAt: true, position: { select: { graceMin: true } } } } },
    }),
    db.alert.findMany({ where: scope, include: { assignment: { select: { shift: { select: { position: { select: { name: true } } } } } } }, orderBy: { openedAt: 'asc' } }),
  ]);
  // Coverage and places read ended shifts only, like the no-show count: an hour still to come is not an hour under minimum.
  const t = now();
  const over = (a: (typeof areas)[number]) => a.positions.flatMap((p) => p.shifts).filter((s) => s.endAt < t);
  const staffed = areas.filter((a) => a.positions.some((p) => p.shifts.length)).map((a) => ({ ...a, hours: coverage(over(a)) }));
  // ponytail: the tier is the person's tier today, which already counts this event; store the tier at invite time if the report must show who was a risk going in.
  const tiers = await tiersFor(scope.orgId, [...new Set(worked.map((a) => a.personId))]);
  const rows = worked.map((a) => ({ outcome: outcomeOf(a), kind: a.person.kind, tier: TIER_LABEL[shownTier(a.person, tiers).tier] }));
  const help = alerts.filter((a) => a.kind === 'help');
  return {
    areas: staffed,
    places: staffed.flatMap(over).reduce((n, s) => n + s.needed, 0),
    shifts: rows.length,
    noShows: rows.filter((r) => r.outcome === 'no_show').length,
    late: rows.filter((r) => r.outcome === 'late').length,
    help: help.length,
    byPool: rate(rows, (r) => r.kind),
    byTier: rate(rows, (r) => r.tier),
    helpByCategory: tally(help, (a) => a.category || 'other'),
    helpByPosition: tally(help, (a) => a.assignment?.shift.position.name ?? 'No shift at the time'),
    resolve: (['no_show', 'help'] as const).map((kind) => {
      const mine = alerts.filter((a) => a.kind === kind);
      const mins = mine.filter((a) => a.resolvedAt).map((a) => Math.round((a.resolvedAt!.getTime() - a.openedAt.getTime()) / 60_000));
      return { kind, raised: mine.length, open: mine.length - mins.length, reachedPlanner: mine.filter((a) => a.step >= 2).length, median: median(mins), slowest: mins.length ? Math.max(...mins) : null };
    }),
    reviews: { areas: staffed.length, reviewed: staffed.filter((a) => a.review && !a.review.waived).length, waived: staffed.filter((a) => a.review?.waived).length },
  };
}
export type Report = Awaited<ReturnType<typeof buildReport>>;
