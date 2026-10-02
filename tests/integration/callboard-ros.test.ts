import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceClock } from '@/core/clock';
import { db } from '@/core/db';
import { pullRos } from '@/app/o/[org]/events/[id]/ros/actions';
import { diffRos, rosLines } from '@/lib/ros';
import { resetAuthTables } from '../helpers/auth';
import { actAs } from '../helpers/org';
import { stage } from '../helpers/stage';
import { writeXlsx } from '../helpers/xlsx';

beforeEach(async () => { advanceClock(0); await resetAuthTables(); });
afterEach(() => vi.unstubAllGlobals());
const MIN = 60_000;
const HEAD = ['Day', 'Time', 'Cue', 'Area', 'Owner'];

describe('what a sync changed', () => {
  const lines = (...rows: string[][]) => rosLines([HEAD, ...rows])!;
  it('tells added, removed, moved and edited apart', () => {
    const old = lines(['Day 1', '08:00', 'Doors', 'Lobby', 'Marcus'], ['Day 1', '09:15', 'Keynote', 'Hall A', 'Priya'], ['Day 1', '12:00', 'Lunch', '', ''], ['Day 2', '09:15', 'Keynote', 'Hall A', '']);
    const next = lines(['Day 1', '08:00', 'Doors', 'Lobby', 'Sofia'], ['Day 1', '09:30', 'Keynote', 'Hall A', 'Priya'], ['Day 1', '17:00', 'Load out', '', ''], ['Day 2', '09:15', 'Keynote', 'Hall A', '']);
    expect(diffRos(old, next)).toEqual([
      { kind: 'edited', day: 'Day 1', at: '08:00', cue: 'Doors', sourceKey: 'Day 1|08:00|Doors', note: 'owner Marcus → Sofia' },
      { kind: 'moved', day: 'Day 1', at: '09:30', cue: 'Keynote', sourceKey: 'Day 1|09:30|Keynote', was: '09:15' }, // day 2's keynote did not move
      { kind: 'added', day: 'Day 1', at: '17:00', cue: 'Load out', sourceKey: 'Day 1|17:00|Load out' },
      { kind: 'removed', day: 'Day 1', at: '12:00', cue: 'Lunch' },
    ]);
    expect(diffRos(old, old)).toEqual([]);
  });
  it('counts a repeated cue at one time, and reads a new time with new words as removed and added', () => {
    const twice = lines(['', '09:00', 'Radio check', '', ''], ['', '09:00', 'Radio check', '', '']);
    expect(diffRos(twice, twice)).toEqual([]);
    expect(diffRos(twice, twice.slice(0, 1))).toEqual([{ kind: 'removed', day: '', at: '09:00', cue: 'Radio check' }]);
    expect(diffRos(twice.slice(0, 1), lines(['', '09:10', 'Radio checks', '', ''])).map((c) => c.kind)).toEqual(['added', 'removed']);
  });
});

describe('the page pulls the live sheet', () => {
  it('logs only what changed, lets one pull through per 50 s, and keeps the rows when a pull fails', async () => {
    const s = await stage('staffing');
    await actAs(s.dana.id, 'acme');
    await db.event.update({ where: { id: s.event.id }, data: { rosUrl: 'https://acme.sharepoint.com/:x:/g/personal/pat/EaBcD?e=k9' } });
    let sheet: string[][] | null = [HEAD, ['', '08:00', 'Doors', 'Lobby', 'Marcus'], ['', '09:15', 'Keynote', 'Hall A', 'Priya']];
    const fetched = vi.fn(async () => (sheet ? new Response(new Uint8Array(writeXlsx(sheet))) : new Response(null, { status: 403 })));
    vi.stubGlobal('fetch', fetched);
    const pull = () => pullRos('acme', { eventId: s.event.id });
    const state = async () => ({ ...(await db.event.findUniqueOrThrow({ where: { id: s.event.id }, select: { rosSyncedAt: true, rosTriedAt: true } })), rows: await db.runOfShowRow.count(), log: await db.rosSync.findMany({ orderBy: { at: 'asc' } }) });

    expect(await pull()).toEqual({ pulled: true });
    let now = await state();
    expect(now).toMatchObject({ rows: 2, log: [] }); // the first import is not a change
    expect(now.rosSyncedAt).toEqual(now.rosTriedAt);

    expect(await pull()).toEqual({ pulled: false }); // a second tab, the same minute
    expect(fetched).toHaveBeenCalledTimes(1);

    advanceClock(MIN);
    expect(await pull()).toEqual({ pulled: true }); // the same sheet
    expect((await state()).log).toHaveLength(0);

    advanceClock(2 * MIN);
    sheet = [HEAD, ['', '08:00', 'Doors', 'Lobby', 'Marcus'], ['', '09:30', 'Keynote', 'Hall A', 'Priya'], ['', '17:00', 'Load out', '', '']];
    expect(await pull()).toEqual({ pulled: true });
    now = await state();
    expect(now.rows).toBe(3);
    expect(now.log).toHaveLength(1);
    expect((now.log[0]!.changes as { kind: string; cue: string }[]).map((c) => [c.kind, c.cue])).toEqual([['moved', 'Keynote'], ['added', 'Load out']]);
    expect(await db.auditEvent.count({ where: { action: 'ros.synced' } })).toBe(1); // a pull that changed nothing is not audited

    advanceClock(3 * MIN);
    sheet = null; // the sheet is mid-save, or the link stopped being public
    expect(await pull()).toMatchObject({ error: expect.stringContaining('not open to everyone') });
    now = await state();
    expect(now).toMatchObject({ rows: 3 });
    expect(now.log).toHaveLength(1);
    expect(now.rosTriedAt!.getTime()).toBeGreaterThan(now.rosSyncedAt!.getTime()); // how the page knows to say so
  });
});
