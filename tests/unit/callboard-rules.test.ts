import { describe, expect, it } from 'vitest';
import { dueAt, firstStep, graceOf, isOverdue, stepMinOf } from '@/lib/dayof';
import { twiml } from '@/lib/inbound';
import { derivedOutcome, outcomeOf, tierOf } from '@/lib/review';
import { declineLocked, firstName, inviteCap, linkExpiry } from '@/lib/staffing';
import { isYmd } from '@/lib/time';

// The pure rules the day-of sweep, the invite list, the person's page and the reliability record lean on.
const MIN = 60_000;
const call = new Date('2026-10-03T13:00:00Z');
const timed = (o: { posGrace?: number | null; eventGrace?: number; in?: Date | null; out?: Date | null; outBy?: string; status?: string } = {}) => ({
  status: o.status ?? 'confirmed',
  checkedInAt: o.in ?? null,
  checkedOutAt: o.out ?? null,
  checkOutMethod: o.outBy ?? 'self',
  shift: { callAt: call, endAt: new Date(call.getTime() + 5 * 60 * MIN), position: { graceMin: o.posGrace ?? null } },
  event: { graceMin: o.eventGrace ?? 15 },
});

describe('calendar days', () => {
  it('takes only a day that exists; Date.parse alone would roll Feb 30 into March', () => {
    expect(['2026-02-28', '2028-02-29', '2026-12-31', '2026-01-01'].map(isYmd)).toEqual([true, true, true, true]);
    expect(['2026-02-29', '2026-02-30', '2026-02-31', '2026-04-31', '2026-06-31', '2026-02-32', '2026-00-10', '2026-1-01', ''].map(isYmd)).toEqual(Array(9).fill(false));
  });
});

describe('no-show timing', () => {
  it('a position’s own grace wins over the event’s, including a grace of zero', () => {
    expect(graceOf(timed())).toBe(15);
    expect(graceOf(timed({ posGrace: 30 }))).toBe(30);
    expect(graceOf(timed({ posGrace: 0 }))).toBe(0); // ?? and not ||: zero minutes is a real rule
    expect(dueAt(timed({ posGrace: 0 })).getTime()).toBe(call.getTime());
    expect(dueAt(timed()).getTime()).toBe(call.getTime() + 15 * MIN);
  });

  it('only a confirmed person who has not checked in is overdue, and only after call time plus grace', () => {
    const due = call.getTime() + 15 * MIN;
    expect(isOverdue(timed(), new Date(due))).toBe(false); // at the line, not past it
    expect(isOverdue(timed(), new Date(due + 1))).toBe(true);
    expect(isOverdue(timed({ in: new Date(due + 5 * MIN) }), new Date(due + 10 * MIN))).toBe(false);
    expect(isOverdue(timed({ status: 'invited' }), new Date(due + MIN))).toBe(false);
    expect(isOverdue(timed({ status: 'declined' }), new Date(due + MIN))).toBe(false);
  });

  it('the chain starts at the lead, else the deputy, else the planner; each kind waits its own step', () => {
    expect(firstStep({ lead: { id: 'l' }, deputy: { id: 'd' } })).toBe(0);
    expect(firstStep({ lead: null, deputy: { id: 'd' } })).toBe(1);
    expect(firstStep({ lead: null, deputy: null })).toBe(2);
    expect(firstStep(null)).toBe(2);
    expect(firstStep(undefined)).toBe(2);
    const event = { stepMin: 10, helpStepMin: 5 };
    expect(stepMinOf({ kind: 'no_show', event })).toBe(10);
    expect(stepMinOf({ kind: 'help', event })).toBe(5);
  });
});

describe('staffing arithmetic', () => {
  it('the overbook cap rounds up, so a small shift still gets a spare', () => {
    expect(inviteCap({ needed: 2, overbookPct: 20 })).toBe(3); // 2.4
    expect(inviteCap({ needed: 5, overbookPct: 20 })).toBe(6);
    expect(inviteCap({ needed: 10, overbookPct: 0 })).toBe(10);
    expect(inviteCap({ needed: 1, overbookPct: 200 })).toBe(3);
    expect(inviteCap({ needed: 0, overbookPct: 50 })).toBe(0);
  });

  it('a link lives a week past the shift; a first name survives stray spaces', () => {
    expect(linkExpiry(call).toISOString()).toBe('2026-10-10T13:00:00.000Z');
    expect(firstName('  Jen   Park ')).toBe('Jen');
    expect(firstName('Cher')).toBe('Cher');
  });

  it('"Can’t make it" closes once the person is checked in or the shift is over', () => {
    const shift = { endAt: new Date(call.getTime() + 5 * 60 * MIN) };
    expect(declineLocked({ checkedInAt: null, shift }, call)).toBe(false);
    expect(declineLocked({ checkedInAt: call, shift }, call)).toBe(true);
    expect(declineLocked({ checkedInAt: null, shift }, shift.endAt)).toBe(true);
    expect(declineLocked({ checkedInAt: null, shift }, new Date(shift.endAt.getTime() - 1))).toBe(false);
  });
});

describe('what happened, from check-in alone', () => {
  const end = call.getTime() + 5 * 60 * MIN;
  it('late is past call plus grace; leaving more than 15 minutes early counts, an automatic close never does', () => {
    expect(derivedOutcome(timed({ in: new Date(call.getTime() + 15 * MIN) }))).toBe('showed'); // on the line is on time
    expect(derivedOutcome(timed({ in: new Date(call.getTime() + 15 * MIN + 1) }))).toBe('late');
    expect(derivedOutcome(timed({ posGrace: 0, in: new Date(call.getTime() + 1) }))).toBe('late');
    expect(derivedOutcome(timed({ in: call, out: new Date(end - 15 * MIN) }))).toBe('showed');
    expect(derivedOutcome(timed({ in: call, out: new Date(end - 16 * MIN) }))).toBe('left_early');
    expect(derivedOutcome(timed({ in: call, out: new Date(end - 3 * 60 * MIN), outBy: 'auto' }))).toBe('showed');
    expect(derivedOutcome(timed())).toBe('no_show');
  });
  it('the lead’s word wins over the clock', () => {
    expect(outcomeOf({ ...timed(), review: { outcome: 'showed' } })).toBe('showed');
    expect(outcomeOf({ ...timed({ in: call }), review: null })).toBe('showed');
  });
  it('a no-show and a "would not rehire" in one event are two strikes', () => {
    expect(tierOf([{ outcomes: ['no_show'], rehire: false }]).tier).toBe(3);
    expect(tierOf([{ outcomes: ['showed'], rehire: false }, { outcomes: ['showed'], rehire: null }, { outcomes: ['showed'], rehire: null }]).tier).toBe(2);
  });
});

describe('TwiML reply', () => {
  it('escapes everything a texted name or note could carry, and silence is an empty Response', () => {
    expect(twiml(null)).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    expect(twiml(`Tom & "Jen" <b>'hi'</b>`)).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Message>Tom &amp; &quot;Jen&quot; &lt;b&gt;&apos;hi&apos;&lt;/b&gt;</Message></Response>');
  });
});
