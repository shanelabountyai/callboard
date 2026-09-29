import Link from 'next/link';
import { notFound } from 'next/navigation';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { latestCards, latestPlaybooks } from '@/lib/cards';
import { aor as stripe } from '@/lib/colors';
import { PlaybookView } from '@/lib/playbook-view';
import { reviewLeads, workedAt } from '@/lib/review';
import { RuleFields } from '@/lib/rule-fields';
import { deviations, standardOf } from '@/lib/rules';
import { stageOf } from '@/lib/stages';
import { fmtDay, fmtTime } from '@/lib/time';
import { addShift, deleteArea, deletePosition, deleteShift, saveLocation, saveRole, saveShift, setEventDefaults, setStatus } from './actions';

export const metadata = { title: 'Event' };

type Query = Record<string, string | string[] | undefined>;

/** A delete sits behind edit mode and asks first. What cannot be deleted yet says why instead of failing. */
function Remove({ action, id, label, what, blocked }: { action: (form: FormData) => Promise<unknown>; id: string; label: string; what: string; blocked?: string | false }) {
  return (
    <details>
      <summary>{label}</summary>
      {blocked ? <p>{blocked}</p> : (
        <ActionForm action={action}>
          <input type="hidden" name="id" value={id} />
          <p>Delete {what}? This cannot be undone.</p>
          <button type="submit" aria-label={`Yes, delete ${what}`}>Yes, delete</button>
        </ActionForm>
      )}
    </details>
  );
}

// The plan on one page: headcount, one form that adds a shift, then location, role and shifts.
// Everything a first event can leave alone sits under "More options"; a shift's own options and every
// delete show in edit mode only.
export default async function EventPage({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<Query> }) {
  const ctx = await requireOrg((await params).org);
  const { id } = await params;
  const q = await searchParams;
  const one = (k: string) => (typeof q[k] === 'string' ? q[k] : '');
  const editing = one('edit') === '1';
  const event = await db.event.findFirst({
    where: { id, ...inOrg(ctx) },
    include: {
      days: { orderBy: { date: 'asc' } },
      aors: { include: { lead: true } },
      areas: {
        orderBy: { name: 'asc' },
        include: { playbook: true, positions: { orderBy: { name: 'asc' }, include: { card: true, shifts: { orderBy: { startAt: 'asc' }, include: { day: true, assignments: { select: { status: true } } } } } } },
      },
    },
  });
  if (!event) notFound();
  const people = await db.person.findMany({ where: inOrg(ctx), orderBy: { name: 'asc' }, select: { id: true, name: true } });
  const cards = await latestCards(ctx.orgId);
  const playbooks = await latestPlaybooks(ctx.orgId);
  const standard = await standardOf(ctx.orgId, db);
  const off = deviations(event, standard);
  const bind = <A extends unknown[], R>(fn: (slug: string, ...a: A) => R) => fn.bind(null, ctx.slug);
  const tz = event.timezone;
  // What closing will send, said before it is sent. Only the first close texts anyone.
  const scope = { orgId: ctx.orgId, eventId: event.id };
  const closable = !event.isTemplate && event.status !== 'draft' && event.status !== 'closed';
  const texts = closable && !event.closedAt ? { leads: (await reviewLeads(db, scope)).length, worked: (await workedAt(db, scope)).length } : null;
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const base = `/o/${ctx.slug}/events/${event.id}`;
  const count = (shifts: { needed: number; assignments: { status: string }[] }[]) => ({
    needed: shifts.reduce((n, s) => n + s.needed, 0),
    confirmed: shifts.reduce((n, s) => n + s.assignments.filter((a) => a.status === 'confirmed').length, 0),
    invited: shifts.reduce((n, s) => n + s.assignments.filter((a) => a.status === 'invited').length, 0),
  });
  const tone = (c: { needed: number; confirmed: number }) => (c.needed === 0 ? undefined : c.confirmed >= c.needed ? 'green' : c.confirmed >= 0.8 * c.needed ? 'amber' : 'red');
  const total = count(event.areas.flatMap((a) => a.positions.flatMap((p) => p.shifts)));
  const roles = [...new Set([...event.areas.flatMap((a) => a.positions.map((p) => p.name)), ...cards.map((c) => c.title)])].sort();
  const pick = (name: string, value: string | null | undefined, none: string) => (
    <select name={name} defaultValue={value ?? ''}><option value="">{none}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
  );

  return (
    <main>
      {event.isTemplate ? (
        <p className="crumbs"><Link href={`/o/${ctx.slug}/templates`}>Templates</Link> <span>{event.name}</span></p>
      ) : (
        <p className="crumbs"><Link href={`/o/${ctx.slug}/events`}>Events</Link> <Link href={`${base}/staff`}>Staff this event</Link> <Link href={`${base}/board`}>Coverage board</Link> <Link href={`${base}/messages`}>Messages</Link> <Link href={`${base}/roster`}>Print roster</Link> <Link href={`${base}/ros`}>Run of show</Link> <Link href={`${base}/review`}>Review</Link> <Link href={`${base}/report`}>Report</Link></p>
      )}
      <h1>{event.name}{event.isTemplate && <small> · template{event.attendanceBand && `, ${event.attendanceBand}`}</small>}</h1>
      {event.isTemplate && <p>This is a template: a structure to start events from. It is never staffed, and its days only fix the order and spacing of the shifts. Changing it touches no event already started from it.</p>}
      <p>
        {event.venue && `${event.venue} · `}{event.days.map((d) => fmtDay(d.date, 'UTC')).join(', ')} · {tz}
      </p>
      {!event.isTemplate && (
        <>
          <p>Stage: <strong>{stageOf(event)}</strong>{event.status === 'draft' && '. Reminders, no-show alerts and replies by text start once the event is open for staffing.'}{closable && '. It starts running by itself on its first day.'}</p>
          {closable ? (
            <details>
              <summary>Close event…</summary>
              <ActionForm action={bind(setStatus)}>
                <input type="hidden" name="id" value={event.id} />
                <input type="hidden" name="status" value="closed" />
                <p>
                  {!texts ? 'Nobody is texted again: the review links and thank-yous went out the first time it was closed.'
                    : texts.leads + texts.worked === 0 ? 'Nobody is texted: no location with shifts has a lead, and nobody checked in.'
                    : `This texts ${n(texts.leads, 'lead', 'leads')} a review link and ${n(texts.worked, 'person', 'people')} who checked in a thank-you. A text cannot be unsent.`}
                </p>
                <button type="submit">Yes, close the event</button>
              </ActionForm>
            </details>
          ) : (
            <ActionForm action={bind(setStatus)}>
              <input type="hidden" name="id" value={event.id} />
              <input type="hidden" name="status" value="staffing" />
              <button type="submit" className={event.status === 'draft' ? 'primary' : undefined}>{event.status === 'draft' ? 'Open for staffing' : 'Reopen event'}</button>
            </ActionForm>
          )}
        </>
      )}

      {event.areas.length > 0 && (
        <>
          <h2>Headcount</h2>
          <p data-tone={tone(total)}>Whole event: {total.confirmed} confirmed of {total.needed} needed ({total.invited} still invited).</p>
          <table>
            <thead><tr><th>Location</th><th>Needed</th><th>Confirmed</th><th>Gap</th></tr></thead>
            <tbody>
              {event.areas.map((a) => {
                const c = count(a.positions.flatMap((p) => p.shifts));
                return <tr key={a.id}><td>{a.name}</td><td>{c.needed}</td><td className="cov" data-tone={tone(c)}>{c.confirmed}</td><td>{Math.max(0, c.needed - c.confirmed)}</td></tr>;
              })}
            </tbody>
          </table>
        </>
      )}

      <h2 id="add-shift">Add a shift</h2>
      {people.length === 0 && <p>Nobody is in People yet. <Link href={`/o/${ctx.slug}/people`}>Add people</Link> before you invite anyone.</p>}
      <ActionForm key={`${one('location')}/${one('role')}`} action={bind(addShift)}>
        <input type="hidden" name="eventId" value={event.id} />
        <label>Location <input name="location" required maxLength={80} placeholder="Registration" list="locations" defaultValue={one('location')} /></label>
        <label>Role <input name="role" required maxLength={80} placeholder="Greeter" list="roles" defaultValue={one('role')} /></label>
        <label>Day <select name="dayId" defaultValue="all"><option value="all">Every day</option>{event.days.map((d) => <option key={d.id} value={d.id}>{fmtDay(d.date, 'UTC')}</option>)}</select></label>
        <label>Start <input name="start" type="time" required defaultValue="08:00" /></label>
        <label>End <input name="end" type="time" required defaultValue="12:00" /></label>
        <label>How many <input name="needed" type="number" min={1} defaultValue={2} /></label>
        <label>Lead for this location {pick('leadId', '', 'Leave as it is')}</label>
        <button type="submit" className="primary">Add shift</button>
        <datalist id="locations">{event.areas.map((a) => <option key={a.id} value={a.name} />)}</datalist>
        <datalist id="roles">{roles.map((r) => <option key={r} value={r} />)}</datalist>
      </ActionForm>

      <h2>Locations, roles and shifts</h2>
      {event.areas.length === 0 && <p>No shifts yet. Add the first one above: its location and role are made with it.</p>}
      {event.areas.length > 0 && (editing
        ? <p role="status">Edit mode: every shift shows Change and Delete, every role and location a Delete. <Link href={base}>Done</Link></p>
        : <p><Link href={`${base}?edit=1`}>Edit: change a shift, or delete shifts, roles or locations</Link></p>)}
      {event.areas.map((area) => {
        const team = event.aors.find((x) => x.id === area.aorId);
        const shared = team ? event.areas.filter((a) => a.aorId === team.id && a.id !== area.id).map((a) => a.name) : [];
        return (
          <section key={area.id} className="stripe" style={stripe(team?.color)}>
            <h3>{area.name}{area.location && <small> · {area.location}</small>}<small> · {team?.lead ? `led by ${team.lead.name}` : 'no lead (you)'}{team?.radioChannel && `, radio ${team.radioChannel}`}</small></h3>
            <details>
              <summary>More options for {area.name}</summary>
              <ActionForm action={bind(saveLocation)}>
                <input type="hidden" name="id" value={area.id} />
                <label>Location name <input name="name" required maxLength={80} defaultValue={area.name} /></label>
                <label>Where exactly <input name="location" maxLength={200} placeholder="North Lobby" defaultValue={area.location} /></label>
                <label>Lead {pick('leadId', team?.leadId, 'No lead (you)')}</label>
                <label>Deputy {pick('deputyId', team?.deputyId, 'Nobody yet')}</label>
                <label>Radio channel <input name="radioChannel" maxLength={20} defaultValue={team?.radioChannel ?? ''} /></label>
                <label>
                  Lead notes{area.playbook && playbooks.some((p) => p.key === area.playbook!.key && p.version > area.playbook!.version) && ` (version ${area.playbook.version}, kept from when the event went live)`}{' '}
                  <select name="playbookId" defaultValue={playbooks.find((p) => p.key === area.playbook?.key)?.id ?? ''} aria-label={`Lead notes for ${area.name}`}>
                    <option value="">No lead notes</option>
                    {playbooks.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select>
                </label>
                {shared.length > 0 && <p>{team!.lead?.name ?? 'The lead'} also leads {shared.join(', ')}; the deputy and radio channel are the same there.</p>}
                <button type="submit">Save {area.name}</button>
              </ActionForm>
              {area.playbook && <PlaybookView playbook={area.playbook} />}
            </details>
            {area.positions.map((pos) => (
              <div key={pos.id} className="card">
                <h4>{pos.name}{(pos.uniform || pos.isFloat) && <small>{pos.uniform && ` · wear ${pos.uniform}`}{pos.isFloat && ' · floaters'}</small>}</h4>
                {pos.brief && <p>{pos.brief}</p>}
                <ul className="plain">
                  {pos.shifts.map((s) => {
                    const c = count([s]);
                    const when = `${fmtDay(s.day.date, 'UTC')}, ${fmtTime(s.startAt, tz)} to ${fmtTime(s.endAt, tz)}`;
                    return (
                      <li key={s.id} className="row">
                        <span className="grow">{when} · arrive by {fmtTime(s.callAt, tz)} · <strong data-tone={tone(c)}>{c.confirmed}/{s.needed} confirmed</strong>{c.invited > 0 && `, ${c.invited} invited`}</span>
                        {editing && (
                        <details>
                          <summary>Change</summary>
                          <ActionForm action={bind(saveShift)}>
                            <input type="hidden" name="id" value={s.id} />
                            <label>How many <input name="needed" type="number" min={1} defaultValue={s.needed} aria-label={`How many: ${pos.name}, ${when}`} /></label>
                            <label>Arrive early by (minutes) <input name="callOffsetMin" type="number" min={0} defaultValue={Math.round((s.startAt.getTime() - s.callAt.getTime()) / 60_000)} /></label>
                            <label>Extra invites (%) <input name="overbookPct" type="number" min={0} defaultValue={s.overbookPct} /></label>
                            <button type="submit">Save shift</button>
                          </ActionForm>
                        </details>
                        )}
                        {editing && <Remove action={bind(deleteShift)} id={s.id} label="Delete shift" what={`the ${pos.name} shift on ${when}`} blocked={s.assignments.length > 0 && 'People are on this shift. Release them on the Staff page first.'} />}
                      </li>
                    );
                  })}
                </ul>
                <p><Link href={`${base}?location=${encodeURIComponent(area.name)}&role=${encodeURIComponent(pos.name)}#add-shift`}>Add another {pos.name} shift</Link></p>
                <details>
                  <summary>More options for {pos.name}</summary>
                  <ActionForm action={bind(saveRole)}>
                    <input type="hidden" name="id" value={pos.id} />
                    <label>Role name <input name="name" required maxLength={80} defaultValue={pos.name} /></label>
                    <label>What to wear <input name="uniform" maxLength={200} defaultValue={pos.uniform} /></label>
                    <label>Notes for this event only <textarea name="brief" rows={3} cols={60} maxLength={4000} defaultValue={pos.brief} /></label>
                    <label>
                      Job description{pos.card && cards.some((c) => c.key === pos.card!.key && c.version > pos.card!.version) && ` (version ${pos.card.version}, kept from when the event went live; the library is at ${cards.find((c) => c.key === pos.card!.key)!.version})`}{' '}
                      <select name="cardId" defaultValue={cards.find((c) => c.key === pos.card?.key)?.id ?? ''} aria-label={`Job description for ${pos.name}`}>
                        <option value="">No job description</option>
                        {cards.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                      </select>
                    </label>
                    <label>How many at once <input name="targetHeadcount" type="number" min={1} defaultValue={pos.targetHeadcount} /></label>
                    <label>Minimum to run <input name="minHeadcount" type="number" min={0} defaultValue={pos.minHeadcount} /></label>
                    <label>Counts as late after (minutes; blank = event default {event.graceMin}) <input name="graceMin" type="number" min={0} defaultValue={pos.graceMin ?? ''} /></label>
                    <input type="hidden" name="isFloat" value="off" />
                    <label><input type="checkbox" name="isFloat" value="on" defaultChecked={pos.isFloat} /> Floaters (people here can be sent to a short shift on the day)</label>
                    <button type="submit">Save {pos.name}</button>
                  </ActionForm>
                </details>
                {editing && <Remove action={bind(deletePosition)} id={pos.id} label="Delete role" what={`the role ${pos.name}`} blocked={pos.shifts.length > 0 && 'Delete its shifts first.'} />}
              </div>
            ))}
            {editing && <Remove action={bind(deleteArea)} id={area.id} label="Delete location" what={`the location ${area.name}`} blocked={area.positions.length > 0 && 'Delete its roles first.'} />}
          </section>
        );
      })}

      <h2>More options for this event</h2>
      <details>
        <summary>Event defaults for this event{off.length > 0 ? <> <strong className="badge" data-tone="amber">{off.length} changed for this event</strong></> : ' (all standard)'}</summary>
        <p>These start as the <Link href={`/o/${ctx.slug}/rules`}>organisation&rsquo;s defaults</Link>. Change one here and this event keeps its own value; set it back and it follows the organisation again.</p>
        <ActionForm action={bind(setEventDefaults)}>
          <input type="hidden" name="id" value={event.id} />
          <RuleFields values={event} standard={standard} />
          <label>Emergency contact (venue security / medical) <input name="emergencyContact" maxLength={200} defaultValue={event.emergencyContact} placeholder="Venue security 555-0100, radio 1" /></label>
          <button type="submit">Save defaults</button>
        </ActionForm>
      </details>
    </main>
  );
}
