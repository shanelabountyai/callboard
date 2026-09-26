import { createHmac } from 'node:crypto';
import { audit } from '@/core/audit';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { safeEqual } from '@/core/tokens';
import type { EventStatus } from '@/generated/prisma/enums';
import { checkIn, checkOut, raiseHelp } from './dayof';
import { ensurePersonLink } from './links';
import { notify, notifyPlanners } from './messages';
import { assignmentInclude, describeAssignment, firstName, linkExpiry, type FullAssignment } from './staffing';
import { fmtWhen } from './time';

// Inbound SMS (PRD 4): keywords on the org's one number. Twilio posts form fields and signs
// base64(HMAC-SHA1(authToken, url + sorted key/value pairs)); the route verifies before parsing.
export function twilioSignature(url: string, params: Record<string, string>, token: string): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return createHmac('sha1', token).update(data).digest('base64');
}
export const verifyTwilio = (url: string, params: Record<string, string>, signature: string | null, token: string | undefined) =>
  !!token && !!signature && safeEqual(twilioSignature(url, params, token), signature);

const LIVE = { status: { in: ['staffing', 'confirmed', 'live'] as EventStatus[] } };
const HOUR = 3_600_000;
const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
/** The TwiML for a reply; an empty <Response/> sends nothing. */
export const twiml = (reply: string | null) => `<?xml version="1.0" encoding="UTF-8"?><Response>${reply ? `<Message>${esc(reply)}</Message>` : ''}</Response>`;

const CATEGORY = /\b(medical|security|supplies|vip|relief)\b/i;

/**
 * Handles one text from `from`. Returns the reply to send back, or null for silence. The number is
 * the identity: the keyword applies to the person's shift happening now, else their next one.
 */
export async function handleInbound(from: string, text: string): Promise<string | null> {
  const people = await db.person.findMany({ where: { mobile: from } }); // one number can be in several orgs
  if (!people.length) return null;
  const upper = text.trim().toUpperCase();
  const word = upper.replace(/^GOT\s+IT\b/, 'GOTIT').split(/[^A-Z]+/)[0] ?? '';
  const note = text.trim().slice(word.length).trim();
  const t = now();

  if (word === 'STOP' || word === 'UNSUBSCRIBE' || word === 'CANCEL' || word === 'QUIT' || word === 'END') {
    await db.person.updateMany({ where: { id: { in: people.map((p) => p.id) } }, data: { smsOptOut: true } });
    return null; // Twilio sends the carrier-mandated confirmation itself
  }
  if (word === 'START' || word === 'UNSTOP') {
    await db.person.updateMany({ where: { id: { in: people.map((p) => p.id) } }, data: { smsOptOut: false } });
    return 'You will get event texts again.';
  }

  const open = await db.assignment.findMany({
    where: { personId: { in: people.map((p) => p.id) }, status: { in: ['invited', 'confirmed'] }, event: LIVE, shift: { endAt: { gt: new Date(t.getTime() - 12 * HOUR) } } },
    include: assignmentInclude,
    orderBy: { shift: { callAt: 'asc' } },
  });
  const current = open.find((a) => a.shift.callAt.getTime() - 3 * HOUR <= t.getTime() && t.getTime() <= a.shift.endAt.getTime() + HOUR);
  const a = current ?? open.find((x) => x.shift.callAt > t) ?? open[0] ?? null;
  const person = a ? a.person : people[0]!;
  const link = async (x: FullAssignment) => ensurePersonLink(db, { orgId: x.orgId, eventId: x.eventId, personId: x.personId }, linkExpiry(x.shift.endAt));

  switch (word) {
    case 'YES':
    case 'Y':
    case 'CONFIRM':
    case 'NO':
    case 'N':
    case 'DECLINE': {
      const yes = word.startsWith('Y') || word === 'CONFIRM';
      if (!a) return 'Nothing to answer right now.';
      const invited = open.filter((x) => x.eventId === a.eventId && x.status === 'invited');
      if (!invited.length) return `Nothing to ${yes ? 'confirm' : 'decline'} for ${a.event.name}. Your details: ${await link(a)}`;
      const status = yes ? 'confirmed' : 'declined';
      await db.$transaction(async (tx) => {
        await tx.assignment.updateMany({ where: { id: { in: invited.map((x) => x.id) } }, data: { status, respondedAt: t } });
        for (const x of invited) await audit({ orgId: x.orgId, userId: null }, `assignment.${status}`, { targetType: 'assignment', targetId: x.id, data: { by: 'sms' } }, tx);
      });
      const first = invited[0]!;
      return yes
        ? `Confirmed: ${first.shift.position.name}, ${fmtWhen(first.shift.startAt, first.event.timezone)}${invited.length > 1 ? ` and ${invited.length - 1} more` : ''}. Details: ${await link(first)}`
        : `Noted, you are not down for ${first.event.name}. Thanks for telling us.`;
    }
    case 'HERE':
    case 'IN': {
      if (!a) return 'You have no shift right now.';
      const r = await db.$transaction((tx) => checkIn(tx, a, t, 'sms'));
      if (r === 'early') return `Too early to check in: your call time is ${fmtWhen(a.shift.callAt, a.event.timezone)}.`;
      return `You're checked in: ${a.shift.position.name}, ${a.shift.position.area.name}${a.shift.position.area.location ? ` (${a.shift.position.area.location})` : ''}. Text HELP if you need your lead.`;
    }
    case 'DONE':
    case 'OUT': {
      if (!a) return 'You have no shift right now.';
      const r = await db.$transaction((tx) => checkOut(tx, a, t, 'sms'));
      return r === 'recorded' ? `Thanks ${firstName(person.name)}, you're checked out. See you next time.` : 'You were not checked in, so there is nothing to close. Text HERE first.';
    }
    case 'HELP': {
      const category = note.match(CATEGORY)?.[1]?.toLowerCase() ?? 'other';
      const eventId = a?.eventId;
      if (!eventId) return 'No planner is on shift for you right now. If this is an emergency call 911.';
      await db.$transaction((tx) => raiseHelp(tx, person, eventId, a, category, note));
      const lead = a?.shift.position.area.aor?.lead;
      const ev = a?.event;
      const emergency = category === 'medical' || category === 'security' ? ` For ${category}, call ${ev?.emergencyContact || 'venue security'} first.` : '';
      return `${lead ? `${firstName(lead.name)} has been told` : 'The planner has been told'} and will come to you.${emergency}`;
    }
    case 'LINK': {
      if (!a) return 'You have no upcoming shifts.';
      return `Your ${a.event.name} details: ${await link(a)}`;
    }
    case 'GOTIT':
    case 'OK':
    case 'K': {
      const r = await db.broadcastRecipient.findFirst({ where: { personId: { in: people.map((p) => p.id) }, ackedAt: null, broadcast: { requiresAck: true } }, orderBy: { broadcast: { createdAt: 'desc' } } });
      if (!r) return 'Thanks.';
      await db.broadcastRecipient.update({ where: { id: r.id }, data: { ackedAt: t } });
      return 'Thanks, noted.';
    }
    default: {
      // Not a keyword: it lands with the lead for that person's shift, or the planner (PRD 4 rules).
      if (!a) return null;
      const lead = a.shift.position.area.aor?.lead ?? a.shift.position.area.aor?.deputy;
      const data = { ...describeAssignment(a, ''), name: person.name, where: `${a.shift.position.name}, ${a.shift.position.area.name}`, text: text.trim().slice(0, 500) };
      await db.$transaction(async (tx) => {
        if (lead) await notify(tx, a.orgId, lead, 'cb_reply', { ...data, to: firstName(lead.name) });
        else await notifyPlanners(tx, a.orgId, 'cb_reply', { ...data, to: 'planner' });
      });
      return null;
    }
  }
}
