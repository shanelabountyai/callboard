import { beforeEach, describe, expect, it } from 'vitest';
import { advanceClock } from '@/core/clock';
import { db } from '@/core/db';
import { deployFloat } from '@/app/o/[org]/events/[id]/board/actions';
import { invite, setAssignmentStatus } from '@/app/o/[org]/events/[id]/staff/actions';
import { POST as respond } from '@/app/p/[token]/respond/route';
import '@/lib/messages';
import { resetAuthTables } from '../helpers/auth';
import { NavSignal } from '../helpers/next';
import { actAs } from '../helpers/org';
import { stage } from '../helpers/stage';

beforeEach(async () => { advanceClock(0); await resetAuthTables(); });
const went = (p: Promise<unknown>) => p.then((r) => r, (e) => (e instanceof NavSignal ? e.to : Promise.reject(e)));
const statusOf = async (id: string) => (await db.assignment.findUniqueOrThrow({ where: { id } })).status;

// Spring Expo's one morning: Greeter and Floor runner run at the same time. Ana declined Greeter.
async function expo() {
  const s = await stage('live');
  await actAs(s.dana.id, 'acme');
  const greeter = await db.shift.findFirstOrThrow({ where: { positionId: s.greeter.id } });
  const runner = await db.shift.findFirstOrThrow({ where: { id: { not: greeter.id } } });
  const scope = { orgId: s.orgId, eventId: s.event.id };
  const pool = await db.position.create({ data: { ...scope, areaId: s.hall.id, name: 'Float', isFloat: true } });
  const float = await db.shift.create({ data: { ...scope, positionId: pool.id, dayId: greeter.dayId, callAt: greeter.callAt, startAt: greeter.startAt, endAt: greeter.endAt, needed: 2 } });
  const on = (shiftId: string, personId: string) => db.assignment.create({ data: { ...scope, shiftId, personId, status: 'confirmed', checkedInAt: greeter.callAt } });
  return { ...s, greeter, runner, float, on };
}

describe('availability: one double-booking rule on every path that gives someone a shift', () => {
  it('a float with another shift at that time is not deployed, and one who already answered for the shift is refused with a reason', async () => {
    const s = await expo();
    const kai = await db.person.create({ data: { orgId: s.orgId, name: 'Kai Moss', mobile: '+15550100008', kind: 'volunteer' } });
    const aKai = await s.on(s.float.id, kai.id);
    const other = await db.assignment.create({ data: { orgId: s.orgId, eventId: s.event.id, shiftId: s.greeter.id, personId: kai.id, status: 'invited' } });

    expect(await went(deployFloat('acme', { id: aKai.id, shiftId: s.runner.id }))).toEqual({ error: 'Kai Moss is already invited for Greeter at Spring Expo at the same time.' });
    expect((await db.assignment.findUniqueOrThrow({ where: { id: aKai.id } })).shiftId).toBe(s.float.id);

    await db.assignment.update({ where: { id: other.id }, data: { status: 'declined' } });
    expect(await went(deployFloat('acme', { id: aKai.id, shiftId: s.greeter.id }))).toEqual({ error: expect.stringContaining('already answered for that shift') }); // the declined row holds (shift, person)
    expect(await went(deployFloat('acme', { id: aKai.id, shiftId: s.runner.id }))).toContain('/board');
    expect((await db.assignment.findUniqueOrThrow({ where: { id: aKai.id } })).shiftId).toBe(s.runner.id);
  });

  it('a decline cannot be turned back into a yes, by the planner or the person, once the time has gone to another shift', async () => {
    const s = await expo();
    expect(await went(invite('acme', { shiftId: s.runner.id, [`p:${s.ana.id}`]: 'on' }))).toContain('/staff');

    expect(await went(setAssignmentStatus('acme', { id: s.aAna.id, status: 'confirmed' }))).toEqual({ error: 'Ana Lima is already invited for Floor runner at Spring Expo at the same time.' });
    const token = await s.token(s.ana.id);
    const say = (assignment: string, answer: string) =>
      respond(new Request(`http://localhost/p/${token}/respond`, { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost' }, body: new URLSearchParams({ assignment, answer }) }), { params: Promise.resolve({ token }) });
    expect((await say(s.aAna.id, 'confirm')).headers.get('location')).toContain('done=clash');
    expect(await statusOf(s.aAna.id)).toBe('declined');

    // The shift she was invited to is hers to confirm: its own row is not a clash with itself.
    const invited = await db.assignment.findFirstOrThrow({ where: { shiftId: s.runner.id, personId: s.ana.id } });
    expect((await say(invited.id, 'confirm')).headers.get('location')).toContain('done=confirm');
    expect(await statusOf(invited.id)).toBe('confirmed');
    // And a release frees her: the planner can then reopen the first one.
    await went(setAssignmentStatus('acme', { id: invited.id, status: 'released' }));
    expect(await went(setAssignmentStatus('acme', { id: s.aAna.id, status: 'confirmed' }))).toContain('/staff');
  });
});
