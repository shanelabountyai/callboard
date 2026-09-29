// public: no login; the link's token is the credential (readPersonLink), rate-limited by IP
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { clientIp } from '@/core/http';
import { CardView } from '@/lib/card-view';
import { repeatsCard } from '@/lib/cards';
import { aor as stripe } from '@/lib/colors';
import { dueAt, EARLY_MS, HELP_CATEGORIES, isOverdue } from '@/lib/dayof';
import { readPersonLink } from '@/lib/links';
import { PlaybookView } from '@/lib/playbook-view';
import { assignmentInclude, firstName } from '@/lib/staffing';
import { isLive, OPEN_SWAP, SWAP_SAYS, swapInclude, swappable, type SwapSays } from '@/lib/swaps';
import { fmtDay, fmtTime, fmtWhen, ymd } from '@/lib/time';
import { Taps } from './taps';

// The person's page (PRD 3, PRD 5): no login, reached from the link in their text. What they need and
// nothing else: where, when, what to wear, who to ask, one tap to answer, and on the day one tap to
// check in, check out or ask for help. The answer comes before the job description, which is folded, so
// Confirm is on the first screen. A lead also runs their team from here: one list for today, the people
// who are overdue at the top, a tap to check each one in (offline-capable, see taps.tsx). Other days fold.
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
  unreachable: 'The planner has been told. They have not been texted, and the shift is still theirs.',
  reach_undo: 'Undone. The planner has been told it is back with you.',
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
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(t); // YYYY-MM-DD in the event's zone
  const isLiveShift = (s: { callAt: Date; endAt: Date }) => s.callAt.getTime() - EARLY_MS <= t.getTime() && t.getTime() <= s.endAt.getTime() + 3_600_000;
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
        const { card, brief } = a.shift.position;
        const notes = card && repeatsCard(card, brief) ? '' : brief;
        const window = a.shift.callAt.getTime() - EARLY_MS <= t.getTime() && t.getTime() <= a.shift.endAt.getTime() + 3_600_000;
        return (
          <article key={a.id} className="stripe" style={stripe(area.aor?.color)}>
            <h2>{a.shift.position.name} · {area.name}</h2>
            <p><strong>{fmtWhen(a.shift.startAt, tz)}</strong> to {fmtTime(a.shift.endAt, tz)}. <strong className="call">Be there by {fmtTime(a.shift.callAt, tz)}.</strong></p>
            {area.location && <p>Where: {area.location}</p>}
            {a.shift.position.uniform && <p>Wear: {a.shift.position.uniform}</p>}
            <p>Your lead: {lead ? <>{lead.name}, <a href={`tel:${lead.mobile}`}>{lead.mobile}</a></> : 'the event planner'}{area.aor?.radioChannel && ` · radio ${area.aor.radioChannel}`}</p>
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
                <button type="submit" name="answer" value="decline" disabled={a.status === 'declined'}>Can’t make it</button>
              </form>
            )}
            {(card || notes) && (
              <details>
                <summary>What the job is</summary>
                {card && <CardView card={card} />}
                {notes && <p className="pre">{notes}</p>}
              </details>
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

      {leads.map((aor) => {
        // One list (S4): the day shown is today, or the next day with shifts, or the last one. Everyone on it appears once.
        const shifts = aor.areas.flatMap((area) => area.positions.flatMap((pos) => pos.shifts.map((s) => ({ s, pos, area }))));
        const days = [...new Set(shifts.map((x) => ymd(x.s.day.date)))].sort();
        const shown = days.find((d) => d >= today) ?? days.at(-1);
        const noShow = (id: string) => aor.alerts.find((al) => al.kind === 'no_show' && al.assignment?.id === id);
        const crewOf = ({ s, pos }: (typeof shifts)[number]) => s.assignments.filter((x) => x.status !== 'released' && x.status !== 'declined').map((x) => {
          const full = { ...x, shift: { ...s, position: pos }, event };
          return { x, s, pos, full, late: ymd(s.day.date) === shown && (isOverdue(full, t) || (!x.checkedInAt && !!noShow(x.id))) };
        });
        const late = shifts.flatMap(crewOf).filter((r) => r.late);
        const onList = new Set(late.map((r) => r.x.id));
        const cards = aor.alerts.filter((al) => !(al.assignment && onList.has(al.assignment.id)));
        const row = ({ x, s, pos, full, late }: ReturnType<typeof crewOf>[number]) => {
          const al = late ? noShow(x.id) : undefined;
          return (
            <li key={x.id} className="row" data-late={late ? '' : undefined}>
              <span className="grow">
                {x.person.name} · <a href={`tel:${x.person.mobile}`}>{x.person.mobile}</a>
                {late ? <> · {pos.name}, arrive by {fmtTime(s.callAt, tz)}</> : <> · <span className="pill" data-status={x.status}>{x.status}</span></>}
                {x.checkedInAt && <> · <strong>here {fmtTime(x.checkedInAt, tz)}</strong></>}
                {x.checkedOutAt && <> · out {fmtTime(x.checkedOutAt, tz)}{x.checkOutMethod === 'auto' && ' (auto)'}</>}
                {late && <> · <span className="pill" data-status="overdue">overdue since {fmtTime(dueAt(full), tz)}</span></>}
                {al?.note && <> · the planner has been told</>}
              </span>
              {isLiveShift(s) && !x.checkedOutAt && (
                <form method="post" action={act} data-tap>
                  <input type="hidden" name="assignment" value={x.id} />
                  {!x.checkedInAt
                    ? <><input type="hidden" name="kind" value="checkin" /><button type="submit" className="primary" aria-label={`Check in ${x.person.name}`}>Here</button></>
                    : <><input type="hidden" name="kind" value="checkout" /><button type="submit" aria-label={`Check out ${x.person.name}`}>Done</button></>}
                </form>
              )}
              {al && (
                <form method="post" action={act}>
                  <input type="hidden" name="alert" value={al.id} />
                  {al.note
                    ? <button type="submit" name="kind" value="reach_undo" aria-label={`Undo: the planner was told you cannot reach ${x.person.name}`}>Undo</button>
                    : <button type="submit" name="kind" value="unreachable" aria-label={`Can’t reach ${x.person.name}`}>Can’t reach them</button>}
                </form>
              )}
            </li>
          );
        };
        const block = (sh: (typeof shifts)[number], withDay: boolean) => {
          const { s, pos } = sh;
          const crew = crewOf(sh);
          return (
            <details key={s.id} open={!withDay}>
              <summary>
                {pos.name}: {withDay && `${fmtDay(s.day.date, 'UTC')}, `}arrive by {fmtTime(s.callAt, tz)} · {crew.filter((r) => r.x.status === 'confirmed').length} confirmed, {s.needed} needed
                {isLiveShift(s) && ` · ${crew.filter((r) => r.x.checkedInAt && !r.x.checkedOutAt).length} here`}
              </summary>
              <ul className="plain">
                {crew.filter((r) => !r.late).map(row)}
                {crew.length === 0 && <li>Nobody invited yet.</li>}
              </ul>
            </details>
          );
        };
        return (
          <section key={aor.id} className="stripe" style={stripe(aor.color)}>
            <h2>You {aor.leadId === person.id ? 'lead' : 'are deputy for'} {aor.name}</h2>
            {event.status === 'closed' && <p><a href={`/p/${token}/review`}><strong>Review your crew</strong></a> (about a minute): anyone you would not have back, and anything to fix next time.</p>}
            {cards.map((al) => (
              <article key={al.id} className="alert pair" data-severity={al.severity >= 3 ? 'high' : 'normal'}>
                <p className="grow">
                  <strong>{al.kind === 'no_show' ? 'Not checked in' : `Help: ${al.category}`}</strong> · {al.person.name}
                  {al.assignment && ` · ${al.assignment.shift.position.name}`} · since {fmtTime(al.openedAt, tz)}
                  {al.step === 1 && ' · passed to the deputy'}{al.step === 2 && ' · with the planner'}
                  {al.note && <><br />“{al.note}”</>}
                </p>
                <form method="post" action={act}>
                  <input type="hidden" name="kind" value="resolve" /><input type="hidden" name="alert" value={al.id} />
                  <button type="submit">Done</button>
                </form>
              </article>
            ))}
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
            {shown && <h3>{shown === today ? 'Today' : fmtDay(new Date(shown), 'UTC')}{late.length > 0 && `: ${late.length} not here`}</h3>}
            {late.length > 0 && <ul className="plain">{late.map(row)}</ul>}
            {aor.areas.map((area) => shifts.some((x) => x.area.id === area.id && ymd(x.s.day.date) === shown) && (
              <div key={area.id}>
                <h3>{area.name}{area.location && ` · ${area.location}`}</h3>
                {shifts.filter((x) => x.area.id === area.id && ymd(x.s.day.date) === shown).map((x) => block(x, false))}
              </div>
            ))}
            {days.length > 1 && (
              <details>
                <summary>Other days</summary>
                {shifts.filter((x) => ymd(x.s.day.date) !== shown).map((x) => block(x, true))}
              </details>
            )}
            <details>
              <summary>Lead notes and house rules</summary>
              <p>
                {aor.leadId === person.id ? `Deputy: ${aor.deputy?.name ?? 'none'}` : `Lead: ${aor.lead?.name ?? 'none'}`}
                {aor.radioChannel && ` · radio ${aor.radioChannel}`}
              </p>
              {[['Breaks', event.breaks], ['Minors', event.minors], ['Moving people', event.moves]].filter(([, v]) => v).map(([k, v]) => <p key={k} className="pre"><strong>{k}:</strong> {v}</p>)}
              {aor.areas.filter((area) => area.playbook).map((area) => <div key={area.id}><h3>{area.name}: equipment, checklists, what has gone wrong before</h3><PlaybookView playbook={area.playbook!} /></div>)}
            </details>
          </section>
        );
      })}
    </main>
  );
}
