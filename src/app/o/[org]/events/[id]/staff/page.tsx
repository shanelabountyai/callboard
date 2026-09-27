import Link from 'next/link';
import { notFound } from 'next/navigation';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { aor as stripe } from '@/lib/colors';
import { shownTier, tiersFor } from '@/lib/review';
import { TierPill } from '@/lib/review-fields';
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
  const tiers = await tiersFor(ctx.orgId);
  // Most reliable first, so the 7am openers get filled from the top of the list (PRD 3).
  const people = (await db.person.findMany({ where: inOrg(ctx), orderBy: { name: 'asc' } })).map((p) => ({ ...p, tier: shownTier(p, tiers) })).sort((a, b) => a.tier.tier - b.tier.tier);
  const bind = <A extends unknown[], R>(fn: (slug: string, ...a: A) => R) => fn.bind(null, ctx.slug);
  const tz = event.timezone;
  const all = event.days.flatMap((d) => d.shifts.flatMap((s) => s.assignments));
  const n = (st: string) => all.filter((a) => a.status === st).length;

  return (
    <main>
      <p className="crumbs"><Link href={`/o/${ctx.slug}/events/${event.id}`}>{event.name}</Link> <span>Staff</span></p>
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
            const tone = confirmed >= s.needed ? 'green' : confirmed >= 0.8 * s.needed ? 'amber' : 'red';
            return (
              <article key={s.id} className="stripe" style={stripe(s.position.area.aor?.color)}>
                <h3>
                  {s.position.name} · {s.position.area.name}{s.position.area.aor && ` (${s.position.area.aor.name}, lead ${s.position.area.aor.lead?.name ?? 'unset'})`}
                </h3>
                <p data-tone={tone}>
                  Call {fmtTime(s.callAt, tz)}, {fmtTime(s.startAt, tz)} to {fmtTime(s.endAt, tz)} · {confirmed} confirmed of {s.needed} needed · {open.length} of {inviteCap(s)} invite slots used
                </p>
                <ul className="plain">
                  {s.assignments.map((a) => (
                    <li key={a.id} className="row">
                      <span className="grow">{a.person.name} ({a.person.kind}{a.person.department && `, ${a.person.department}`}) · <span className="pill" data-status={a.status}>{a.status}</span></span>
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
                    <div className="columns">
                      {people.filter((p) => !onShift.has(p.id)).map((p) => (
                        <label key={p.id}>
                          <input type="checkbox" name={`p:${p.id}`} /> {p.name} <TierPill t={p.tier} /> <small>({p.kind}{p.department && `, ${p.department}`})</small>
                        </label>
                      ))}
                    </div>
                    <button type="submit" className="primary">Send invites</button>
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
