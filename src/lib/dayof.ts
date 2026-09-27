import { audit } from '@/core/audit';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';
import type { AlertKind, EventStatus } from '@/generated/prisma/enums';
import { ensurePersonLink } from './links';
import { notify, notifyPlanners } from './messages';
import { assignmentInclude, firstName, linkExpiry, type FullAssignment } from './staffing';
import { fmtTime } from './time';

// Day-of operations (PRD 5): check-in and check-out, no-show alerts on the lead → deputy → planner
// chain, help requests, and the sweep the cron runs every five minutes. Every timer keys off callAt.
export type Method = 'lead' | 'self' | 'sms' | 'planner';
export const EARLY_MS = 3 * 3_600_000; // a check-in this long before call time is probably a mistake
export const AUTO_CLOSE_MS = 60 * 60_000; // an unclosed assignment is closed this long after shift end, flagged
export const ESCALATE_MS: Record<AlertKind, number> = { no_show: 10 * 60_000, help: 5 * 60_000 };
const LIVE = { status: { in: ['staffing', 'confirmed', 'live'] as EventStatus[] } };
type Tx = Prisma.TransactionClient;
type Chain = { lead: { id: string } | null; deputy: { id: string } | null } | null | undefined;

export const graceOf = (a: { shift: { position: { graceMin: number | null } }; event: { graceMin: number } }) => a.shift.position.graceMin ?? a.event.graceMin;
export const dueAt = (a: Parameters<typeof graceOf>[0] & { shift: { callAt: Date } }) => new Date(a.shift.callAt.getTime() + graceOf(a) * 60_000);
/** Someone confirmed, past call time plus grace, not here. Computed live, so the board never waits for the sweep. */
export const isOverdue = (a: Parameters<typeof dueAt>[0] & { status: string; checkedInAt: Date | null }, t = now()) => a.status === 'confirmed' && !a.checkedInAt && dueAt(a) < t;

/** The first chain step that has someone in it: 0 lead, 1 deputy, 2 planner. */
export const firstStep = (aor: Chain) => (aor?.lead ? 0 : aor?.deputy ? 1 : 2);
const nextStep = (aor: Chain, step: number) => (step === 0 && aor?.deputy ? 1 : 2);
const ownerAt = (aor: Chain, step: number) => (step === 0 ? aor?.lead : step === 1 ? aor?.deputy : null) ?? null;

/** Records arrival. The earliest timestamp wins, so a late sync of an earlier tap replaces a later one and a duplicate is ignored. */
export async function checkIn(tx: Tx, a: FullAssignment, at: Date, method: Method): Promise<'recorded' | 'kept' | 'early'> {
  if (method !== 'planner' && at.getTime() < a.shift.callAt.getTime() - EARLY_MS) return 'early';
  const t = now();
  const { count } = await tx.assignment.updateMany({
    where: { id: a.id, orgId: a.orgId, OR: [{ checkedInAt: null }, { checkedInAt: { gt: at } }] },
    data: { checkedInAt: at, checkInMethod: method, checkInSyncedAt: t, status: 'confirmed', respondedAt: a.respondedAt ?? t },
  });
  if (!count) return 'kept';
  const tz = a.event.timezone;
  await tx.alert.updateMany({
    where: { assignmentId: a.id, orgId: a.orgId, kind: 'no_show', resolvedAt: null },
    data: { resolvedAt: t, resolution: `checked in ${fmtTime(at, tz)}, synced ${fmtTime(t, tz)}` },
  });
  await audit({ orgId: a.orgId, userId: null }, 'assignment.checked_in', { targetType: 'assignment', targetId: a.id, data: { method, at: at.toISOString() } }, tx);
  return 'recorded';
}

export async function checkOut(tx: Tx, a: FullAssignment, at: Date, method: Method): Promise<'recorded' | 'kept'> {
  const { count } = await tx.assignment.updateMany({
    where: { id: a.id, orgId: a.orgId, checkedInAt: { not: null }, checkedOutAt: null },
    data: { checkedOutAt: at, checkOutMethod: method },
  });
  if (count) await audit({ orgId: a.orgId, userId: null }, 'assignment.checked_out', { targetType: 'assignment', targetId: a.id, data: { method } }, tx);
  return count ? 'recorded' : 'kept';
}

// Key order is the order the help sheet shows its chips; the first is pre-picked, so it is the mildest.
const SEVERITY: Record<string, number> = { supplies: 1, vip: 2, relief: 2, medical: 3, security: 3, other: 1 };
export const HELP_CATEGORIES = Object.keys(SEVERITY);

/** A help request from the floor: an alert to the lead with the person's position and area attached. */
export async function raiseHelp(tx: Tx, person: { id: string; orgId: string; name: string }, eventId: string, a: FullAssignment | null, category: string, note: string) {
  const aor = a?.shift.position.area.aor ?? null;
  const step = firstStep(aor);
  const alert = await tx.alert.create({
    data: { orgId: person.orgId, eventId, kind: 'help', severity: SEVERITY[category] ?? 1, personId: person.id, assignmentId: a?.id ?? null, aorId: aor?.id ?? null, step, category, note: note.slice(0, 500), openedAt: now(), steppedAt: now() },
  });
  await tell(tx, alert.id, aor, step, 'cb_help', {
    name: person.name,
    where: a ? `${a.shift.position.name}, ${a.shift.position.area.name}` : 'no shift right now',
    category,
    note,
    event: a?.event.name ?? '',
  }, person.orgId, eventId);
  return alert;
}

/** Notifies whoever owns `step`: the lead or deputy by SMS with their roster link, or every planner by email. */
async function tell(tx: Tx, alertId: string, aor: Chain, step: number, template: string, data: Record<string, string>, orgId: string, eventId: string) {
  const owner = ownerAt(aor, step);
  if (!owner) return notifyPlanners(tx, orgId, template, { ...data, url: '', to: 'planner' });
  const p = await tx.person.findUniqueOrThrow({ where: { id: owner.id } });
  const ev = await tx.event.findUniqueOrThrow({ where: { id: eventId }, include: { days: { orderBy: { date: 'desc' }, take: 1 } } });
  const url = await ensurePersonLink(tx, { orgId, eventId, personId: p.id }, linkExpiry(ev.days[0]?.date ?? now()));
  await notify(tx, orgId, p, template, { ...data, to: firstName(p.name), url });
  await audit({ orgId, userId: null }, 'alert.notified', { targetType: 'alert', targetId: alertId, data: { step, personId: p.id } }, tx);
}

/**
 * The five-minute sweep: raise a no-show alert for everyone past call time plus grace, escalate open
 * alerts that have sat a step too long, and close assignments nobody checked out an hour after shift end.
 */
export async function runDayOf(): Promise<{ noShows: number; escalated: number; autoClosed: number }> {
  const t = now();
  let noShows = 0;
  let escalated = 0;

  const candidates = await db.assignment.findMany({
    where: { status: 'confirmed', checkedInAt: null, event: LIVE, shift: { callAt: { lt: t }, endAt: { gt: t } }, alerts: { none: { kind: 'no_show' } } },
    include: assignmentInclude,
  });
  // One notification per owner, listing everyone who fired together (PRD 5 flow step 2).
  const batches = new Map<string, { aor: FullAssignment['shift']['position']['area']['aor']; step: number; eventId: string; orgId: string; names: string[]; ids: string[] }>();
  for (const a of candidates.filter((a) => dueAt(a) < t)) {
    const aor = a.shift.position.area.aor;
    const step = firstStep(aor);
    const key = `${a.eventId}:${aor?.id ?? 'planner'}`;
    const b = batches.get(key) ?? { aor, step, eventId: a.eventId, orgId: a.orgId, names: [], ids: [] };
    b.names.push(`${a.person.name} (${a.shift.position.name}, call ${fmtTime(a.shift.callAt, a.event.timezone)})`);
    b.ids.push(a.id);
    batches.set(key, b);
    await db.$transaction(async (tx) => {
      const alert = await tx.alert.create({ data: { orgId: a.orgId, eventId: a.eventId, kind: 'no_show', personId: a.personId, assignmentId: a.id, aorId: aor?.id ?? null, step, openedAt: t, steppedAt: t } }); // app clock, not the database's
      await audit({ orgId: a.orgId, userId: null }, 'alert.no_show', { targetType: 'alert', targetId: alert.id, data: { assignmentId: a.id } }, tx);
    });
    noShows++;
  }
  for (const b of batches.values()) {
    const ev = await db.event.findUniqueOrThrow({ where: { id: b.eventId } });
    await db.$transaction((tx) => tell(tx, b.ids[0]!, b.aor, b.step, 'cb_noshow', { event: ev.name, list: b.names.join('; '), count: String(b.names.length) }, b.orgId, b.eventId));
  }

  const stale = await db.alert.findMany({ where: { resolvedAt: null, step: { lt: 2 } }, include: { aor: { include: { lead: true, deputy: true } }, person: true, event: true, assignment: { include: { shift: { include: { position: true } } } } } });
  for (const al of stale.filter((al) => al.steppedAt.getTime() + ESCALATE_MS[al.kind] <= t.getTime())) {
    const step = nextStep(al.aor, al.step);
    await db.$transaction(async (tx) => {
      await tx.alert.update({ where: { id: al.id }, data: { step, steppedAt: t } });
      const where = al.assignment ? `${al.assignment.shift.position.name}` : 'no shift';
      const data: Record<string, string> = al.kind === 'no_show'
        ? { event: al.event.name, list: `${al.person.name} (${where}, unresolved ${ESCALATE_MS.no_show / 60_000} min)`, count: '1' }
        : { event: al.event.name, name: al.person.name, where, category: al.category, note: `${al.note} (unanswered ${ESCALATE_MS.help / 60_000} min)` };
      await tell(tx, al.id, al.aor, step, al.kind === 'no_show' ? 'cb_noshow' : 'cb_help', data, al.orgId, al.eventId);
    });
    escalated++;
  }

  const autoClosed = await db.$executeRaw`
    UPDATE "Assignment" a SET "checkedOutAt" = s."endAt" + interval '60 minutes', "checkOutMethod" = 'auto'
    FROM "Shift" s WHERE s.id = a."shiftId" AND a."checkedInAt" IS NOT NULL AND a."checkedOutAt" IS NULL AND s."endAt" + interval '60 minutes' < ${t}`;
  return { noShows, escalated, autoClosed };
}
