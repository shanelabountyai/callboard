import { audit } from '@/core/audit';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { isSameOrigin } from '@/core/http';
import { parseCsv, pickColumn, toRecords } from '@/lib/csv';
import { excelTime, readXlsx } from '@/lib/xlsx';

// Run-of-show import (PRD 1): an .xlsx from Excel or a CSV export from Smartsheet. Columns are
// matched by header name; imported rows are replaced wholesale, hand-added rows are kept.
// ponytail: header synonyms instead of a saved column mapping; add the mapping UI if a sheet ever fails to match.
const TIME = ['time', 'start', 'start time', 'when', 'at'];
const CUE = ['cue', 'item', 'description', 'what', 'activity', 'segment', 'title', 'program'];
const AREA = ['area', 'location', 'room', 'where', 'venue', 'stage'];
const OWNER = ['owner', 'who', 'lead', 'responsible', 'contact'];
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org);
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
  const records = toRecords(rows);
  const first = records[0];
  const timeCol = first && pickColumn(first, TIME);
  const cueCol = first && pickColumn(first, CUE);
  if (!first || !timeCol || !cueCol) return back('error=columns');
  const areaCol = pickColumn(first, AREA);
  const ownerCol = pickColumn(first, OWNER);
  const seen = new Map<string, number>();
  const data = records
    .map((r, i) => ({ at: excelTime(r[timeCol]!), cue: r[cueCol]!, area: areaCol ? r[areaCol]! : '', owner: ownerCol ? r[ownerCol]! : '', sortOrder: i }))
    .filter((r) => r.at || r.cue)
    .map((r) => {
      const base = `${r.at}|${r.cue}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return { ...inOrg(ctx), eventId: id, manual: false, sourceKey: n === 1 ? base : `${base}#${n}`, ...r };
    });
  await db.$transaction(async (tx) => {
    await tx.runOfShowRow.deleteMany({ where: { ...inOrg(ctx), eventId: id, manual: false } });
    await tx.runOfShowRow.createMany({ data });
    await audit(ctx, 'ros.imported', { targetType: 'event', targetId: id, data: { rows: data.length, file: file.name.slice(0, 80) } }, tx);
  });
  return back(`imported=${data.length}`);
}
