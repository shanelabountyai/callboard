import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import type { Playbook } from '@/generated/prisma/client';
import { PLAYBOOK_FIELDS, PlaybookView } from '@/lib/playbook-view';
import { fmtWhen } from '@/lib/time';
import { createPlaybook, savePlaybook } from './actions';

export const metadata = { title: 'Area playbooks' };

const LABELS: [keyof Playbook, string][] = [['title', 'title'], ['callOffsetMin', 'call time'], ...PLAYBOOK_FIELDS.map(([k, l]) => [k, l.toLowerCase()] as [keyof Playbook, string])];

function Fields({ pb }: { pb?: Playbook }) {
  return (
    <>
      <label>Area <input name="title" required maxLength={80} defaultValue={pb?.title} placeholder="Registration" /></label>
      <label>Call time, minutes before the shift (blank = the event&rsquo;s) <input name="callOffsetMin" type="number" min={0} max={480} defaultValue={pb?.callOffsetMin ?? ''} /></label>
      {PLAYBOOK_FIELDS.map(([k, label, example]) => (
        <label key={k}>{label} (one per line) <textarea name={k} rows={3} cols={60} defaultValue={pb ? String(pb[k]) : ''} placeholder={example} /></label>
      ))}
    </>
  );
}

// The library (PRD 6): how each area is run, written once. Who leads it and where it is come from each event.
export default async function Playbooks({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const all = await db.playbook.findMany({ where: inOrg(ctx), orderBy: [{ key: 'asc' }, { version: 'desc' }], include: { _count: { select: { areas: true } } } });
  const users = await db.user.findMany({ where: { id: { in: [...new Set(all.map((c) => c.changedBy))] } }, select: { id: true, name: true, email: true } });
  const who = (id: string) => { const u = users.find((x) => x.id === id); return u ? u.name || u.email : 'someone no longer here'; };
  const keys = [...new Set(all.map((c) => c.key))].map((k) => all.filter((c) => c.key === k)).sort((a, b) => a[0]!.title.localeCompare(b[0]!.title));
  const bind = <A extends unknown[], R>(fn: (slug: string, ...a: A) => R) => fn.bind(null, ctx.slug);

  return (
    <main>
      <h1>Area playbooks</h1>
      <p>{keys.length} in the library. A playbook says how an area is run: who it needs by the hour, breaks, floats, equipment, the setup and close checklists, and what has gone wrong before. Link one to an area on the event&rsquo;s page and its lead sees it on their roster.</p>
      {keys.map((versions) => {
        const pb = versions[0]!;
        return (
          <section key={pb.key} id={pb.key} className="card">
            <h2>{pb.title} <small>version {pb.version}</small></h2>
            <PlaybookView playbook={pb} />
            <details>
              <summary>Edit {pb.title}</summary>
              <p>Saving makes version {pb.version + 1}. Events still being planned pick it up; a live or closed event keeps the version it ran with.</p>
              <ActionForm action={bind(savePlaybook)}>
                <input type="hidden" name="id" value={pb.id} />
                <Fields pb={pb} />
                <button type="submit">Save as version {pb.version + 1}</button>
              </ActionForm>
            </details>
            <details>
              <summary>History ({versions.length})</summary>
              <ul className="plain">
                {versions.map((v, i) => {
                  const prev = versions[i + 1];
                  const changed = prev ? LABELS.filter(([k]) => v[k] !== prev[k]).map(([, l]) => l).join(', ') : 'created';
                  return <li key={v.id}>Version {v.version} · {who(v.changedBy)} · {fmtWhen(v.createdAt, 'UTC')} UTC · {changed} · on {v._count.areas} {v._count.areas === 1 ? 'area' : 'areas'}</li>;
                })}
              </ul>
            </details>
          </section>
        );
      })}
      <h2>Add a playbook</h2>
      <ActionForm action={bind(createPlaybook)}>
        <Fields />
        <button type="submit">Add playbook</button>
      </ActionForm>
    </main>
  );
}
