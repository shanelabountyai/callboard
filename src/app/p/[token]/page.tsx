import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { clientIp } from '@/core/http';
import { dueAt, EARLY_MS, HELP_CATEGORIES, isOverdue } from '@/lib/dayof';
import { readPersonLink } from '@/lib/links';
import { assignmentInclude, firstName } from '@/lib/staffing';
import { fmtDay, fmtTime, fmtWhen } from '@/lib/time';
import { Taps } from './taps';

// The person's page (PRD 3, PRD 5): no login, reached from the link in their text. What they need and
// nothing else: where, when, what to wear, who to ask, what the job is, one tap to answer, and on the
// day one tap to check in, check out or ask for help. A lead also runs their AoR from here: tap
// check-in for their crew (offline-capable, see taps.tsx), overdue flags and the alerts they own.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your shifts', robots: { index: false, follow: false } };

const DONE: Record<string, string> = {
  confirm: 'Thanks, you are confirmed. See you there.',
  decline: 'Noted. Your lead has been told, and the shift is open for someone else.',
  checkin: 'You are checked in.',
  checkout: 'You are checked out. Thanks for today.',
  help: 'Your lead has been told and will come to you.',
  ack: 'Thanks, noted.',
  resolve: 'Alert closed.',
  release: 'Released. They have been told.',
};
const big = { fontSize: 18, padding: '12px 24px', minHeight: 48 } as const;

export default async function PersonPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const link = await readPersonLink(token, clientIp(await headers()));
  if (link === 'limited') return <main><h1>Too many requests</h1><p>Wait a few minutes and try again.</p></main>;
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
        areas: { include: { positions: { include: { shifts: { orderBy: { startAt: 'asc' }, include: { day: true, assignments: { include: { person: true } } } } } } } },
      },
    }),
    db.broadcastRecipient.findMany({ where: { orgId, personId: person.id, broadcast: { eventId: event.id } }, include: { broadcast: true }, orderBy: { broadcast: { createdAt: 'desc' } }, take: 10 }),
  ]);
  const act = `/p/${token}/act`;
  const onDay = assignments.some((a) => a.shift.callAt.getTime() - EARLY_MS <= t.getTime() && t.getTime() <= a.shift.endAt.getTime() + 3_600_000);

  return (
    <main>
      <h1>{event.name}</h1>
      <p>Hi {firstName(person.name)}.{event.venue && ` ${event.venue}.`}</p>
      {done && DONE[done] && <p role="status">{DONE[done]}</p>}
      <Taps token={token} />
      {assignments.length === 0 && leads.length === 0 && <p>You have no shifts on this event right now.</p>}

      {messages.filter((m) => m.broadcast.requiresAck && !m.ackedAt).map((m) => (
        <article key={m.id} style={{ border: '2px solid #d97706', padding: 12, marginBottom: 12 }}>
          <p><strong>From the planner, {fmtWhen(m.broadcast.createdAt, tz)}:</strong></p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{m.broadcast.body}</p>
          <form method="post" action={act} data-tap>
            <input type="hidden" name="kind" value="ack" />
            <input type="hidden" name="recipient" value={m.id} />
            <button type="submit" style={big}>Got it</button>
          </form>
        </article>
      ))}

      {assignments.map((a) => {
        const area = a.shift.position.area;
        const lead = area.aor?.lead;
        const window = a.shift.callAt.getTime() - EARLY_MS <= t.getTime() && t.getTime() <= a.shift.endAt.getTime() + 3_600_000;
        return (
          <article key={a.id} style={{ border: '1px solid #ccc', borderLeft: `6px solid ${area.aor?.color ?? '#999'}`, padding: 12, marginBottom: 12 }}>
            <h2>{a.shift.position.name} · {area.name}</h2>
            <p><strong>{fmtWhen(a.shift.startAt, tz)}</strong> to {fmtTime(a.shift.endAt, tz)}. <strong>Be there by {fmtTime(a.shift.callAt, tz)}.</strong></p>
            {area.location && <p>Where: {area.location}</p>}
            {a.shift.position.uniform && <p>Wear: {a.shift.position.uniform}</p>}
            <p>Your lead: {lead ? <>{lead.name}, <a href={`tel:${lead.mobile}`}>{lead.mobile}</a></> : 'the event planner'}{area.aor?.radioChannel && ` · radio ${area.aor.radioChannel}`}</p>
            {a.shift.position.brief && <p style={{ whiteSpace: 'pre-wrap' }}>{a.shift.position.brief}</p>}
            <p>
              Status: <strong>{a.status}</strong>
              {a.checkedInAt && <> · checked in {fmtTime(a.checkedInAt, tz)}</>}
              {a.checkedOutAt && <> · checked out {fmtTime(a.checkedOutAt, tz)}</>}
            </p>
            {a.status === 'confirmed' && window && !a.checkedOutAt ? (
              <form method="post" action={act} data-tap style={{ display: 'flex', gap: 8 }}>
                <input type="hidden" name="assignment" value={a.id} />
                {!a.checkedInAt
                  ? <><input type="hidden" name="kind" value="checkin" /><button type="submit" style={big}>Check in</button></>
                  : <><input type="hidden" name="kind" value="checkout" /><button type="submit" style={big}>I’m done</button></>}
              </form>
            ) : (
              <form method="post" action={`/p/${token}/respond`} style={{ display: 'flex', gap: 8 }}>
                <input type="hidden" name="assignment" value={a.id} />
                <button type="submit" name="answer" value="confirm" disabled={a.status === 'confirmed'} style={big}>Confirm</button>
                <button type="submit" name="answer" value="decline" disabled={a.status === 'declined'} style={big}>Decline</button>
              </form>
            )}
          </article>
        );
      })}

      {onDay && (
        <details style={{ marginBottom: 12 }}>
          <summary style={big}>Need help?</summary>
          <p>For medical or security, call {event.emergencyContact || 'venue security'} first. This page tells your lead; it is not the emergency channel.</p>
          <form method="post" action={act}>
            <input type="hidden" name="kind" value="help" />
            <label>What kind <select name="category" style={big}>{HELP_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <label>Note <input name="note" maxLength={500} placeholder="No badge stock at printer 2" style={{ width: '100%', minHeight: 48, fontSize: 18 }} /></label>
            <button type="submit" style={big}>Send to my lead</button>
          </form>
        </details>
      )}

      {leads.map((aor) => (
        <section key={aor.id} style={{ borderLeft: `6px solid ${aor.color}`, paddingLeft: 8 }}>
          <h2>You {aor.leadId === person.id ? 'lead' : 'are deputy for'} {aor.name}</h2>
          <p>
            {aor.leadId === person.id ? `Deputy: ${aor.deputy?.name ?? 'none'}` : `Lead: ${aor.lead?.name ?? 'none'}`}
            {aor.radioChannel && ` · radio ${aor.radioChannel}`}
          </p>
          {aor.alerts.length > 0 && (
            <div>
              <h3>Needs you ({aor.alerts.length})</h3>
              {aor.alerts.map((al) => (
                <article key={al.id} style={{ border: '2px solid #dc2626', padding: 8, marginBottom: 8 }}>
                  <p>
                    <strong>{al.kind === 'no_show' ? 'Not checked in' : `Help: ${al.category}`}</strong> · {al.person.name}
                    {al.assignment && ` · ${al.assignment.shift.position.name}`} · since {fmtTime(al.openedAt, tz)}
                    {al.step === 1 && ' · escalated to deputy'}{al.step === 2 && ' · with the planner'}
                    {al.note && <><br />“{al.note}”</>}
                  </p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {al.assignment && al.kind === 'no_show' && (
                      <form method="post" action={act} data-tap>
                        <input type="hidden" name="kind" value="checkin" /><input type="hidden" name="assignment" value={al.assignment.id} />
                        <button type="submit" style={big}>They’re here</button>
                      </form>
                    )}
                    {al.assignment && al.kind === 'no_show' && (
                      <form method="post" action={act}>
                        <input type="hidden" name="kind" value="release" /><input type="hidden" name="alert" value={al.id} />
                        <button type="submit" style={big}>Release them</button>
                      </form>
                    )}
                    <form method="post" action={act}>
                      <input type="hidden" name="kind" value="resolve" /><input type="hidden" name="alert" value={al.id} />
                      <button type="submit" style={big}>Handled</button>
                    </form>
                  </div>
                </article>
              ))}
            </div>
          )}
          {aor.areas.map((area) => (
            <div key={area.id}>
              <h3>{area.name}{area.location && ` · ${area.location}`}</h3>
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
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                      {open.map((x) => {
                        const full = { ...x, shift: { ...s, position: pos }, event };
                        const overdue = isOverdue(full, t);
                        return (
                          <li key={x.id} style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 56, borderBottom: '1px solid #eee', flexWrap: 'wrap' }}>
                            <span style={{ flex: 1 }}>
                              {x.person.name} · <a href={`tel:${x.person.mobile}`}>{x.person.mobile}</a> · {x.status}
                              {x.checkedInAt && <> · <strong>here {fmtTime(x.checkedInAt, tz)}</strong></>}
                              {x.checkedOutAt && <> · out {fmtTime(x.checkedOutAt, tz)}{x.checkOutMethod === 'auto' && ' (auto)'}</>}
                              {overdue && <> · <strong style={{ color: '#dc2626' }}>overdue since {fmtTime(dueAt(full), tz)}</strong></>}
                            </span>
                            {live && !x.checkedOutAt && (
                              <form method="post" action={act} data-tap>
                                <input type="hidden" name="assignment" value={x.id} />
                                {!x.checkedInAt
                                  ? <><input type="hidden" name="kind" value="checkin" /><button type="submit" style={big} aria-label={`Check in ${x.person.name}`}>Here</button></>
                                  : <><input type="hidden" name="kind" value="checkout" /><button type="submit" style={big} aria-label={`Check out ${x.person.name}`}>Done</button></>}
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
