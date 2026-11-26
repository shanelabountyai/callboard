'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/core/audit';
import { ref } from '@/core/authz/action';
import { inOrg, type OrgCtx } from '@/core/authz/guards';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { checkIn, checkOut } from '@/lib/dayof';
import { ensurePersonLink } from '@/lib/links';
import { notify } from '@/lib/messages';
import { must, onUnique } from '@/lib/refuse';
import { assignmentInclude, clashSays, describeAssignment, findClash, linkExpiry } from '@/lib/staffing';
import { drainOutbox } from '@/modules/notifications/outbox';
import { plannerAction } from '@/lib/planner';

// The planner's day-of moves (PRD 5): check someone in or out on a lead's behalf, close an alert, deploy float.
const board = (ctx: OrgCtx, eventId: string, day?: string) => `/o/${ctx.slug}/events/${eventId}/board${day ? `?day=${day}` : ''}`;

export const plannerCheck = plannerAction(z.object({ id: ref('assignment'), action: z.enum(['in', 'out']), day: z.string().max(10).optional() }), async (ctx, i) => {
  const a = must(await db.assignment.findFirst({ where: { id: i.id, ...inOrg(ctx) }, include: assignmentInclude }));
  await db.$transaction((tx) => (i.action === 'in' ? checkIn(tx, a, now(), 'planner') : checkOut(tx, a, now(), 'planner')));
  redirect(board(ctx, a.eventId, i.day));
});

export const resolveAlert = plannerAction(z.object({ id: ref('alert'), resolution: z.string().trim().max(200).default(''), day: z.string().max(10).optional() }), async (ctx, i) => {
  const al = must(await db.alert.findFirst({ where: { id: i.id, ...inOrg(ctx) } }));
  await db.$transaction(async (tx) => {
    await tx.alert.update({ where: { id: al.id }, data: { resolvedAt: now(), resolution: i.resolution || 'resolved by planner' } });
    await audit(ctx, 'alert.resolve', { targetType: 'alert', targetId: al.id }, tx);
  });
  redirect(board(ctx, al.eventId, i.day));
});

/** Moves a checked-in float to a red shift and tells them where to go. Never automatic: the planner picks (PRD 5 rules). */
export const deployFloat = plannerAction(z.object({ id: ref('assignment'), shiftId: ref('shift'), day: z.string().max(10).optional() }), async (ctx, i) => {
  const a = must(await db.assignment.findFirst({ where: { id: i.id, ...inOrg(ctx) }, include: assignmentInclude }));
  const to = must(await db.shift.findFirst({ where: { id: i.shiftId, ...inOrg(ctx), eventId: a.eventId }, include: { position: true } }));
  if (!a.shift.position.isFloat) throw new Refused(`${a.person.name} is not in the float pool.`);
  if (to.id === a.shiftId) throw new Refused('They are already on that shift.');
  const clash = await findClash(db, ctx.orgId, [a.personId], to, a.id);
  if (clash) throw new Refused(clashSays(clash));
  await db.$transaction(async (tx) => {
    const moved = await tx.assignment.update({ where: { id: a.id }, data: { shiftId: to.id, status: 'confirmed' }, include: assignmentInclude })
      .catch(onUnique(`${a.person.name} has already answered for that shift. Change their answer on the Staff page instead.`));
    const url = await ensurePersonLink(tx, { orgId: ctx.orgId, eventId: a.eventId, personId: a.personId }, linkExpiry(to.endAt));
    await notify(tx, ctx.orgId, a.person, 'cb_deploy', describeAssignment(moved, url));
    await audit(ctx, 'assignment.deployed', { targetType: 'assignment', targetId: a.id, data: { from: a.shiftId, to: to.id } }, tx);
  });
  await drainOutbox(5);
  redirect(board(ctx, a.eventId, i.day));
});
