'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/core/audit';
import { orgAction, ref } from '@/core/authz/action';
import { inOrg, type OrgCtx } from '@/core/authz/guards';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { cardLines, slug } from '@/lib/cards';
import { must, onUnique } from '@/lib/refuse';
import { startDue } from '@/lib/stages';

// The area playbook library (PRD 6). The same rules as the card library (cards/actions.ts): every save is
// a new version with a name on it, versions are linear, and a live or closed event keeps the one it ran with.
const page = (ctx: OrgCtx) => `/o/${ctx.slug}/playbooks`;
const lines = (label: string) => z.string().max(4000).default('').refine((v) => cardLines(v).length <= 20, `${label}: 20 lines at most.`);
const fields = {
  title: z.string().trim().min(1, 'Name the area this playbook is for.').max(80),
  staffing: lines('Positions and headcount'),
  callOffsetMin: z.union([z.literal(''), z.coerce.number().int().min(0, 'Call offset cannot be negative.').max(480)]).default(''),
  breakPlan: lines('Break plan'),
  floatPlan: lines('Floats'),
  equipment: lines('Equipment'),
  setup: lines('Setup checklist'),
  close: lines('Close checklist'),
  failurePoints: lines('Known failure points'),
};
type Fields = z.infer<z.ZodObject<typeof fields>>;
const tidy = (v: string) => cardLines(v).join('\n');
const clean = (i: Fields) => ({
  title: i.title, callOffsetMin: i.callOffsetMin === '' ? null : i.callOffsetMin,
  staffing: tidy(i.staffing), breakPlan: tidy(i.breakPlan), floatPlan: tidy(i.floatPlan), equipment: tidy(i.equipment), setup: tidy(i.setup), close: tidy(i.close), failurePoints: tidy(i.failurePoints),
});

export const createPlaybook = orgAction(null, z.object(fields), async (ctx, i) => {
  const key = slug(i.title);
  if (!key) throw new Refused('Use letters or numbers in the title.');
  const pb = await db.playbook
    .create({ data: { ...inOrg(ctx), key, version: 1, ...clean(i), changedBy: ctx.userId } })
    .catch(onUnique('A playbook with that title is already in the library. Edit that one.'));
  await audit(ctx, 'playbook.created', { targetType: 'playbook', targetId: pb.id, data: { key } });
  redirect(page(ctx));
});

export const savePlaybook = orgAction(null, z.object({ id: ref('playbook'), ...fields }), async (ctx, { id, ...i }) => {
  const base = must(await db.playbook.findFirst({ where: { id, ...inOrg(ctx) } }));
  const latest = await db.playbook.findFirstOrThrow({ where: { ...inOrg(ctx), key: base.key }, orderBy: { version: 'desc' } });
  if (latest.id !== base.id) throw new Refused(`Version ${latest.version} was saved while you were editing. Reload to see that change, then make yours on top of it.`);
  const next = clean(i);
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== base[k]);
  if (!changed.length) throw new Refused('Nothing changed, so there is no new version.');
  await startDue(ctx.orgId); // an event on its first day is running, and frozen, before the cron says so
  await db.$transaction(async (tx) => {
    const pb = await tx.playbook
      .create({ data: { ...inOrg(ctx), key: base.key, version: base.version + 1, ...next, changedBy: ctx.userId } })
      .catch(onUnique('Someone saved this playbook a moment ago. Reload to see their change, then make yours on top of it.'));
    const moved = await tx.area.updateMany({ where: { ...inOrg(ctx), playbook: { key: base.key }, event: { status: { notIn: ['live', 'closed'] } } }, data: { playbookId: pb.id } });
    await audit(ctx, 'playbook.versioned', { targetType: 'playbook', targetId: pb.id, data: { key: base.key, version: pb.version, changed, areasMoved: moved.count } }, tx);
  });
  redirect(page(ctx));
});
