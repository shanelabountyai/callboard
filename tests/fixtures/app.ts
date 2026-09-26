import { now } from '@/core/clock';
import { db } from '@/core/db';
import { hashToken } from '@/core/tokens';

// CLONE-OWNED. The INV-01..04 harness seeds these rows in both fixture orgs, so it can drive
// actions whose inputs use ref('<model>') for Callboard's tables. One row of each, owned by `org`.
export async function seedApp(org: { orgId: string; userId: string }, key: 'a' | 'b'): Promise<Record<string, string>> {
  const n = key === 'a' ? 300 : 400;
  const ID = (k: number) => `00000000-0000-4000-8000-${String(n + k).padStart(12, '0')}`;
  const orgId = org.orgId;
  const t = now();
  const ids = { person: ID(1), event: ID(2), eventDay: ID(3), aor: ID(4), area: ID(5), position: ID(6), shift: ID(7), assignment: ID(8), runOfShowRow: ID(10), alert: ID(11), broadcast: ID(12) };
  const lead = ID(9);
  await db.person.create({ data: { id: ids.person, orgId, name: `Person ${key}`, mobile: `+1555000${n}`, kind: 'volunteer' } });
  await db.person.create({ data: { id: lead, orgId, name: `Lead ${key}`, mobile: `+1555001${n}`, kind: 'employee' } });
  await db.event.create({ data: { id: ids.event, orgId, name: `Event ${key}`, status: 'staffing' } });
  const date = new Date(t.getTime() + 3 * 86_400_000);
  date.setUTCHours(0, 0, 0, 0);
  await db.eventDay.create({ data: { id: ids.eventDay, orgId, eventId: ids.event, date } });
  await db.aor.create({ data: { id: ids.aor, orgId, eventId: ids.event, name: 'Front of house', leadId: lead } });
  await db.area.create({ data: { id: ids.area, orgId, eventId: ids.event, aorId: ids.aor, name: 'Registration' } });
  await db.position.create({ data: { id: ids.position, orgId, eventId: ids.event, areaId: ids.area, name: 'Greeter', minHeadcount: 1, targetHeadcount: 2 } });
  const startAt = new Date(date.getTime() + 14 * 3_600_000);
  await db.shift.create({
    data: { id: ids.shift, orgId, eventId: ids.event, positionId: ids.position, dayId: ids.eventDay, callAt: new Date(startAt.getTime() - 45 * 60_000), startAt, endAt: new Date(startAt.getTime() + 4 * 3_600_000), needed: 2 },
  });
  await db.assignment.create({ data: { id: ids.assignment, orgId, eventId: ids.event, shiftId: ids.shift, personId: ids.person } });
  await db.personLink.create({ data: { orgId, eventId: ids.event, personId: ids.person, tokenHash: hashToken(`plink-${key}`), expiresAt: new Date(t.getTime() + 86_400_000) } });
  await db.runOfShowRow.create({ data: { id: ids.runOfShowRow, orgId, eventId: ids.event, sourceKey: `manual:${ids.runOfShowRow}`, manual: true, at: '09:00', cue: 'Doors open', sortOrder: 0 } });
  await db.alert.create({ data: { id: ids.alert, orgId, eventId: ids.event, kind: 'no_show', personId: ids.person, assignmentId: ids.assignment, aorId: ids.aor } });
  await db.broadcast.create({ data: { id: ids.broadcast, orgId, eventId: ids.event, audience: 'Whole event', body: 'Doors at 9', requiresAck: true, recipients: { create: { orgId, personId: ids.person } } } });
  return ids;
}
