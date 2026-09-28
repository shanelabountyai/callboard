import { beforeEach, describe, expect, it } from 'vitest';
import { advanceClock, now } from '@/core/clock';
import { db } from '@/core/db';
import { createCard, saveCard } from '@/app/o/[org]/cards/actions';
import { createEvent, duplicateEvent, saveAsTemplate } from '@/app/o/[org]/events/actions';
import { setAreaPlaybook, setEventDefaults, setPositionCard, setStatus } from '@/app/o/[org]/events/[id]/actions';
import { invite } from '@/app/o/[org]/events/[id]/staff/actions';
import { createPlaybook, savePlaybook } from '@/app/o/[org]/playbooks/actions';
import { saveStandard } from '@/app/o/[org]/rules/actions';
import { POST as act } from '@/app/p/[token]/act/route';
import { runDayOf } from '@/lib/dayof';
import '@/lib/messages';
import { runReminders } from '@/lib/reminders';
import { buildReport, coverage, median } from '@/lib/report';
import { deviations, pickRules, standardOf } from '@/lib/rules';
import { drainOutbox } from '@/modules/notifications/outbox';
import { resetAuthTables } from '../helpers/auth';
import { NavSignal } from '../helpers/next';
import { actAs } from '../helpers/org';
import { stage } from '../helpers/stage';

beforeEach(async () => { advanceClock(0); await resetAuthTables(); });
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const went = (p: Promise<unknown>) => p.then(() => 'returned', (e) => (e instanceof NavSignal ? e.to : Promise.reject(e)));
const event = (id: string) => db.event.findUniqueOrThrow({ where: { id } });

describe('standard rules', () => {
  it('a planned event follows the standard, an event that said otherwise keeps its value, a live event is frozen', async () => {
    const s = await stage('live'); // Spring Expo, live, on the defaults
    await actAs(s.dana.id, 'acme');
    const std = pickRules(await standardOf(s.orgId, db));
    expect(std).toMatchObject({ graceMin: 15, callOffsetMin: 45, overbookPct: 20, stepMin: 10, helpStepMin: 5, nudgeDays: 7 });

    await went(createEvent('acme', { name: 'Autumn Expo', startsOn: '2027-10-01', endsOn: '2027-10-02' }));
    await went(createEvent('acme', { name: 'Winter Gala', startsOn: '2027-12-01', endsOn: '2027-12-01' }));
    const autumn = await db.event.findFirstOrThrow({ where: { name: 'Autumn Expo' } });
    const gala = await db.event.findFirstOrThrow({ where: { name: 'Winter Gala' } });
    await went(setEventDefaults('acme', { id: gala.id, graceMin: 5 })); // doors: a tighter grace, everything else left alone
    expect(deviations(await event(gala.id), std).map((r) => r.key)).toEqual(['graceMin']);
    expect(deviations(await event(autumn.id), std)).toEqual([]);

    await went(saveStandard('acme', { ...std, graceMin: 20, breaks: '15 minutes every 4 hours' }));
    expect(await event(autumn.id)).toMatchObject({ graceMin: 20, breaks: '15 minutes every 4 hours' }); // followed
    expect(await event(gala.id)).toMatchObject({ graceMin: 5, breaks: '15 minutes every 4 hours' }); // its own grace, the standard's breaks
    expect(await event(s.event.id)).toMatchObject({ graceMin: 15, breaks: '' }); // live: the rules it is running with
    const now2 = pickRules(await standardOf(s.orgId, db));
    expect(deviations(await event(s.event.id), now2).map((r) => r.key)).toEqual(['graceMin', 'breaks']);

    // Back on the standard means following it again.
    await went(setEventDefaults('acme', { id: gala.id, graceMin: 20 }));
    await went(saveStandard('acme', { ...now2, graceMin: 10 }));
    expect((await event(gala.id)).graceMin).toBe(10);

    expect(await saveStandard('acme', { ...now2, graceMin: 10 })).toEqual({ error: 'Nothing changed.' });
    expect(await saveStandard('acme', { ...now2, stepMin: 0 })).toEqual({ error: expect.stringContaining('No-show escalation cannot be under 1') });
    expect(await setEventDefaults('acme', { id: gala.id, nudgeDays: 45 })).toEqual({ error: expect.stringContaining('First reminder cannot be over 30') });
  });

  it('the escalation and reminder rules drive the sweeps', async () => {
    const s = await stage('live');
    await db.event.update({ where: { id: s.event.id }, data: { stepMin: 30 } });
    await db.alert.create({ data: { orgId: s.orgId, eventId: s.event.id, kind: 'no_show', personId: s.tom.id, assignmentId: s.aTom.id, aorId: s.reg.aorId, openedAt: now(), steppedAt: now() } }); // with Marcus, the lead
    advanceClock(15 * MIN);
    expect((await runDayOf()).escalated).toBe(0); // the standard 10 minutes would have moved it on
    advanceClock(35 * MIN); // an offset from the real clock, not a step
    expect((await runDayOf()).escalated).toBe(1);

    // An invite that has sat for two days on a shift ten days out: silent on the standard week, nudged at 14 days.
    const later = await db.event.create({ data: { orgId: s.orgId, name: 'Autumn Expo', status: 'staffing' } });
    const day = await db.eventDay.create({ data: { orgId: s.orgId, eventId: later.id, date: new Date('2027-10-01') } });
    const area = await db.area.create({ data: { orgId: s.orgId, eventId: later.id, name: 'Registration' } });
    const pos = await db.position.create({ data: { orgId: s.orgId, eventId: later.id, areaId: area.id, name: 'Greeter' } });
    const t = now().getTime();
    const shift = await db.shift.create({ data: { orgId: s.orgId, eventId: later.id, positionId: pos.id, dayId: day.id, callAt: new Date(t + 10 * DAY), startAt: new Date(t + 10 * DAY + HOUR), endAt: new Date(t + 10 * DAY + 5 * HOUR), needed: 1 } });
    await db.assignment.create({ data: { orgId: s.orgId, eventId: later.id, shiftId: shift.id, personId: s.ana.id, createdAt: new Date(t - 2 * DAY) } });
    expect((await runReminders()).nudged).toBe(0);
    await db.event.update({ where: { id: later.id }, data: { nudgeDays: 14 } });
    expect((await runReminders()).nudged).toBe(1);
    await drainOutbox();
    expect((await db.capturedMessage.findFirstOrThrow({ where: { to: s.ana.mobile } })).body).toContain('is in 14 days');
  });
});

describe('playbooks', () => {
  it('are versioned like cards: linear, and a live event keeps the version it ran with', async () => {
    const s = await stage('live');
    await actAs(s.dana.id, 'acme');
    expect(await went(createPlaybook('acme', { title: 'Registration', staffing: 'Greeter 8 to 9am: min 6, target 8\n\n', failurePoints: 'Printer 2 jams' }))).toBe('/o/acme/playbooks');
    const v1 = await db.playbook.findFirstOrThrow({ where: { key: 'registration' } });
    expect(v1).toMatchObject({ version: 1, staffing: 'Greeter 8 to 9am: min 6, target 8', callOffsetMin: null, changedBy: s.dana.id });
    expect(await createPlaybook('acme', { title: 'registration' })).toEqual({ error: expect.stringContaining('already in the library') });

    const planned = await db.event.create({ data: { orgId: s.orgId, name: 'Autumn Expo', status: 'staffing' } });
    const area = await db.area.create({ data: { orgId: s.orgId, eventId: planned.id, name: 'Registration' } });
    await went(setAreaPlaybook('acme', { id: s.reg.id, playbookId: v1.id }));
    await went(setAreaPlaybook('acme', { id: area.id, playbookId: v1.id }));

    await went(savePlaybook('acme', { id: v1.id, title: 'Registration', staffing: v1.staffing, failurePoints: v1.failurePoints, callOffsetMin: 60 }));
    const v2 = await db.playbook.findFirstOrThrow({ where: { key: 'registration', version: 2 } });
    expect(v2.callOffsetMin).toBe(60);
    expect((await db.area.findUniqueOrThrow({ where: { id: s.reg.id } })).playbookId).toBe(v1.id); // live: frozen
    expect((await db.area.findUniqueOrThrow({ where: { id: area.id } })).playbookId).toBe(v2.id); // planned: moved up
    expect(await savePlaybook('acme', { id: v1.id, title: 'Registration', equipment: '4 radios' })).toEqual({ error: expect.stringContaining('Version 2 was saved while you were editing') });
    await went(setAreaPlaybook('acme', { id: area.id, playbookId: '' }));
    expect((await db.area.findUniqueOrThrow({ where: { id: area.id } })).playbookId).toBeNull();
  });
});

describe('event templates', () => {
  it('save keeps the structure and drops the people; an event started from it is a copy on the latest library', async () => {
    const s = await stage('staffing');
    await actAs(s.dana.id, 'acme');
    await went(createCard('acme', { title: 'Greeter', duties: 'Welcome people' }));
    const card1 = await db.positionCard.findFirstOrThrow({ where: { key: 'greeter' } });
    await went(setPositionCard('acme', { id: s.greeter.id, cardId: card1.id }));
    await went(setEventDefaults('acme', { id: s.event.id, graceMin: 5, overbookPct: 50 }));

    expect(await went(saveAsTemplate('acme', { id: s.event.id, name: 'Expo template', attendanceBand: '250 to 1,000' }))).toBe('/o/acme/templates');
    const tpl = await db.event.findFirstOrThrow({ where: { isTemplate: true }, include: { aors: true, areas: true, positions: true, shifts: true, assignments: true, days: true } });
    expect(tpl).toMatchObject({ name: 'Expo template', attendanceBand: '250 to 1,000', status: 'draft', graceMin: 5, overbookPct: 50, templateId: null });
    expect([tpl.aors.length, tpl.areas.length, tpl.positions.length, tpl.shifts.length, tpl.assignments.length]).toEqual([2, 2, 2, 2, 0]);
    expect(tpl.aors.every((a) => a.leadId === null && a.deputyId === null)).toBe(true); // leads are slots to fill
    expect((await event(s.event.id)).templateId).toBeNull(); // saving links nothing back

    // A template is never staffed or run.
    expect(await setStatus('acme', { id: tpl.id, status: 'staffing' })).toEqual({ error: expect.stringContaining('never staffed') });
    expect(await invite('acme', { shiftId: tpl.shifts[0]!.id, [`p:${s.ana.id}`]: 'on' })).toEqual({ error: expect.stringContaining('never staffed') });

    // The card moves on; the template, still being planned, follows it, and so does the event started from it.
    await went(saveCard('acme', { id: card1.id, title: 'Greeter', duties: 'Welcome people\nPoint to the badge line' }));
    const card2 = await db.positionCard.findFirstOrThrow({ where: { key: 'greeter', version: 2 } });
    await went(duplicateEvent('acme', { id: tpl.id, name: 'Autumn Expo', startsOn: '2027-10-01' }));
    const made = await db.event.findFirstOrThrow({ where: { name: 'Autumn Expo' }, include: { days: true, positions: true, shifts: true, assignments: true } });
    expect(made).toMatchObject({ isTemplate: false, templateId: tpl.id, attendanceBand: '250 to 1,000', graceMin: 5, overbookPct: 50, status: 'draft' });
    expect(made.days.map((d) => d.date.toISOString().slice(0, 10))).toEqual(['2027-10-01']);
    expect(made.positions.find((p) => p.name === 'Greeter')!.cardId).toBe(card2.id);
    expect(made.assignments).toEqual([]);
    const from = tpl.shifts[0]!;
    const shift = made.shifts.find((x) => x.needed === from.needed)!;
    expect(shift.endAt.getTime() - shift.callAt.getTime()).toBe(from.endAt.getTime() - from.callAt.getTime()); // the pattern, moved whole
    expect(shift.startAt.getTime() - from.startAt.getTime()).toBe(made.days[0]!.date.getTime() - tpl.days[0]!.date.getTime());

    // Copied, never linked: editing the event leaves the template alone.
    await db.position.updateMany({ where: { eventId: made.id }, data: { name: 'Changed' } });
    expect(await db.position.count({ where: { eventId: tpl.id, name: 'Changed' } })).toBe(0);
    expect(await duplicateEvent('acme', { id: tpl.id, name: 'Bad date', startsOn: 'next week' })).toEqual({ error: 'Start date must be YYYY-MM-DD.' });
  });
});

describe('the report', () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 4, 2, h, m));
  const shift = (from: number, to: number, needed: number, position: { id: string; minHeadcount: number }, people: [Date | null, Date | null][]) =>
    ({ startAt: at(from), endAt: at(to), needed, position, assignments: people.map(([checkedInAt, checkedOutAt]) => ({ checkedInAt, checkedOutAt })) });

  it('reads each hour at its middle, against the plan and the minimum', () => {
    const greeter = { id: 'g', minHeadcount: 2 };
    const hours = coverage([
      shift(8, 10, 3, greeter, [[at(7, 50), at(10)], [at(8, 40), null], [null, null]]), // one on time, one 40 minutes late, one never came
      shift(9, 11, 1, { id: 'r', minHeadcount: 1 }, [[at(9), at(9, 20)]]), // left after 20 minutes
      shift(14, 15, 1, greeter, []),
    ]);
    expect(hours.map((h) => [h.at.getUTCHours(), h.min, h.planned, h.actual])).toEqual([
      [8, 2, 3, 1], // at 8:30 only the first is in: under the minimum
      [9, 3, 4, 2], // both positions on; the runner has already gone
      [10, 1, 1, 0],
      [14, 2, 1, 0], // the gap from 11 to 2 has no rows
    ]);
    expect(coverage([])).toEqual([]);
    expect([median([]), median([7]), median([9, 1, 5]), median([1, 2, 3, 10])]).toEqual([null, 7, 5, 2.5]);
  });

  it('counts no-shows by pool and tier, help by category, and alerts by how long they took', async () => {
    const s = await stage('live');
    const t = now();
    await db.person.update({ where: { id: s.jen.id }, data: { kind: 'employee' } });
    const alert = (kind: 'help' | 'no_show', personId: string, assignmentId: string, openMin: number, resolvedMin: number | null, extra: object = {}) =>
      db.alert.create({ data: { orgId: s.orgId, eventId: s.event.id, kind, personId, assignmentId, openedAt: new Date(t.getTime() - openMin * MIN), resolvedAt: resolvedMin === null ? null : new Date(t.getTime() - resolvedMin * MIN), ...extra } });
    await alert('help', s.jen.id, s.aJen.id, 60, 56, { category: 'supplies' });
    await alert('help', s.jen.id, s.aJen.id, 50, 40, { category: 'supplies', step: 2 });
    await alert('help', s.jen.id, s.aJen.id, 30, null, { category: 'vip' });
    await alert('no_show', s.tom.id, s.aTom.id, 300, 280);

    const r = await buildReport({ orgId: s.orgId, eventId: s.event.id });
    expect([r.shifts, r.noShows]).toEqual([2, 1]); // Ana declined: not counted
    expect(r.byPool).toEqual([{ group: 'employee', people: 1, noShows: 0 }, { group: 'volunteer', people: 1, noShows: 1 }]);
    expect(r.byTier).toEqual([{ group: 'Tier 2', people: 2, noShows: 1 }]);
    expect(r.helpByCategory).toEqual([['supplies', 2], ['vip', 1]]);
    expect(r.helpByPosition).toEqual([['Greeter', 3]]);
    expect(r.resolve).toEqual([
      { kind: 'no_show', raised: 1, open: 0, reachedPlanner: 0, median: 20, slowest: 20 },
      { kind: 'help', raised: 3, open: 1, reachedPlanner: 1, median: 7, slowest: 10 },
    ]);
    expect(r.areas.map((a) => a.name)).toEqual(['Exhibit Hall', 'Registration']);
    expect(r.areas[1]!.hours.every((h) => h.planned === 2 && h.actual === 1)).toBe(true); // Jen alone, all shift
    expect(r.reviews).toEqual({ areas: 2, reviewed: 0, waived: 0 });
  });
});

describe('thank you and come back', () => {
  const tap = (token: string, fields: Record<string, string>, origin = 'http://localhost') =>
    act(new Request(`http://localhost/p/${token}/act`, { method: 'POST', headers: { origin, host: 'localhost', 'content-type': 'application/json' }, body: JSON.stringify(fields) }), { params: Promise.resolve({ token }) });

  it('the first close thanks everyone who checked in, in the org’s words, and one tap puts them on the list', async () => {
    const s = await stage('live');
    await actAs(s.dana.id, 'acme');
    await went(setEventDefaults('acme', { id: s.event.id, thanks: 'Thank you {name}. {event} worked because of you.' }));
    await went(setStatus('acme', { id: s.event.id, status: 'closed' }));
    await drainOutbox();
    const thanks = await db.capturedMessage.findMany({ where: { body: { contains: 'counted in' } } });
    expect(thanks.map((m) => m.to)).toEqual([s.jen.mobile]); // Tom never came, Ana declined
    expect(thanks[0]!.body).toMatch(/^Thank you Jen\. Spring Expo worked because of you\. Want to work the next one\? Tap to be counted in: http\S+\/p\/[\w-]+$/);

    const jen = thanks[0]!.body.split('/p/')[1]!;
    expect((await tap(jen, { kind: 'back' }, 'https://evil.example')).status).toBe(403);
    expect((await db.person.findUniqueOrThrow({ where: { id: s.jen.id } })).wantsBackAt).toBeNull();
    expect((await tap(jen, { kind: 'back' })).status).toBe(200);
    expect((await db.person.findUniqueOrThrow({ where: { id: s.jen.id } })).wantsBackAt).not.toBeNull();
    expect((await db.person.findUniqueOrThrow({ where: { id: s.tom.id } })).wantsBackAt).toBeNull();
    expect((await tap('not-a-token', { kind: 'back' })).status).toBe(404);
  });
});
