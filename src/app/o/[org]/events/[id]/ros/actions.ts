'use server';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/core/audit';
import { orgAction, ref } from '@/core/authz/action';
import { inOrg, notFoundOnP2025, type OrgCtx } from '@/core/authz/guards';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { must } from '@/lib/refuse';
import { COLUMNS_ERROR, replaceImported, rosLines } from '@/lib/ros';
import { fetchSheet, parseSheetLink } from '@/lib/sheet-link';
import { excelTime } from '@/lib/xlsx';

// Hand-added run-of-show lines sit beside the imported ones and survive every re-import.
const page = (ctx: OrgCtx, eventId: string) => `/o/${ctx.slug}/events/${eventId}/ros`;

export const addRosRow = orgAction(
  null,
  z.object({ eventId: ref('event'), day: z.string().trim().max(40).default(''), at: z.string().trim().max(10).default(''), cue: z.string().trim().min(1, 'What happens?').max(200), area: z.string().trim().max(80).default(''), owner: z.string().trim().max(80).default('') }),
  async (ctx, i) => {
    must(await db.event.findFirst({ where: { id: i.eventId, ...inOrg(ctx) }, select: { id: true } }));
    const id = randomUUID();
    await db.runOfShowRow.create({ data: { id, ...inOrg(ctx), eventId: i.eventId, sourceKey: `manual:${id}`, manual: true, day: i.day, at: excelTime(i.at), cue: i.cue, area: i.area, owner: i.owner, sortOrder: 0 } });
    redirect(page(ctx, i.eventId));
  },
);

export const deleteRosRow = orgAction(null, z.object({ id: ref('runOfShowRow') }), async (ctx, { id }) => {
  const row = must(await db.runOfShowRow.findFirst({ where: { id, ...inOrg(ctx) }, select: { eventId: true } }));
  await db.runOfShowRow.delete({ where: { id, ...inOrg(ctx) } }).catch(notFoundOnP2025);
  redirect(page(ctx, row.eventId));
});

// The live sheet: saves the link and pulls it now. A blank link disconnects and leaves the rows as they are.
// SMARTSHEET_TOKEN is read from process.env, not @/core/env: the template owns that schema (INV-14).
export const syncRos = orgAction(null, z.object({ eventId: ref('event'), url: z.string().trim().max(500).default('') }), async (ctx, i) => {
  must(await db.event.findFirst({ where: { id: i.eventId, ...inOrg(ctx) }, select: { id: true } }));
  if (!i.url) {
    await db.event.update({ where: { id: i.eventId, ...inOrg(ctx) }, data: { rosUrl: '', rosSyncedAt: null } });
    redirect(page(ctx, i.eventId));
  }
  const link = parseSheetLink(i.url);
  if (!link) throw new Refused('Paste a Smartsheet link, or a OneDrive or SharePoint link to an Excel workbook.');
  const lines = rosLines(await fetchSheet(link, { token: process.env.SMARTSHEET_TOKEN }));
  if (!lines) throw new Refused(COLUMNS_ERROR);
  await db.$transaction(async (tx) => {
    await replaceImported(tx, ctx, i.eventId, lines);
    await tx.event.update({ where: { id: i.eventId, ...inOrg(ctx) }, data: { rosUrl: link.url.href, rosSyncedAt: now() } });
    await audit(ctx, 'ros.synced', { targetType: 'event', targetId: i.eventId, data: { rows: lines.length, from: link.kind } }, tx);
  });
  redirect(`${page(ctx, i.eventId)}?imported=${lines.length}`);
});
