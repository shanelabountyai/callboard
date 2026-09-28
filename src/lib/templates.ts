import { audit } from '@/core/audit';
import type { OrgCtx } from '@/core/authz/guards';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import type { Prisma } from '@/generated/prisma/client';
import { pickRules } from './rules';
import { isYmd, ymd } from './time';

// Event templates (PRD 6, PRD 1). A template is an event nobody staffs (`isTemplate`), so its editor is
// the event editor and starting an event from it is the same copy that duplicates an event. Copies never
// link back: the new event has its own rows, and editing either side leaves the other alone.
export const BANDS = ['Under 250', '250 to 1,000', '1,000 to 5,000', 'Over 5,000'] as const;

type Opts = { name: string; startsOn?: string; asTemplate?: { band: string } };

/**
 * Days, AoRs, areas, positions, shifts and the rule set come across with every date shifted so the first
 * day lands on `startsOn`; assignments never do. Cards and playbooks move to their latest version.
 * A template leaves lead and deputy as slots to fill (PRD 2).
 * The caller has already checked the event is theirs: this file stays free of `next/*` so the seed can use it.
 */
export async function copyEvent(tx: Prisma.TransactionClient, ctx: Pick<OrgCtx, 'orgId' | 'userId'>, srcId: string, o: Opts): Promise<string> {
  const inOrg = (c: typeof ctx) => ({ orgId: c.orgId }); // the seed has no session to make a full OrgCtx from
  // Read outside the transaction: a read with this many includes runs its parts side by side, which one transaction's connection cannot do.
  const src = await db.event.findFirstOrThrow({
      where: { id: srcId, ...inOrg(ctx) },
      include: { days: { orderBy: { date: 'asc' } }, aors: true, areas: { include: { playbook: { select: { key: true } } } }, positions: { include: { card: { select: { key: true } } } }, shifts: true },
  });
  if (o.startsOn !== undefined && !isYmd(o.startsOn)) throw new Refused('Start date must be YYYY-MM-DD.');
  const firstDay = src.days[0]?.date;
  const delta = o.startsOn && firstDay ? Date.parse(o.startsOn) - firstDay.getTime() : 0; // ponytail: a DST boundary between the two events shifts wall times an hour; the planner sees it on the new event's page
  const at = (d: Date) => new Date(d.getTime() + delta);
  const latest = async (rows: { id: string; key: string; version: number }[]) => new Map(rows.sort((a, b) => a.version - b.version).map((r) => [r.key, r.id]));
  const cards = await latest(await tx.positionCard.findMany({ where: inOrg(ctx), select: { id: true, key: true, version: true } }));
  const playbooks = await latest(await tx.playbook.findMany({ where: inOrg(ctx), select: { id: true, key: true, version: true } }));

  const e = await tx.event.create({
    data: {
      ...inOrg(ctx), name: o.name, venue: src.venue, timezone: src.timezone, emergencyContact: o.asTemplate ? '' : src.emergencyContact, ...pickRules(src),
      isTemplate: !!o.asTemplate, attendanceBand: o.asTemplate?.band ?? src.attendanceBand, templateId: src.isTemplate && !o.asTemplate ? src.id : null,
    },
  });
  const dayIds = new Map<string, string>();
  for (const d of src.days) dayIds.set(d.id, (await tx.eventDay.create({ data: { ...inOrg(ctx), eventId: e.id, date: at(d.date) } })).id);
  const aorIds = new Map<string, string>();
  for (const { id, ...a } of src.aors) aorIds.set(id, (await tx.aor.create({ data: { ...a, eventId: e.id, ...(o.asTemplate && { leadId: null, deputyId: null }) } })).id);
  const areaIds = new Map<string, string>();
  for (const { id, aorId, playbook, ...a } of src.areas) {
    areaIds.set(id, (await tx.area.create({ data: { ...a, eventId: e.id, aorId: aorId ? aorIds.get(aorId) : null, playbookId: playbook ? playbooks.get(playbook.key) : null } })).id);
  }
  const positionIds = new Map<string, string>();
  for (const { id, areaId, card, ...p } of src.positions) {
    positionIds.set(id, (await tx.position.create({ data: { ...p, eventId: e.id, areaId: areaIds.get(areaId)!, cardId: card ? cards.get(card.key) : null } })).id);
  }
  await tx.shift.createMany({
    data: src.shifts.map((s) => ({
      ...inOrg(ctx), needed: s.needed, overbookPct: s.overbookPct, eventId: e.id, positionId: positionIds.get(s.positionId)!, dayId: dayIds.get(s.dayId)!,
      callAt: at(s.callAt), startAt: at(s.startAt), endAt: at(s.endAt),
    })),
  });
  const action = o.asTemplate ? 'template.saved' : src.isTemplate ? 'event.from_template' : 'event.duplicated';
  await audit(ctx, action, { targetType: 'event', targetId: e.id, data: { from: src.id, ...(firstDay && { firstDay: ymd(firstDay) }) } }, tx);
  return e.id;
}
