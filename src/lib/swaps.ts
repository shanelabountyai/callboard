import { audit } from '@/core/audit';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { hit } from '@/core/rate-limit';
import type { Prisma } from '@/generated/prisma/client';
import type { SwapStatus } from '@/generated/prisma/enums';
import { ensurePersonLink } from './links';
import { notify, notifyPlanners } from './messages';
import { assignmentInclude, describeAssignment, firstName, linkExpiry, OPEN, overlapping as over, type FullAssignment } from './staffing';
import { fmtWhen } from './time';

// Swaps (PRD 3): a person offers their shift for a named colleague's, the colleague accepts, the lead
// approves, and the two assignments change shifts in one transaction. Every step checks the swap
// again, and approval only moves an assignment that is still exactly what was offered.
export const swapInclude = { from: { include: assignmentInclude }, to: { include: assignmentInclude } } satisfies Prisma.SwapInclude;
export type FullSwap = Prisma.SwapGetPayload<{ include: typeof swapInclude }>;
export const OPEN_SWAP: SwapStatus[] = ['proposed', 'accepted'];

// What the page says after each step. The code travels in the URL (?done=), never the text.
export const SWAP_SAYS = {
  swap_asked: 'Asked. They have been sent a text. Nothing changes until they and your lead agree.',
  swap_accepted: 'Accepted. Your lead has been asked to approve. Nothing changes until they do.',
  swap_declined: 'Declined. They have been told.',
  swap_withdrawn: 'Withdrawn. Your shift stays as it was.',
  swap_approved: 'Approved. Both have been sent their new shift.',
  swap_refused: 'Refused. Both have been told their shifts stay as they were.',
  swap_none: 'That swap is not yours to answer, or it has already been answered.',
  swap_stale: 'That swap no longer applies: one of the shifts has changed or started.',
  swap_area: 'You can only swap with someone in your own area. Ask the planner for anything wider.',
  swap_held: 'One of you has already answered for the other’s shift. Ask the planner to make this change.',
  swap_clash: 'That swap would put one of you on two shifts at the same time.',
  swap_busy: 'There is already a swap waiting on one of those shifts.',
  swap_limit: 'That is enough swap requests for today. Ask your lead.',
  swap_own: 'You are part of this swap, so someone else has to approve it.',
} as const;
export type SwapSays = keyof typeof SWAP_SAYS;
const DONE: SwapSays[] = ['swap_asked', 'swap_accepted', 'swap_declined', 'swap_withdrawn', 'swap_approved', 'swap_refused'];
export const swapDone = (r: SwapSays) => DONE.includes(r);

// Asking texts a colleague, so a link holder cannot be allowed to do it without end.
const ASKS_PER_DAY = { limit: 5, windowMs: 86_400_000 } as const;

type Tx = Prisma.TransactionClient | typeof db;
type Scope = { orgId: string; eventId: string };
type Actor = Parameters<typeof audit>[0];
type Me = { id: string; name: string };
/** Who is deciding: a lead or deputy acts for their own AoRs only; the planner (no `aorIds`) for any. */
export type Decider = { name: string; personId?: string; aorIds?: string[] };

/** A shift that can still change hands: confirmed, not checked in, call time ahead. */
export const swappable = (a: { status: string; checkedInAt: Date | null; shift: { callAt: Date } }, t: Date) =>
  a.status === 'confirmed' && !a.checkedInAt && a.shift.callAt > t;
/** Still exactly what was offered. */
export const isLive = (s: FullSwap, t: Date) => s.from.shiftId === s.fromShiftId && s.to.shiftId === s.toShiftId && swappable(s.from, t) && swappable(s.to, t);

/** Why these two cannot swap, or null. */
async function problem(tx: Tx, a: FullAssignment, b: FullAssignment, t: Date): Promise<SwapSays | null> {
  if (a.personId === b.personId || a.shiftId === b.shiftId || !swappable(a, t) || !swappable(b, t) || a.event.status === 'closed' || a.event.isTemplate) return 'swap_stale';
  // ponytail: one AoR only, so one lead owns both people; a swap across AoRs is the planner's by hand. Add two approvals if it is asked for.
  if (a.shift.position.area.aorId !== b.shift.position.area.aorId) return 'swap_area';
  // A row is unique on shift and person, and a decline is a row.
  if (await tx.assignment.count({ where: { OR: [{ shiftId: b.shiftId, personId: a.personId }, { shiftId: a.shiftId, personId: b.personId }] } })) return 'swap_held';
  // The conflict check an invite makes (PRD 3), for each person against the shift they would take.
  const clash = await tx.assignment.count({
    where: {
      orgId: a.orgId, status: { in: OPEN },
      OR: [{ personId: a.personId, id: { not: a.id }, shift: over(b.shift) }, { personId: b.personId, id: { not: b.id }, shift: over(a.shift) }],
    },
  });
  return clash ? 'swap_clash' : null;
}
const check = async (tx: Tx, s: FullSwap, t: Date) => (isLive(s, t) ? problem(tx, s.from, s.to, t) : 'swap_stale');

/** A text to `mine`'s person about their own shift and the other side of the swap. */
async function tell(tx: Tx, template: string, mine: FullAssignment, theirs: FullAssignment, extra: Record<string, string> = {}) {
  const expires = linkExpiry(mine.shift.endAt > theirs.shift.endAt ? mine.shift.endAt : theirs.shift.endAt);
  const url = await ensurePersonLink(tx, { orgId: mine.orgId, eventId: mine.eventId, personId: mine.personId }, expires);
  const tz = mine.event.timezone;
  await notify(tx, mine.orgId, mine.person, template, {
    ...describeAssignment(mine, url), other: theirs.person.name, otherPosition: theirs.shift.position.name, otherWhen: fmtWhen(theirs.shift.startAt, tz), ...extra,
  });
}
const off = async (tx: Tx, s: FullSwap, why: string, to: ('from' | 'to')[] = ['from', 'to']) => {
  if (to.includes('from')) await tell(tx, 'cb_swap_off', s.from, s.to, { why });
  if (to.includes('to')) await tell(tx, 'cb_swap_off', s.to, s.from, { why });
};

/** The lead, or the deputy when the lead is one of the two; with neither, the planners by email. */
async function askApprover(tx: Tx, s: FullSwap) {
  const aor = s.from.shift.position.area.aor;
  const approver = [aor?.lead, aor?.deputy].find((p) => p && p.id !== s.from.personId && p.id !== s.to.personId);
  const tz = s.from.event.timezone;
  const d = {
    event: s.from.event.name, a: s.from.person.name, b: s.to.person.name,
    aTakes: `${s.to.shift.position.name}, ${fmtWhen(s.to.shift.startAt, tz)}`, bTakes: `${s.from.shift.position.name}, ${fmtWhen(s.from.shift.startAt, tz)}`,
  };
  if (!approver) return notifyPlanners(tx, s.orgId, 'cb_swap_approve', { ...d, to: 'Planner', url: '' });
  const url = await ensurePersonLink(tx, { orgId: s.orgId, eventId: s.eventId, personId: approver.id }, linkExpiry(s.from.shift.endAt));
  await notify(tx, s.orgId, approver, 'cb_swap_approve', { ...d, to: firstName(approver.name), url });
}

export async function askSwap(me: Me, scope: Scope, fromId: string, toId: string): Promise<SwapSays> {
  const t = now();
  const [from, to] = await Promise.all([fromId, toId].map((id) => db.assignment.findFirst({ where: { id, ...scope }, include: assignmentInclude })));
  if (!from || !to || from.personId !== me.id) return 'swap_none';
  const bad = await problem(db, from, to, t);
  if (bad) return bad;
  // One open swap per shift. A dead one (a shift changed under it) is closed on the way past.
  const ids = [from.id, to.id];
  const open = await db.swap.findMany({ where: { ...scope, status: { in: OPEN_SWAP }, OR: [{ fromId: { in: ids } }, { toId: { in: ids } }] }, include: swapInclude });
  const dead = open.filter((s) => !isLive(s, t));
  if (dead.length < open.length) return 'swap_busy';
  if (!(await hit(`swap:person:${me.id}`, ASKS_PER_DAY))) return 'swap_limit';
  await db.$transaction(async (tx) => {
    if (dead.length) await tx.swap.updateMany({ where: { id: { in: dead.map((s) => s.id) }, status: { in: OPEN_SWAP } }, data: { status: 'cancelled', decidedAt: t } });
    const s = await tx.swap.create({ data: { ...scope, fromId: from.id, toId: to.id, fromShiftId: from.shiftId, toShiftId: to.shiftId } });
    await tell(tx, 'cb_swap_ask', to, from);
    await audit({ orgId: scope.orgId, userId: null }, 'swap.asked', { targetType: 'swap', targetId: s.id, data: { by: 'person', personId: me.id } }, tx);
  });
  return 'swap_asked';
}

export async function answerSwap(me: Me, scope: Scope, id: string, yes: boolean): Promise<SwapSays> {
  const t = now();
  const s = await db.swap.findFirst({ where: { id, ...scope, status: 'proposed', to: { personId: me.id } }, include: swapInclude });
  if (!s) return 'swap_none';
  const bad = yes ? await check(db, s, t) : null;
  const status = bad ? 'cancelled' : yes ? 'accepted' : 'declined';
  return db.$transaction(async (tx) => {
    const { count } = await tx.swap.updateMany({ where: { id: s.id, status: 'proposed' }, data: { status, answeredAt: t } });
    if (!count) return 'swap_none';
    if (status === 'accepted') {
      await tell(tx, 'cb_swap_accepted', s.from, s.to);
      await askApprover(tx, s);
    } else await off(tx, s, bad ? 'a shift changed' : `${firstName(me.name)} declined`, ['from']);
    await audit({ orgId: scope.orgId, userId: null }, `swap.${status}`, { targetType: 'swap', targetId: s.id, data: { by: 'person', personId: me.id } }, tx);
    return bad ?? (yes ? 'swap_accepted' : 'swap_declined');
  });
}

export async function withdrawSwap(me: Me, scope: Scope, id: string): Promise<SwapSays> {
  const s = await db.swap.findFirst({ where: { id, ...scope, status: { in: OPEN_SWAP }, from: { personId: me.id } }, include: swapInclude });
  if (!s) return 'swap_none';
  return db.$transaction(async (tx) => {
    const { count } = await tx.swap.updateMany({ where: { id: s.id, status: { in: OPEN_SWAP } }, data: { status: 'cancelled', decidedAt: now() } });
    if (!count) return 'swap_none';
    await off(tx, s, `${firstName(me.name)} withdrew it`, ['to']);
    await audit({ orgId: scope.orgId, userId: null }, 'swap.cancelled', { targetType: 'swap', targetId: s.id, data: { by: 'person', personId: me.id } }, tx);
    return 'swap_withdrawn';
  });
}

class Stale extends Error {}

/** Approve or refuse a swap both people have agreed to. Approval is all or nothing. */
export async function decideSwap(by: Decider, actor: Actor, scope: { orgId: string; eventId?: string }, id: string, approve: boolean): Promise<SwapSays> {
  const t = now();
  const s = await db.swap.findFirst({ where: { id, ...scope, status: 'accepted' }, include: swapInclude });
  if (!s) return 'swap_none';
  if (by.aorIds) {
    const aorId = s.from.shift.position.area.aorId;
    if (!aorId || !by.aorIds.includes(aorId)) return 'swap_none';
    if (by.personId === s.from.personId || by.personId === s.to.personId) return 'swap_own';
  }
  const data = { by: by.personId ? 'person' : 'planner', ...(by.personId && { personId: by.personId }) };
  const close = (status: 'refused' | 'cancelled', why: string, says: SwapSays) =>
    db.$transaction(async (tx) => {
      const { count } = await tx.swap.updateMany({ where: { id: s.id, status: 'accepted' }, data: { status, decidedAt: t, decidedBy: by.name } });
      if (!count) return 'swap_none' as const;
      await off(tx, s, why);
      await audit(actor, `swap.${status}`, { targetType: 'swap', targetId: s.id, data }, tx);
      return says;
    });
  if (!approve) return close('refused', `refused by ${by.name}`, 'swap_refused');
  const bad = await check(db, s, t);
  if (bad) return close('cancelled', 'a shift changed', bad);
  try {
    return await db.$transaction(async (tx) => {
      const claim = await tx.swap.updateMany({ where: { id: s.id, status: 'accepted' }, data: { status: 'approved', decidedAt: t, decidedBy: by.name } });
      if (!claim.count) return 'swap_none';
      // Each row moves only if it is still what was offered; the reminders start again for the new shift.
      for (const [a, shiftId, takes] of [[s.from, s.fromShiftId, s.toShiftId], [s.to, s.toShiftId, s.fromShiftId]] as const) {
        const moved = await tx.assignment.updateMany({ where: { id: a.id, personId: a.personId, shiftId, status: 'confirmed', checkedInAt: null }, data: { shiftId: takes, t7SentAt: null, t1SentAt: null } });
        if (!moved.count) throw new Stale();
      }
      const [from, to] = await Promise.all([s.fromId, s.toId].map((x) => tx.assignment.findUniqueOrThrow({ where: { id: x }, include: assignmentInclude })));
      await tell(tx, 'cb_swap_done', from!, to!);
      await tell(tx, 'cb_swap_done', to!, from!);
      await audit(actor, 'swap.approved', { targetType: 'swap', targetId: s.id, data: { ...data, moved: [{ assignment: s.fromId, to: s.toShiftId }, { assignment: s.toId, to: s.fromShiftId }] } }, tx);
      return 'swap_approved';
    });
  } catch (e) {
    if (!(e instanceof Stale)) throw e;
    return close('cancelled', 'a shift changed', 'swap_stale');
  }
}
