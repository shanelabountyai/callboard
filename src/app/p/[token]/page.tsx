// public: no login; the link's token is the credential (readPersonLink), rate-limited by IP
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { clientIp } from '@/core/http';
import { CardView } from '@/lib/card-view';
import { aor as stripe } from '@/lib/colors';
import { dueAt, EARLY_MS, HELP_CATEGORIES, isOverdue } from '@/lib/dayof';
import { readPersonLink } from '@/lib/links';
import { PlaybookView } from '@/lib/playbook-view';
import { shownTier, tiersFor } from '@/lib/review';
import { TierPill } from '@/lib/review-fields';
import { assignmentInclude, firstName } from '@/lib/staffing';
import { isLive, OPEN_SWAP, SWAP_SAYS, swapInclude, swappable, type SwapSays } from '@/lib/swaps';
import { fmtDay, fmtTime, fmtWhen } from '@/lib/time';
import { Taps } from './taps';

// The person's page (PRD 3, PRD 5): no login, reached from the link in their text. What they need and
// nothing else: where, when, what to wear, who to ask, what the job is, one tap to answer, and on the
// day one tap to check in, check out or ask for help. A lead also runs their AoR from here: tap
// check-in for their crew (offline-capable, see taps.tsx), overdue flags and the alerts they own.
// Before the day a person can ask a colleague in their own area to swap shifts; the lead approves here.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your shifts', robots: { index: false, follow: false } };

const DONE: Record<string, string> = {
  confirm: 'Thanks, you are confirmed. See you there.',
  decline: 'Noted. Your lead has been told, and the shift is open for someone else.',
  clash: 'You have another shift at that time, so this one was not confirmed. Decline the other first, or ask your lead.',
  checkin: 'You are checked in.',
  checkout: 'You are checked out. Thanks for today.',
  help: 'Your lead has been told and will come to you.',
  ack: 'Thanks, noted.',
  resolve: 'Alert closed.',
  release: 'Released. They have been told.',
  back: 'You are on the list for next time. Thank you.',
};

export default async function PersonPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const link = await readPersonLink(token, clientIp(await headers()));
  if (link === 'limited') return <main className="floor"><h1>Too many requests</h1><p>Wait a few minutes and try again.</p></main>;
  if (!link) notFound();
  const { person, event, orgId } = link;
  const tz = event.timezone;
  const t = now();
  const scope = { orgId, eventId: event.id };
  const [assignments, leads, messages] = await Promise.all([
    db.assignment.findMany({ where: { ...scope, personId: person.id, status: { not: 'released' } }, include: assignmentInclude, orderBy: { shift: { startAt: 'asc' } } }),
    db.aor.findMany({
      where: { ...scope, OR: [{ leadId: person.id }, { deputyId: person.id }] },
      include: {
        lead: true, deputy: true,
        alerts: { where: { resolvedAt: null }, include: { person: true, assignment: { include: { shift: { include: { position: true } } } } }, orderBy: [{ severity: 'desc' }, { openedAt: 'asc' }] },
        areas: { include: { playbook: true, positions: { include: { shifts: { orderBy: { startAt: 'asc' }, include: { day: true, assignments: { include: { person: true } } } } } } } },
      },
    }),
    db.broadcastRecipient.findMany({ where: { orgId, personId: person.id, broadcast: { eventId: event.id } }, include: { broadcast: true }, orderBy: { broadcast: { createdAt: 'desc' } }, take: 10 }),
  ]);
  // Tiers are for leads and planners only (PRD 6): computed for a lead's crew, never rendered on anyone's own card.
  const crew = leads.flatMap((aor) => aor.areas.flatMap((ar) => ar.positions.flatMap((p) => p.shifts.flatMap((s) => s.assignments.map((x) => x.personId)))));
  const tiers = crew.length ? await tiersFor(orgId, crew) : new Map();
  // Swaps (PRD 3): mine, the ones asked of me, and the agreed ones waiting on me as a lead.
  const myAorIds = leads.map((x) => x.id);
  const swaps = (await db.swap.findMany({
    where: { ...scope, status: { in: OPEN_SWAP }, OR: [{ from: { personId: person.id } }, { to: { personId: person.id } }, { status: 'accepted', from: { shift: { position: { area: { aorId: { in: myAorIds } } } } } }] },
    include: swapInclude, orderBy: { createdAt: 'asc' },
  })).filter((x) => isLive(x, t));
  // Who a shift could be swapped with: confirmed people in the same area of responsibility, by name and shift only.
  const mine = event.status === 'closed' ? [] : assignments.filter((a) => swappable(a, t));
  const aorIds = mine.map((a) => a.shift.position.area.aorId);
  const colleagues = mine.length === 0 ? [] : await db.assignment.findMany({
    where: {
      ...scope, personId: { not: person.id }, status: 'confirmed', checkedInAt: null,
      shift: { callAt: { gt: t }, position: { area: { OR: [{ aorId: { in: aorIds.filter((x) => x !== null) } }, ...(aorIds.includes(null) ? [{ aorId: null }] : [])] } } },
    },
    include: { person: { select: { name: true } }, shift: { include: { position: { include: { area: { select: { aorId: true } } } } } } },
    orderBy: { shift: { startAt: 'asc' } }, take: 200,
  });
  const takes = (a: { shift: { startAt: Date; position: { name: string } } }) => `${a.shift.position.name}, ${fmtWhen(a.shift.startAt, tz)}`;
  const act = `/p/${token}/act`;
  const onDay = assignments.some((a) => a.shift.callAt.getTime() - EARLY_MS <= t.getTime() && t.getTime() <= a.shift.endAt.getTime() + 3_600_000);

  return (
    <main className="floor">
      <h1>{event.name}</h1>
      <p>Hi {firstName(person.name)}.{event.venue && ` ${event.venue}.`}</p>
      {done && (DONE[done] ?? SWAP_SAYS[done as SwapSays]) && <p role="status">{DONE[done] ?? SWAP_SAYS[done as SwapSays]}</p>}
      <Taps token={token} />
      {event.status === 'closed' && (
        <article>
          <p><strong>Thank you for {event.name}.</strong></p>
          {person.wantsBackAt ? <p>You are on the list for next time.</p> : (
            <form method="post" action={act}>
              <input type="hidden" name="kind" value="back" />
              <button type="submit">Count me in next time</button>
            </form>
          )}
        </article>
      )}
      {assignments.length === 0 && leads.length === 0 && <p>You have no shifts on this event right now.</p>}

      {messages.filter((m) => m.broadcast.requiresAck && !m.ackedAt).map((m) => (
        <article key={m.id} className="alert">
          <p><strong>From the planner, {fmtWhen(m.broadcast.createdAt, tz)}:</strong></p>
          <p className="pre">{m.broadcast.body}</p>
          <form method="post" action={act} data-tap>
            <input type="hidden" name="kind" value="ack" />
            <input type="hidden" name="recipient" value={m.id} />
            <button type="submit" className="primary">Got it</button>
          </form>
        </article>
      ))}

      {swaps.filter((x) => x.status === 'proposed' && x.to.personId === person.id).map((x) => (
        <article key={x.id} className="alert">
          <p><strong>{x.from.person.name} asks to swap shifts.</strong></p>
          <p>You would take {takes(x.from)} (be there by {fmtTime(x.from.shift.callAt, tz)}). They would take your {takes(x.to)}. Nothing changes until your lead approves.</p>
          <form method="post" action={act} className="pair">
            <input type="hidden" name="swap" value={x.id} />
            <button type="submit" name="kind" value="swap_yes" className="primary">Accept</button>
            <button type="submit" name="kind" value="swap_no">Decline</button>
          </form>
        </article>
      ))}

      {assignments.map((a) => {
        const area = a.shift.position.area;
        const asked = swaps.find((x) => x.fromId === a.id);
        const offered = swaps.some((x) => x.toId === a.id);
        const options = mine.includes(a) && !asked && !offered ? colleagues.filter((c) => c.shift.position.area.aorId === area.aorId && c.shiftId !== a.shiftId) : [];
        const lead = area.aor?.lead;
        const window = a.shift.callAt.getTime() - EARLY_MS <= t.getTime() && t.getTime() <= a.shift.endAt.getTime() + 3_600_000;
        return (
          <article key={a.id} className="stripe" style={stripe(area.aor?.color)}>
            <h2>{a.shift.position.name} · {area.name}</h2>
            <p><strong>{fmtWhen(a.shift.startAt, tz)}</strong> to {fmtTime(a.shift.endAt, tz)}. <strong className="call">Be there by {fmtTime(a.shift.callAt, tz)}.</strong></p>
            {area.location && <p>Where: {area.location}</p>}
            {a.shift.position.uniform && <p>Wear: {a.shift.position.uniform}</p>}
            <p>Your lead: {lead ? <>{lead.name}, <a href={`tel:${lead.mobile}`}>{lead.mobile}</a></> : 'the event planner'}{area.aor?.radioChannel && ` · radio ${area.aor.radioChannel}`}</p>
            {a.shift.position.card && <CardView card={a.shift.position.card} />}
            {a.shift.position.brief && <p className="pre">{a.shift.position.brief}</p>}
            <p>
              Status: <span className="pill" data-status={a.checkedOutAt ? 'done' : a.checkedInAt ? 'here' : a.status}>{a.status}</span>
              {a.checkedInAt && <> · checked in {fmtTime(a.checkedInAt, tz)}</>}
              {a.checkedOutAt && <> · checked out {fmtTime(a.checkedOutAt, tz)}</>}
            </p>
            {a.status === 'confirmed' && window && !a.checkedOutAt ? (
              <form method="post" action={act} data-tap className="pair">
                <input type="hidden" name="assignment" value={a.id} />
                {!a.checkedInAt
                  ? <><input type="hidden" name="kind" value="checkin" /><button type="submit" className="primary">Check in</button></>
                  : <><input type="hidden" name="kind" value="checkout" /><button type="submit" className="primary">I’m done</button></>}
              </form>
            ) : (
              <form method="post" action={`/p/${token}/respond`} className="pair">
                <input type="hidden" name="assignment" value={a.id} />
                <button type="submit" name="answer" value="confirm" disabled={a.status === 'confirmed'} className="primary">Confirm</button>
                <button type="submit" name="answer" value="decline" disabled={a.status === 'declined'}>Decline</button>
              </form>
            )}
            {asked && (
              <form method="post" action={act}>
                <p>You asked {asked.to.person.name} to swap for {takes(asked.to)}. Waiting on {asked.status === 'proposed' ? firstName(asked.to.person.name) : 'your lead'}; this shift is yours until it is approved.</p>
                <input type="hidden" name="kind" value="swap_withdraw" />
                <input type="hidden" name="swap" value={asked.id} />
                <button type="submit">Withdraw the swap</button>
              </form>
            )}
            {options.length > 0 && (
              <details>
                <summary>Swap this shift</summary>
                <form method="post" action={act}>
                  <input type="hidden" name="kind" value="swap_ask" />
                  <input type="hidden" name="assignment" value={a.id} />
                  <label>Swap with <select name="other" required>{options.map((c) => <option key={c.id} value={c.id}>{c.person.name}: {takes(c)}</option>)}</select></label>
                  <p>They get a text and can accept or decline. Your lead has the last word.</p>
                  <button type="submit">Ask to swap</button>
                </form>
              </details>
            )}
          </article>
        );
      })}

      {onDay && (
        <details className="card">
          <summary>Need help?</summary>
          <p>For medical or security, call {event.emergencyContact || 'venue security'} first. This page tells your lead; it is not the emergency channel.</p>
          <form method="post" action={act}>
            <input type="hidden" name="kind" value="help" />
            <fieldset>
              <legend>What kind</legend>
              <div className="chips">
                {HELP_CATEGORIES.map((c, i) => <label key={c}><input type="radio" name="category" value={c} defaultChecked={i === 0} /><span>{c}</span></label>)}
              </div>
            </fieldset>
            <label>Note <input name="note" maxLength={500} placeholder="No badge stock at printer 2" /></label>
            <button type="submit" className="primary">Send to my lead</button>
          </form>
        </details>
      )}

      {leads.map((aor) => (
        <section key={aor.id} className="stripe" style={stripe(aor.color)}>
          <h2>You {aor.leadId === person.id ? 'lead' : 'are deputy for'} {aor.name}</h2>
          <p>
            {aor.leadId === person.id ? `Deputy: ${aor.deputy?.name ?? 'none'}` : `Lead: ${aor.lead?.name ?? 'none'}`}
            {aor.radioChannel && ` · radio ${aor.radioChannel}`}
          </p>
          {[['Breaks', event.breaks], ['Minors', event.minors], ['Moving people', event.moves]].filter(([, v]) => v).map(([k, v]) => <p key={k} className="pre"><strong>{k}:</strong> {v}</p>)}
          {event.status === 'closed' && <p><a href={`/p/${token}/review`}><strong>Review your crew</strong></a> (about three minutes): who showed, and what to fix next time.</p>}
          {aor.alerts.length > 0 && (
            <div>
              <h3>Needs you ({aor.alerts.length})</h3>
              {aor.alerts.map((al) => (
                <article key={al.id} className="alert" data-severity={al.severity >= 3 ? 'high' : 'normal'}>
                  <p>
                    <strong>{al.kind === 'no_show' ? 'Not checked in' : `Help: ${al.category}`}</strong> · {al.person.name}
                    {al.assignment && ` · ${al.assignment.shift.position.name}`} · since {fmtTime(al.openedAt, tz)}
                    {al.step === 1 && ' · escalated to deputy'}{al.step === 2 && ' · with the planner'}
                    {al.note && <><br />“{al.note}”</>}
                  </p>
                  <div className="pair">
                    {al.assignment && al.kind === 'no_show' && (
                      <form method="post" action={act} data-tap>
                        <input type="hidden" name="kind" value="checkin" /><input type="hidden" name="assignment" value={al.assignment.id} />
                        <button type="submit" className="primary">They’re here</button>
                      </form>
                    )}
                    {al.assignment && al.kind === 'no_show' && (
                      <form method="post" action={act}>
                        <input type="hidden" name="kind" value="release" /><input type="hidden" name="alert" value={al.id} />
                        <button type="submit">Release them</button>
                      </form>
                    )}
                    <form method="post" action={act}>
                      <input type="hidden" name="kind" value="resolve" /><input type="hidden" name="alert" value={al.id} />
                      <button type="submit">Handled</button>
                    </form>
                  </div>
                </article>
              ))}
            </div>
          )}
          {swaps.some((x) => x.status === 'accepted' && x.from.shift.position.area.aorId === aor.id) && (
            <div>
              <h3>Swaps to approve</h3>
              {swaps.filter((x) => x.status === 'accepted' && x.from.shift.position.area.aorId === aor.id).map((x) => (
                <article key={x.id} className="alert">
                  <p><strong>{x.from.person.name} and {x.to.person.name} want to swap.</strong> {firstName(x.from.person.name)} would take {takes(x.to)}; {firstName(x.to.person.name)} would take {takes(x.from)}.</p>
                  {x.from.personId === person.id || x.to.personId === person.id ? <p>You are part of this swap, so {aor.leadId === person.id ? 'your deputy' : 'your lead'} or the planner decides.</p> : (
                    <form method="post" action={act} className="pair">
                      <input type="hidden" name="swap" value={x.id} />
                      <button type="submit" name="kind" value="swap_approve" className="primary">Approve</button>
                      <button type="submit" name="kind" value="swap_refuse">Refuse</button>
                    </form>
                  )}
                </article>
              ))}
            </div>
          )}
          {aor.areas.map((area) => (
            <div key={area.id}>
              <h3>{area.name}{area.location && ` · ${area.location}`}</h3>
              {area.playbook && <details><summary>Playbook: equipment, checklists, what has gone wrong before</summary><PlaybookView playbook={area.playbook} /></details>}
              {area.positions.flatMap((pos) => pos.shifts.map((s) => {
                const open = s.assignments.filter((x) => x.status !== 'released' && x.status !== 'declined');
                const here = open.filter((x) => x.checkedInAt && !x.checkedOutAt).length;
                const live = s.callAt.getTime() - EARLY_MS <= t.getTime() && t.getTime() <= s.endAt.getTime() + 3_600_000;
                return (
                  <details key={s.id} open={live || open.length > 0}>
                    <summary>
                      {pos.name}: {fmtDay(s.day.date, 'UTC')}, call {fmtTime(s.callAt, tz)} · {open.filter((x) => x.status === 'confirmed').length} confirmed of {s.needed}
                      {live && ` · ${here} here`}
                    </summary>
                    <ul className="plain">
                      {open.map((x) => {
                        const full = { ...x, shift: { ...s, position: pos }, event };
                        const overdue = isOverdue(full, t);
                        return (
                          <li key={x.id} className="row">
                            <span className="grow">
                              {x.person.name} <TierPill t={shownTier(x.person, tiers)} /> · <a href={`tel:${x.person.mobile}`}>{x.person.mobile}</a> · <span className="pill" data-status={x.status}>{x.status}</span>
                              {x.checkedInAt && <> · <strong>here {fmtTime(x.checkedInAt, tz)}</strong></>}
                              {x.checkedOutAt && <> · out {fmtTime(x.checkedOutAt, tz)}{x.checkOutMethod === 'auto' && ' (auto)'}</>}
                              {overdue && <> · <span className="pill" data-status="overdue">overdue since {fmtTime(dueAt(full), tz)}</span></>}
                            </span>
                            {live && !x.checkedOutAt && (
                              <form method="post" action={act} data-tap>
                                <input type="hidden" name="assignment" value={x.id} />
                                {!x.checkedInAt
                                  ? <><input type="hidden" name="kind" value="checkin" /><button type="submit" className="primary" aria-label={`Check in ${x.person.name}`}>Here</button></>
                                  : <><input type="hidden" name="kind" value="checkout" /><button type="submit" aria-label={`Check out ${x.person.name}`}>Done</button></>}
                              </form>
                            )}
                          </li>
                        );
                      })}
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
