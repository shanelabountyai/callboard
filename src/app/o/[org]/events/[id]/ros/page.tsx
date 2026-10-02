import Link from 'next/link';
import { notFound } from 'next/navigation';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { now } from '@/core/clock';
import { COLUMNS_ERROR, type RosChange } from '@/lib/ros';
import { fmtHm, fmtWhen } from '@/lib/time';
import { addRosRow, deleteRosRow, pullRos, syncRos } from './actions';
import { AutoSync } from './auto-sync';

export const metadata = { title: 'Run of show' };

const ERRORS: Record<string, string> = {
  nofile: 'Choose a file first.',
  toolarge: 'That file is over 5 MB.',
  unreadable: 'That file could not be read. Export it as .xlsx or .csv and try again.',
  columns: COLUMNS_ERROR,
};

// The run of show stays in Excel or Smartsheet; this is the mirror, plus lines added by hand (PRD 1).
export default async function RunOfShow({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<{ imported?: string; error?: string }> }) {
  const ctx = await requireOrg((await params).org);
  const { id } = await params;
  const q = await searchParams;
  const event = await db.event.findFirst({ where: { id, ...inOrg(ctx) }, select: { id: true, name: true, timezone: true, rosUrl: true, rosSyncedAt: true, rosTriedAt: true } });
  if (!event) notFound();
  const rows = await db.runOfShowRow.findMany({ where: { ...inOrg(ctx), eventId: id }, orderBy: [{ at: 'asc' }, { sortOrder: 'asc' }] });
  // Days in the sheet's order; a one-day sheet has none and shows no headings. Lines with no day come first.
  const days = [...new Set([...rows].sort((a, b) => Number(a.manual) - Number(b.manual) || a.sortOrder - b.sortOrder).map((r) => r.day).filter(Boolean))];
  const groups = ['', ...days].map((day) => ({ day, rows: rows.filter((r) => r.day === day) })).filter((g) => g.rows.length);
  // The change log, newest first. A line changed in the last hour is marked where it sits in the table.
  const log = (await db.rosSync.findMany({ where: { ...inOrg(ctx), eventId: id }, orderBy: { at: 'desc' }, take: 20 })).map((s) => ({ ...s, changes: s.changes as RosChange[] }));
  const told = (c: RosChange) => `${c.kind === 'moved' ? `moved from ${fmtHm(c.was ?? '') || 'no time'}` : c.kind}${c.note ? `: ${c.note}` : ''}`;
  const marks = new Map(log.filter((s) => s.at.getTime() > now().getTime() - 3_600_000).reverse().flatMap((s) => s.changes.map((c) => [c.sourceKey, told(c)] as const)));
  const failed = event.rosUrl && event.rosTriedAt && (!event.rosSyncedAt || event.rosTriedAt > event.rosSyncedAt);
  const bind = <A extends unknown[], R>(fn: (slug: string, ...a: A) => R) => fn.bind(null, ctx.slug);
  const base = `/o/${ctx.slug}/events/${event.id}`;

  return (
    <main>
      <p className="crumbs"><Link href={base}>{event.name}</Link> <span>Run of show</span></p>
      <h1>Run of show: {event.name}</h1>
      {q.imported && <p role="status">Imported {q.imported} rows. Hand-added lines were kept.</p>}
      {q.error && <p role="alert">{ERRORS[q.error] ?? 'Import failed.'}</p>}
      <p>{rows.filter((r) => !r.manual).length} imported, {rows.filter((r) => r.manual).length} added by hand.</p>
      <table>
        <thead><tr><th>Time</th><th>Cue</th><th>Area</th><th>Owner</th><th>Source</th><th></th></tr></thead>
        {groups.map((g) => (
        <tbody key={g.day}>
          {days.length > 0 && <tr><th colSpan={6} scope="rowgroup">{g.day || 'Any day'}</th></tr>}
          {g.rows.map((r) => (
            <tr key={r.id}>
              <td>{fmtHm(r.at)}</td><td>{r.cue}{!r.manual && marks.has(r.sourceKey) && <> <mark>{marks.get(r.sourceKey)}</mark></>}</td><td>{r.area}</td><td>{r.owner}</td><td>{r.manual ? 'manual' : 'import'}</td>
              <td>
                {r.manual && (
                  <ActionForm action={bind(deleteRosRow)}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" aria-label={`Delete ${r.cue}`}>Delete</button>
                  </ActionForm>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        ))}
      </table>

      <h2>Add a line</h2>
      <ActionForm action={bind(addRosRow)}>
        <input type="hidden" name="eventId" value={event.id} />
        {days.length > 0 && <label>Day <select name="day">{days.map((d) => <option key={d}>{d}</option>)}</select></label>}
        <label>Time <input name="at" type="time" /></label>
        <label>Cue <input name="cue" required maxLength={200} placeholder="Doors open" /></label>
        <label>Area <input name="area" maxLength={80} /></label>
        <label>Owner <input name="owner" maxLength={80} /></label>
        <button type="submit">Add line</button>
      </ActionForm>

      <h2>Live sheet</h2>
      <p>Paste the link to the run of show in Smartsheet, or to an Excel workbook on OneDrive or SharePoint shared with &quot;Anyone with the link can view&quot;. Sync pulls the sheet as it is now, and this page pulls it again about once a minute while it is open: each pull replaces the imported rows and keeps the ones added by hand. Clear the link and sync to disconnect.</p>
      {event.rosSyncedAt && <p>Last synced {fmtWhen(event.rosSyncedAt, event.timezone)}. {event.rosUrl && <AutoSync pull={pullRos.bind(null, ctx.slug, { eventId: event.id })} />}</p>}
      {failed && <p role="alert">The sheet could not be read at {fmtWhen(event.rosTriedAt!, event.timezone)}. The lines above are the last good copy. Press Sync now to see why.</p>}
      <ActionForm action={bind(syncRos)}>
        <input type="hidden" name="eventId" value={event.id} />
        <label>Sheet link <input name="url" type="url" maxLength={500} defaultValue={event.rosUrl} placeholder="https://app.smartsheet.com/sheets/..." /></label>
        <button type="submit">{event.rosUrl ? 'Sync now' : 'Link and sync'}</button>
      </ActionForm>

      <h2>What changed</h2>
      {log.length === 0 && <p>Nothing yet. Each sync or import that changes a line is listed here, newest first.</p>}
      {log.map((s) => (
        <section key={s.id}>
          <h3>{fmtWhen(s.at, event.timezone)}</h3>
          <ul>{s.changes.map((c, i) => <li key={i}>{[c.day, fmtHm(c.at), c.cue].filter(Boolean).join(', ')}: {told(c)}</li>)}</ul>
        </section>
      ))}

      <h2>Import a file</h2>
      <p>Upload the sheet as .xlsx, or a .csv export from Smartsheet. The header row needs a time and a cue column; area and owner are optional. Re-importing replaces the imported rows and keeps the ones added by hand.</p>
      <form method="post" action={`${base}/ros/upload`} encType="multipart/form-data">
        <label>File <input type="file" name="file" accept=".xlsx,.csv" required /></label>
        <button type="submit">Import</button>
      </form>
    </main>
  );
}
