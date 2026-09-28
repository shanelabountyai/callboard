import Link from 'next/link';
import { notFound } from 'next/navigation';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { aor as stripe } from '@/lib/colors';
import { dueAt, EARLY_MS, isOverdue } from '@/lib/dayof';
import { fmtDay, fmtTime, isYmd, ymd } from '@/lib/time';
import { deployFloat, plannerCheck, resolveAlert } from './actions';
import { AutoRefresh } from './refresh';

export const metadata = { title: 'Coverage board' };

// The live picture (PRD 5): one day, every shift, who is here against needed, coloured by minimum and
// target; the alert queue; float to deploy. Overdue is computed live, so it never waits for the sweep.
export default async function Board({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<{ day?: string }> }) {
  const ctx = await requireOrg((await params).org);
  const { id } = await params;
  const q = await searchParams;
  const event = await db.event.findFirst({
    where: { id, ...inOrg(ctx) },
    include: {
      days: { orderBy: { date: 'asc' } },
      aors: { include: { lead: true, deputy: true }, orderBy: { name: 'asc' } },
      alerts: { where: { resolvedAt: null }, include: { person: true, aor: true, assignment: { include: { shift: { include: { position: true } } } } }, orderBy: [{ severity: 'desc' }, { openedAt: 'asc' }] },
    },
  });
  if (!event) notFound();
  const t = now();
  const tz = event.timezone;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(t); // YYYY-MM-DD in the event's zone
  const day = (q.day && isYmd(q.day) ? event.days.find((d) => ymd(d.date) === q.day) : undefined) ?? event.days.find((d) => ymd(d.date) === today) ?? event.days[0];
  const dayKey = day ? ymd(day.date) : '';
  const shifts = day
    ? await db.shift.findMany({
        where: { ...inOrg(ctx), dayId: day.id },
        include: { position: { include: { area: { include: { aor: true } } } }, assignments: { where: { status: { in: ['invited', 'confirmed'] } }, include: { person: true }, orderBy: { person: { name: 'asc' } } } },
        orderBy: { startAt: 'asc' },
      })
    : [];
  const bind = <A extends unknown[], R>(fn: (slug: string, ...a: A) => R) => fn.bind(null, ctx.slug);
  const base = `/o/${ctx.slug}/events/${event.id}`;
  const full = (s: (typeof shifts)[number], a: (typeof shifts)[number]['assignments'][number]) => ({ ...a, shift: s, event });
  const floats = shifts.filter((s) => s.position.isFloat).flatMap((s) => s.assignments.filter((a) => a.checkedInAt && !a.checkedOutAt).map((a) => ({ ...a, shift: s })));
  const groups = new Map<string, { aor: (typeof event.aors)[number] | null; shifts: typeof shifts }>();
  for (const s of shifts) {
    const key = s.position.area.aorId ?? 'planner';
    const g = groups.get(key) ?? { aor: event.aors.find((x) => x.id === key) ?? null, shifts: [] };
    g.shifts.push(s);
    groups.set(key, g);
  }
  const alertCount = (shiftId: string) => event.alerts.filter((al) => al.assignment?.shiftId === shiftId).length;

  return (
    <main>
      <p className="crumbs no-print"><Link href={base}>{event.name}</Link> <span>Coverage board</span> <AutoRefresh /></p>
      <h1>Board: {event.name}</h1>
      <p className="crumbs">
        <span>Day:</span>
        {event.days.map((d) => <Link key={d.id} href={`${base}/board?day=${ymd(d.date)}`} aria-current={ymd(d.date) === dayKey ? 'page' : undefined}>{ymd(d.date) === dayKey ? <strong>{fmtDay(d.date, 'UTC')}</strong> : fmtDay(d.date, 'UTC')}</Link>)}
        <span>{fmtTime(t, tz)} {tz}</span>
        <Link href={`${base}/messages`}>Message people</Link>
        <Link href={`${base}/roster?day=${dayKey ?? ''}`}>Print roster</Link>
      </p>

      <h2>Alerts ({event.alerts.length})</h2>
      {event.alerts.length === 0 && <p>Nothing open.</p>}
      {event.alerts.map((al) => (
        <article key={al.id} className="alert pair" data-severity={al.severity >= 3 ? 'high' : 'normal'}>
          <span className="grow">
            <strong>{al.kind === 'no_show' ? 'Not checked in' : `Help: ${al.category}`}</strong> · {al.person.name}{al.assignment && ` · ${al.assignment.shift.position.name}`}
            {al.aor && ` · ${al.aor.name}`} · since {fmtTime(al.openedAt, tz)} · {['with the lead', 'with the deputy', 'with you'][al.step]}
            {al.note && <> · “{al.note}”</>}
          </span>
          {al.assignment && al.kind === 'no_show' && (
            <ActionForm action={bind(plannerCheck)}>
              <input type="hidden" name="id" value={al.assignment.id} /><input type="hidden" name="action" value="in" /><input type="hidden" name="day" value={dayKey ?? ''} />
              <button type="submit">Check in</button>
            </ActionForm>
          )}
          <ActionForm action={bind(resolveAlert)}>
            <input type="hidden" name="id" value={al.id} /><input type="hidden" name="day" value={dayKey ?? ''} />
            <input name="resolution" placeholder="How it was resolved" maxLength={200} />
            <button type="submit">Resolve</button>
          </ActionForm>
        </article>
      ))}

      <h2>Coverage{day ? `: ${fmtDay(day.date, 'UTC')}` : ''}</h2>
      {!day && <p>No day matches. Pick one above.</p>}
      {[...groups.values()].map(({ aor, shifts: gs }) => (
        <section key={aor?.id ?? 'planner'} className="stripe" style={stripe(aor?.color)}>
          <h3>{aor ? `${aor.name} · lead ${aor.lead?.name ?? 'unset'}${aor.deputy ? `, deputy ${aor.deputy.name}` : ''}${aor.radioChannel ? ` · radio ${aor.radioChannel}` : ''}` : 'Ungrouped (planner)'}</h3>
          <table>
            <thead><tr><th>Area · position</th><th>Call</th><th>Shift</th><th>Here</th><th>Confirmed</th><th>Needed</th><th>Overdue</th><th>Alerts</th><th></th></tr></thead>
            <tbody>
              {gs.map((s) => {
                const here = s.assignments.filter((a) => a.checkedInAt && !a.checkedOutAt).length;
                const confirmed = s.assignments.filter((a) => a.status === 'confirmed').length;
                const live = s.callAt.getTime() - EARLY_MS <= t.getTime() && t.getTime() <= s.endAt.getTime() + 3_600_000;
                const started = s.callAt <= t;
                const measure = started ? here : confirmed; // before call time the plan is the measure; after it, who is here
                const tone = measure >= s.needed ? 'green' : measure >= s.position.minHeadcount ? 'amber' : 'red';
                const overdue = s.assignments.filter((a) => isOverdue(full(s, a), t));
                const alerts = alertCount(s.id);
                return (
                  <tr key={s.id} className={live ? 'live' : undefined}>
                    <td>{s.position.area.name} · {s.position.name}{s.position.isFloat && ' (float)'}</td>
                    <td>{fmtTime(s.callAt, tz)}</td>
                    <td>{fmtTime(s.startAt, tz)} to {fmtTime(s.endAt, tz)}</td>
                    <td className="cov" data-tone={tone}>{here}</td>
                    <td>{confirmed}</td>
                    <td>{s.needed} (min {s.position.minHeadcount})</td>
                    <td>{overdue.length > 0 && <span className="badge">{overdue.length}</span>}</td>
                    <td>{alerts > 0 && <span className="badge">{alerts}</span>}</td>
                    <td>
                      <details>
                        <summary>People</summary>
                        <ul className="plain">
                          {s.assignments.map((a) => {
                            const f = full(s, a);
                            return (
                              <li key={a.id} className="row">
                                <span className="grow">
                                  {a.person.name} · <span className="pill" data-status={a.status}>{a.status}</span>
                                  {a.checkedInAt && <> · here {fmtTime(a.checkedInAt, tz)}{a.checkInMethod && ` (${a.checkInMethod})`}</>}
                                  {a.checkedOutAt && <> · out {fmtTime(a.checkedOutAt, tz)}{a.checkOutMethod === 'auto' && ' (auto-closed, ask the lead)'}</>}
                                  {isOverdue(f, t) && <> · <span className="pill" data-status="overdue">overdue since {fmtTime(dueAt(f), tz)}</span></>}
                                </span>
                                {!a.checkedOutAt && (
                                  <ActionForm action={bind(plannerCheck)}>
                                    <input type="hidden" name="id" value={a.id} /><input type="hidden" name="action" value={a.checkedInAt ? 'out' : 'in'} /><input type="hidden" name="day" value={dayKey ?? ''} />
                                    <button type="submit" aria-label={`${a.checkedInAt ? 'Check out' : 'Check in'} ${a.person.name}`}>{a.checkedInAt ? 'Out' : 'In'}</button>
                                  </ActionForm>
                                )}
                              </li>
                            );
                          })}
                          {s.assignments.length === 0 && <li>Nobody on this shift.</li>}
                        </ul>
                        {tone === 'red' && started && !s.position.isFloat && floats.filter((f) => f.shiftId !== s.id).length > 0 && (
                          <ActionForm action={bind(deployFloat)}>
                            <input type="hidden" name="shiftId" value={s.id} /><input type="hidden" name="day" value={dayKey ?? ''} />
                            <label>Deploy float <select name="id">{floats.filter((f) => f.shiftId !== s.id).map((f) => <option key={f.id} value={f.id}>{f.person.name} ({f.shift.position.name})</option>)}</select></label>
                            <button type="submit">Send them</button>
                          </ActionForm>
                        )}
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
