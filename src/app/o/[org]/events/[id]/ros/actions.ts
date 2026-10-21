'use server';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/core/audit';
import { ref } from '@/core/authz/action';
import { inOrg, notFoundOnP2025, type OrgCtx } from '@/core/authz/guards';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { must } from '@/lib/refuse';
import { COLUMNS_ERROR, replaceImported, rosLines } from '@/lib/ros';
import { fetchSheet, parseSheetLink } from '@/lib/sheet-link';
import { excelTime } from '@/lib/xlsx';
import { plannerAction } from '@/lib/planner';

// Hand-added run-of-show lines sit beside the imported ones and survive every re-import.
const page = (ctx: OrgCtx, eventId: string) => `/o/${ctx.slug}/events/${eventId}/ros`;

export const addRosRow = plannerAction(
  z.object({ eventId: ref('event'), day: z.string().trim().max(40).default(''), at: z.string().trim().max(10).default(''), cue: z.string().trim().min(1, 'What happens?').max(200), area: z.string().trim().max(80).default(''), owner: z.string().trim().max(80).default('') }),
  async (ctx, i) => {
    must(await db.event.findFirst({ where: { id: i.eventId, ...inOrg(ctx) }, select: { id: true } }));
    const id = randomUUID();
    await db.runOfShowRow.create({ data: { id, ...inOrg(ctx), eventId: i.eventId, sourceKey: `manual:${id}`, manual: true, day: i.day, at: excelTime(i.at), cue: i.cue, area: i.area, owner: i.owner, sortOrder: 0 } });
    redirect(page(ctx, i.eventId));
  },
);

export const deleteRosRow = plannerAction(z.object({ id: ref('runOfShowRow') }), async (ctx, { id }) => {
  const row = must(await db.runOfShowRow.findFirst({ where: { id, ...inOrg(ctx) }, select: { eventId: true } }));
  await db.runOfShowRow.delete({ where: { id, ...inOrg(ctx) } }).catch(notFoundOnP2025);
  redirect(page(ctx, row.eventId));
});

// The live sheet: saves the link and pulls it now. A blank link disconnects and leaves the rows as they are.
// SMARTSHEET_TOKEN is read from process.env, not @/core/env: the template owns that schema (INV-14).
export const syncRos = plannerAction(z.object({ eventId: ref('event'), url: z.string().trim().max(500).default('') }), async (ctx, i) => {
  must(await db.event.findFirst({ where: { id: i.eventId, ...inOrg(ctx) }, select: { id: true } }));
  if (!i.url) {
    await db.event.update({ where: { id: i.eventId, ...inOrg(ctx) }, data: { rosUrl: '', rosSyncedAt: null, rosTriedAt: null } });
    redirect(page(ctx, i.eventId));
  }
  const link = parseSheetLink(i.url);
  if (!link) throw new Refused('Paste a Smartsheet link, or a OneDrive or SharePoint link to an Excel workbook.');
  const lines = rosLines(await fetchSheet(link, { token: process.env.SMARTSHEET_TOKEN }));
  if (!lines) throw new Refused(COLUMNS_ERROR);
  const at = now();
  await db.$transaction(async (tx) => {
    await replaceImported(tx, ctx, i.eventId, lines);
    await tx.event.update({ where: { id: i.eventId, ...inOrg(ctx) }, data: { rosUrl: link.url.href, rosSyncedAt: at, rosTriedAt: at } });
    await audit(ctx, 'ros.synced', { targetType: 'event', targetId: i.eventId, data: { rows: lines.length, from: link.kind } }, tx);
  });
  redirect(`${page(ctx, i.eventId)}?imported=${lines.length}`);
});

// The page's own pull, about once a minute while it is open. It reads the saved link, never one from the request.
// Several open tabs share one pull: the claim on rosTriedAt lets one through every 50 s. A pull that fails keeps the
// rows and logs nothing; rosTriedAt ahead of rosSyncedAt is how the page knows to say so.
const PULL_GAP_MS = 50_000;
export const pullRos = plannerAction(z.object({ eventId: ref('event') }), async (ctx, { eventId }) => {
  const event = must(await db.event.findFirst({ where: { id: eventId, ...inOrg(ctx) }, select: { rosUrl: true } }));
  const link = parseSheetLink(event.rosUrl);
  if (!link) return { pulled: false };
  const at = now();
  const claim = await db.event.updateMany({ where: { id: eventId, ...inOrg(ctx), rosUrl: event.rosUrl, OR: [{ rosTriedAt: null }, { rosTriedAt: { lt: new Date(at.getTime() - PULL_GAP_MS) } }] }, data: { rosTriedAt: at } });
  if (!claim.count) return { pulled: false };
  const lines = rosLines(await fetchSheet(link, { token: process.env.SMARTSHEET_TOKEN }));
  if (!lines) throw new Refused(COLUMNS_ERROR);
  await db.$transaction(async (tx) => {
    const changed = await replaceImported(tx, ctx, eventId, lines);
    // The link is checked again: a disconnect or a new link while the sheet was on its way must not be marked synced.
    await tx.event.updateMany({ where: { id: eventId, ...inOrg(ctx), rosUrl: event.rosUrl }, data: { rosSyncedAt: at } });
    if (changed) await audit(ctx, 'ros.synced', { targetType: 'event', targetId: eventId, data: { rows: lines.length, from: link.kind, changed, auto: true } }, tx);
  });
  return { pulled: true };
});
