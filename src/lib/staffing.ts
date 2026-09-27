import type { Prisma } from '@/generated/prisma/client';
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
