import Link from 'next/link';
import { notFound } from 'next/navigation';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { aor as stripe } from '@/lib/colors';
import { buildReport } from '@/lib/report';
import { fmtDay, fmtTime } from '@/lib/time';

export const metadata = { title: 'Report' };

const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : 'none');
const KIND = { no_show: 'No-show', help: 'Help request' };

// The post-event report (PRD 6): four numbers first, the detail folded under them. Read from check-in,
// alerts, help and reviews, and only from shifts that have ended.
export default async function Report({ params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org);
  const { id } = await params;
  const event = await db.event.findFirst({ where: { id, ...inOrg(ctx), isTemplate: false } });
  if (!event) notFound();
  const r = await buildReport({ orgId: ctx.orgId, eventId: event.id });
  const tz = event.timezone;
  const base = `/o/${ctx.slug}/events/${event.id}`;
  const open = r.reviews.areas - r.reviews.reviewed - r.reviews.waived;
  const short = r.areas.flatMap((a) => a.hours.filter((h) => h.actual < h.min).map((h) => ({ area: a.name, ...h })));
  // A review saved before the short form has three answers; one saved since has the note alone.
  const said = r.areas.flatMap((a) => {
    const v = a.review && !a.review.waived ? a.review : null;
    const text = v ? [v.understaffed && `Short: ${v.understaffed}`, v.overstaffed && `Too many: ${v.overstaffed}`, v.wentWrong].filter(Boolean).join(' · ') : '';
    return text ? [{ id: a.id, area: a.name, by: v!.by, text }] : [];
  });

  return (
    <main>
      <p className="crumbs"><Link href={base}>{event.name}</Link> <Link href={`${base}/review`}>Review</Link> <span>Report</span></p>
      <h1>Report: {event.name}</h1>
      {event.status !== 'closed' && <p data-tone="amber">The event is not closed yet, so this is the picture so far. Only shifts that have ended are counted.</p>}
      {event.status === 'closed' && open > 0 && <p data-tone="amber">Provisional: {open} of {r.reviews.areas} areas have no review yet. <Link href={`${base}/review`}>Finish or waive them</Link>.</p>}
      <table>
        <thead><tr><th>Places filled</th><th>No-shows</th><th>Late</th><th>Help requests</th></tr></thead>
        <tbody>
          <tr>
            <td>{r.shifts} of {r.places}</td>
            <td className="cov" data-tone={r.noShows ? 'red' : 'green'}>{r.noShows}</td>
            <td>{r.late}</td>
            <td>{r.help}</td>
          </tr>
        </tbody>
      </table>
      <p>
        {short.length === 0 ? 'No area fell under its minimum.' : `${short.length} area-hours under minimum.`}
        {' '}Lead reviews: {r.reviews.reviewed} of {r.reviews.areas} done{r.reviews.waived > 0 && `, ${r.reviews.waived} waived`}.
      </p>

      {said.length > 0 && (
        <>
          <h2>What the leads said</h2>
          <ul>{said.map((s) => <li key={s.id}><strong>{s.area}</strong> ({s.by}): {s.text}</li>)}</ul>
        </>
      )}

      <details>
        <summary>Coverage by hour</summary>
        <p>Each hour is read at its middle: 8 AM is who was checked in at 8:30. Red is under the minimum, amber under plan.</p>
        {short.length === 0 && r.areas.every((a) => a.hours.length === 0) && <p>No shift on this event has ended yet.</p>}
        {r.areas.filter((a) => a.hours.length).map((a) => (
          <section key={a.id} className="stripe" style={stripe(a.aor?.color)}>
            <h3>{a.name}{a.aor && <small> · {a.aor.name}</small>}</h3>
            <table>
              <thead><tr><th>Hour</th><th>Minimum</th><th>Planned</th><th>Checked in</th></tr></thead>
              <tbody>
                {a.hours.map((h) => (
                  <tr key={h.at.getTime()}>
                    <td>{fmtDay(h.at, tz)}, {fmtTime(h.at, tz)}</td><td>{h.min}</td><td>{h.planned}</td>
                    <td className="cov" data-tone={h.actual < h.min ? 'red' : h.actual < h.planned ? 'amber' : 'green'}>{h.actual}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </details>

      <details>
        <summary>No-shows by group</summary>
        <table>
          <thead><tr><th>Group</th><th>Places filled</th><th>No-shows</th><th>Rate</th></tr></thead>
          <tbody>
            {[...r.byPool, ...r.byTier].map((g) => <tr key={g.group}><td>{g.group}</td><td>{g.people}</td><td>{g.noShows}</td><td>{pct(g.noShows, g.people)}</td></tr>)}
          </tbody>
        </table>
        <p><small>Reliability is each person&rsquo;s standing today, which already counts this event.</small></p>
      </details>

      <details>
        <summary>Help requests by kind and role</summary>
        {r.helpByCategory.length === 0 ? <p>None.</p> : (
          <>
            {([['By kind', r.helpByCategory], ['By role', r.helpByPosition]] as const).map(([label, rows]) => (
              <table key={label}>
                <thead><tr><th>{label}</th><th>Requests</th></tr></thead>
                <tbody>{rows.map(([k, n]) => <tr key={k}><td>{k}</td><td>{n}</td></tr>)}</tbody>
              </table>
            ))}
          </>
        )}
      </details>

      <details>
        <summary>How fast alerts were handled</summary>
        <table>
          <thead><tr><th>Kind</th><th>Raised</th><th>Reached the planner</th><th>Median to resolve</th><th>Slowest</th><th>Still open</th></tr></thead>
          <tbody>
            {r.resolve.map((k) => (
              <tr key={k.kind}>
                <td>{KIND[k.kind]}</td><td>{k.raised}</td><td>{k.reachedPlanner}</td>
                <td>{k.median === null ? 'n/a' : `${k.median} min`}</td><td>{k.slowest === null ? 'n/a' : `${k.slowest} min`}</td>
                <td className="cov" data-tone={k.open ? 'red' : 'green'}>{k.open}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </main>
  );
}
