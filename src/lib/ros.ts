import { inOrg, type OrgCtx } from '@/core/authz/guards';
import type { Prisma } from '@/generated/prisma/client';
import { pickColumn, toRecords } from './csv';
import { excelTime } from './xlsx';

// The run-of-show mirror (PRD 1), shared by the file upload and the live sheet's Sync. Columns are
// matched by header name; imported rows are replaced wholesale, hand-added rows are kept.
// ponytail: header synonyms instead of a saved column mapping; add the mapping UI if a sheet ever fails to match.
const TIME = ['time', 'start', 'start time', 'when', 'at'];
const CUE = ['cue', 'item', 'description', 'what', 'activity', 'segment', 'title', 'program'];
const AREA = ['area', 'location', 'room', 'where', 'venue', 'stage'];
const DAY = ['day', 'date'];
const OWNER = ['owner', 'who', 'lead', 'responsible', 'contact'];

export const COLUMNS_ERROR = 'The header row needs a time column (Time, Start or When) and a cue column (Cue, Item, Description or What).';
export type RosLine = { day: string; at: string; cue: string; area: string; owner: string; sortOrder: number; sourceKey: string };

/** "Day 2" stays as written; a date cell arrives as Excel's serial with no style, and becomes "2026-10-14". */
const excelDay = (v: string) => (/^\d{5}(\.\d+)?$/.test(v.trim()) ? new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86_400_000).toISOString().slice(0, 10) : v.trim().slice(0, 40));

/** A sheet's rows as run-of-show lines, or null when the header row has no time or no cue column. */
export function rosLines(rows: string[][]): RosLine[] | null {
  const records = toRecords(rows);
  const first = records[0];
  const timeCol = first && pickColumn(first, TIME);
  const cueCol = first && pickColumn(first, CUE);
  if (!first || !timeCol || !cueCol) return null;
  const areaCol = pickColumn(first, AREA);
  const ownerCol = pickColumn(first, OWNER);
  const dayCol = pickColumn(first, DAY);
  const seen = new Map<string, number>();
  return records
    .map((r, i) => ({ day: dayCol ? excelDay(r[dayCol]!) : '', at: excelTime(r[timeCol]!), cue: r[cueCol]!, area: areaCol ? r[areaCol]! : '', owner: ownerCol ? r[ownerCol]! : '', sortOrder: i }))
    .filter((r) => r.at || r.cue)
    .map((r) => {
      const base = `${r.day && `${r.day}|`}${r.at}|${r.cue}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return { ...r, sourceKey: n === 1 ? base : `${base}#${n}` };
    });
}

export async function replaceImported(tx: Prisma.TransactionClient, ctx: OrgCtx, eventId: string, lines: RosLine[]) {
  await tx.runOfShowRow.deleteMany({ where: { ...inOrg(ctx), eventId, manual: false } });
  await tx.runOfShowRow.createMany({ data: lines.map((l) => ({ ...inOrg(ctx), eventId, manual: false, ...l })) });
}
