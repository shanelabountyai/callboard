import { z } from 'zod';
import { audit } from '@/core/audit';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { clientIp, isSameOrigin } from '@/core/http';
import { checkIn, checkOut, HELP_CATEGORIES, raiseHelp, type Method } from '@/lib/dayof';
import { readPersonLink } from '@/lib/links';
import { ensurePersonLink } from '@/lib/links';
import { notify } from '@/lib/messages';
import { assignmentInclude, describeAssignment, linkExpiry } from '@/lib/staffing';
import { drainOutbox } from '@/modules/notifications/outbox';

// Every day-of action from a person's or lead's page (PRD 5): check in or out (own shift, or anyone in
// an AoR you lead), ask for help, acknowledge a message, resolve or release a no-show. A POST, same
// origin, from the link's own page; JSON from taps.tsx or a plain form without JavaScript.
const Body = z.object({
  kind: z.enum(['checkin', 'checkout', 'help', 'ack', 'resolve', 'release']),
  assignment: z.uuid().optional(),
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

  if (i.kind === 'ack') {
    if (!i.recipient) return reply(400, 'Which message?');
    const { count } = await db.broadcastRecipient.updateMany({ where: { id: i.recipient, orgId, personId: person.id, ackedAt: null }, data: { ackedAt: t } });
    return count ? reply(200, undefined, 'ack') : reply(404, 'That message is not yours.');
  }

  // resolve / release: a lead closing a no-show in their own AoR
  if (!i.alert) return reply(400, 'Which alert?');
  const alert = await db.alert.findFirst({ where: { id: i.alert, orgId, eventId: event.id, resolvedAt: null }, include: { assignment: { include: assignmentInclude } } });
  if (!alert || !leads(alert.aorId)) return reply(404, 'That alert is not yours to close.');
  await db.$transaction(async (tx) => {
    let resolution = `resolved by ${person.name}${i.note ? `: ${i.note}` : ''}`;
    if (i.kind === 'release' && alert.assignment && alert.assignment.status !== 'released') {
      const a = alert.assignment;
      await tx.assignment.update({ where: { id: a.id }, data: { status: 'released', respondedAt: t } });
      const url = await ensurePersonLink(tx, { orgId, eventId: event.id, personId: a.personId }, linkExpiry(a.shift.endAt));
      await notify(tx, orgId, a.person, 'cb_released', describeAssignment(a, url));
      resolution = `released by ${person.name}`;
    }
    await tx.alert.update({ where: { id: alert.id }, data: { resolvedAt: t, resolution } });
    await audit({ orgId, userId: null }, `alert.${i.kind}`, { targetType: 'alert', targetId: alert.id, data: { by: 'person', personId: person.id } }, tx);
  });
  if (i.kind === 'release') await drainOutbox(5);
  return reply(200, undefined, i.kind);
}
