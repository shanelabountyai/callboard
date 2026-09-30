import { beforeEach, describe, expect, it } from 'vitest';
import { advanceClock } from '@/core/clock';
import { db } from '@/core/db';
import { addShift, deleteArea, saveLocation, saveRole, saveShift } from '@/app/o/[org]/events/[id]/actions';
import { createCard } from '@/app/o/[org]/cards/actions';
import '@/lib/messages';
import { resetAuthTables } from '../helpers/auth';
import { NavSignal } from '../helpers/next';
import { actAs } from '../helpers/org';
import { stage } from '../helpers/stage';

beforeEach(async () => { advanceClock(0); await resetAuthTables(); });
const went = (p: Promise<unknown>) => p.then((r) => r, (e) => (e instanceof NavSignal ? e.to : Promise.reject(e)));
const texts = (mobile: string) => db.capturedMessage.count({ where: { to: mobile } });

// Marcus leads Front of house (Registration), Sofia leads Exhibit floor (Exhibit Hall). Dana plans.
describe('the plain event page (S1)', () => {
  it('one form adds the shift and makes the location and role it names, once', async () => {
    const s = await stage('staffing');
    await actAs(s.dana.id, 'acme');
    await went(createCard('acme', { title: 'Coat check', duties: 'Take coats' }));
    const day = await db.eventDay.findFirstOrThrow({ where: { eventId: s.event.id } });
    const form = { eventId: s.event.id, location: 'Cloakroom', role: 'coat check', dayId: 'all', start: '08:00', end: '12:00', needed: 3 };

    expect(await went(addShift('acme', { ...form, leadId: s.tom.id }))).toBe(`/o/acme/events/${s.event.id}`);
    expect(await went(addShift('acme', { ...form, location: 'cloakroom', dayId: day.id, start: '13:00', end: '17:00' }))).toContain('/events/');

    const area = await db.area.findFirstOrThrow({ where: { name: 'Cloakroom' }, include: { aor: true, positions: { include: { card: true, shifts: { orderBy: { startAt: 'asc' } } } } } });
    expect(await db.area.count({ where: { eventId: s.event.id } })).toBe(3); // the second form matched the first one's location
    expect(area.aor).toMatchObject({ name: 'Cloakroom', leadId: s.tom.id }); // a blank lead on the second form left it alone
    expect(area.positions).toHaveLength(1);
    expect(area.positions[0]).toMatchObject({ name: 'coat check', targetHeadcount: 3, card: { title: 'Coat check' } });
    const [first] = area.positions[0]!.shifts;
    expect(area.positions[0]!.shifts).toHaveLength(2);
    expect(first).toMatchObject({ needed: 3, overbookPct: s.event.overbookPct });
    expect(first!.startAt.getTime() - first!.callAt.getTime()).toBe(s.event.callOffsetMin * 60_000);
    expect(await texts(s.tom.mobile)).toBe(1); // his roster link, once

    expect(await addShift('acme', { ...form, start: '8am' })).toEqual({ error: 'Times must be HH:MM (24-hour).' });
  });

  it('a lead picked for a location joins, fills or starts a team, and an emptied team goes', async () => {
    const s = await stage('staffing');
    await actAs(s.dana.id, 'acme');
    const teams = () => db.aor.findMany({ where: { eventId: s.event.id }, orderBy: { name: 'asc' }, include: { areas: { select: { name: true }, orderBy: { name: 'asc' } } } });

    // Marcus takes the hall too: it joins his team, Sofia's is left empty and goes, and nobody is texted.
    await went(saveLocation('acme', { id: s.hall.id, leadId: s.marcus.id }));
    expect(await teams()).toMatchObject([{ name: 'Front of house', leadId: s.marcus.id, areas: [{ name: 'Exhibit Hall' }, { name: 'Registration' }] }]);
    expect(await texts(s.marcus.mobile)).toBe(0);

    // Sofia takes the hall back: Marcus still leads Registration, so she gets a team of her own and her link.
    await went(saveLocation('acme', { id: s.hall.id, leadId: s.sofia.id, deputyId: s.jen.id, radioChannel: '4' }));
    expect(await teams()).toMatchObject([{ name: 'Exhibit Hall', leadId: s.sofia.id, deputyId: s.jen.id, radioChannel: '4' }, { name: 'Front of house', areas: [{ name: 'Registration' }] }]);
    expect([await texts(s.sofia.mobile), await texts(s.jen.mobile)]).toEqual([1, 1]);

    // A one-location team changes hands in place and keeps its name, deputy and radio.
    await went(saveLocation('acme', { id: s.hall.id, leadId: s.tom.id }));
    expect((await teams())[0]).toMatchObject({ name: 'Exhibit Hall', leadId: s.tom.id, deputyId: s.jen.id, radioChannel: '4' });
    expect(await saveLocation('acme', { id: s.hall.id, deputyId: s.tom.id })).toEqual({ error: 'Lead and deputy must be different people.' });

    // No lead: the location rolls up to the planner. A deputy needs a lead.
    await went(saveLocation('acme', { id: s.hall.id, leadId: '' }));
    expect((await teams()).map((t) => t.name)).toEqual(['Front of house']);
    expect(await saveLocation('acme', { id: s.hall.id, deputyId: s.jen.id })).toEqual({ error: 'Pick a lead before a deputy.' });
    expect((await db.area.findUniqueOrThrow({ where: { id: s.hall.id } })).aorId).toBeNull();
  });

  it('a save changes only what the form sent, and deleting the last location of a team removes the team', async () => {
    const s = await stage('staffing');
    await actAs(s.dana.id, 'acme');
    await went(saveRole('acme', { id: s.greeter.id, uniform: 'Black polo', graceMin: '5', isFloat: 'on' }));
    expect(await db.position.findUniqueOrThrow({ where: { id: s.greeter.id } })).toMatchObject({ name: 'Greeter', uniform: 'Black polo', graceMin: 5, isFloat: true });
    await went(saveRole('acme', { id: s.greeter.id, graceMin: '' }));
    expect(await db.position.findUniqueOrThrow({ where: { id: s.greeter.id } })).toMatchObject({ uniform: 'Black polo', graceMin: null, isFloat: true });
    expect(await saveRole('acme', { id: s.greeter.id, minHeadcount: 4 })).toEqual({ error: 'The minimum cannot be more than how many you want.' });

    const shift = await db.shift.findFirstOrThrow({ where: { positionId: s.greeter.id } });
    await went(saveShift('acme', { id: shift.id, callOffsetMin: 30 }));
    const after = await db.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect([after.startAt.getTime() - after.callAt.getTime(), after.needed]).toEqual([30 * 60_000, shift.needed]);

    const empty = await db.area.create({ data: { orgId: s.orgId, eventId: s.event.id, name: 'Cloakroom' } });
    await went(saveLocation('acme', { id: empty.id, leadId: s.tom.id }));
    expect(await db.aor.count({ where: { eventId: s.event.id } })).toBe(3);
    expect(await went(deleteArea('acme', { id: empty.id }))).toBe(`/o/acme/events/${s.event.id}?edit=1`);
    expect(await db.aor.count({ where: { eventId: s.event.id } })).toBe(2);
  });
});
