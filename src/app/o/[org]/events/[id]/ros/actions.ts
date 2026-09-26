'use server';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { orgAction, ref } from '@/core/authz/action';
import { inOrg, notFoundOnP2025, type OrgCtx } from '@/core/authz/guards';
import { db } from '@/core/db';
import { must } from '@/lib/refuse';
import { excelTime } from '@/lib/xlsx';

// Hand-added run-of-show lines sit beside the imported ones and survive every re-import.
const page = (ctx: OrgCtx, eventId: string) => `/o/${ctx.slug}/events/${eventId}/ros`;

export const addRosRow = orgAction(
  null,
  z.object({ eventId: ref('event'), at: z.string().trim().max(10).default(''), cue: z.string().trim().min(1, 'What happens?').max(200), area: z.string().trim().max(80).default(''), owner: z.string().trim().max(80).default('') }),
  async (ctx, i) => {
    must(await db.event.findFirst({ where: { id: i.eventId, ...inOrg(ctx) }, select: { id: true } }));
    const id = randomUUID();
    await db.runOfShowRow.create({ data: { id, ...inOrg(ctx), eventId: i.eventId, sourceKey: `manual:${id}`, manual: true, at: excelTime(i.at), cue: i.cue, area: i.area, owner: i.owner, sortOrder: 0 } });
    redirect(page(ctx, i.eventId));
  },
);

export const deleteRosRow = orgAction(null, z.object({ id: ref('runOfShowRow') }), async (ctx, { id }) => {
  const row = must(await db.runOfShowRow.findFirst({ where: { id, ...inOrg(ctx) }, select: { eventId: true } }));
  await db.runOfShowRow.delete({ where: { id, ...inOrg(ctx) } }).catch(notFoundOnP2025);
  redirect(page(ctx, row.eventId));
});
