import { now } from '@/core/clock';
import { db } from '@/core/db';
import { ensurePersonLink } from '@/lib/links';
import { addMember, makeOrg } from './org';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// A closed-out morning: Marcus leads Front of house (Registration), Sofia leads Exhibit floor (Exhibit Hall).
// At Registration Tom was confirmed and never came, Jen checked in on time, Ana declined. Dana plans.
export async function stage(status: 'live' | 'staffing' = 'live') {
  const org = await makeOrg();
  const orgId = org.id;
  const dana = await addMember(orgId, 'owner', 'dana@example.test');
  const t = now();
  const mk = (name: string, mobile: string) => db.person.create({ data: { orgId, name, mobile, kind: 'volunteer' } });
  const [marcus, sofia, tom, jen, ana] = await Promise.all([mk('Marcus Bell', '+15550100001'), mk('Sofia Reyes', '+15550100005'), mk('Tom Alvarez', '+15550100006'), mk('Jen Park', '+15550100003'), mk('Ana Lima', '+15550100007')]);
  const event = await db.event.create({ data: { orgId, name: 'Spring Expo', status, graceMin: 15 } });
  const date = new Date(t); date.setUTCHours(0, 0, 0, 0);
  const day = await db.eventDay.create({ data: { orgId, eventId: event.id, date } });
  const foh = await db.aor.create({ data: { orgId, eventId: event.id, name: 'Front of house', leadId: marcus!.id } });
  const floor = await db.aor.create({ data: { orgId, eventId: event.id, name: 'Exhibit floor', leadId: sofia!.id } });
  const reg = await db.area.create({ data: { orgId, eventId: event.id, aorId: foh.id, name: 'Registration' } });
  const hall = await db.area.create({ data: { orgId, eventId: event.id, aorId: floor.id, name: 'Exhibit Hall' } });
  const greeter = await db.position.create({ data: { orgId, eventId: event.id, areaId: reg.id, name: 'Greeter' } });
  const runner = await db.position.create({ data: { orgId, eventId: event.id, areaId: hall.id, name: 'Floor runner' } });
  const times = { callAt: new Date(t.getTime() - 6 * HOUR), startAt: new Date(t.getTime() - 5 * HOUR), endAt: new Date(t.getTime() - HOUR) };
  const shift = await db.shift.create({ data: { orgId, eventId: event.id, positionId: greeter.id, dayId: day.id, ...times, needed: 2 } });
  await db.shift.create({ data: { orgId, eventId: event.id, positionId: runner.id, dayId: day.id, ...times, needed: 1 } });
  const assign = (personId: string, data: object) => db.assignment.create({ data: { orgId, eventId: event.id, shiftId: shift.id, personId, ...data } });
  const aTom = await assign(tom!.id, { status: 'confirmed' });
  const aJen = await assign(jen!.id, { status: 'confirmed', checkedInAt: new Date(times.callAt.getTime() + 5 * MIN), checkInMethod: 'self', checkedOutAt: times.endAt, checkOutMethod: 'self' });
  const aAna = await assign(ana!.id, { status: 'declined', declineReason: 'illness' });
  const token = async (personId: string) => (await ensurePersonLink(db, { orgId, eventId: event.id, personId }, new Date(t.getTime() + 8 * DAY))).split('/p/')[1]!;
  return { orgId, dana, marcus: marcus!, sofia: sofia!, tom: tom!, jen: jen!, ana: ana!, event, reg, hall, greeter, aTom, aJen, aAna, token };
}
