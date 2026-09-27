import Link from 'next/link';
import { notFound } from 'next/navigation';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { AOR_COLORS, aor as stripe } from '@/lib/colors';
import { fmtDay, fmtTime } from '@/lib/time';
import { addAor, addArea, addPosition, addShift, deleteAor, deleteArea, deletePosition, deleteShift, setAorLead, setAreaAor, setEventDefaults, setStatus } from './actions';

export const metadata = { title: 'Event' };

const STATUSES = ['draft', 'staffing', 'confirmed', 'live', 'closed'] as const;

// The plan (PRD 1) and its org chart (PRD 2) on one page: headcount by area, then the tree.
export default async function EventPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  const ctx = await requireOrg(org);
  const event = await db.event.findFirst({
    where: { id, ...inOrg(ctx) },
    include: {
      days: { orderBy: { date: 'asc' } },
      aors: { include: { lead: true, deputy: true }, orderBy: { name: 'asc' } },
      areas: {
        orderBy: { name: 'asc' },
        include: { positions: { orderBy: { name: 'asc' }, include: { shifts: { orderBy: { startAt: 'asc' }, include: { day: true, assignments: { select: { status: true } } } } } } },
      },
    },
  });
  if (!event) notFound();
  const people = await db.person.findMany({ where: inOrg(ctx), orderBy: { name: 'asc' }, select: { id: true, name: true } });
  const bind = <A extends unknown[], R>(fn: (slug: string, ...a: A) => R) => fn.bind(null, ctx.slug);
  const tz = event.timezone;
  const base = `/o/${ctx.slug}/events/${event.id}`;
  const count = (shifts: { needed: number; assignments: { status: string }[] }[]) => ({
    needed: shifts.reduce((n, s) => n + s.needed, 0),
    confirmed: shifts.reduce((n, s) => n + s.assignments.filter((a) => a.status === 'confirmed').length, 0),
    invited: shifts.reduce((n, s) => n + s.assignments.filter((a) => a.status === 'invited').length, 0),
  });
  const tone = (c: { needed: number; confirmed: number }) => (c.needed === 0 ? undefined : c.confirmed >= c.needed ? 'green' : c.confirmed >= 0.8 * c.needed ? 'amber' : 'red');
  const total = count(event.areas.flatMap((a) => a.positions.flatMap((p) => p.shifts)));

  return (
    <main>
      <p className="crumbs"><Link href={`/o/${ctx.slug}/events`}>Events</Link> <Link href={`${base}/staff`}>Staff this event</Link> <Link href={`${base}/board`}>Coverage board</Link> <Link href={`${base}/messages`}>Messages</Link> <Link href={`${base}/roster`}>Print roster</Link> <Link href={`${base}/ros`}>Run of show</Link></p>
      <h1>{event.name}</h1>
      <p>
        {event.venue && `${event.venue} · `}{event.days.map((d) => fmtDay(d.date, 'UTC')).join(', ')} · {tz}
      </p>
      <ActionForm action={bind(setStatus)}>
        <input type="hidden" name="id" value={event.id} />
        <label>Status <select name="status" defaultValue={event.status}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <button type="submit">Set status</button>
      </ActionForm>
      <ActionForm action={bind(setEventDefaults)}>
        <input type="hidden" name="id" value={event.id} />
        <label>Default call offset (min before start) <input name="callOffsetMin" type="number" min={0} defaultValue={event.callOffsetMin} /></label>
        <label>No-show grace (min after call) <input name="graceMin" type="number" min={0} defaultValue={event.graceMin} /></label>
        <label>Emergency contact (venue security / medical) <input name="emergencyContact" maxLength={200} defaultValue={event.emergencyContact} placeholder="Venue security 555-0100, radio 1" /></label>
        <button type="submit">Save defaults</button>
      </ActionForm>

      <h2>Headcount</h2>
      <p data-tone={tone(total)}>Whole event: {total.confirmed} confirmed of {total.needed} needed ({total.invited} still invited).</p>
      <table>
        <thead><tr><th>Area</th><th>AoR</th><th>Needed</th><th>Confirmed</th><th>Invited</th><th>Gap</th></tr></thead>
        <tbody>
          {event.areas.map((a) => {
            const c = count(a.positions.flatMap((p) => p.shifts));
            return (
              <tr key={a.id}>
                <td>{a.name}</td><td>{event.aors.find((x) => x.id === a.aorId)?.name ?? 'Ungrouped (planner)'}</td>
                <td>{c.needed}</td><td className="cov" data-tone={tone(c)}>{c.confirmed}</td><td>{c.invited}</td><td>{Math.max(0, c.needed - c.confirmed)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>Areas of responsibility</h2>
      {event.aors.length === 0 && <p>None yet. Group areas under a lead so they can run their slice without asking.</p>}
      {event.aors.map((aor) => (
        <section key={aor.id} className="stripe" style={stripe(aor.color)}>
          <h3>{aor.name}{aor.radioChannel && <small> · radio {aor.radioChannel}</small>}</h3>
          <p>Areas: {event.areas.filter((a) => a.aorId === aor.id).map((a) => a.name).join(', ') || 'none yet'}</p>
          <ActionForm action={bind(setAorLead)}>
            <input type="hidden" name="id" value={aor.id} />
            <label>Lead <select name="leadId" defaultValue={aor.leadId ?? ''}><option value="">Nobody yet</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Deputy <select name="deputyId" defaultValue={aor.deputyId ?? ''}><option value="">Nobody yet</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <button type="submit">Save</button>
          </ActionForm>
          <ActionForm action={bind(deleteAor)}>
            <input type="hidden" name="id" value={aor.id} />
            <button type="submit">Delete AoR</button>
          </ActionForm>
        </section>
      ))}
      <details>
        <summary>Add an area of responsibility</summary>
        <ActionForm action={bind(addAor)}>
          <input type="hidden" name="eventId" value={event.id} />
          <label>Name <input name="name" required maxLength={80} placeholder="Front of house" /></label>
          <fieldset>
            <legend>Colour</legend>
            <div className="swatches">
              {AOR_COLORS.map(([name, hex], i) => <label key={hex} title={name}><input type="radio" name="color" value={hex} defaultChecked={i === event.aors.length % AOR_COLORS.length} aria-label={name} /><span style={stripe(hex)} /></label>)}
            </div>
          </fieldset>
          <label>Radio channel <input name="radioChannel" maxLength={20} /></label>
          <button type="submit">Add</button>
        </ActionForm>
      </details>

      <h2>Areas, positions and shifts</h2>
      {event.areas.map((area) => (
        <section key={area.id}>
          <h3>{area.name}{area.location && <small> · {area.location}</small>}</h3>
          <ActionForm action={bind(setAreaAor)}>
            <input type="hidden" name="id" value={area.id} />
            <label>Belongs to <select name="aorId" defaultValue={area.aorId ?? ''}><option value="">Ungrouped (planner)</option>{event.aors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <button type="submit">Move</button>
          </ActionForm>
          {area.positions.map((pos) => (
            <div key={pos.id} className="card">
              <h4>{pos.name} <small>min {pos.minHeadcount}, target {pos.targetHeadcount}{pos.uniform && ` · wear ${pos.uniform}`}{pos.graceMin !== null && ` · grace ${pos.graceMin} min`}{pos.isFloat && ' · float pool'}</small></h4>
              {pos.brief && <p>{pos.brief}</p>}
              <ul className="plain">
                {pos.shifts.map((s) => {
                  const c = count([s]);
                  return (
                    <li key={s.id} className="row">
                      <span className="grow">{fmtDay(s.day.date, 'UTC')}: call {fmtTime(s.callAt, tz)}, {fmtTime(s.startAt, tz)} to {fmtTime(s.endAt, tz)} · <strong data-tone={tone(c)}>{c.confirmed}/{s.needed} confirmed</strong>, {c.invited} invited · overbook {s.overbookPct}%</span>
                      <ActionForm action={bind(deleteShift)}>
                        <input type="hidden" name="id" value={s.id} />
                        <button type="submit" aria-label={`Delete shift ${fmtDay(s.day.date, 'UTC')} ${pos.name}`}>Delete</button>
                      </ActionForm>
                    </li>
                  );
                })}
              </ul>
              <details>
                <summary>Add shift for {pos.name}</summary>
                <ActionForm action={bind(addShift)}>
                  <input type="hidden" name="positionId" value={pos.id} />
                  <label>Day <select name="dayId" defaultValue="all"><option value="all">Every day</option>{event.days.map((d) => <option key={d.id} value={d.id}>{fmtDay(d.date, 'UTC')}</option>)}</select></label>
                  <label>Start <input name="start" type="time" required defaultValue="08:00" /></label>
                  <label>End <input name="end" type="time" required defaultValue="12:00" /></label>
                  <label>Needed <input name="needed" type="number" min={1} defaultValue={pos.targetHeadcount} /></label>
                  <label>Call offset (min) <input name="callOffsetMin" type="number" min={0} defaultValue={event.callOffsetMin} /></label>
                  <label>Overbook % <input name="overbookPct" type="number" min={0} defaultValue={20} /></label>
                  <button type="submit">Add shift</button>
                </ActionForm>
              </details>
              <ActionForm action={bind(deletePosition)}>
                <input type="hidden" name="id" value={pos.id} />
                <button type="submit">Delete position</button>
              </ActionForm>
            </div>
          ))}
          <details>
            <summary>Add position in {area.name}</summary>
            <ActionForm action={bind(addPosition)}>
              <input type="hidden" name="areaId" value={area.id} />
              <label>Name <input name="name" required maxLength={80} placeholder="Greeter" /></label>
              <label>Minimum <input name="minHeadcount" type="number" min={0} defaultValue={1} /></label>
              <label>Target <input name="targetHeadcount" type="number" min={1} defaultValue={2} /></label>
              <label>What to wear <input name="uniform" maxLength={200} /></label>
              <label>Brief (the position card) <textarea name="brief" rows={4} cols={60} maxLength={4000} /></label>
              <label>No-show grace (min; blank = event default {event.graceMin}) <input name="graceMin" type="number" min={0} /></label>
              <label><input type="checkbox" name="isFloat" /> Float pool (people here can be deployed to a short cell on the day)</label>
              <button type="submit">Add position</button>
            </ActionForm>
          </details>
          <ActionForm action={bind(deleteArea)}>
            <input type="hidden" name="id" value={area.id} />
            <button type="submit">Delete area</button>
          </ActionForm>
        </section>
      ))}
      <details>
        <summary>Add an area</summary>
        <ActionForm action={bind(addArea)}>
          <input type="hidden" name="eventId" value={event.id} />
          <label>Name <input name="name" required maxLength={80} placeholder="Registration" /></label>
          <label>Location <input name="location" maxLength={200} placeholder="North Lobby" /></label>
          <label>AoR <select name="aorId" defaultValue=""><option value="">Ungrouped (planner)</option>{event.aors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <button type="submit">Add area</button>
        </ActionForm>
      </details>
    </main>
  );
}
