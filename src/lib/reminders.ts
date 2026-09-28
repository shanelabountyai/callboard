import { now } from '@/core/clock';
import { db } from '@/core/db';
import type { AssignmentStatus, EventStatus } from '@/generated/prisma/enums';
import { ensurePersonLink } from './links';
import { notify } from './messages';
import { assignmentInclude, describeAssignment, linkExpiry, type FullAssignment } from './staffing';

// Automatic reminders (PRD 4, phase 1): a first nudge to the unconfirmed (seven days out unless the
// event's rule says otherwise, PRD 6), the pack to the confirmed the day before, and a last nudge to the rest. Runs from the hourly cron; each assignment gets each one once.
const LIVE = { status: { in: ['staffing', 'confirmed', 'live'] as EventStatus[] } };
const OPEN = { in: ['invited', 'confirmed'] as AssignmentStatus[] };
const DAY = 86_400_000;

export async function runReminders(limit = 200): Promise<{ nudged: number; packed: number }> {
  const t = now();
  let nudged = 0;
  let packed = 0;

  // One query per cadence in use: almost always one, the standard.
  const cadences = await db.event.findMany({ where: LIVE, distinct: ['nudgeDays'], select: { nudgeDays: true } });
  const due7 = (await Promise.all(cadences.map(({ nudgeDays }) => db.assignment.findMany({
    where: { t7SentAt: null, status: OPEN, event: { ...LIVE, nudgeDays }, shift: { callAt: { gt: t, lte: new Date(t.getTime() + nudgeDays * DAY) } } },
    include: assignmentInclude, take: limit,
  })))).flat();
  for (const a of due7) {
    await db.$transaction(async (tx) => {
      // An invite sent today already carries the link; only nudge people who have sat on it for a day.
      if (a.status === 'invited' && a.createdAt.getTime() < t.getTime() - DAY) {
        await notify(tx, a.orgId, a.person, 'cb_nudge', { ...describeAssignment(a, await link(tx, a)), daysOut: a.event.nudgeDays === 7 ? 'in a week' : `in ${a.event.nudgeDays} days` });
        nudged++;
      }
      await tx.assignment.update({ where: { id: a.id }, data: { t7SentAt: t } });
    });
  }

  const due1 = await db.assignment.findMany({
    where: { t1SentAt: null, status: OPEN, event: LIVE, shift: { callAt: { gt: t, lte: new Date(t.getTime() + DAY) } } },
    include: assignmentInclude, take: limit,
  });
  for (const a of due1) {
    await db.$transaction(async (tx) => {
      const data = describeAssignment(a, await link(tx, a));
      if (a.status === 'confirmed') {
        await notify(tx, a.orgId, a.person, 'cb_pack', data);
        packed++;
      } else {
        await notify(tx, a.orgId, a.person, 'cb_nudge', { ...data, daysOut: 'tomorrow' });
        nudged++;
      }
      await tx.assignment.update({ where: { id: a.id }, data: { t1SentAt: t, t7SentAt: a.t7SentAt ?? t } });
    });
  }
  return { nudged, packed };
}

const link = (tx: Parameters<typeof ensurePersonLink>[0], a: FullAssignment) =>
  ensurePersonLink(tx, { orgId: a.orgId, eventId: a.eventId, personId: a.personId }, linkExpiry(a.shift.endAt));
