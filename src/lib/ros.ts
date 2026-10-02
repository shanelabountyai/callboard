import { inOrg, type OrgCtx } from '@/core/authz/guards';
import { now } from '@/core/clock';
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

type Line = Pick<RosLine, 'day' | 'at' | 'cue' | 'area' | 'owner' | 'sourceKey'>;
/** One line of the change log. `sourceKey` is the line as it is now (none for a removed one); `was` is a moved line's old time. */
export type RosChange = { kind: 'added' | 'removed' | 'moved' | 'edited'; day: string; at: string; cue: string; sourceKey?: string; was?: string; note?: string };

/**
 * What a sync changed. A line is the same line when its day, time and cue match (sourceKey): then a new area or
 * owner is an edit. A line with a new time and the same day and cue has moved. Anything else is added or removed.
 * ponytail: a sheet row has no permanent id, so a cue whose time and wording both change reads as one removed and
 * one added; match on Smartsheet's row id if that ever matters.
 */
export function diffRos(old: Line[], lines: Line[]): RosChange[] {
  const before = new Map(old.map((o) => [o.sourceKey, o]));
  const kept = new Set(lines.map((l) => l.sourceKey));
  const gone = old.filter((o) => !kept.has(o.sourceKey));
  const note = (o: Line, l: Line) => (['area', 'owner'] as const).filter((f) => o[f] !== l[f]).map((f) => `${f} ${o[f] || 'none'} → ${l[f] || 'none'}`).join(', ');
  const out: RosChange[] = [];
  for (const l of lines) {
    const line = { day: l.day, at: l.at, cue: l.cue, sourceKey: l.sourceKey };
    const same = before.get(l.sourceKey);
    if (same) {
      if (note(same, l)) out.push({ kind: 'edited', ...line, note: note(same, l) });
      continue;
    }
    const i = gone.findIndex((g) => g.day === l.day && g.cue === l.cue);
    const from = i < 0 ? null : gone.splice(i, 1)[0]!;
    out.push(from ? { kind: 'moved', ...line, was: from.at, ...(note(from, l) && { note: note(from, l) }) } : { kind: 'added', ...line });
  }
  return [...out, ...gone.map((g) => ({ kind: 'removed' as const, day: g.day, at: g.at, cue: g.cue }))];
}

/** Replaces the imported rows and logs what changed. The first import, and one that changes nothing, log nothing. */
export async function replaceImported(tx: Prisma.TransactionClient, ctx: OrgCtx, eventId: string, lines: RosLine[]) {
  // Two syncs of one event take turns: side by side, both would delete the old rows and both insert the new ones.
  await tx.$queryRaw`SELECT 1 FROM "Event" WHERE "id" = ${eventId}::uuid AND "orgId" = ${ctx.orgId}::uuid FOR UPDATE`;
  const old = await tx.runOfShowRow.findMany({ where: { ...inOrg(ctx), eventId, manual: false }, orderBy: { sortOrder: 'asc' } });
  const changes = old.length ? diffRos(old, lines) : [];
  await tx.runOfShowRow.deleteMany({ where: { ...inOrg(ctx), eventId, manual: false } });
  await tx.runOfShowRow.createMany({ data: lines.map((l) => ({ ...inOrg(ctx), eventId, manual: false, ...l })) });
  if (changes.length) await tx.rosSync.create({ data: { ...inOrg(ctx), eventId, at: now(), changes } });
  return changes.length;
}
