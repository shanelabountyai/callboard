import { beforeEach, describe, expect, it } from 'vitest';
import { advanceClock } from '@/core/clock';
import { db } from '@/core/db';
import { createCard, saveCard } from '@/app/o/[org]/cards/actions';
import { saveRole, setStatus } from '@/app/o/[org]/events/[id]/actions';
import { saveAreaReview, waiveAreaReview } from '@/app/o/[org]/events/[id]/review/actions';
import { POST as leadSave } from '@/app/p/[token]/review/save/route';
import '@/lib/messages';
import { derivedOutcome, runReviewAsks, shownTier, tierOf, tiersFor, type EventRecord } from '@/lib/review';
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

describe('what check-in says happened', () => {
  const callAt = new Date('2026-05-02T12:00:00Z');
  const shift = { callAt, endAt: new Date('2026-05-02T17:00:00Z'), position: { graceMin: null } };
  const at = (min: number) => new Date(callAt.getTime() + min * MIN);
  const a = (checkedInAt: Date | null, checkedOutAt: Date | null = null, checkOutMethod = '') => ({ checkedInAt, checkedOutAt, checkOutMethod, shift, event: { graceMin: 15 } });

  it('no check-in is a no-show; late starts after call time plus grace; an auto close is not an early exit', () => {
    expect(derivedOutcome(a(null))).toBe('no_show');
    expect(derivedOutcome(a(at(15)))).toBe('showed'); // inside the grace the no-show alert also honours
    expect(derivedOutcome(a(at(16)))).toBe('late');
    expect(derivedOutcome(a(at(0), at(200), 'self'))).toBe('left_early'); // out 100 minutes before the end
    expect(derivedOutcome(a(at(0), at(290), 'self'))).toBe('showed'); // ten minutes early is not early
    expect(derivedOutcome(a(at(0), at(360), 'auto'))).toBe('showed');
    expect(derivedOutcome({ ...a(at(10)), shift: { ...shift, position: { graceMin: 5 } } })).toBe('late'); // the position's grace wins
  });
});

describe('reliability tier', () => {
  const ok: EventRecord = { outcomes: ['showed'], rehire: null };
  const late: EventRecord = { outcomes: ['showed', 'late'], rehire: true };
  const gone: EventRecord = { outcomes: ['no_show'], rehire: null };
  const unwanted: EventRecord = { outcomes: ['showed'], rehire: false };

  it('tier 1 is earned over three clean events, two strikes make tier 3, everyone else is tier 2', () => {
    expect(tierOf([])).toEqual({ tier: 2, why: 'no history yet' });
    expect(tierOf([ok, ok]).tier).toBe(2); // not enough history
    expect(tierOf([ok, ok, ok]).tier).toBe(1);
    expect(tierOf([ok, late, ok, ok, ok]).tier).toBe(1); // Tom after five events, one late
    expect(tierOf([late, late, ok]).tier).toBe(2);
    expect(tierOf([gone, ok, ok, ok]).tier).toBe(2); // one no-show costs tier 1, not the person
    expect(tierOf([gone, ok, gone]).tier).toBe(3);
    expect(tierOf([gone, unwanted, ok]).tier).toBe(3);
    expect(tierOf([ok, ok, ok]).why).toBe('last 3 events: 3 clean, 0 late or left early, 0 no-show');
  });

  it('looks back eight events, so old no-shows roll off', () => {
    expect(tierOf([ok, ok, ok, ok, ok, ok, ok, ok, gone, gone]).tier).toBe(1);
  });

  it('a tier set by hand wins and says so', () => {
    const t = shownTier({ id: 'p', tierOverride: 1, tierNote: 'ran registration for years elsewhere' }, new Map());
    expect(t).toMatchObject({ tier: 1, byHand: true });
    expect(t.why).toContain('ran registration for years elsewhere');
    expect(shownTier({ id: 'p', tierOverride: null, tierNote: '' }, new Map([['p', tierOf([gone, gone])]]))).toMatchObject({ tier: 3, byHand: false });
  });
});

const answers = { understaffed: '8 to 9am', overstaffed: 'never', wentWrong: 'printer 2 jammed' };
const post = (token: string, fields: Record<string, string>) =>
  leadSave(new Request(`http://localhost/p/${token}/review/save`, { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost' }, body: new URLSearchParams(fields) }), { params: Promise.resolve({ token }) });

describe('position cards', () => {
  it('versions are linear, a live event keeps the version it ran with, and a stale save is refused', async () => {
    const s = await stage('live');
    await actAs(s.dana.id, 'acme');
    expect(await went(createCard('acme', { title: 'Registration Greeter', purpose: 'The first face', duties: 'Welcome people\n\n  Point to the badge line  ' }))).toBe('/o/acme/cards');
    const v1 = await db.positionCard.findFirstOrThrow({ where: { key: 'registration-greeter' } });
    expect(v1).toMatchObject({ version: 1, duties: 'Welcome people\nPoint to the badge line', changedBy: s.dana.id });
    expect(await createCard('acme', { title: 'Registration greeter' })).toEqual({ error: expect.stringContaining('already in the library') });
    expect(await createCard('acme', { title: 'Usher', duties: '1\n2\n3\n4\n5\n6' })).toEqual({ error: expect.stringContaining('5 lines at most') });

    // The same card on a live event and on one still being planned.
    const planned = await db.event.create({ data: { orgId: s.orgId, name: 'Autumn Expo', status: 'staffing' } });
    const area = await db.area.create({ data: { orgId: s.orgId, eventId: planned.id, name: 'Registration' } });
    const later = await db.position.create({ data: { orgId: s.orgId, eventId: planned.id, areaId: area.id, name: 'Greeter' } });
    await went(saveRole('acme', { id: s.greeter.id, cardId: v1.id }));
    await went(saveRole('acme', { id: later.id, cardId: v1.id }));

    await went(saveCard('acme', { id: v1.id, title: 'Registration Greeter', purpose: 'The first face', duties: 'Welcome people', situations: 'A VIP is not on the list: radio your lead' }));
    const v2 = await db.positionCard.findFirstOrThrow({ where: { key: 'registration-greeter', version: 2 } });
    expect((await db.position.findUniqueOrThrow({ where: { id: s.greeter.id } })).cardId).toBe(v1.id); // live: frozen
    expect((await db.position.findUniqueOrThrow({ where: { id: later.id } })).cardId).toBe(v2.id); // planned: moved up

    // A second planner who opened version 1 before that save.
    expect(await saveCard('acme', { id: v1.id, title: 'Registration Greeter', never: 'Leave the post' })).toEqual({ error: expect.stringContaining('Version 2 was saved while you were editing') });
    expect(await saveCard('acme', { id: v2.id, title: v2.title, purpose: v2.purpose, duties: v2.duties, situations: v2.situations })).toEqual({ error: expect.stringContaining('Nothing changed') });
    expect(await db.positionCard.count({ where: { key: 'registration-greeter' } })).toBe(2);

    // Linking always takes the latest, whichever version was picked.
    await went(saveRole('acme', { id: s.greeter.id, cardId: v1.id }));
    expect((await db.position.findUniqueOrThrow({ where: { id: s.greeter.id } })).cardId).toBe(v2.id);
  });
});

describe('the review', () => {
  it('closing texts each lead once, the lead reviews their own areas only, and the record moves the tier', async () => {
    const s = await stage();
    await actAs(s.dana.id, 'acme');
    expect(await went(setStatus('acme', { id: s.event.id, status: 'closed' }))).toBe(`/o/acme/events/${s.event.id}/review`);
    await drainOutbox();
    const texts = await db.capturedMessage.findMany({ where: { body: { contains: '/review' } }, orderBy: { to: 'asc' } });
    expect(texts.map((m) => m.to)).toEqual([s.marcus.mobile, s.sofia.mobile]);
    expect(texts[0]!.body).toMatch(/\/p\/[\w-]+\/review/);
    await went(setStatus('acme', { id: s.event.id, status: 'live' }));
    await went(setStatus('acme', { id: s.event.id, status: 'closed' }));
    await drainOutbox();
    expect(await db.capturedMessage.count()).toBe(3); // a second close texts nobody again: two review links and Jen's thank-you

    // Before any review the record is check-in alone: Tom never came, Jen did, Ana's decline does not count.
    let tiers = await tiersFor(s.orgId);
    expect(tiers.get(s.tom.id)!.why).toBe('last 1 event: 0 clean, 0 late or left early, 1 no-show');
    expect(tiers.get(s.jen.id)!.why).toBe('last 1 event: 1 clean, 0 late or left early, 0 no-show');
    expect(tiers.has(s.ana.id)).toBe(false);

    const marcus = await s.token(s.marcus.id);
    const form = { areaId: s.reg.id, [`o:${s.aTom.id}`]: 'no_show', [`r:${s.aTom.id}`]: 'no', [`n:${s.aTom.id}`]: 'No call, no text', [`o:${s.aJen.id}`]: 'late', [`r:${s.aJen.id}`]: 'yes' };
    let res = await post(marcus, form); // the three answers are missing
    expect(res.headers.get('location')).toContain('/review?error=1');
    expect(await db.review.count()).toBe(0);
    res = await post(marcus, { ...form, ...answers });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/review?done=1');
    expect(await db.review.findUniqueOrThrow({ where: { assignmentId: s.aTom.id } })).toMatchObject({ outcome: 'no_show', rehire: false, note: 'No call, no text', by: 'Marcus Bell' });
    expect(await db.areaReview.findUniqueOrThrow({ where: { areaId: s.reg.id } })).toMatchObject({ ...answers, waived: false, by: 'Marcus Bell' });

    // The lead's word overrules the clock (Jen: late), and a no-show plus "would not rehire" is two strikes.
    tiers = await tiersFor(s.orgId);
    expect(tiers.get(s.tom.id)!.tier).toBe(3);
    expect(tiers.get(s.jen.id)!.why).toBe('last 1 event: 0 clean, 1 late or left early, 0 no-show');

    // Not yours: another lead's area, someone who leads nothing, a person off this area's roster, a foreign origin.
    expect((await post(await s.token(s.sofia.id), { areaId: s.reg.id, ...answers })).status).toBe(404);
    expect((await post(await s.token(s.tom.id), { areaId: s.reg.id, ...answers })).status).toBe(404);
    expect((await post(marcus, { areaId: s.reg.id, [`o:${s.aAna.id}`]: 'no_show', ...answers })).headers.get('location')).toContain('error=1'); // Ana declined: not reviewable
    expect(await db.review.count()).toBe(2);
    const foreign = await leadSave(new Request(`http://localhost/p/${marcus}/review/save`, { method: 'POST', headers: { origin: 'https://evil.example', host: 'localhost' }, body: new URLSearchParams({ areaId: s.reg.id, ...answers }) }), { params: Promise.resolve({ token: marcus }) });
    expect(foreign.status).toBe(403);
  });

  it('the planner can finish or waive an area, and only once the event is closed', async () => {
    const s = await stage();
    await actAs(s.dana.id, 'acme');
    expect(await saveAreaReview('acme', { areaId: s.reg.id, ...answers })).toEqual({ error: 'The review opens when the event is closed.' });
    expect(await waiveAreaReview('acme', { areaId: s.hall.id, note: 'Too early' })).toEqual({ error: 'The review opens when the event is closed.' });
    await went(setStatus('acme', { id: s.event.id, status: 'closed' }));

    expect(await saveAreaReview('acme', { areaId: s.reg.id, understaffed: 'never', overstaffed: '', wentWrong: 'nothing' })).toEqual({ error: expect.stringContaining('Answer all three') });
    await went(saveAreaReview('acme', { areaId: s.reg.id, [`o:${s.aTom.id}`]: 'showed', [`r:${s.aTom.id}`]: '', ...answers })); // Dana saw him there; the tap was missed
    expect(await db.review.findUniqueOrThrow({ where: { assignmentId: s.aTom.id } })).toMatchObject({ outcome: 'showed', rehire: null, by: 'dana@example.test' });
    expect((await tiersFor(s.orgId)).get(s.tom.id)!.why).toContain('1 clean');

    expect(await waiveAreaReview('acme', { areaId: s.hall.id, note: ' ' })).toEqual({ error: 'Say why the review is waived.' });
    await went(waiveAreaReview('acme', { areaId: s.hall.id, note: 'Sofia left the company' }));
    expect(await db.areaReview.findUniqueOrThrow({ where: { areaId: s.hall.id } })).toMatchObject({ waived: true, waiveNote: 'Sofia left the company' });
  });

  it('a week after the close the planner is asked once about what is still open', async () => {
    const s = await stage();
    await actAs(s.dana.id, 'acme');
    await went(setStatus('acme', { id: s.event.id, status: 'closed' }));
    await went(waiveAreaReview('acme', { areaId: s.hall.id, note: 'Nothing to report' }));
    await drainOutbox();
    await db.capturedMessage.deleteMany();

    advanceClock(6 * DAY);
    expect(await runReviewAsks()).toEqual({ asked: 0 });
    advanceClock(7 * DAY + MIN);
    expect(await runReviewAsks()).toEqual({ asked: 1 });
    expect(await runReviewAsks()).toEqual({ asked: 0 });
    await drainOutbox();
    const [mail] = await db.capturedMessage.findMany();
    expect(mail!.to).toBe('dana@example.test');
    expect(mail!.body).toContain('Registration');
    expect(mail!.body).not.toContain('Exhibit Hall'); // waived
    expect(mail!.body).toContain(`/o/acme/events/${s.event.id}/review`);
  });
});
