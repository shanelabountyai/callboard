'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/core/audit';
import { ref } from '@/core/authz/action';
import { inOrg, type OrgCtx } from '@/core/authz/guards';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { ensurePersonLink } from '@/lib/links';
import { notify } from '@/lib/messages';
import { must } from '@/lib/refuse';
import { drainOutbox } from '@/modules/notifications/outbox';
import { assignmentInclude, clashSays, describeAssignment, findClash, inviteCap, linkExpiry, OPEN } from '@/lib/staffing';
import { decideSwap as decide, SWAP_SAYS, swapDone } from '@/lib/swaps';
import { plannerAction } from '@/lib/planner';

// Assignments and invites (PRD 3). Inviting is sending: the assignment row and its message commit together,
// then the outbox is drained right away so a planner's sends do not wait for the hourly cron.
// ponytail: a synchronous drain capped at 25 keeps the request short; the cron sends the rest within the hour.
const page = (ctx: OrgCtx, eventId: string) => `/o/${ctx.slug}/events/${eventId}/staff`;
const daysOut = (callAt: Date) => {
  const d = Math.round((callAt.getTime() - now().getTime()) / 86_400_000);
  return d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;
};

/** People come as checkboxes named `p:<personId>`, so the form can list the whole directory. */
export const invite = plannerAction(z.looseObject({ shiftId: ref('shift') }), async (ctx, i) => {
  const shift = must(await db.shift.findFirst({ where: { id: i.shiftId, ...inOrg(ctx) }, include: { assignments: true, event: { select: { isTemplate: true } } } }));
  if (shift.event.isTemplate) throw new Refused('A template is never staffed. Start an event from it instead.');
  const personIds = Object.keys(i).filter((k) => k.startsWith('p:')).map((k) => k.slice(2)).filter((id) => z.uuid().safeParse(id).success);
  if (!personIds.length) throw new Refused('Tick at least one person.');
  const people = await db.person.findMany({ where: { id: { in: personIds }, ...inOrg(ctx) } });
  if (people.length !== personIds.length) throw new Refused('Someone on the list is no longer in the directory.');
  const open = shift.assignments.filter((a) => OPEN.includes(a.status));
  const fresh = people.filter((p) => !open.some((a) => a.personId === p.id));
  const cap = inviteCap(shift);
  if (open.length + fresh.length > cap) {
    throw new Refused(`That would be ${open.length + fresh.length} invites for ${shift.needed} needed; the overbook cap is ${cap}. Raise needed or the overbook %.`);
  }
  const clash = await findClash(db, ctx.orgId, fresh.map((p) => p.id), shift);
  if (clash) throw new Refused(clashSays(clash));
  await db.$transaction(async (tx) => {
    for (const p of fresh) {
      const prior = shift.assignments.find((a) => a.personId === p.id); // declined or released before: re-invite the same row
      const a = prior
        ? await tx.assignment.update({ where: { id: prior.id }, data: { status: 'invited', respondedAt: null, declineReason: '', t7SentAt: null, t1SentAt: null }, include: assignmentInclude })
        : await tx.assignment.create({ data: { ...inOrg(ctx), eventId: shift.eventId, shiftId: shift.id, personId: p.id }, include: assignmentInclude });
      const url = await ensurePersonLink(tx, { orgId: ctx.orgId, eventId: shift.eventId, personId: p.id }, linkExpiry(shift.endAt));
      await notify(tx, ctx.orgId, p, 'cb_invite', describeAssignment(a, url));
    }
    await audit(ctx, 'assignment.invited', { targetType: 'shift', targetId: shift.id, data: { count: fresh.length } }, tx);
  });
  await drainOutbox(25);
  redirect(page(ctx, shift.eventId));
});

/** One reminder to everyone still unconfirmed on the event, with the sender's name on it. */
export const nudgeUnconfirmed = plannerAction(z.object({ eventId: ref('event') }), async (ctx, { eventId }) => {
  must(await db.event.findFirst({ where: { id: eventId, ...inOrg(ctx) }, select: { id: true } }));
  const pending = await db.assignment.findMany({ where: { ...inOrg(ctx), eventId, status: 'invited', shift: { callAt: { gt: now() } } }, include: assignmentInclude });
  await db.$transaction(async (tx) => {
    for (const a of pending) {
      const url = await ensurePersonLink(tx, { orgId: ctx.orgId, eventId, personId: a.personId }, linkExpiry(a.shift.endAt));
      await notify(tx, ctx.orgId, a.person, 'cb_nudge', { ...describeAssignment(a, url), daysOut: daysOut(a.shift.callAt) });
    }
    await audit(ctx, 'assignment.nudged', { targetType: 'event', targetId: eventId, data: { count: pending.length } }, tx);
  });
  await drainOutbox(25);
  return { notice: `Nudged ${pending.length} unconfirmed ${pending.length === 1 ? 'person' : 'people'}.` };
});

/** Planner override: confirm on someone's behalf, mark a decline, or release them (they are told). */
export const setAssignmentStatus = plannerAction(
  z.object({ id: ref('assignment'), status: z.enum(['invited', 'confirmed', 'declined', 'released']) }),
  async (ctx, i) => {
    const a = must(await db.assignment.findFirst({ where: { id: i.id, ...inOrg(ctx) }, include: assignmentInclude }));
    // Reopening a decline or a release gives the shift back, so it is checked like an invite.
    const clash = i.status === 'invited' || i.status === 'confirmed' ? await findClash(db, ctx.orgId, [a.personId], a.shift, a.id) : null;
    if (clash) throw new Refused(clashSays(clash));
    await db.$transaction(async (tx) => {
      await tx.assignment.update({ where: { id: a.id }, data: { status: i.status, respondedAt: i.status === 'invited' ? null : now() } });
      if (i.status === 'released' && a.status !== 'released') {
        const url = await ensurePersonLink(tx, { orgId: ctx.orgId, eventId: a.eventId, personId: a.personId }, linkExpiry(a.shift.endAt));
        await notify(tx, ctx.orgId, a.person, 'cb_released', describeAssignment(a, url));
      }
      await audit(ctx, 'assignment.status', { targetType: 'assignment', targetId: a.id, data: { status: i.status } }, tx);
    });
    if (i.status === 'released') await drainOutbox(5);
    redirect(page(ctx, a.eventId));
  },
);

/** The planner's word on a swap both people have agreed to (PRD 3). A lead does the same from their own page. */
export const decideSwap = plannerAction(z.object({ id: ref('swap'), decision: z.enum(['approve', 'refuse']) }), async (ctx, i) => {
  const s = must(await db.swap.findFirst({ where: { id: i.id, ...inOrg(ctx) }, select: { eventId: true } }));
  const r = await decide({ name: 'the planner' }, ctx, { orgId: ctx.orgId }, i.id, i.decision === 'approve');
  await drainOutbox(5);
  if (!swapDone(r)) throw new Refused(SWAP_SAYS[r]);
  redirect(page(ctx, s.eventId));
});
