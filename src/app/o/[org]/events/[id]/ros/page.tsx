import Link from 'next/link';
import { notFound } from 'next/navigation';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { addRosRow, deleteRosRow } from './actions';

export const metadata = { title: 'Run of show' };

const ERRORS: Record<string, string> = {
  nofile: 'Choose a file first.',
  toolarge: 'That file is over 5 MB.',
  unreadable: 'That file could not be read. Export it as .xlsx or .csv and try again.',
  columns: 'The header row needs a time column (Time, Start or When) and a cue column (Cue, Item, Description or What).',
};

// The run of show stays in Excel or Smartsheet; this is the mirror, plus lines added by hand (PRD 1).
export default async function RunOfShow({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<{ imported?: string; error?: string }> }) {
  const ctx = await requireOrg((await params).org);
  const { id } = await params;
  const q = await searchParams;
  const event = await db.event.findFirst({ where: { id, ...inOrg(ctx) }, select: { id: true, name: true } });
  if (!event) notFound();
  const rows = await db.runOfShowRow.findMany({ where: { ...inOrg(ctx), eventId: id }, orderBy: [{ at: 'asc' }, { sortOrder: 'asc' }] });
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
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.at}</td><td>{r.cue}</td><td>{r.area}</td><td>{r.owner}</td><td>{r.manual ? 'manual' : 'import'}</td>
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
      </table>

      <h2>Add a line</h2>
      <ActionForm action={bind(addRosRow)}>
        <input type="hidden" name="eventId" value={event.id} />
        <label>Time <input name="at" type="time" /></label>
        <label>Cue <input name="cue" required maxLength={200} placeholder="Doors open" /></label>
        <label>Area <input name="area" maxLength={80} /></label>
        <label>Owner <input name="owner" maxLength={80} /></label>
        <button type="submit">Add line</button>
      </ActionForm>

      <h2>Import from Excel or Smartsheet</h2>
      <p>Upload the sheet as .xlsx, or a .csv export from Smartsheet. The header row needs a time and a cue column; area and owner are optional. Re-importing replaces the imported rows and keeps the ones added by hand.</p>
      <form method="post" action={`${base}/ros/upload`} encType="multipart/form-data">
        <label>File <input type="file" name="file" accept=".xlsx,.csv" required /></label>
        <button type="submit">Import</button>
      </form>
    </main>
  );
}
