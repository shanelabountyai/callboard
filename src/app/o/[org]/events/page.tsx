import Link from 'next/link';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { deviations, standardOf } from '@/lib/rules';
import { fmtDay } from '@/lib/time';
import { createEvent, duplicateEvent } from './actions';

export const metadata = { title: 'Events' };

export default async function Events({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const events = await db.event.findMany({
    where: { ...inOrg(ctx), isTemplate: false },
    orderBy: { createdAt: 'desc' },
    include: { days: { orderBy: { date: 'asc' } }, _count: { select: { shifts: true, assignments: true } } },
  });
  const bind = <A extends unknown[], R>(fn: (slug: string, ...a: A) => R) => fn.bind(null, ctx.slug);
  const base = `/o/${ctx.slug}/events`;
  const standard = await standardOf(ctx.orgId, db);

  return (
    <main>
      <h1>Events</h1>
      {events.length === 0 && <p>No events yet. Create one below.</p>}
      {events.map((e) => (
        <section key={e.id}>
          <h2><Link href={`${base}/${e.id}`}>{e.name}</Link> <small>{e.status}</small></h2>
          <p>
            {e.days.length ? `${fmtDay(e.days[0]!.date, 'UTC')}${e.days.length > 1 ? ` to ${fmtDay(e.days.at(-1)!.date, 'UTC')}` : ''}` : 'No days'}
            {e.venue && ` · ${e.venue}`} · {e._count.shifts} shifts · {e._count.assignments} assignments
            {deviations(e, standard).length > 0 && <> · <strong className="badge" data-tone="amber">Deviates from standard: {deviations(e, standard).map((r) => r.label).join(', ')}</strong></>}
          </p>
          <details>
            <summary>Start a new event from this one</summary>
            <ActionForm action={bind(duplicateEvent)}>
              <input type="hidden" name="id" value={e.id} />
              <label>New name <input name="name" required maxLength={120} defaultValue={`${e.name} (copy)`} /></label>
              <label>First day <input name="startsOn" type="date" required /></label>
              <button type="submit">Duplicate</button>
            </ActionForm>
          </details>
        </section>
      ))}

      <h2>New event</h2>
      <p>Blank, below, or <Link href={`/o/${ctx.slug}/templates`}>start from a template</Link>.</p>
      <ActionForm action={bind(createEvent)}>
        <label>Name <input name="name" required maxLength={120} /></label>
        <label>Venue <input name="venue" maxLength={200} /></label>
        <label>Timezone <input name="timezone" defaultValue="America/Chicago" required /></label>
        <label>First day <input name="startsOn" type="date" required /></label>
        <label>Last day <input name="endsOn" type="date" required /></label>
        <button type="submit">Create event</button>
      </ActionForm>
    </main>
  );
}
