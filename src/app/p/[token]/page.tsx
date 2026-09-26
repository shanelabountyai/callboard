import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { db } from '@/core/db';
import { clientIp } from '@/core/http';
import { readPersonLink } from '@/lib/links';
import { assignmentInclude, firstName } from '@/lib/staffing';
import { fmtDay, fmtTime, fmtWhen } from '@/lib/time';

// The person's page (PRD 3): no login, reached from the link in their text. What they need and
// nothing else: where, when, what to wear, who to ask, what the job is, and one tap to answer.
// A lead also sees their AoR's roster here. Internal notes never render.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your shifts', robots: { index: false, follow: false } };

export default async function PersonPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const link = await readPersonLink(token, clientIp(await headers()));
  if (link === 'limited') return <main><h1>Too many requests</h1><p>Wait a few minutes and try again.</p></main>;
  if (!link) notFound();
  const { person, event, orgId } = link;
  const tz = event.timezone;
  const scope = { orgId, eventId: event.id };
  const [assignments, leads] = await Promise.all([
    db.assignment.findMany({ where: { ...scope, personId: person.id, status: { not: 'released' } }, include: assignmentInclude, orderBy: { shift: { startAt: 'asc' } } }),
    db.aor.findMany({
      where: { ...scope, OR: [{ leadId: person.id }, { deputyId: person.id }] },
      include: { lead: true, deputy: true, areas: { include: { positions: { include: { shifts: { orderBy: { startAt: 'asc' }, include: { day: true, assignments: { include: { person: true } } } } } } } } },
    }),
  ]);
  const respond = `/p/${token}/respond`;

  return (
    <main>
      <h1>{event.name}</h1>
      <p>Hi {firstName(person.name)}.{event.venue && ` ${event.venue}.`}</p>
      {done === 'confirm' && <p role="status">Thanks, you are confirmed. See you there.</p>}
      {done === 'decline' && <p role="status">Noted. Your lead has been told, and the shift is open for someone else.</p>}
      {assignments.length === 0 && leads.length === 0 && <p>You have no shifts on this event right now.</p>}

      {assignments.map((a) => {
        const area = a.shift.position.area;
        const lead = area.aor?.lead;
        return (
          <article key={a.id} style={{ border: '1px solid #ccc', padding: 12, marginBottom: 12 }}>
            <h2>{a.shift.position.name} · {area.name}</h2>
            <p><strong>{fmtWhen(a.shift.startAt, tz)}</strong> to {fmtTime(a.shift.endAt, tz)}. <strong>Be there by {fmtTime(a.shift.callAt, tz)}.</strong></p>
            {area.location && <p>Where: {area.location}</p>}
            {a.shift.position.uniform && <p>Wear: {a.shift.position.uniform}</p>}
            <p>Your lead: {lead ? `${lead.name}, ${lead.mobile}` : 'the event planner'}{area.aor?.radioChannel && ` · radio ${area.aor.radioChannel}`}</p>
            {a.shift.position.brief && <p style={{ whiteSpace: 'pre-wrap' }}>{a.shift.position.brief}</p>}
            <p>Status: <strong>{a.status}</strong></p>
            <form method="post" action={respond} style={{ display: 'flex', gap: 8 }}>
              <input type="hidden" name="assignment" value={a.id} />
              <button type="submit" name="answer" value="confirm" disabled={a.status === 'confirmed'} style={{ fontSize: 18, padding: '12px 24px' }}>Confirm</button>
              <button type="submit" name="answer" value="decline" disabled={a.status === 'declined'} style={{ fontSize: 18, padding: '12px 24px' }}>Decline</button>
            </form>
          </article>
        );
      })}

      {leads.map((aor) => (
        <section key={aor.id}>
          <h2>You {aor.leadId === person.id ? 'lead' : 'are deputy for'} {aor.name}</h2>
          <p>
            {aor.leadId === person.id ? `Deputy: ${aor.deputy?.name ?? 'none'}` : `Lead: ${aor.lead?.name ?? 'none'}`}
            {aor.radioChannel && ` · radio ${aor.radioChannel}`}
          </p>
          {aor.areas.map((area) => (
            <div key={area.id}>
              <h3>{area.name}{area.location && ` · ${area.location}`}</h3>
              {area.positions.flatMap((pos) => pos.shifts.map((s) => {
                const open = s.assignments.filter((x) => x.status !== 'released' && x.status !== 'declined');
                return (
                  <details key={s.id} open>
                    <summary>{pos.name}: {fmtDay(s.day.date, 'UTC')}, call {fmtTime(s.callAt, tz)} · {open.filter((x) => x.status === 'confirmed').length} confirmed of {s.needed}</summary>
                    <ul>
                      {open.map((x) => <li key={x.id}>{x.person.name} · {x.person.mobile} · {x.status}</li>)}
                      {open.length === 0 && <li>Nobody invited yet.</li>}
                    </ul>
                  </details>
                );
              }))}
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
