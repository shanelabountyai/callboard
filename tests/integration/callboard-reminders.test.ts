import { beforeEach, describe, expect, it } from 'vitest';
import { advanceClock, now } from '@/core/clock';
import { db } from '@/core/db';
import { hashToken } from '@/core/tokens';
import { readPersonLink } from '@/lib/links';
import '@/lib/messages';
import { runReminders } from '@/lib/reminders';
import { drainOutbox } from '@/modules/notifications/outbox';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

beforeEach(resetAuthTables);

async function stage() {
  const org = await makeOrg();
  const orgId = org.id;
  const t = now();
  const jen = await db.person.create({ data: { orgId, name: 'Jen Park', mobile: '+15550102001', email: 'jen@example.test', kind: 'employee' } });
  const tom = await db.person.create({ data: { orgId, name: 'Tom Reyes', mobile: '+15550102002', kind: 'volunteer' } });
  const event = await db.event.create({ data: { orgId, name: 'Spring Expo', status: 'staffing' } });
  const date = new Date(t.getTime() + 5 * 86_400_000);
  date.setUTCHours(0, 0, 0, 0);
  const day = await db.eventDay.create({ data: { orgId, eventId: event.id, date } });
  const area = await db.area.create({ data: { orgId, eventId: event.id, name: 'Registration', location: 'North Lobby' } });
  const pos = await db.position.create({ data: { orgId, eventId: event.id, areaId: area.id, name: 'Greeter', uniform: 'black polo' } });
  const startAt = new Date(date.getTime() + 14 * 3_600_000);
  const shift = await db.shift.create({
    data: { orgId, eventId: event.id, positionId: pos.id, dayId: day.id, callAt: new Date(startAt.getTime() - 45 * 60_000), startAt, endAt: new Date(startAt.getTime() + 4 * 3_600_000), needed: 2 },
  });
  // Jen was invited 3 days ago and confirmed; Tom was invited 3 days ago and never answered.
  const invitedAt = new Date(t.getTime() - 3 * 86_400_000);
  await db.assignment.create({ data: { orgId, eventId: event.id, shiftId: shift.id, personId: jen.id, status: 'confirmed', createdAt: invitedAt } });
  await db.assignment.create({ data: { orgId, eventId: event.id, shiftId: shift.id, personId: tom.id, status: 'invited', createdAt: invitedAt } });
  return { orgId, jen, tom, event, shift };
}

describe('reminders', () => {
  it('T-7 nudges only the unconfirmed, once; T-1 sends the pack to the confirmed and a last nudge to the rest', async () => {
    const { jen, tom, shift } = await stage();
    expect(await runReminders()).toEqual({ nudged: 1, packed: 0 }); // shift is 5 days out: inside T-7
    expect(await runReminders()).toEqual({ nudged: 0, packed: 0 }); // once
    await drainOutbox();
    const t7 = await db.capturedMessage.findMany({ orderBy: { createdAt: 'asc' } });
    expect(t7.map((m) => m.to)).toEqual([tom.mobile]); // Tom by SMS only: no email; Jen nothing
    expect(t7[0]!.body).toContain('in a week');
    expect(t7[0]!.body).toMatch(/\/p\/[\w-]+/);

    // Twelve hours before call time, measured from the shift: a fixed "4 days and an hour" only lands
    // inside T-1 when the suite runs after 12:15 UTC, because the shift is pinned to a UTC day.
    advanceClock(shift.callAt.getTime() - 12 * 3_600_000 - now().getTime());
    expect(await runReminders()).toEqual({ nudged: 1, packed: 1 });
    await drainOutbox();
    const all = await db.capturedMessage.findMany({ orderBy: { createdAt: 'asc' } });
    const pack = all.filter((m) => m.body.includes('tomorrow') && m.body.includes('Your card'));
    expect(pack.map((m) => m.to).sort()).toEqual([jen.email, jen.mobile].sort()); // Jen: SMS and email
    expect(pack[0]!.body).toContain('black polo');
    expect(pack[0]!.body).toContain('North Lobby');
    expect(all.filter((m) => m.to === tom.mobile)).toHaveLength(2);
  });

  it('the link in a message resolves to the person and event, and the database holds only its hash', async () => {
    const { tom, event } = await stage();
    await runReminders();
    await drainOutbox();
    const [msg] = await db.capturedMessage.findMany();
    const token = msg!.body.match(/\/p\/([\w-]+)/)![1]!;
    const link = await readPersonLink(token, '10.0.0.1');
    expect(link && link !== 'limited' && link.personId).toBe(tom.id);
    expect(link && link !== 'limited' && link.eventId).toBe(event.id);
    const rows = await db.personLink.findMany();
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]!.tokenHash).toBe(hashToken(token));
    expect(await readPersonLink('not-a-token', '10.0.0.1')).toBeNull();
  });
});
