'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/core/audit';
import { orgAction } from '@/core/authz/action';
import { inOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { RULES, ruleShape, standardOf } from '@/lib/rules';
import { startDue } from '@/lib/stages';

/**
 * Changes the org's standard (PRD 6). Every event still being planned that was on the old standard moves
 * to the new one, templates included; an event that said otherwise keeps its own value, and a live or
 * closed event keeps the rules it ran with.
 */
export const saveStandard = orgAction(null, z.object(ruleShape()), async (ctx, i) => {
  await startDue(ctx.orgId); // an event on its first day is running, and frozen, before the cron says so
  await db.$transaction(async (tx) => {
    const old = await standardOf(ctx.orgId, tx);
    const changed = RULES.map((r) => r.key).filter((k) => old[k] !== i[k]);
    if (!changed.length) throw new Refused('Nothing changed.');
    await tx.orgRules.update({ where: { orgId: ctx.orgId }, data: i });
    let moved = 0;
    for (const k of changed) moved += (await tx.event.updateMany({ where: { ...inOrg(ctx), status: { notIn: ['live', 'closed'] }, [k]: old[k] }, data: { [k]: i[k] } })).count;
    await audit(ctx, 'rules.standard', { targetType: 'org', targetId: ctx.orgId, data: { changed, eventValuesMoved: moved } }, tx);
  });
  redirect(`/o/${ctx.slug}/rules`);
});
