// public: the link's token is the credential (readPersonLink); same-origin POST
import { z } from 'zod';
import { audit } from '@/core/audit';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { clientIp, isSameOrigin } from '@/core/http';
import { cantReach, checkIn, checkOut, HELP_CATEGORIES, raiseHelp, type Method } from '@/lib/dayof';
import { readPersonLink } from '@/lib/links';
import { assignmentInclude, describeAssignment } from '@/lib/staffing';
import { answerSwap, askSwap, decideSwap, SWAP_SAYS, swapDone, withdrawSwap } from '@/lib/swaps';
import { drainOutbox } from '@/modules/notifications/outbox';

// Every day-of action from a person's or lead's page (PRD 5): check in or out (own shift, or anyone in
// an AoR you lead), ask for help, acknowledge a message, close an alert, or pass a no-show to the planner
// ("Can't reach them") and take that back. A lead cannot release anyone: that texts the person, and it is
// the planner's, from the Staff page. And before the day, a swap (PRD 3): ask, answer, withdraw, and a
// lead's approval. A POST, same origin, from the link's own page; JSON from taps.tsx or a plain form
// without JavaScript.
const Body = z.object({
  kind: z.enum(['checkin', 'checkout', 'help', 'ack', 'resolve', 'unreachable', 'reach_undo', 'back', 'swap_ask', 'swap_yes', 'swap_no', 'swap_withdraw', 'swap_approve', 'swap_refuse']),
  assignment: z.uuid().optional(),
  other: z.uuid().optional(), // swap_ask: the colleague's assignment
  swap: z.uuid().optional(),
  alert: z.uuid().optional(),
  recipient: z.uuid().optional(),
  category: z.string().max(20).optional(),
  note: z.string().max(500).optional(),
  at: z.string().optional(), // device time of an offline tap
});

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!isSameOrigin(req.headers)) return new Response(null, { status: 403 });
  const { token } = await params;
  const link = await readPersonLink(token, clientIp(req.headers));
  if (link === 'limited') return new Response('Too many requests', { status: 429 });
  if (!link) return new Response(null, { status: 404 });
  const json = req.headers.get('content-type')?.includes('json');
  const raw = json ? await req.json().catch(() => null) : Object.fromEntries(await req.formData());
  const parsed = Body.safeParse(raw);
  const reply = (status: number, error?: string, done?: string) =>
    json || !req.headers.get('accept')?.includes('text/html')
      ? Response.json(error ? { error } : { ok: true }, { status })
      : Response.redirect(new URL(`/p/${token}${done ? `?done=${done}` : ''}`, req.url), 303);
  if (!parsed.success) return reply(400, 'Check the form and try again.');
  const i = parsed.data;
  const { person, event, orgId } = link;
  const t = now();
  const deviceAt = i.at ? new Date(i.at) : t;
  const at = Number.isNaN(deviceAt.getTime()) || deviceAt.getTime() > t.getTime() + 5 * 60_000 ? t : deviceAt; // a future clock is wrong; an old one is an offline tap
  const myAors = await db.aor.findMany({ where: { orgId, eventId: event.id, OR: [{ leadId: person.id }, { deputyId: person.id }] }, select: { id: true } });
  const leads = (aorId: string | null) => !!aorId && myAors.some((x) => x.id === aorId);

  if (i.kind === 'checkin' || i.kind === 'checkout') {
    if (!i.assignment) return reply(400, 'Which shift?');
    const a = await db.assignment.findFirst({ where: { id: i.assignment, orgId, eventId: event.id }, include: assignmentInclude });
    const method: Method | null = !a ? null : a.personId === person.id ? 'self' : leads(a.shift.position.area.aorId) ? 'lead' : null;
    if (!a || !method) return reply(404, 'That shift is not yours to change.');
    const r = await db.$transaction((tx) => (i.kind === 'checkin' ? checkIn(tx, a, at, method) : checkOut(tx, a, at, method)));
    if (r === 'early') return reply(409, `Too early: call time is ${describeAssignment(a, '').call}. Check in within three hours of it.`);
    return reply(200, undefined, i.kind);
  }

  if (i.kind === 'help') {
    const category = HELP_CATEGORIES.includes(i.category ?? '') ? i.category! : 'other';
    const a = await db.assignment.findFirst({
      where: { orgId, eventId: event.id, personId: person.id, status: { in: ['invited', 'confirmed'] }, shift: { endAt: { gt: new Date(t.getTime() - 12 * 3_600_000) } } },
      include: assignmentInclude, orderBy: { shift: { callAt: 'asc' } },
    });
    await db.$transaction((tx) => raiseHelp(tx, { ...person, orgId }, event.id, a, category, i.note ?? ''));
    await drainOutbox(5);
    return reply(200, undefined, 'help');
  }

  if (i.kind.startsWith('swap_')) {
    const scope = { orgId, eventId: event.id };
    if (i.kind === 'swap_ask' ? !i.assignment || !i.other : !i.swap) return reply(400, 'Which swap?');
    const r =
      i.kind === 'swap_ask' ? await askSwap(person, scope, i.assignment!, i.other!)
      : i.kind === 'swap_withdraw' ? await withdrawSwap(person, scope, i.swap!)
      : i.kind === 'swap_yes' || i.kind === 'swap_no' ? await answerSwap(person, scope, i.swap!, i.kind === 'swap_yes')
      : await decideSwap({ name: person.name, personId: person.id, aorIds: myAors.map((x) => x.id) }, { orgId, userId: null }, scope, i.swap!, i.kind === 'swap_approve');
    await drainOutbox(5);
    return swapDone(r) ? reply(200, undefined, r) : reply(409, SWAP_SAYS[r], r);
  }

  // "Count me in next time" on the thank-you (PRD 6): about the person, not the event, so it outlives this link.
  if (i.kind === 'back') {
    await db.person.update({ where: { id: person.id }, data: { wantsBackAt: t } });
    await audit({ orgId, userId: null }, 'person.wants_back', { targetType: 'person', targetId: person.id, data: { eventId: event.id } });
    return reply(200, undefined, 'back');
  }

  if (i.kind === 'ack') {
    if (!i.recipient) return reply(400, 'Which message?');
    const { count } = await db.broadcastRecipient.updateMany({ where: { id: i.recipient, orgId, personId: person.id, ackedAt: null }, data: { ackedAt: t } });
    return count ? reply(200, undefined, 'ack') : reply(404, 'That message is not yours.');
  }

  // A lead and an alert in their own AoR: close it, pass a no-show to the planner, or take that back.
  if (!i.alert) return reply(400, 'Which alert?');
  const alert = await db.alert.findFirst({ where: { id: i.alert, orgId, eventId: event.id, resolvedAt: null }, include: { assignment: { include: assignmentInclude } } });
  if (!alert || !leads(alert.aorId)) return reply(404, 'That alert is not yours to close.');
  if (i.kind === 'resolve') {
    await db.$transaction(async (tx) => {
      await tx.alert.update({ where: { id: alert.id }, data: { resolvedAt: t, resolution: `resolved by ${person.name}${i.note ? `: ${i.note}` : ''}` } });
      await audit({ orgId, userId: null }, 'alert.resolve', { targetType: 'alert', targetId: alert.id, data: { by: 'person', personId: person.id } }, tx);
    });
    return reply(200, undefined, 'resolve');
  }
  const a = alert.assignment;
  if (!a) return reply(409, 'That shift is gone. Tap Done to close the alert.');
  if (await db.$transaction((tx) => cantReach(tx, alert, a, person.name, i.kind === 'reach_undo'))) await drainOutbox(5); // a second tap changes nothing and sends nothing
  return reply(200, undefined, i.kind);
}
