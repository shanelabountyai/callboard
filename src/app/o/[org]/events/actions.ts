'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/core/audit';
import { orgAction, ref } from '@/core/authz/action';
import { inOrg, type OrgCtx } from '@/core/authz/guards';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { must } from '@/lib/refuse';
import { isYmd, ymd } from '@/lib/time';

const eventPage = (ctx: OrgCtx, id: string) => `/o/${ctx.slug}/events/${id}`;
const DAY = 86_400_000;

function validTz(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The days from `from` to `to` inclusive, as UTC-midnight dates for a @db.Date column. */
function daysBetween(from: string, to: string): Date[] {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!isYmd(from) || !isYmd(to)) throw new Refused('Dates must be YYYY-MM-DD.');
  if (b < a) throw new Refused('The end date is before the start date.');
  if (b - a > 14 * DAY) throw new Refused('An event can span at most 15 days.');
  return Array.from({ length: (b - a) / DAY + 1 }, (_, i) => new Date(a + i * DAY));
}

export const createEvent = orgAction(
  null,
  z.object({
    name: z.string().trim().min(1, 'Give the event a name.').max(120),
    venue: z.string().trim().max(200).default(''),
    timezone: z.string().trim().min(1).default('America/Chicago'),
    startsOn: z.string().trim().min(1, 'Start date is required.'),
    endsOn: z.string().trim().min(1, 'End date is required.'),
  }),
  async (ctx, i) => {
    if (!validTz(i.timezone)) throw new Refused('Timezone must be an IANA name like America/Chicago.');
    const days = daysBetween(i.startsOn, i.endsOn);
    const e = await db.event.create({
      data: { ...inOrg(ctx), name: i.name, venue: i.venue, timezone: i.timezone, days: { create: days.map((date) => ({ ...inOrg(ctx), date })) } },
    });
    await audit(ctx, 'event.created', { targetType: 'event', targetId: e.id });
    redirect(eventPage(ctx, e.id));
  },
);

/**
 * Start a new event from an existing one (PRD 1's "template" in phase 1): days, AoRs with their
 * leads, areas, positions and shifts come across with every date shifted; assignments do not.
 */
export const duplicateEvent = orgAction(
  null,
  z.object({ id: ref('event'), name: z.string().trim().min(1, 'Give the new event a name.').max(120), startsOn: z.string().trim().min(1, 'Start date is required.') }),
  async (ctx, i) => {
    const src = must(
      await db.event.findFirst({
        where: { id: i.id, ...inOrg(ctx) },
        include: { days: { orderBy: { date: 'asc' } }, aors: true, areas: true, positions: true, shifts: true },
      }),
    );
    if (!isYmd(i.startsOn)) throw new Refused('Start date must be YYYY-MM-DD.');
    const firstDay = src.days[0]?.date ?? new Date(i.startsOn);
    const delta = Date.parse(i.startsOn) - firstDay.getTime(); // ponytail: a DST boundary between the two events shifts wall times an hour; the planner sees it on the new event's page
    const id = await db.$transaction(async (tx) => {
      const e = await tx.event.create({ data: { ...inOrg(ctx), name: i.name, venue: src.venue, timezone: src.timezone, callOffsetMin: src.callOffsetMin, graceMin: src.graceMin } });
      const dayIds = new Map<string, string>();
      for (const d of src.days) dayIds.set(d.id, (await tx.eventDay.create({ data: { ...inOrg(ctx), eventId: e.id, date: new Date(d.date.getTime() + delta) } })).id);
      const aorIds = new Map<string, string>();
      for (const a of src.aors) {
        const { id: oldId, ...rest } = a;
        aorIds.set(oldId, (await tx.aor.create({ data: { ...rest, eventId: e.id } })).id);
      }
      const areaIds = new Map<string, string>();
      for (const a of src.areas) {
        const { id: oldId, aorId, ...rest } = a;
        areaIds.set(oldId, (await tx.area.create({ data: { ...rest, eventId: e.id, aorId: aorId ? aorIds.get(aorId) : null } })).id);
      }
      const positionIds = new Map<string, string>();
      for (const p of src.positions) {
        const { id: oldId, areaId, ...rest } = p;
        positionIds.set(oldId, (await tx.position.create({ data: { ...rest, eventId: e.id, areaId: areaIds.get(areaId)! } })).id);
      }
      for (const s of src.shifts) {
        const { positionId, dayId, callAt, startAt, endAt, needed, overbookPct } = s;
        await tx.shift.create({
          data: {
            ...inOrg(ctx), needed, overbookPct, eventId: e.id, positionId: positionIds.get(positionId)!, dayId: dayIds.get(dayId)!,
            callAt: new Date(callAt.getTime() + delta), startAt: new Date(startAt.getTime() + delta), endAt: new Date(endAt.getTime() + delta),
          },
        });
      }
      await audit(ctx, 'event.duplicated', { targetType: 'event', targetId: e.id, data: { from: src.id, firstDay: ymd(firstDay) } }, tx);
      return e.id;
    });
    redirect(eventPage(ctx, id));
  },
);
