'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/core/audit';
import { orgAction, ref } from '@/core/authz/action';
import { inOrg, notFoundOnP2025, type OrgCtx } from '@/core/authz/guards';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import type { Person, Prisma } from '@/generated/prisma/client';
import { latestCards } from '@/lib/cards';
import { AOR_HEX } from '@/lib/colors';
import { ensurePersonLink } from '@/lib/links';
import { notify } from '@/lib/messages';
import { must } from '@/lib/refuse';
import { openReviews, sendThanks } from '@/lib/review';
import { ruleShapeOptional } from '@/lib/rules';
import { drainOutbox } from '@/modules/notifications/outbox';
import { isHm, ymd, zonedToUtc } from '@/lib/time';

// The event's structure (PRD 1, PRD 2): locations (areas) with a lead, roles (positions) and shifts.
const page = (ctx: OrgCtx, eventId: string) => `/o/${ctx.slug}/events/${eventId}`;
const optionalRef = (model: string) => z.union([ref(model), z.literal('')]);
const int = (min: number, msg: string) => z.coerce.number().int().min(min, msg);

export const setStatus = orgAction(null, z.object({ id: ref('event'), status: z.enum(['draft', 'staffing', 'confirmed', 'live', 'closed']) }), async (ctx, i) => {
  const event = must(await db.event.findFirst({ where: { id: i.id, ...inOrg(ctx) } }));
  // The first close starts the review (PRD 6): leads get their link. Reopening and closing again does not text them twice.
  if (event.isTemplate) throw new Refused('A template is never staffed or run. Start an event from it instead.');
  const firstClose = i.status === 'closed' && !event.closedAt;
  await db.$transaction(async (tx) => {
    await tx.event.update({ where: { id: event.id }, data: { status: i.status } });
    if (firstClose) await openReviews(tx, event);
    if (firstClose) await sendThanks(tx, event);
    await audit(ctx, 'event.status', { targetType: 'event', targetId: i.id, data: { status: i.status } }, tx);
  }, { timeout: 60_000 });
  if (firstClose) await drainOutbox(25);
  redirect(i.status === 'closed' ? `${page(ctx, i.id)}/review` : page(ctx, i.id));
});

/** This event's own rules (PRD 6) and its emergency contact. A rule left out of the form stays as it is. */
export const setEventDefaults = orgAction(
  null,
  z.object({ id: ref('event'), ...ruleShapeOptional(), emergencyContact: z.string().trim().max(200).optional() }),
  async (ctx, { id, ...data }) => {
    await db.event.update({ where: { id, ...inOrg(ctx) }, data }).catch(notFoundOnP2025);
    await audit(ctx, 'event.rules', { targetType: 'event', targetId: id, data: { set: Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined) } });
    redirect(page(ctx, id));
  },
);

/** The latest version of the library card or playbook that was picked. */
const latestOf = async (ctx: OrgCtx, cardId: string) => {
  const picked = must(await db.positionCard.findFirst({ where: { id: cardId, ...inOrg(ctx) }, select: { key: true } }));
  return db.positionCard.findFirstOrThrow({ where: { ...inOrg(ctx), key: picked.key }, orderBy: { version: 'desc' }, select: { id: true } });
};
const latestPlaybookOf = async (ctx: OrgCtx, playbookId: string) => {
  const picked = must(await db.playbook.findFirst({ where: { id: playbookId, ...inOrg(ctx) }, select: { key: true } }));
  return db.playbook.findFirstOrThrow({ where: { ...inOrg(ctx), key: picked.key }, orderBy: { version: 'desc' }, select: { id: true } });
};

type Tx = Prisma.TransactionClient;
type Spot = { id: string; name: string; eventId: string; aorId: string | null };

/** A newly named lead or deputy gets their roster link at once; they need no account, only a mobile (PRD 2). */
async function welcome(tx: Tx, ctx: OrgCtx, team: { name: string; eventId: string }, p: Person) {
  const event = await tx.event.findUniqueOrThrow({ where: { id: team.eventId }, select: { name: true, days: { orderBy: { date: 'desc' }, take: 1 } } });
  const expiresAt = new Date((event.days[0]?.date ?? new Date()).getTime() + 8 * 86_400_000);
  const url = await ensurePersonLink(tx, { orgId: ctx.orgId, eventId: team.eventId, personId: p.id }, expiresAt);
  await notify(tx, ctx.orgId, p, 'cb_lead', { name: p.name.split(' ')[0] ?? p.name, event: event.name, aor: team.name, url });
}

/**
 * The planner picks a lead per location; the team (the Aor row) is kept for them. The location joins the team
 * that person already leads, or its own team takes them when it has no lead or no other location, or a new
 * team is named after the location. No lead means the location rolls up to the planner. A team left with no
 * location is removed. Returns the location's team.
 */
async function setLead(tx: Tx, ctx: OrgCtx, area: Spot, lead: Person | null) {
  const teams = await tx.aor.findMany({ where: { eventId: area.eventId, ...inOrg(ctx) }, include: { _count: { select: { areas: true } } } });
  const current = teams.find((t) => t.id === area.aorId);
  if (lead && current?.leadId === lead.id) return current;
  let team = (lead && teams.find((t) => t.leadId === lead.id)) || null;
  if (lead && !team) {
    const made =
      current && (!current.leadId || current._count.areas === 1)
        ? await tx.aor.update({ where: { id: current.id }, data: { leadId: lead.id, ...(current.deputyId === lead.id && { deputyId: null }) } })
        : await tx.aor.create({ data: { ...inOrg(ctx), eventId: area.eventId, name: area.name, color: AOR_HEX[teams.length % AOR_HEX.length]!, leadId: lead.id } });
    await welcome(tx, ctx, made, lead);
    await audit(ctx, 'aor.lead_set', { targetType: 'aor', targetId: made.id, data: { leadId: lead.id } }, tx);
    if (made.id === area.aorId) return made;
    team = { ...made, _count: { areas: 0 } };
  }
  await tx.area.update({ where: { id: area.id }, data: { aorId: team?.id ?? null } });
  if (current?._count.areas === 1) await tx.aor.delete({ where: { id: current.id } });
  return team;
}

const hm = z.string().trim().min(1, 'Start and end times are required.');
const same = (name: string) => ({ equals: name, mode: 'insensitive' as const });

/**
 * The one form: a shift, with its location and role made on the way if they are new (matched by name, any
 * case). One day or every day. Arrive-early minutes and extra invites come from the event's defaults, and a
 * new role takes the job description of the same name. A lead left blank leaves the location's lead alone.
 */
export const addShift = orgAction(
  null,
  z.object({
    eventId: ref('event'),
    location: z.string().trim().min(1, 'Say where, such as Registration.').max(80),
    role: z.string().trim().min(1, 'Name the role, such as Greeter.').max(80),
    dayId: z.union([ref('eventDay'), z.literal('all')]),
    start: hm,
    end: hm,
    needed: int(1, 'How many must be at least 1.'),
    leadId: optionalRef('person').default(''),
  }),
  async (ctx, i) => {
    // Rows first, values second: "not yours" must win over "bad input" (INV-02/03).
    const event = must(await db.event.findFirst({ where: { id: i.eventId, ...inOrg(ctx) }, include: { days: true } }));
    const days = i.dayId === 'all' ? event.days : [must(event.days.find((d) => d.id === i.dayId))];
    const lead = i.leadId ? must(await db.person.findFirst({ where: { id: i.leadId, ...inOrg(ctx) } })) : null;
    if (!isHm(i.start) || !isHm(i.end)) throw new Refused('Times must be HH:MM (24-hour).');
    const card = (await latestCards(ctx.orgId)).find((c) => c.title.toLowerCase() === i.role.toLowerCase());
    const scope = { ...inOrg(ctx), eventId: event.id };
    await db.$transaction(async (tx) => {
      const area = (await tx.area.findFirst({ where: { ...scope, name: same(i.location) } })) ?? (await tx.area.create({ data: { ...scope, name: i.location } }));
      if (lead) await setLead(tx, ctx, area, lead);
      const position =
        (await tx.position.findFirst({ where: { ...scope, areaId: area.id, name: same(i.role) } })) ??
        (await tx.position.create({ data: { ...scope, areaId: area.id, name: i.role, targetHeadcount: i.needed, cardId: card?.id ?? null } }));
      for (const d of days) {
        const startAt = zonedToUtc(ymd(d.date), i.start, event.timezone);
        let endAt = zonedToUtc(ymd(d.date), i.end, event.timezone);
        if (endAt <= startAt) endAt = new Date(endAt.getTime() + 86_400_000); // crosses midnight: belongs to the day it starts
        const callAt = new Date(startAt.getTime() - event.callOffsetMin * 60_000);
        await tx.shift.create({ data: { ...scope, positionId: position.id, dayId: d.id, startAt, endAt, callAt, needed: i.needed, overbookPct: event.overbookPct } });
      }
    });
    if (lead) await drainOutbox(5);
    redirect(page(ctx, event.id));
  },
);

const text = (max: number) => z.string().trim().max(max).optional();

/** One Save per location. A field left out of the form stays as it is; deputy and radio belong to the lead's team. */
export const saveLocation = orgAction(
  null,
  z.object({
    id: ref('area'),
    name: z.string().trim().min(1, 'Name the location.').max(80).optional(),
    location: text(200),
    leadId: optionalRef('person').optional(),
    deputyId: optionalRef('person').optional(),
    radioChannel: text(20),
    playbookId: optionalRef('playbook').optional(),
  }),
  async (ctx, { id, leadId, deputyId, radioChannel, playbookId, ...rest }) => {
    const area = must(await db.area.findFirst({ where: { id, ...inOrg(ctx) } }));
    const people = await db.person.findMany({ where: { id: { in: [leadId, deputyId].filter((x): x is string => !!x) }, ...inOrg(ctx) } });
    const person = (pid?: string) => (pid ? must(people.find((p) => p.id === pid)) : null);
    const [lead, deputy] = [person(leadId), person(deputyId)];
    const playbook = playbookId ? await latestPlaybookOf(ctx, playbookId) : null;
    await db.$transaction(async (tx) => {
      await tx.area.update({ where: { id }, data: { ...rest, ...(playbookId !== undefined && { playbookId: playbook?.id ?? null }) } });
      const team = leadId === undefined ? area.aorId && (await tx.aor.findUnique({ where: { id: area.aorId } })) : await setLead(tx, ctx, area, lead);
      if (deputy && !team) throw new Refused('Pick a lead before a deputy.');
      if (!team || (deputyId === undefined && radioChannel === undefined)) return;
      if (deputy && deputy.id === team.leadId) throw new Refused('Lead and deputy must be different people.');
      await tx.aor.update({ where: { id: team.id }, data: { radioChannel, ...(deputyId !== undefined && { deputyId: deputy?.id ?? null }) } });
      if (deputy && deputy.id !== team.deputyId) await welcome(tx, ctx, team, deputy);
    });
    await drainOutbox(5);
    redirect(page(ctx, area.eventId));
  },
);

/** One Save per role. A field left out of the form stays as it is; the job description lands on its latest version. */
export const saveRole = orgAction(
  null,
  z.object({
    id: ref('position'),
    name: z.string().trim().min(1, 'Name the role.').max(80).optional(),
    targetHeadcount: int(1, 'How many must be at least 1.').optional(),
    minHeadcount: int(0, 'Minimum cannot be negative.').optional(),
    uniform: text(200),
    brief: text(4000),
    cardId: optionalRef('positionCard').optional(),
    graceMin: z.union([z.literal(''), int(0, 'Minutes cannot be negative.')]).optional(), // '' = the event default
    isFloat: z.enum(['on', 'off']).optional(),
  }),
  async (ctx, { id, cardId, graceMin, isFloat, ...rest }) => {
    const p = must(await db.position.findFirst({ where: { id, ...inOrg(ctx) } }));
    const card = cardId ? await latestOf(ctx, cardId) : null;
    if ((rest.minHeadcount ?? p.minHeadcount) > (rest.targetHeadcount ?? p.targetHeadcount)) throw new Refused('The minimum cannot be more than how many you want.');
    await db.position.update({
      where: { id, ...inOrg(ctx) },
      data: { ...rest, ...(cardId !== undefined && { cardId: card?.id ?? null }), ...(graceMin !== undefined && { graceMin: graceMin === '' ? null : graceMin }), ...(isFloat && { isFloat: isFloat === 'on' }) },
    });
    redirect(page(ctx, p.eventId));
  },
);

/** One Save per shift. Arrive-early minutes move the call time, which every no-show rule keys off. */
export const saveShift = orgAction(
  null,
  z.object({ id: ref('shift'), needed: int(1, 'How many must be at least 1.').optional(), callOffsetMin: int(0, 'Minutes cannot be negative.').optional(), overbookPct: int(0, 'Extra invites cannot be negative.').optional() }),
  async (ctx, { id, callOffsetMin, ...rest }) => {
    const s = must(await db.shift.findFirst({ where: { id, ...inOrg(ctx) }, select: { eventId: true, startAt: true } }));
    await db.shift.update({ where: { id, ...inOrg(ctx) }, data: { ...rest, ...(callOffsetMin !== undefined && { callAt: new Date(s.startAt.getTime() - callOffsetMin * 60_000) }) } });
    redirect(page(ctx, s.eventId));
  },
);

// Deletes only show in edit mode, behind a confirmation, so each one lands back in edit mode.
const editing = (ctx: OrgCtx, eventId: string) => `${page(ctx, eventId)}?edit=1`;

export const deleteArea = orgAction(null, z.object({ id: ref('area') }), async (ctx, { id }) => {
  const area = must(await db.area.findFirst({ where: { id, ...inOrg(ctx) }, select: { eventId: true, aorId: true, _count: { select: { positions: true } } } }));
  if (area._count.positions) throw new Refused('Delete the location’s roles first.');
  await db.area.delete({ where: { id, ...inOrg(ctx) } }).catch(notFoundOnP2025);
  if (area.aorId) await db.aor.deleteMany({ where: { id: area.aorId, ...inOrg(ctx), areas: { none: {} } } }); // a team with no location left
  redirect(editing(ctx, area.eventId));
});

export const deletePosition = orgAction(null, z.object({ id: ref('position') }), async (ctx, { id }) => {
  const p = must(await db.position.findFirst({ where: { id, ...inOrg(ctx) }, select: { eventId: true, _count: { select: { shifts: true } } } }));
  if (p._count.shifts) throw new Refused('Delete the role’s shifts first.');
  await db.position.delete({ where: { id, ...inOrg(ctx) } }).catch(notFoundOnP2025);
  redirect(editing(ctx, p.eventId));
});

export const deleteShift = orgAction(null, z.object({ id: ref('shift') }), async (ctx, { id }) => {
  const s = must(await db.shift.findFirst({ where: { id, ...inOrg(ctx) }, select: { eventId: true, _count: { select: { assignments: true } } } }));
  if (s._count.assignments) throw new Refused('Release the people on this shift first (Staff page).');
  await db.shift.delete({ where: { id, ...inOrg(ctx) } }).catch(notFoundOnP2025);
  redirect(editing(ctx, s.eventId));
});
