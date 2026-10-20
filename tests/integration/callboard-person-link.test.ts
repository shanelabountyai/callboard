import { beforeEach, describe, expect, it } from 'vitest';
import { advanceClock, now } from '@/core/clock';
import { db } from '@/core/db';
import { createEvent } from '@/app/o/[org]/events/actions';
import { POST as act } from '@/app/p/[token]/act/route';
import { POST as respond } from '@/app/p/[token]/respond/route';
import '@/lib/messages';
import { resetAuthTables } from '../helpers/auth';
import { NavSignal } from '../helpers/next';
import { actAs, makeOrg } from '../helpers/org';
import { stage } from '../helpers/stage';

// The person's link is the only credential on /p/[token]: what it may change, and what it may not.
beforeEach(async () => { advanceClock(0); await resetAuthTables(); });
const MIN = 60_000;
const HOUR = 60 * MIN;
const went = (p: Promise<unknown>) => p.then((r) => r, (e) => (e instanceof NavSignal ? e.to : Promise.reject(e)));
const same = { origin: 'http://localhost', host: 'localhost' };
const row = (id: string) => db.assignment.findUniqueOrThrow({ where: { id } });

const answer = (token: string, assignment: string, a: 'confirm' | 'decline') =>
  respond(new Request(`http://localhost/p/${token}/respond`, { method: 'POST', headers: same, body: new URLSearchParams({ assignment, answer: a }) }), { params: Promise.resolve({ token }) });
const tap = (token: string, body: Record<string, string>, headers: Record<string, string> = same) =>
  act(new Request(`http://localhost/p/${token}/act`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ token }) });

describe('"Can’t make it" after the fact', () => {
  it('cannot erase a worked shift or a no-show from the record once the shift is over', async () => {
    const s = await stage('live'); // the morning ended an hour ago: Jen worked it, Tom never came
    const jen = await s.token(s.jen.id);
    const tom = await s.token(s.tom.id);

    expect((await answer(jen, s.aJen.id, 'decline')).headers.get('location')).toContain('done=locked');
    expect((await row(s.aJen.id)).status).toBe('confirmed');
    expect((await answer(tom, s.aTom.id, 'decline')).headers.get('location')).toContain('done=locked');
    expect((await row(s.aTom.id)).status).toBe('confirmed');
    expect(await db.auditEvent.count({ where: { action: 'assignment.declined' } })).toBe(0);
  });

  it('is refused once checked in or once a no-show alert is up, and still works before the shift', async () => {
    const s = await stage('live');
    const t = now();
    const scope = { orgId: s.orgId, eventId: s.event.id };
    const day = await db.eventDay.findFirstOrThrow({ where: scope });
    const later = await db.shift.create({ data: { ...scope, positionId: s.greeter.id, dayId: day.id, callAt: new Date(t.getTime() - 30 * MIN), startAt: t, endAt: new Date(t.getTime() + 4 * HOUR), needed: 3 } });
    const mk = (personId: string, data: object = {}) => db.assignment.create({ data: { ...scope, shiftId: later.id, personId, status: 'confirmed', ...data } });
    const here = await mk(s.jen.id, { checkedInAt: new Date(t.getTime() - 20 * MIN), checkInMethod: 'self' });
    const absent = await mk(s.tom.id);
    await db.alert.create({ data: { ...scope, kind: 'no_show', personId: s.tom.id, assignmentId: absent.id, step: 0, openedAt: t, steppedAt: t } });
    const tomorrow = await db.shift.create({ data: { ...scope, positionId: s.greeter.id, dayId: day.id, callAt: new Date(t.getTime() + 24 * HOUR), startAt: new Date(t.getTime() + 25 * HOUR), endAt: new Date(t.getTime() + 29 * HOUR), needed: 1 } });
    const ahead = await db.assignment.create({ data: { ...scope, shiftId: tomorrow.id, personId: s.ana.id, status: 'confirmed' } });

    expect((await answer(await s.token(s.jen.id), here.id, 'decline')).headers.get('location')).toContain('done=locked');
    expect((await row(here.id)).status).toBe('confirmed');
    expect((await answer(await s.token(s.tom.id), absent.id, 'decline')).headers.get('location')).toContain('done=locked');
    expect((await row(absent.id)).status).toBe('confirmed');

    expect((await answer(await s.token(s.ana.id), ahead.id, 'decline')).headers.get('location')).toContain('done=decline');
    expect((await row(ahead.id)).status).toBe('declined');
  });

  it('answers only for the link’s own person, from the same origin', async () => {
    const s = await stage('live');
    const t = now();
    const scope = { orgId: s.orgId, eventId: s.event.id };
    const day = await db.eventDay.findFirstOrThrow({ where: scope });
    const tomorrow = await db.shift.create({ data: { ...scope, positionId: s.greeter.id, dayId: day.id, callAt: new Date(t.getTime() + 24 * HOUR), startAt: new Date(t.getTime() + 25 * HOUR), endAt: new Date(t.getTime() + 29 * HOUR), needed: 1 } });
    const anas = await db.assignment.create({ data: { ...scope, shiftId: tomorrow.id, personId: s.ana.id, status: 'invited' } });
    const tom = await s.token(s.tom.id);

    await answer(tom, anas.id, 'decline'); // Tom's link, Ana's row
    expect((await row(anas.id)).status).toBe('invited');
    const cross = await respond(new Request(`http://localhost/p/${tom}/respond`, { method: 'POST', headers: { origin: 'https://evil.example', host: 'localhost' }, body: new URLSearchParams({ assignment: anas.id, answer: 'confirm' }) }), { params: Promise.resolve({ token: tom }) });
    expect(cross.status).toBe(403);
    const unknown = await respond(new Request('http://localhost/p/nope/respond', { method: 'POST', headers: same, body: new URLSearchParams({ assignment: anas.id, answer: 'confirm' }) }), { params: Promise.resolve({ token: 'nope' }) });
    expect(unknown.status).toBe(404);
  });
});

describe('day-of taps from a link', () => {
  // A shift on now: call 30 minutes ago, Tom and Jen confirmed and not yet here; Marcus leads their area.
  async function onNow() {
    const s = await stage('live');
    const t = now();
    const scope = { orgId: s.orgId, eventId: s.event.id };
    const day = await db.eventDay.findFirstOrThrow({ where: scope });
    const shift = await db.shift.create({ data: { ...scope, positionId: s.greeter.id, dayId: day.id, callAt: new Date(t.getTime() - 30 * MIN), startAt: t, endAt: new Date(t.getTime() + 4 * HOUR), needed: 2 } });
    const nowTom = await db.assignment.create({ data: { ...scope, shiftId: shift.id, personId: s.tom.id, status: 'confirmed' } });
    const nowJen = await db.assignment.create({ data: { ...scope, shiftId: shift.id, personId: s.jen.id, status: 'confirmed' } });
    return { ...s, t, shift, nowTom, nowJen };
  }

  it('a person checks in only themself; their lead can check in anyone in the area; a lead elsewhere cannot', async () => {
    const s = await onNow();
    expect((await tap(await s.token(s.jen.id), { kind: 'checkin', assignment: s.nowTom.id })).status).toBe(404);
    expect((await row(s.nowTom.id)).checkedInAt).toBeNull();
    expect((await tap(await s.token(s.sofia.id), { kind: 'checkin', assignment: s.nowTom.id })).status).toBe(404); // Sofia leads the Exhibit floor, not Registration

    expect((await tap(await s.token(s.marcus.id), { kind: 'checkin', assignment: s.nowTom.id })).status).toBe(200);
    expect((await row(s.nowTom.id)).checkInMethod).toBe('lead');
    expect((await tap(await s.token(s.jen.id), { kind: 'checkin', assignment: s.nowJen.id })).status).toBe(200);
    expect((await row(s.nowJen.id)).checkInMethod).toBe('self');
  });

  it('a device clock in the future is replaced by the server’s; an offline tap from earlier keeps its time', async () => {
    const s = await onNow();
    const ahead = new Date(s.t.getTime() + 2 * HOUR).toISOString();
    expect((await tap(await s.token(s.tom.id), { kind: 'checkin', assignment: s.nowTom.id, at: ahead })).status).toBe(200);
    const tomIn = (await row(s.nowTom.id)).checkedInAt!;
    expect(tomIn.getTime()).toBeLessThan(new Date(ahead).getTime());
    expect(Math.abs(tomIn.getTime() - s.t.getTime())).toBeLessThan(60_000);

    const earlier = new Date(s.t.getTime() - 10 * MIN);
    expect((await tap(await s.token(s.jen.id), { kind: 'checkin', assignment: s.nowJen.id, at: earlier.toISOString() })).status).toBe(200);
    expect((await row(s.nowJen.id)).checkedInAt!.getTime()).toBe(earlier.getTime());
  });

  it('refuses another origin, a bad body, someone else’s message and an alert outside the lead’s area', async () => {
    const s = await onNow();
    const jen = await s.token(s.jen.id);
    expect((await tap(jen, { kind: 'checkin', assignment: s.nowJen.id }, { origin: 'https://evil.example', host: 'localhost' })).status).toBe(403);
    expect((await row(s.nowJen.id)).checkedInAt).toBeNull();
    expect((await tap(jen, { kind: 'release', assignment: s.nowTom.id })).status).toBe(400);
    expect((await tap(jen, { kind: 'checkin' })).status).toBe(400);

    const scope = { orgId: s.orgId, eventId: s.event.id };
    const b = await db.broadcast.create({ data: { ...scope, audience: 'Whole event', body: 'Doors at 9', requiresAck: true } });
    const tomsCopy = await db.broadcastRecipient.create({ data: { orgId: s.orgId, broadcastId: b.id, personId: s.tom.id } });
    expect((await tap(jen, { kind: 'ack', recipient: tomsCopy.id })).status).toBe(404);
    expect((await db.broadcastRecipient.findUniqueOrThrow({ where: { id: tomsCopy.id } })).ackedAt).toBeNull();

    const fohAor = await db.aor.findFirstOrThrow({ where: { ...scope, leadId: s.marcus.id } });
    const alert = await db.alert.create({ data: { ...scope, kind: 'no_show', personId: s.tom.id, assignmentId: s.nowTom.id, aorId: fohAor.id, step: 0, openedAt: s.t, steppedAt: s.t } });
    expect((await tap(await s.token(s.sofia.id), { kind: 'resolve', alert: alert.id })).status).toBe(404);
    expect((await tap(jen, { kind: 'resolve', alert: alert.id })).status).toBe(404);
    expect((await db.alert.findUniqueOrThrow({ where: { id: alert.id } })).resolvedAt).toBeNull();
    expect((await tap(await s.token(s.marcus.id), { kind: 'resolve', alert: alert.id })).status).toBe(200);
    expect((await db.alert.findUniqueOrThrow({ where: { id: alert.id } })).resolvedAt).not.toBeNull();
  });

  it('a link from another org’s event cannot touch this event’s rows', async () => {
    const s = await onNow();
    const other = await makeOrg('globex');
    const ev = await db.event.create({ data: { orgId: other.id, name: 'Globex Day', status: 'live' } });
    const stranger = await db.person.create({ data: { orgId: other.id, name: 'Sam Stone', mobile: '+15550100099', kind: 'volunteer' } });
    const { ensurePersonLink } = await import('@/lib/links');
    const url = await ensurePersonLink(db, { orgId: other.id, eventId: ev.id, personId: stranger.id }, new Date(s.t.getTime() + 24 * HOUR));
    const token = url.split('/p/')[1]!;
    expect((await tap(token, { kind: 'checkin', assignment: s.nowTom.id })).status).toBe(404);
    await answer(token, s.nowTom.id, 'decline');
    expect(await row(s.nowTom.id)).toMatchObject({ status: 'confirmed', checkedInAt: null });
  });
});

describe('event dates', () => {
  it('a day that does not exist is refused, not rolled into the next month', async () => {
    const s = await stage('live');
    await actAs(s.dana.id, 'acme');
    expect(await went(createEvent('acme', { name: 'Leap Expo', startsOn: '2027-02-29', endsOn: '2027-03-01' }))).toEqual({ error: 'Dates must be YYYY-MM-DD.' });
    expect(await went(createEvent('acme', { name: 'Leap Expo', startsOn: '2027-02-27', endsOn: '2027-02-30' }))).toEqual({ error: 'Dates must be YYYY-MM-DD.' });
    expect(await db.event.count({ where: { name: 'Leap Expo' } })).toBe(0);
    expect(await went(createEvent('acme', { name: 'Leap Expo', startsOn: '2028-02-28', endsOn: '2028-03-01' }))).toContain('/o/acme/events/');
    const days = await db.eventDay.findMany({ where: { event: { name: 'Leap Expo' } }, orderBy: { date: 'asc' } });
    expect(days.map((d) => d.date.toISOString().slice(0, 10))).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });
});
