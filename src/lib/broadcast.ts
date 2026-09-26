import { audit } from '@/core/audit';
import type { OrgCtx } from '@/core/authz/guards';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import type { Prisma } from '@/generated/prisma/client';
import { ensurePersonLink } from './links';
import { enqueue } from '@/modules/notifications/outbox';
import { must } from './refuse';
import { linkExpiry } from './staffing';

// Targeted sends (PRD 4): one message to a picked audience, with an optional one-tap "Got it".
// An audience is a string the picker builds: event | aor:<id> | area:<id> | shift:<id> | person:<id> |
// unconfirmed | unchecked | float. Every query spreads the org, so a foreign id resolves to nobody.
const OPEN = { in: ['invited', 'confirmed'] as Prisma.EnumAssignmentStatusFilter['in'] };

export async function resolveAudience(orgId: string, eventId: string, audience: string): Promise<{ label: string; people: { id: string; name: string; mobile: string; email: string | null; smsOptOut: boolean }[] }> {
  const t = now();
  const [kind, id] = audience.split(':') as [string, string | undefined];
  const base: Prisma.AssignmentWhereInput = { orgId, eventId, status: OPEN };
  let where: Prisma.AssignmentWhereInput;
  let label: string;
  switch (kind) {
    case 'event': where = base; label = 'Whole event'; break;
    case 'aor': where = { ...base, shift: { position: { area: { aorId: id } } } }; label = (await db.aor.findFirst({ where: { id, orgId }, select: { name: true } }))?.name ?? ''; break;
    case 'area': where = { ...base, shift: { position: { areaId: id } } }; label = (await db.area.findFirst({ where: { id, orgId }, select: { name: true } }))?.name ?? ''; break;
    case 'shift': where = { ...base, shiftId: id }; label = id ? `Shift ${id.slice(0, 8)}` : ''; break;
    case 'person': where = { ...base, personId: id }; label = (await db.person.findFirst({ where: { id, orgId }, select: { name: true } }))?.name ?? ''; break;
    case 'unconfirmed': where = { ...base, status: 'invited' }; label = 'Still unconfirmed'; break;
    case 'unchecked': where = { ...base, status: 'confirmed', checkedInAt: null, shift: { callAt: { lt: new Date(t.getTime() + 3 * 3_600_000) }, endAt: { gt: t } } }; label = 'Not checked in'; break;
    case 'float': where = { ...base, status: 'confirmed', shift: { position: { isFloat: true } } }; label = 'Float pool'; break;
    default: throw new Refused('Pick who this goes to.');
  }
  if (!label) throw new Refused('That audience no longer exists.');
  const rows = await db.assignment.findMany({ where, select: { person: { select: { id: true, name: true, mobile: true, email: true, smsOptOut: true } } } });
  const people = [...new Map(rows.map((r) => [r.person.id, r.person])).values()];
  return { label, people };
}

/** Creates the broadcast and queues one message per person, both in one transaction. Returns the recipient count. */
export async function sendBroadcast(ctx: OrgCtx, eventId: string, audience: string, body: string, requiresAck: boolean) {
  const event = must(await db.event.findFirst({ where: { id: eventId, orgId: ctx.orgId }, include: { days: { orderBy: { date: 'desc' }, take: 1 } } })); // not yours = not found (INV-04)
  const { label, people } = await resolveAudience(ctx.orgId, eventId, audience);
  if (!people.length) throw new Refused('Nobody matches that audience right now.');
  await db.$transaction(async (tx) => {
    const b = await tx.broadcast.create({ data: { orgId: ctx.orgId, eventId, audience: label, body, requiresAck } });
    const expiresAt = linkExpiry(event.days[0]?.date ?? now());
    for (const p of people) {
      const url = await ensurePersonLink(tx, { orgId: ctx.orgId, eventId, personId: p.id }, expiresAt);
      const data = { name: p.name, event: event.name, body, requiresAck: requiresAck ? '1' : '', url };
      const sms = p.smsOptOut ? null : await enqueue({ channel: 'sms', to: p.mobile, template: 'cb_broadcast', data, orgId: ctx.orgId }, tx);
      if (p.email) await enqueue({ channel: 'email', to: p.email, template: 'cb_broadcast', data, orgId: ctx.orgId }, tx);
      await tx.broadcastRecipient.create({ data: { orgId: ctx.orgId, broadcastId: b.id, personId: p.id, outboxId: sms?.id ?? null } });
    }
    await audit(ctx, 'broadcast.sent', { targetType: 'broadcast', targetId: b.id, data: { audience: label, count: people.length, requiresAck } }, tx);
  });
  return people.length;
}

/** The same message again, only to those who have not tapped Got it. */
export async function resendToNonAckers(ctx: OrgCtx, broadcastId: string) {
  const b = must(await db.broadcast.findFirst({ where: { id: broadcastId, orgId: ctx.orgId }, include: { event: { include: { days: { orderBy: { date: 'desc' }, take: 1 } } }, recipients: { where: { ackedAt: null }, include: { person: true } } } }));
  if (!b.requiresAck) throw new Refused('This message did not ask for a Got it.');
  await db.$transaction(async (tx) => {
    for (const r of b.recipients) {
      const url = await ensurePersonLink(tx, { orgId: ctx.orgId, eventId: b.eventId, personId: r.personId }, linkExpiry(b.event.days[0]?.date ?? now()));
      const data = { name: r.person.name, event: b.event.name, body: b.body, requiresAck: '1', url };
      const sms = r.person.smsOptOut ? null : await enqueue({ channel: 'sms', to: r.person.mobile, template: 'cb_broadcast', data, orgId: ctx.orgId }, tx);
      if (r.person.email) await enqueue({ channel: 'email', to: r.person.email, template: 'cb_broadcast', data, orgId: ctx.orgId }, tx);
      await tx.broadcastRecipient.update({ where: { id: r.id }, data: { outboxId: sms?.id ?? null } });
    }
    await audit(ctx, 'broadcast.resent', { targetType: 'broadcast', targetId: b.id, data: { count: b.recipients.length } }, tx);
  });
  return b.recipients.length;
}
