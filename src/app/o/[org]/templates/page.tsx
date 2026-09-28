import Link from 'next/link';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { duplicateEvent } from '../events/actions';

export const metadata = { title: 'Event templates' };

// The library (PRD 6): saved event structures. A template is edited in the event editor and copied, never
// linked, into each event started from it.
export default async function Templates({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const templates = await db.event.findMany({
    where: { ...inOrg(ctx), isTemplate: true },
    orderBy: { name: 'asc' },
    include: { _count: { select: { days: true, aors: true, areas: true, positions: true, shifts: true, startedFrom: true } } },
  });

  return (
    <main>
      <h1>Event templates</h1>
      {templates.length === 0 && <p>No templates yet. Open an event and save it as a template: its areas of responsibility, areas, positions, shifts, cards, playbooks and rules are kept, its people are not.</p>}
      {templates.map((t) => (
        <section key={t.id} className="card">
          <h2>{t.name} <small>{t.attendanceBand}</small></h2>
          <p>
            {t._count.days} {t._count.days === 1 ? 'day' : 'days'} · {t._count.aors} areas of responsibility · {t._count.areas} areas · {t._count.positions} positions · {t._count.shifts} shifts · used for {t._count.startedFrom} {t._count.startedFrom === 1 ? 'event' : 'events'}
          </p>
          <p><Link href={`/o/${ctx.slug}/events/${t.id}`}>Edit the template</Link></p>
          <ActionForm action={duplicateEvent.bind(null, ctx.slug)}>
            <input type="hidden" name="id" value={t.id} />
            <label>New event&rsquo;s name <input name="name" required maxLength={120} /></label>
            <label>First day <input name="startsOn" type="date" required /></label>
            <button type="submit">Start an event from {t.name}</button>
          </ActionForm>
        </section>
      ))}
    </main>
  );
}
