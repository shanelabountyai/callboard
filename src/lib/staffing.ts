import type { Prisma } from '@/generated/prisma/client';
import type { AssignmentStatus } from '@/generated/prisma/enums';
import { fmtTime, fmtWhen } from './time';

/** Everything a message about an assignment needs, in one include. */
export const assignmentInclude = {
  person: true,
  event: true,
  shift: { include: { day: true, position: { include: { card: true, area: { include: { aor: { include: { lead: true, deputy: true } } } } } } } },
} satisfies Prisma.AssignmentInclude;
export type FullAssignment = Prisma.AssignmentGetPayload<{ include: typeof assignmentInclude }>;

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Template data for one assignment. Strings only: the outbox stores them as JSON. */
export function describeAssignment(a: FullAssignment, url: string): Record<string, string> {
  const tz = a.event.timezone;
  const area = a.shift.position.area;
  return {
    name: firstName(a.person.name),
    event: a.event.name,
    position: a.shift.position.name,
    area: area.name,
    location: area.location,
    when: fmtWhen(a.shift.startAt, tz),
    call: fmtTime(a.shift.callAt, tz),
    end: fmtTime(a.shift.endAt, tz),
    lead: area.aor?.lead?.name ?? 'the planner',
    leadMobile: area.aor?.lead?.mobile ?? '',
    uniform: a.shift.position.uniform,
    url,
  };
}

/** A link outlives its last shift by a week (PRD 3). */
export const linkExpiry = (shiftEnd: Date) => new Date(shiftEnd.getTime() + 7 * 86_400_000);

/** Overbook cap: invites allowed on a shift, needed × (1 + overbook%). */
export const inviteCap = (shift: { needed: number; overbookPct: number }) => Math.ceil(shift.needed * (1 + shift.overbookPct / 100));

/** An assignment that holds the person's time. A decline or a release does not. */
export const OPEN: AssignmentStatus[] = ['invited', 'confirmed'];
export const overlapping = (s: { startAt: Date; endAt: Date }) => ({ startAt: { lt: s.endAt }, endAt: { gt: s.startAt } });

/**
 * The double-booking rule (PRD 3), for every path that gives someone a shift: the first open assignment anywhere in
 * the org that overlaps `shift` for one of these people, or null. `exceptId` is the row being moved or reopened.
 * ponytail: check then write, so two requests in the same instant can both pass. Add a per-person advisory lock if it is ever seen.
 */
export const findClash = (tx: Pick<Prisma.TransactionClient, 'assignment'>, orgId: string, personIds: string[], shift: { startAt: Date; endAt: Date }, exceptId?: string) =>
  tx.assignment.findFirst({
    where: { orgId, personId: { in: personIds }, status: { in: OPEN }, shift: overlapping(shift), ...(exceptId && { id: { not: exceptId } }) },
    include: { person: true, shift: { include: { position: true, event: true } } },
  });
export const clashSays = (c: NonNullable<Awaited<ReturnType<typeof findClash>>>) =>
  `${c.person.name} is already ${c.status} for ${c.shift.position.name} at ${c.shift.event.name} at the same time.`;
