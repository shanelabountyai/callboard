import Link from 'next/link';
import { notFound } from 'next/navigation';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { inviteCap } from '@/lib/staffing';
import { fmtDay, fmtTime } from '@/lib/time';
import { invite, nudgeUnconfirmed, setAssignmentStatus } from './actions';

export const metadata = { title: 'Staff' };

const STATUSES = ['invited', 'confirmed', 'declined', 'released'] as const;

// Fill every shift from the directory and watch confirmations come in (PRD 3).
export default async function Staff({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  const ctx = await requireOrg(org);
  const event = await db.event.findFirst({
    where: { id, ...inOrg(ctx) },
    include: {
      days: { orderBy: { date: 'asc' }, include: { shifts: { orderBy: { startAt: 'asc' }, include: { position: { include: { area: { include: { aor: { include: { lead: true } } } } } }, assignments: { include: { person: true }, orderBy: { createdAt: 'asc' } } } } } },
    },
  });
  if (!event) notFound();
  const people = await db.person.findMany({ where: inOrg(ctx), orderBy: { name: 'asc' } });
  const bind = <A extends unknown[], R>(fn: (slug: string, ...a: A) => R) => fn.bind(null, ctx.slug);
  const tz = event.timezone;
  const all = event.days.flatMap((d) => d.shifts.flatMap((s) => s.assignments));
  const n = (st: string) => all.filter((a) => a.status === st).length;

  return (
    <main>
      <p><Link href={`/o/${ctx.slug}/events/${event.id}`}>{event.name}</Link> · Staff</p>
      <h1>Staff: {event.name}</h1>
      <p>{n('confirmed')} confirmed · {n('invited')} invited, waiting · {n('declined')} declined · {n('released')} released</p>
      <ActionForm action={bind(nudgeUnconfirmed)}>
        <input type="hidden" name="eventId" value={event.id} />
        <button type="submit">Nudge everyone still unconfirmed</button>
      </ActionForm>

      {event.days.map((day) => (
        <section key={day.id}>
          <h2>{fmtDay(day.date, 'UTC')}</h2>
          {day.shifts.length === 0 && <p>No shifts on this day yet.</p>}
          {day.shifts.map((s) => {
            const open = s.assignments.filter((a) => a.status === 'invited' || a.status === 'confirmed');
            const confirmed = open.filter((a) => a.status === 'confirmed').length;
            const onShift = new Set(open.map((a) => a.personId));
            const color = confirmed >= s.needed ? '#16a34a' : confirmed >= 0.8 * s.needed ? '#d97706' : '#dc2626';
            return (
              <article key={s.id} style={{ borderLeft: `6px solid ${s.position.area.aor?.color ?? '#999'}`, paddingLeft: 8, marginBottom: 16 }}>
                <h3>
                  {s.position.name} · {s.position.area.name}{s.position.area.aor && ` (${s.position.area.aor.name}, lead ${s.position.area.aor.lead?.name ?? 'unset'})`}
                </h3>
                <p style={{ color }}>
                  Call {fmtTime(s.callAt, tz)}, {fmtTime(s.startAt, tz)} to {fmtTime(s.endAt, tz)} · {confirmed} confirmed of {s.needed} needed · {open.length} of {inviteCap(s)} invite slots used
                </p>
                <ul>
                  {s.assignments.map((a) => (
                    <li key={a.id}>
                      {a.person.name} ({a.person.kind}{a.person.department && `, ${a.person.department}`}) · <strong>{a.status}</strong>
                      <ActionForm action={bind(setAssignmentStatus)}>
                        <input type="hidden" name="id" value={a.id} />
                        <select name="status" defaultValue={a.status} aria-label={`Status for ${a.person.name}`}>{STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}</select>
                        <button type="submit">Set</button>
                      </ActionForm>
                    </li>
                  ))}
                </ul>
                <details>
                  <summary>Invite people to this shift</summary>
                  <ActionForm action={bind(invite)}>
                    <input type="hidden" name="shiftId" value={s.id} />
                    <div style={{ columns: 3 }}>
                      {people.filter((p) => !onShift.has(p.id)).map((p) => (
                        <label key={p.id} style={{ display: 'block' }}>
                          <input type="checkbox" name={`p:${p.id}`} /> {p.name} <small>({p.kind}{p.department && `, ${p.department}`})</small>
                        </label>
                      ))}
                    </div>
                    <button type="submit">Send invites</button>
                  </ActionForm>
                </details>
              </article>
            );
          })}
        </section>
      ))}
    </main>
  );
}
