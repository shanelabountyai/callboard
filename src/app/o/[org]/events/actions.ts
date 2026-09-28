'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/core/audit';
import { orgAction, ref } from '@/core/authz/action';
import { inOrg, type OrgCtx } from '@/core/authz/guards';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { must } from '@/lib/refuse';
import { pickRules, standardOf } from '@/lib/rules';
import { BANDS, copyEvent } from '@/lib/templates';
import { isYmd } from '@/lib/time';

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
      data: { ...inOrg(ctx), name: i.name, venue: i.venue, timezone: i.timezone, ...pickRules(await standardOf(ctx.orgId, db)), days: { create: days.map((date) => ({ ...inOrg(ctx), date })) } },
    });
    await audit(ctx, 'event.created', { targetType: 'event', targetId: e.id });
    redirect(eventPage(ctx, e.id));
  },
);

/**
 * Start a new event from a template or from another event (PRD 1): the structure comes across with
 * every date shifted; assignments do not. See copyEvent.
 */
export const duplicateEvent = orgAction(
  null,
  z.object({ id: ref('event'), name: z.string().trim().min(1, 'Give the new event a name.').max(120), startsOn: z.string().trim().min(1, 'Start date is required.') }),
  async (ctx, i) => {
    must(await db.event.findFirst({ where: { id: i.id, ...inOrg(ctx) }, select: { id: true } }));
    const id = await db.$transaction((tx) => copyEvent(tx, ctx, i.id, { name: i.name, startsOn: i.startsOn }), { timeout: 30_000 });
    redirect(eventPage(ctx, id));
  },
);

/** Save an event's structure to the library (PRD 6). The event itself is untouched and keeps no link to the template. */
export const saveAsTemplate = orgAction(
  null,
  z.object({ id: ref('event'), name: z.string().trim().min(1, 'Give the template a name.').max(120), attendanceBand: z.enum(BANDS, { message: 'Pick an attendance band.' }) }),
  async (ctx, i) => {
    must(await db.event.findFirst({ where: { id: i.id, ...inOrg(ctx) }, select: { id: true } }));
    await db.$transaction((tx) => copyEvent(tx, ctx, i.id, { name: i.name, asTemplate: { band: i.attendanceBand } }), { timeout: 30_000 });
    redirect(`/o/${ctx.slug}/templates`);
  },
);
