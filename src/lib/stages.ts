import { now } from '@/core/clock';
import { db } from '@/core/db';
import type { EventStatus } from '@/generated/prisma/enums';
import { ymd, zonedToUtc } from './time';

// The planner's stages: Planning, Staffing, Running, Closed. The planner opens and closes; running is
// never set by hand. "confirmed" is no longer offered; a row that holds it reads as Staffing.
export const STAGE: Record<EventStatus, string> = { draft: 'Planning', staffing: 'Staffing', confirmed: 'Staffing', live: 'Running', closed: 'Closed' };
const OPEN: EventStatus[] = ['staffing', 'confirmed'];

type Dated = { status: EventStatus; timezone: string; days: { date: Date }[] };
const firstDay = (e: Dated) => e.days.reduce<Date | null>((min, d) => (!min || d.date < min ? d.date : min), null);
/** Open for staffing and past the start of its first day, in its own timezone. */
const due = (e: Dated, t: Date) => {
  const d = OPEN.includes(e.status) && firstDay(e);
  return !!d && zonedToUtc(ymd(d), '00:00', e.timezone) <= t;
};

/** The stage to show. It does not wait for the cron: an event that is due reads as Running at once. */
export const stageOf = (e: Dated, t = now()) => STAGE[due(e, t) ? 'live' : e.status];

/**
 * Moves every event that is due to live, which freezes its job descriptions, lead notes and defaults.
 * The cron calls it, and so does anything that reads the freeze, so the freeze never waits for a tick.
 */
export async function startDue(orgId?: string): Promise<number> {
  const t = now();
  // 14 hours: the furthest a timezone's midnight runs ahead of the UTC date the day is stored as.
  const near = await db.event.findMany({
    where: { ...(orgId && { orgId }), isTemplate: false, status: { in: OPEN }, days: { some: { date: { lte: new Date(t.getTime() + 14 * 3_600_000) } } } },
    select: { id: true, status: true, timezone: true, days: { select: { date: true } } },
  });
  const ids = near.filter((e) => due(e, t)).map((e) => e.id);
  if (!ids.length) return 0;
  return (await db.event.updateMany({ where: { id: { in: ids }, status: { in: OPEN } }, data: { status: 'live' } })).count;
}
