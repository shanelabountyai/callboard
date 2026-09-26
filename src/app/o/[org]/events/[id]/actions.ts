'use server';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/core/audit';
import { orgAction, ref } from '@/core/authz/action';
import { inOrg, notFoundOnP2025, type OrgCtx } from '@/core/authz/guards';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { ensurePersonLink } from '@/lib/links';
import { notify } from '@/lib/messages';
import { must } from '@/lib/refuse';
import { drainOutbox } from '@/modules/notifications/outbox';
import { isHm, ymd, zonedToUtc } from '@/lib/time';

// The event's structure (PRD 1, PRD 2): days, AoRs and leads, areas, positions, shifts.
const page = (ctx: OrgCtx, eventId: string) => `/o/${ctx.slug}/events/${eventId}`;
const optionalRef = (model: string) => z.union([ref(model), z.literal('')]);
const int = (min: number, msg: string) => z.coerce.number().int().min(min, msg);

export const setStatus = orgAction(null, z.object({ id: ref('event'), status: z.enum(['draft', 'staffing', 'confirmed', 'live', 'closed']) }), async (ctx, i) => {
  await db.event.update({ where: { id: i.id, ...inOrg(ctx) }, data: { status: i.status } }).catch(notFoundOnP2025);
  await audit(ctx, 'event.status', { targetType: 'event', targetId: i.id, data: { status: i.status } });
  redirect(page(ctx, i.id));
});

export const setEventDefaults = orgAction(
  null,
  z.object({ id: ref('event'), callOffsetMin: int(0, 'Call offset cannot be negative.'), graceMin: int(0, 'Grace cannot be negative.') }),
  async (ctx, i) => {
    await db.event.update({ where: { id: i.id, ...inOrg(ctx) }, data: { callOffsetMin: i.callOffsetMin, graceMin: i.graceMin } }).catch(notFoundOnP2025);
    redirect(page(ctx, i.id));
  },
);

export const addAor = orgAction(
  null,
  z.object({ eventId: ref('event'), name: z.string().trim().min(1, 'Name the area of responsibility.').max(80), color: z.string().trim().max(9).default('#4f46e5'), radioChannel: z.string().trim().max(20).default('') }),
  async (ctx, i) => {
    must(await db.event.findFirst({ where: { id: i.eventId, ...inOrg(ctx) }, select: { id: true } }));
    const a = await db.aor.create({ data: { ...inOrg(ctx), eventId: i.eventId, name: i.name, color: i.color, radioChannel: i.radioChannel } });
    await audit(ctx, 'aor.created', { targetType: 'aor', targetId: a.id });
    redirect(page(ctx, i.eventId));
  },
);

/** Lead and deputy come from the directory; a lead needs no account, only a mobile (PRD 2). A newly named lead or deputy gets their roster link at once. */
export const setAorLead = orgAction(null, z.object({ id: ref('aor'), leadId: optionalRef('person'), deputyId: optionalRef('person') }), async (ctx, i) => {
  const aor = must(await db.aor.findFirst({ where: { id: i.id, ...inOrg(ctx) }, include: { event: { include: { days: { orderBy: { date: 'desc' }, take: 1 } } } } }));
  const people = await db.person.findMany({ where: { id: { in: [i.leadId, i.deputyId].filter(Boolean) }, ...inOrg(ctx) } });
  for (const pid of [i.leadId, i.deputyId]) if (pid && !people.some((p) => p.id === pid)) notFound();
  if (i.leadId && i.leadId === i.deputyId) throw new Refused('Lead and deputy must be different people.');
  const lastDay = aor.event.days[0]?.date ?? new Date();
  const expiresAt = new Date(lastDay.getTime() + 8 * 86_400_000);
  await db.$transaction(async (tx) => {
    await tx.aor.update({ where: { id: i.id }, data: { leadId: i.leadId || null, deputyId: i.deputyId || null } });
    for (const pid of [i.leadId, i.deputyId]) {
      const p = pid && pid !== aor.leadId && pid !== aor.deputyId ? people.find((x) => x.id === pid) : undefined;
      if (!p) continue;
      const url = await ensurePersonLink(tx, { orgId: ctx.orgId, eventId: aor.eventId, personId: p.id }, expiresAt);
      await notify(tx, ctx.orgId, p, 'cb_lead', { name: p.name.split(' ')[0] ?? p.name, event: aor.event.name, aor: aor.name, url });
    }
    await audit(ctx, 'aor.lead_set', { targetType: 'aor', targetId: i.id, data: { leadId: i.leadId || null, deputyId: i.deputyId || null } }, tx);
  });
  await drainOutbox(5);
  redirect(page(ctx, aor.eventId));
});

export const deleteAor = orgAction(null, z.object({ id: ref('aor') }), async (ctx, { id }) => {
  const aor = must(await db.aor.findFirst({ where: { id, ...inOrg(ctx) }, select: { eventId: true } }));
  await db.aor.delete({ where: { id, ...inOrg(ctx) } }).catch(notFoundOnP2025); // areas fall back to ungrouped
  redirect(page(ctx, aor.eventId));
});

export const addArea = orgAction(
  null,
  z.object({ eventId: ref('event'), name: z.string().trim().min(1, 'Name the area.').max(80), location: z.string().trim().max(200).default(''), aorId: optionalRef('aor') }),
  async (ctx, i) => {
    must(await db.event.findFirst({ where: { id: i.eventId, ...inOrg(ctx) }, select: { id: true } }));
    if (i.aorId) must(await db.aor.findFirst({ where: { id: i.aorId, ...inOrg(ctx), eventId: i.eventId }, select: { id: true } }));
    await db.area.create({ data: { ...inOrg(ctx), eventId: i.eventId, name: i.name, location: i.location, aorId: i.aorId || null } });
    redirect(page(ctx, i.eventId));
  },
);

export const setAreaAor = orgAction(null, z.object({ id: ref('area'), aorId: optionalRef('aor') }), async (ctx, i) => {
  const area = must(await db.area.findFirst({ where: { id: i.id, ...inOrg(ctx) }, select: { eventId: true } }));
  if (i.aorId) must(await db.aor.findFirst({ where: { id: i.aorId, ...inOrg(ctx), eventId: area.eventId }, select: { id: true } }));
  await db.area.update({ where: { id: i.id, ...inOrg(ctx) }, data: { aorId: i.aorId || null } });
  redirect(page(ctx, area.eventId));
});

export const deleteArea = orgAction(null, z.object({ id: ref('area') }), async (ctx, { id }) => {
  const area = must(await db.area.findFirst({ where: { id, ...inOrg(ctx) }, select: { eventId: true, _count: { select: { positions: true } } } }));
  if (area._count.positions) throw new Refused('Remove the area’s positions first.');
  await db.area.delete({ where: { id, ...inOrg(ctx) } }).catch(notFoundOnP2025);
  redirect(page(ctx, area.eventId));
});

export const addPosition = orgAction(
  null,
  z.object({
    areaId: ref('area'),
    name: z.string().trim().min(1, 'Name the position.').max(80),
    minHeadcount: int(0, 'Minimum cannot be negative.'),
    targetHeadcount: int(1, 'Target must be at least 1.'),
    uniform: z.string().trim().max(200).default(''),
    brief: z.string().trim().max(4000).default(''),
  }),
  async (ctx, i) => {
    const area = must(await db.area.findFirst({ where: { id: i.areaId, ...inOrg(ctx) }, select: { eventId: true } }));
    if (i.minHeadcount > i.targetHeadcount) throw new Refused('Minimum cannot exceed target.');
    const { areaId, ...rest } = i;
    await db.position.create({ data: { ...inOrg(ctx), eventId: area.eventId, areaId, ...rest } });
    redirect(page(ctx, area.eventId));
  },
);

export const deletePosition = orgAction(null, z.object({ id: ref('position') }), async (ctx, { id }) => {
  const p = must(await db.position.findFirst({ where: { id, ...inOrg(ctx) }, select: { eventId: true, _count: { select: { shifts: true } } } }));
  if (p._count.shifts) throw new Refused('Remove the position’s shifts first.');
  await db.position.delete({ where: { id, ...inOrg(ctx) } }).catch(notFoundOnP2025);
  redirect(page(ctx, p.eventId));
});

/** One shift, or the same pattern on every day of the event. Call time comes from the offset, never typed twice. */
export const addShift = orgAction(
  null,
  z.object({
    positionId: ref('position'),
    dayId: z.union([ref('eventDay'), z.literal('all')]),
    start: z.string().trim().min(1, 'Start time is required.'),
    end: z.string().trim().min(1, 'End time is required.'),
    needed: int(1, 'Needed must be at least 1.'),
    callOffsetMin: int(0, 'Call offset cannot be negative.'),
    overbookPct: int(0, 'Overbook cannot be negative.').default(20),
  }),
  async (ctx, i) => {
    // Rows first, values second: "not yours" must win over "bad input" (INV-02/03).
    const position = must(await db.position.findFirst({ where: { id: i.positionId, ...inOrg(ctx) }, include: { event: { include: { days: true } } } }));
    const days = i.dayId === 'all' ? position.event.days : [must(position.event.days.find((d) => d.id === i.dayId))];
    if (!isHm(i.start) || !isHm(i.end)) throw new Refused('Times must be HH:MM (24-hour).');
    const tz = position.event.timezone;
    await db.$transaction(
      days.map((d) => {
        const startAt = zonedToUtc(ymd(d.date), i.start, tz);
        let endAt = zonedToUtc(ymd(d.date), i.end, tz);
        if (endAt <= startAt) endAt = new Date(endAt.getTime() + 86_400_000); // crosses midnight: belongs to the day it starts
        return db.shift.create({
          data: { ...inOrg(ctx), eventId: position.eventId, positionId: position.id, dayId: d.id, startAt, endAt, callAt: new Date(startAt.getTime() - i.callOffsetMin * 60_000), needed: i.needed, overbookPct: i.overbookPct },
        });
      }),
    );
    redirect(page(ctx, position.eventId));
  },
);

export const deleteShift = orgAction(null, z.object({ id: ref('shift') }), async (ctx, { id }) => {
  const s = must(await db.shift.findFirst({ where: { id, ...inOrg(ctx) }, select: { eventId: true, _count: { select: { assignments: true } } } }));
  if (s._count.assignments) throw new Refused('Release the people on this shift first (Staff page).');
  await db.shift.delete({ where: { id, ...inOrg(ctx) } }).catch(notFoundOnP2025);
  redirect(page(ctx, s.eventId));
});
