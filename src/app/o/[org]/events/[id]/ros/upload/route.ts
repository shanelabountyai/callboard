import { audit } from '@/core/audit';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { isSameOrigin } from '@/core/http';
import { parseCsv } from '@/lib/csv';
import { assertPlanner } from '@/lib/planner';
import { replaceImported, rosLines } from '@/lib/ros';
import { readXlsx } from '@/lib/xlsx';

// Run-of-show import (PRD 1): an .xlsx from Excel or a CSV export from Smartsheet. The rows are read by
// src/lib/ros.ts, the same as the live sheet's Sync.
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = assertPlanner(await requireOrg((await params).org));
  const { id } = await params;
  const back = (q: string) => Response.redirect(new URL(`/o/${ctx.slug}/events/${id}/ros?${q}`, req.url), 303);
  if (!isSameOrigin(req.headers)) return new Response(null, { status: 403 });
  const event = await db.event.findFirst({ where: { id, ...inOrg(ctx) }, select: { id: true } });
  if (!event) return new Response(null, { status: 404 });
  const file = (await req.formData()).get('file');
  if (!(file instanceof File) || file.size === 0) return back('error=nofile');
  if (file.size > MAX_BYTES) return back('error=toolarge');
  let rows: string[][];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    rows = file.name.toLowerCase().endsWith('.xlsx') ? readXlsx(buf) : parseCsv(buf.toString('utf8').replace(/^﻿/, ''));
  } catch {
    return back('error=unreadable');
  }
  const data = rosLines(rows);
  if (!data) return back('error=columns');
  await db.$transaction(async (tx) => {
    await replaceImported(tx, ctx, id, data);
    await audit(ctx, 'ros.imported', { targetType: 'event', targetId: id, data: { rows: data.length, file: file.name.slice(0, 80) } }, tx);
  });
  return back(`imported=${data.length}`);
}
