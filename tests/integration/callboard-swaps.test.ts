import { beforeEach, describe, expect, it } from 'vitest';
import { advanceClock, now } from '@/core/clock';
import { db } from '@/core/db';
import '@/lib/messages';
import { answerSwap, askSwap, decideSwap, withdrawSwap } from '@/lib/swaps';
import { drainOutbox } from '@/modules/notifications/outbox';
import { resetAuthTables } from '../helpers/auth';
import { addMember, makeOrg } from '../helpers/org';

beforeEach(async () => { advanceClock(0); await resetAuthTables(); });
const HOUR = 3_600_000;

// Two days out, Front of house (Marcus leads, Priya is deputy): Tom has the morning Greeter shift, Jen the
// afternoon one, and Marcus himself works the evening. Ana is on Catering, which Priya leads.
async function stage() {
  const org = await makeOrg();
  const orgId = org.id;
  await addMember(orgId, 'owner', 'dana@example.test');
  const mk = (name: string, mobile: string) => db.person.create({ data: { orgId, name, mobile, kind: 'volunteer' } });
  const [marcus, priya, tom, jen, ana] = await Promise.all([mk('Marcus Bell', '+15550100001'), mk('Priya Nair', '+15550100002'), mk('Tom Alvarez', '+15550100006'), mk('Jen Park', '+15550100003'), mk('Ana Lima', '+15550100004')]);
  const event = await db.event.create({ data: { orgId, name: 'Spring Expo', status: 'confirmed', timezone: 'UTC' } });
  const scope = { orgId, eventId: event.id };
  const date = new Date(now().getTime() + 2 * 24 * HOUR); date.setUTCHours(0, 0, 0, 0);
  const day = await db.eventDay.create({ data: { ...scope, date } });
  const foh = await db.aor.create({ data: { ...scope, name: 'Front of house', leadId: marcus!.id, deputyId: priya!.id } });
  const back = await db.aor.create({ data: { ...scope, name: 'Back of house', leadId: priya!.id } });
  const area = (aorId: string, name: string) => db.area.create({ data: { ...scope, aorId, name } });
  const position = async (aorId: string, name: string) => db.position.create({ data: { ...scope, areaId: (await area(aorId, name)).id, name } });
  const [greeter, runner] = [await position(foh.id, 'Greeter'), await position(back.id, 'Runner')];
  const shift = (positionId: string, from: number, to: number) =>
    db.shift.create({ data: { ...scope, positionId, dayId: day.id, callAt: new Date(date.getTime() + (from - 1) * HOUR), startAt: new Date(date.getTime() + from * HOUR), endAt: new Date(date.getTime() + to * HOUR), needed: 1 } });
  const [morning, afternoon, evening, catering] = [await shift(greeter.id, 8, 12), await shift(greeter.id, 13, 17), await shift(greeter.id, 18, 21), await shift(runner.id, 13, 17)];
  const on = (shiftId: string, personId: string, status: 'confirmed' | 'declined' = 'confirmed') => db.assignment.create({ data: { ...scope, shiftId, personId, status, t1SentAt: now() } });
  const [a, b, m, c] = [await on(morning.id, tom!.id), await on(afternoon.id, jen!.id), await on(evening.id, marcus!.id), await on(catering.id, ana!.id)];
  const lead = (p: { id: string; name: string }, aorIds: string[]) => ({ name: p.name, personId: p.id, aorIds });
  return { orgId, scope, marcus: marcus!, priya: priya!, tom: tom!, jen: jen!, ana: ana!, foh, back, morning, afternoon, evening, a, b, m, c, lead, actor: { orgId, userId: null } };
}
const shiftOf = async (id: string) => (await db.assignment.findUniqueOrThrow({ where: { id } })).shiftId;
const sent = async () => { await drainOutbox(); return db.capturedMessage.findMany({ orderBy: { createdAt: 'asc' } }); };
const theSwap = () => db.swap.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });

describe('swaps', () => {
  it('ask, accept, approve: the two assignments change shifts together and everyone is told', async () => {
    const s = await stage();
    expect(await askSwap(s.tom, s.scope, s.a.id, s.b.id)).toBe('swap_asked');
    const { id } = await theSwap();
    expect(await answerSwap(s.jen, s.scope, id, true)).toBe('swap_accepted');
    expect([await shiftOf(s.a.id), await shiftOf(s.b.id)]).toEqual([s.morning.id, s.afternoon.id]); // nothing moves before the lead
    expect(await decideSwap(s.lead(s.marcus, [s.foh.id]), s.actor, s.scope, id, true)).toBe('swap_approved');

    expect([await shiftOf(s.a.id), await shiftOf(s.b.id)]).toEqual([s.afternoon.id, s.morning.id]);
    const tom = await db.assignment.findUniqueOrThrow({ where: { id: s.a.id } });
    expect([tom.personId, tom.status, tom.t1SentAt]).toEqual([s.tom.id, 'confirmed', null]); // the pack goes out again, for the new shift
    expect(await theSwap()).toMatchObject({ status: 'approved', decidedBy: 'Marcus Bell' });

    const msgs = await sent();
    expect(msgs.map((x) => x.to)).toEqual([s.jen.mobile, s.tom.mobile, s.marcus.mobile, s.tom.mobile, s.jen.mobile]);
    expect(msgs[0]!.body).toContain('Tom Alvarez asks to swap');
    expect(msgs[2]!.body).toContain('Tom Alvarez and Jen Park want to swap');
    expect(msgs[3]!.body).toMatch(/approved\. You now have Greeter .*1:00 PM/);
    expect(await db.auditEvent.count({ where: { action: { startsWith: 'swap.' } } })).toBe(3);
  });

  it('only the asker offers their shift, only the colleague answers, only that area’s lead approves', async () => {
    const s = await stage();
    expect(await askSwap(s.jen, s.scope, s.a.id, s.b.id)).toBe('swap_none'); // Tom's shift is not Jen's to offer
    expect(await askSwap(s.tom, { ...s.scope, eventId: s.orgId }, s.a.id, s.b.id)).toBe('swap_none'); // nor from another event's link
    await askSwap(s.tom, s.scope, s.a.id, s.b.id);
    const { id } = await theSwap();
    expect(await answerSwap(s.tom, s.scope, id, true)).toBe('swap_none'); // the asker cannot accept for the colleague
    expect(await decideSwap(s.lead(s.marcus, [s.foh.id]), s.actor, s.scope, id, true)).toBe('swap_none'); // not agreed yet
    await answerSwap(s.jen, s.scope, id, true);
    expect(await decideSwap(s.lead(s.priya, [s.back.id]), s.actor, s.scope, id, true)).toBe('swap_none'); // a lead, of another area
    expect(await decideSwap(s.lead(s.tom, []), s.actor, s.scope, id, true)).toBe('swap_none');
    expect(await decideSwap({ name: 'the planner' }, s.actor, { orgId: s.marcus.id }, id, true)).toBe('swap_none'); // another org
    expect([await shiftOf(s.a.id), await shiftOf(s.b.id)]).toEqual([s.morning.id, s.afternoon.id]);
    expect(await decideSwap({ name: 'the planner' }, s.actor, { orgId: s.orgId }, id, true)).toBe('swap_approved'); // the planner can, for any area
  });

  it('a lead who is part of the swap cannot approve it; the deputy is asked instead', async () => {
    const s = await stage();
    await askSwap(s.marcus, s.scope, s.m.id, s.b.id);
    const { id } = await theSwap();
    await answerSwap(s.jen, s.scope, id, true);
    expect((await sent()).at(-1)).toMatchObject({ to: s.priya.mobile });
    expect(await decideSwap(s.lead(s.marcus, [s.foh.id]), s.actor, s.scope, id, true)).toBe('swap_own');
    expect(await shiftOf(s.m.id)).toBe(s.evening.id);
    expect(await decideSwap(s.lead(s.priya, [s.foh.id]), s.actor, s.scope, id, true)).toBe('swap_approved');
  });

  it('refuses a swap across areas, onto a double booking, onto a shift already answered, or while one is waiting', async () => {
    const s = await stage();
    expect(await askSwap(s.tom, s.scope, s.a.id, s.c.id)).toBe('swap_area');
    // Jen also works the morning somewhere else: she cannot take Tom's morning.
    const other = await db.event.create({ data: { orgId: s.orgId, name: 'Other', status: 'confirmed' } });
    const clash = await db.assignment.create({ data: { orgId: s.orgId, eventId: other.id, personId: s.jen.id, status: 'invited', shiftId: (await db.shift.create({ data: { orgId: s.orgId, eventId: other.id, positionId: s.morning.positionId, dayId: s.morning.dayId, callAt: s.morning.callAt, startAt: s.morning.startAt, endAt: s.morning.endAt, needed: 1 } })).id } });
    expect(await askSwap(s.tom, s.scope, s.a.id, s.b.id)).toBe('swap_clash');
    await db.assignment.delete({ where: { id: clash.id } });
    const declined = await db.assignment.create({ data: { ...s.scope, shiftId: s.afternoon.id, personId: s.tom.id, status: 'declined' } });
    expect(await askSwap(s.tom, s.scope, s.a.id, s.b.id)).toBe('swap_held');
    await db.assignment.delete({ where: { id: declined.id } });

    expect(await askSwap(s.tom, s.scope, s.a.id, s.b.id)).toBe('swap_asked');
    expect(await askSwap(s.marcus, s.scope, s.m.id, s.b.id)).toBe('swap_busy');
    expect(await db.swap.count()).toBe(1);
    expect(await sent()).toHaveLength(1);
  });

  it('a shift that changed after both agreed cancels the swap and moves nobody', async () => {
    const s = await stage();
    await askSwap(s.tom, s.scope, s.a.id, s.b.id);
    const { id } = await theSwap();
    await answerSwap(s.jen, s.scope, id, true);
    await db.assignment.update({ where: { id: s.b.id }, data: { status: 'released' } });
    expect(await decideSwap(s.lead(s.marcus, [s.foh.id]), s.actor, s.scope, id, true)).toBe('swap_stale');
    expect(await theSwap()).toMatchObject({ status: 'cancelled' });
    expect([await shiftOf(s.a.id), await shiftOf(s.b.id)]).toEqual([s.morning.id, s.afternoon.id]);
    expect((await sent()).at(-1)!.body).toContain('is off (a shift changed)');
    // and the dead swap does not block a new one on Tom's shift
    await db.swap.update({ where: { id }, data: { status: 'accepted' } });
    expect(await askSwap(s.tom, s.scope, s.a.id, s.m.id)).toBe('swap_asked');
    expect(await db.swap.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'cancelled' });
  });

  it('two approvals at once exchange the shifts once; a swap past call time is dead', async () => {
    const s = await stage();
    await askSwap(s.tom, s.scope, s.a.id, s.b.id);
    const { id } = await theSwap();
    await answerSwap(s.jen, s.scope, id, true);
    const by = s.lead(s.marcus, [s.foh.id]);
    const both = await Promise.all([decideSwap(by, s.actor, s.scope, id, true), decideSwap(by, s.actor, s.scope, id, true)]);
    expect(both.filter((r) => r === 'swap_approved')).toHaveLength(1);
    expect([await shiftOf(s.a.id), await shiftOf(s.b.id)]).toEqual([s.afternoon.id, s.morning.id]);
    expect((await sent()).filter((x) => x.body.includes('is approved'))).toHaveLength(2);

    expect(await askSwap(s.marcus, s.scope, s.m.id, s.a.id)).toBe('swap_asked');
    advanceClock(2 * 24 * HOUR); // Tom's afternoon call time has passed
    expect(await answerSwap(s.tom, s.scope, (await theSwap()).id, true)).toBe('swap_stale');
    expect(await shiftOf(s.m.id)).toBe(s.evening.id);
  });

  it('decline, refuse and withdraw each tell the other side; a sixth ask in a day is refused', async () => {
    const s = await stage();
    await askSwap(s.tom, s.scope, s.a.id, s.b.id);
    expect(await answerSwap(s.jen, s.scope, (await theSwap()).id, false)).toBe('swap_declined');
    expect((await sent()).at(-1)).toMatchObject({ to: s.tom.mobile, body: expect.stringContaining('Jen declined') });

    await askSwap(s.tom, s.scope, s.a.id, s.b.id);
    await answerSwap(s.jen, s.scope, (await theSwap()).id, true);
    expect(await decideSwap(s.lead(s.marcus, [s.foh.id]), s.actor, s.scope, (await theSwap()).id, false)).toBe('swap_refused');
    expect((await sent()).filter((x) => x.body.includes('refused by Marcus Bell')).map((x) => x.to).sort()).toEqual([s.jen.mobile, s.tom.mobile].sort());
    expect([await shiftOf(s.a.id), await shiftOf(s.b.id)]).toEqual([s.morning.id, s.afternoon.id]);

    for (let i = 0; i < 3; i++) {
      expect(await askSwap(s.tom, s.scope, s.a.id, s.b.id)).toBe('swap_asked');
      expect(await withdrawSwap(s.tom, s.scope, (await theSwap()).id)).toBe('swap_withdrawn');
    }
    expect(await withdrawSwap(s.tom, s.scope, (await theSwap()).id)).toBe('swap_none'); // already withdrawn
    expect(await askSwap(s.tom, s.scope, s.a.id, s.b.id)).toBe('swap_limit');
  });
});
