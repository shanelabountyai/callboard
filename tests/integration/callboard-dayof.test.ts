import { beforeEach, describe, expect, it } from 'vitest';
import { advanceClock, now } from '@/core/clock';
import { db } from '@/core/db';
import { resendToNonAckers, sendBroadcast } from '@/lib/broadcast';
import { POST as act } from '@/app/p/[token]/act/route';
import { checkIn, runDayOf } from '@/lib/dayof';
import { handleInbound, twilioSignature, twiml, verifyTwilio } from '@/lib/inbound';
import '@/lib/messages';
import { assignmentInclude } from '@/lib/staffing';
import { drainOutbox } from '@/modules/notifications/outbox';
import { resetAuthTables } from '../helpers/auth';
import { actAs, addMember, makeOrg } from '../helpers/org';

beforeEach(async () => { advanceClock(0); await resetAuthTables(); }); // advanceClock sets an absolute offset
const MIN = 60_000;

// A shift whose call time was 19 minutes ago (grace 15): Tom is confirmed and absent, Jen is confirmed and
// absent too but on a float position with grace 20, Marcus leads, Priya is deputy, Dana is the planner.
async function stage() {
  const org = await makeOrg();
  const orgId = org.id;
  const dana = await addMember(orgId, 'owner', 'dana@example.test');
  const t = now();
  const mk = (name: string, mobile: string, kind: 'employee' | 'volunteer', email?: string) => db.person.create({ data: { orgId, name, mobile, kind, email } });
  const [marcus, priya, tom, jen] = await Promise.all([mk('Marcus Bell', '+15550100001', 'employee', 'marcus@example.test'), mk('Priya Nair', '+15550100002', 'employee'), mk('Tom Alvarez', '+15550100006', 'volunteer'), mk('Jen Park', '+15550100003', 'employee')]);
  const event = await db.event.create({ data: { orgId, name: 'Spring Expo', status: 'live', graceMin: 15, emergencyContact: 'Security 555-0100' } });
  const date = new Date(t); date.setUTCHours(0, 0, 0, 0);
  const day = await db.eventDay.create({ data: { orgId, eventId: event.id, date } });
  const aor = await db.aor.create({ data: { orgId, eventId: event.id, name: 'Front of house', leadId: marcus!.id, deputyId: priya!.id } });
  const area = await db.area.create({ data: { orgId, eventId: event.id, aorId: aor.id, name: 'Registration', location: 'North Lobby' } });
  const greeter = await db.position.create({ data: { orgId, eventId: event.id, areaId: area.id, name: 'Greeter', minHeadcount: 1, targetHeadcount: 2 } });
  const floater = await db.position.create({ data: { orgId, eventId: event.id, areaId: area.id, name: 'Floater', minHeadcount: 0, targetHeadcount: 1, isFloat: true, graceMin: 20 } });
  const callAt = new Date(t.getTime() - 19 * MIN); // Tom (grace 15) is 4 minutes overdue; Jen (float, grace 20) has a minute left
  const startAt = new Date(t.getTime() + 25 * MIN);
  const endAt = new Date(t.getTime() + 4 * 60 * MIN);
  const shift = await db.shift.create({ data: { orgId, eventId: event.id, positionId: greeter.id, dayId: day.id, callAt, startAt, endAt, needed: 2 } });
  const floatShift = await db.shift.create({ data: { orgId, eventId: event.id, positionId: floater.id, dayId: day.id, callAt, startAt, endAt, needed: 1 } });
  const a = await db.assignment.create({ data: { orgId, eventId: event.id, shiftId: shift.id, personId: tom!.id, status: 'confirmed' }, include: assignmentInclude });
  const f = await db.assignment.create({ data: { orgId, eventId: event.id, shiftId: floatShift.id, personId: jen!.id, status: 'confirmed' }, include: assignmentInclude });
  return { orgId, dana, marcus: marcus!, priya: priya!, tom: tom!, jen: jen!, event, shift, a, f };
}
const captured = () => db.capturedMessage.findMany({ orderBy: { createdAt: 'asc' } });

describe('no-show alerts and the escalation chain', () => {
  it('raises once per assignment after call + grace, texts the lead, escalates to the deputy, then the planner by email', async () => {
    const s = await stage();
    expect(await runDayOf()).toEqual({ noShows: 1, escalated: 0, autoClosed: 0 }); // Tom (grace 15); Jen's float grace of 20 has not run out
    expect(await runDayOf()).toMatchObject({ noShows: 0 }); // once
    await drainOutbox();
    const [toLead] = await captured();
    expect(toLead!.to).toBe(s.marcus.mobile);
    expect(toLead!.body).toContain('Tom Alvarez (Greeter');
    expect(toLead!.body).toMatch(/\/p\/[\w-]+/);

    advanceClock(5 * MIN); // Jen is now past her 20-minute grace
    expect(await runDayOf()).toMatchObject({ noShows: 1, escalated: 0 });
    advanceClock(11 * MIN); // Tom's alert has sat 11 minutes with the lead
    expect(await runDayOf()).toMatchObject({ escalated: 1 });
    await drainOutbox();
    const msgs = await captured();
    expect(msgs.filter((m) => m.to === s.priya.mobile)).toHaveLength(1);
    expect(msgs.find((m) => m.to === s.priya.mobile)!.body).toContain('unresolved 10 min');

    advanceClock(21 * MIN);
    expect(await runDayOf()).toMatchObject({ escalated: 2 }); // Tom's to the planner, Jen's to the deputy
    await drainOutbox();
    const emails = (await captured()).filter((m) => m.to === 'dana@example.test');
    expect(emails).toHaveLength(1);
    expect(emails[0]!.body).toContain('See the coverage board');
    const tomAlert = await db.alert.findFirstOrThrow({ where: { assignmentId: s.a.id } });
    expect(tomAlert.step).toBe(2);
    expect(await runDayOf()).toMatchObject({ escalated: 0 }); // nothing past the planner
  });

  it('"Can’t reach them" tells the planner and never the person, keeps the shift, and can be undone; a lead cannot release', async () => {
    const s = await stage();
    await runDayOf();
    await drainOutbox();
    const token = (await captured())[0]!.body.match(/\/p\/([\w-]+)/)![1]!; // Marcus's link, from the no-show text
    const alert = await db.alert.findFirstOrThrow({ where: { assignmentId: s.a.id } });
    const tap = (kind: string) =>
      act(new Request(`http://localhost/p/${token}/act`, { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' }, body: JSON.stringify({ kind, alert: alert.id }) }), { params: Promise.resolve({ token }) });
    const state = async () => ({ ...(await db.alert.findUniqueOrThrow({ where: { id: alert.id }, select: { step: true, note: true, resolvedAt: true } })), status: (await db.assignment.findUniqueOrThrow({ where: { id: s.a.id } })).status });
    const emails = async () => (await captured()).filter((m) => m.to === 'dana@example.test').map((m) => m.body);

    expect((await tap('release')).status).toBe(400); // gone: releasing texts the person, and it is the planner's
    expect((await tap('unreachable')).status).toBe(200);
    expect((await tap('unreachable')).status).toBe(200); // a second tap sends nothing
    expect(await state()).toEqual({ step: 2, note: 'Marcus Bell cannot reach them', resolvedAt: null, status: 'confirmed' });
    expect(await emails()).toEqual([expect.stringContaining('Tom Alvarez (Greeter): Marcus Bell cannot reach them')]);
    expect((await captured()).filter((m) => m.to === s.tom.mobile)).toEqual([]);
    expect(await runDayOf()).toMatchObject({ noShows: 0, escalated: 0 }); // already with the planner

    expect((await tap('reach_undo')).status).toBe(200);
    expect((await tap('reach_undo')).status).toBe(200);
    expect(await state()).toEqual({ step: 0, note: '', resolvedAt: null, status: 'confirmed' });
    expect(await emails()).toHaveLength(2);
    expect((await emails())[1]).toContain('Marcus Bell has reached them');
    expect((await captured()).filter((m) => m.to === s.tom.mobile)).toEqual([]);
  });

  it('a check-in resolves the alert with the device and sync times; earlier wins, too-early is refused, auto-close flags', async () => {
    const s = await stage();
    await runDayOf();
    const tapped = new Date(now().getTime() - 3 * MIN); // an offline tap from three minutes ago
    expect(await db.$transaction((tx) => checkIn(tx, s.a, tapped, 'lead'))).toBe('recorded');
    expect(await db.$transaction((tx) => checkIn(tx, s.a, now(), 'self'))).toBe('kept'); // later duplicate ignored
    const a = await db.assignment.findUniqueOrThrow({ where: { id: s.a.id } });
    expect(a.checkedInAt).toEqual(tapped);
    expect(a.checkInMethod).toBe('lead');
    const alert = await db.alert.findFirstOrThrow({ where: { assignmentId: s.a.id } });
    expect(alert.resolvedAt).not.toBeNull();
    expect(alert.resolution).toMatch(/^checked in \d+:\d\d [AP]M, synced/);

    const early = new Date(s.f.shift.callAt.getTime() - 4 * 3_600_000);
    expect(await db.$transaction((tx) => checkIn(tx, s.f, early, 'self'))).toBe('early');
    expect(await db.$transaction((tx) => checkIn(tx, s.f, early, 'planner'))).toBe('recorded'); // the planner may override

    advanceClock(6 * 3_600_000); // an hour past shift end
    expect(await runDayOf()).toMatchObject({ autoClosed: 2 });
    expect((await db.assignment.findUniqueOrThrow({ where: { id: s.a.id } })).checkOutMethod).toBe('auto');
  });
});

describe('inbound SMS keywords', () => {
  it('signs like Twilio and refuses without a token or a matching signature', () => {
    // The vector from Twilio's security docs.
    const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
    const params = { CallSid: 'CA1234567890ABCDE', Caller: '+14158675309', Digits: '1234', From: '+14158675309', To: '+18005551212' };
    expect(twilioSignature(url, params, '12345')).toBe('RSOYDt4T1cUTdK1PDd93/VVr8B8=');
    expect(verifyTwilio(url, params, 'RSOYDt4T1cUTdK1PDd93/VVr8B8=', '12345')).toBe(true);
    expect(verifyTwilio(url, params, 'RSOYDt4T1cUTdK1PDd93/VVr8B8=', undefined)).toBe(false);
    expect(verifyTwilio(url, { ...params, Digits: '4321' }, 'RSOYDt4T1cUTdK1PDd93/VVr8B8=', '12345')).toBe(false);
    expect(verifyTwilio(url, params, null, '12345')).toBe(false);
    expect(twiml('Tom & Jerry <3')).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Message>Tom &amp; Jerry &lt;3</Message></Response>');
    expect(twiml(null)).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });

  it('HERE checks in and closes the alert, DONE checks out, HELP reaches the lead, an unknown number is silent', async () => {
    const s = await stage();
    await runDayOf();
    expect(await handleInbound('+15559999999', 'HERE')).toBeNull();
    expect(await handleInbound(s.tom.mobile, 'here!')).toMatch(/checked in: Greeter, Registration \(North Lobby\)/);
    expect((await db.alert.findFirstOrThrow({ where: { assignmentId: s.a.id } })).resolvedAt).not.toBeNull();
    expect(await handleInbound(s.tom.mobile, 'HELP no badge stock, supplies')).toContain('Marcus has been told');
    const help = await db.alert.findFirstOrThrow({ where: { kind: 'help' } });
    expect(help).toMatchObject({ category: 'supplies', severity: 1, aorId: expect.any(String), personId: s.tom.id });
    expect(await handleInbound(s.tom.mobile, 'HELP medical')).toContain('call Security 555-0100 first');
    await drainOutbox();
    const toLead = (await captured()).filter((m) => m.to === s.marcus.mobile);
    expect(toLead.some((m) => m.body.includes('needs help: supplies') && m.body.includes('no badge stock'))).toBe(true);
    expect(await handleInbound(s.tom.mobile, 'Running 5 late, parking is full')).toBeNull(); // not a keyword: forwarded
    await drainOutbox();
    expect((await captured()).some((m) => m.to === s.marcus.mobile && m.body.includes('texted: "Running 5 late'))).toBe(true);
    expect(await handleInbound(s.tom.mobile, 'DONE')).toContain("you're checked out");
    expect(await handleInbound(s.tom.mobile, 'DONE')).toContain('nothing to close');
    expect(await handleInbound(s.tom.mobile, 'STOP')).toBeNull();
    expect((await db.person.findUniqueOrThrow({ where: { id: s.tom.id } })).smsOptOut).toBe(true);
  });

  it('YES confirms the invited shifts on the nearest event, NO declines, LINK re-sends the link', async () => {
    const s = await stage();
    const other = await db.assignment.update({ where: { id: s.f.id }, data: { personId: s.tom.id, status: 'invited' } }); // Tom also invited to the float shift
    expect(await handleInbound(s.tom.mobile, 'yes')).toMatch(/^Confirmed: Floater.*Details: http/);
    expect((await db.assignment.findUniqueOrThrow({ where: { id: other.id } })).status).toBe('confirmed');
    expect(await handleInbound(s.tom.mobile, 'NO')).toContain('Nothing to decline');
    expect(await handleInbound(s.tom.mobile, 'LINK')).toMatch(/Spring Expo details: http.*\/p\//);
  });
});

describe('broadcasts with Got it', () => {
  it('resolves an audience in this org only, sends with the link, tracks acks, re-sends to non-ackers', async () => {
    const s = await stage();
    const ctx = await actAs(s.dana.id, 'acme');
    expect(await sendBroadcast(ctx, s.event.id, 'unchecked', 'Doors now 9:15, not 9:00.', true)).toBe(2); // Tom and Jen: confirmed, not checked in
    await drainOutbox();
    const sms = (await captured()).filter((m) => m.subject === 'sms');
    expect(sms.map((m) => m.to).sort()).toEqual([s.jen.mobile, s.tom.mobile].sort());
    expect(sms[0]!.body).toMatch(/^Spring Expo: Doors now 9:15, not 9:00\. Got it\? Reply GOT IT or tap http/);
    expect(await handleInbound(s.tom.mobile, 'got it')).toBe('Thanks, noted.');
    const b = await db.broadcast.findFirstOrThrow({ include: { recipients: true } });
    expect(b.recipients.filter((r) => r.ackedAt).map((r) => r.personId)).toEqual([s.tom.id]);
    expect(await resendToNonAckers(ctx, b.id)).toBe(1); // Jen only
    await expect(sendBroadcast(ctx, s.event.id, 'aor:00000000-0000-4000-8000-000000000999', 'x', false)).rejects.toThrow('no longer exists');
    await expect(sendBroadcast(ctx, s.event.id, 'unconfirmed', 'x', false)).rejects.toThrow('Nobody matches');
    const long = 'x'.repeat(400);
    await sendBroadcast(ctx, s.event.id, 'event', long, false);
    await drainOutbox();
    const last = (await captured()).at(-1)!;
    expect(last.body).toMatch(/^Spring Expo: a message from the planner\. Read it: http/);
    expect(last.body.length).toBeLessThan(200);
  });
});
