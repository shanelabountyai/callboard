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

// The position card library (PRD 6). Any planner in the org can edit; every save is a new version with
// their name on it, and nothing is ever edited in place.
// No #anchor on the redirect: the router treats same-path-plus-hash as a scroll and keeps showing the old version.
const page = (ctx: OrgCtx) => `/o/${ctx.slug}/cards`;
const lines = (label: string, max: number) =>
  z.string().max(2000).default('').refine((v) => cardLines(v).length <= max, `${label}: ${max} lines at most. A card people read is a short card.`);
const fields = {
  title: z.string().trim().min(1, 'Give the card a title.').max(80),
  purpose: z.string().trim().max(200).default(''),
  duties: lines('What you do', 5),
  situations: lines('What to do if', 5),
  never: z.string().trim().max(1000).default(''),
  demands: z.string().trim().max(1000).default(''),
  minAge: z.union([z.literal(''), z.coerce.number().int().min(0, 'Minimum age cannot be negative.').max(99)]).default(''),
};
type Fields = z.infer<z.ZodObject<typeof fields>>;
const clean = (i: Fields) => ({
  title: i.title, purpose: i.purpose, never: i.never, demands: i.demands,
  duties: cardLines(i.duties).join('\n'), situations: cardLines(i.situations).join('\n'),
  minAge: i.minAge === '' ? null : i.minAge,
});
const TAKEN = 'Someone saved this card a moment ago. Reload to see their change, then make yours on top of it.';

export const createCard = orgAction(null, z.object(fields), async (ctx, i) => {
  const key = slug(i.title);
  if (!key) throw new Refused('Use letters or numbers in the title.');
  const card = await db.positionCard
    .create({ data: { ...inOrg(ctx), key, version: 1, ...clean(i), changedBy: ctx.userId } })
    .catch(onUnique('A card with that title is already in the library. Edit that one.'));
  await audit(ctx, 'card.created', { targetType: 'positionCard', targetId: card.id, data: { key } });
  redirect(page(ctx));
});

/**
 * Saves the next version. `id` is the version the editor opened: if it is no longer the latest, someone
 * else saved first and this one is refused rather than silently winning (versions are linear).
 * Events not yet live move to the new version; a live or closed event keeps the one it ran with.
 */
export const saveCard = orgAction(null, z.object({ id: ref('positionCard'), ...fields }), async (ctx, { id, ...i }) => {
  const base = must(await db.positionCard.findFirst({ where: { id, ...inOrg(ctx) } }));
  const latest = await db.positionCard.findFirstOrThrow({ where: { ...inOrg(ctx), key: base.key }, orderBy: { version: 'desc' } });
  if (latest.id !== base.id) throw new Refused(`Version ${latest.version} was saved while you were editing. Reload to see that change, then make yours on top of it.`);
  const next = clean(i);
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== base[k]);
  if (!changed.length) throw new Refused('Nothing changed, so there is no new version.');
  await startDue(ctx.orgId); // an event on its first day is running, and frozen, before the cron says so
  await db.$transaction(async (tx) => {
    const card = await tx.positionCard.create({ data: { ...inOrg(ctx), key: base.key, version: base.version + 1, ...next, changedBy: ctx.userId } }).catch(onUnique(TAKEN));
    const moved = await tx.position.updateMany({ where: { ...inOrg(ctx), card: { key: base.key }, event: { status: { notIn: ['live', 'closed'] } } }, data: { cardId: card.id } });
    await audit(ctx, 'card.versioned', { targetType: 'positionCard', targetId: card.id, data: { key: base.key, version: card.version, changed, positionsMoved: moved.count } }, tx);
  });
  redirect(page(ctx));
});
