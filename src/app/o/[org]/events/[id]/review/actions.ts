'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/core/audit';
import { orgAction, ref } from '@/core/authz/action';
import { inOrg, type OrgCtx } from '@/core/authz/guards';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { must } from '@/lib/refuse';
import { parseReview, saveReview } from '@/lib/review';

// The planner's side of the review (PRD 6): finish an area a lead has not, or waive it with a note.
const page = (ctx: OrgCtx, eventId: string) => `/o/${ctx.slug}/events/${eventId}/review`;
const area = async (ctx: OrgCtx, id: string) => must(await db.area.findFirst({ where: { id, ...inOrg(ctx) }, select: { id: true, orgId: true, eventId: true } }));

/** People come as `o:` / `r:` / `n:<assignmentId>` fields (see parseReview), so one form carries the whole area. */
export const saveAreaReview = orgAction(null, z.looseObject({ areaId: ref('area') }), async (ctx, i) => {
  const a = await area(ctx, i.areaId); // the row first, the answers second: "not yours" wins over "bad input"
  const input = parseReview(i);
  await db.$transaction((tx) => saveReview(tx, a, { userId: ctx.userId, name: ctx.session.email }, input));
  redirect(page(ctx, a.eventId));
});

export const waiveAreaReview = orgAction(null, z.object({ areaId: ref('area'), note: z.string().trim().min(1, 'Say why the review is waived.').max(500) }), async (ctx, i) => {
  const a = await area(ctx, i.areaId);
  const event = await db.event.findUniqueOrThrow({ where: { id: a.eventId }, select: { status: true } });
  if (event.status !== 'closed') throw new Refused('The review opens when the event is closed.');
  const waived = { waived: true, waiveNote: i.note, understaffed: '', overstaffed: '', wentWrong: '', by: ctx.session.email, at: now() };
  await db.areaReview.upsert({ where: { areaId: a.id }, create: { ...inOrg(ctx), eventId: a.eventId, areaId: a.id, ...waived }, update: waived });
  await audit(ctx, 'review.waived', { targetType: 'area', targetId: a.id, data: { note: i.note } });
  redirect(page(ctx, a.eventId));
});
