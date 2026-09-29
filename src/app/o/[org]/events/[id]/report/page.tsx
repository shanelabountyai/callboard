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

// The post-event report (PRD 6): planned against actual, read from check-in, alerts, help and reviews.
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

  return (
    <main>
      <p className="crumbs"><Link href={base}>{event.name}</Link> <Link href={`${base}/review`}>Review</Link> <span>Report</span></p>
      <h1>Report: {event.name}</h1>
      {event.status !== 'closed' && <p data-tone="amber">The event is not closed yet, so this is the picture so far. It is final once the event is closed and every area is reviewed or waived.</p>}
      {event.status === 'closed' && open > 0 && <p data-tone="amber">Provisional: {open} of {r.reviews.areas} areas have no review yet, so what happened still comes from check-in alone there. <Link href={`${base}/review`}>Finish or waive them</Link>.</p>}
      <p>
        {r.shifts} confirmed shifts, {r.noShows} no-shows ({pct(r.noShows, r.shifts)}). {short.length === 0 ? 'No area fell under its minimum.' : `${short.length} area-hours under minimum.`}
        {' '}Lead reviews: {r.reviews.reviewed} of {r.reviews.areas} done{r.reviews.waived > 0 && `, ${r.reviews.waived} waived`}.
      </p>

      <h2>Coverage by hour</h2>
      <p>Each hour is read at its middle: 8 AM is who was checked in at 8:30. Red is under the minimum, amber under plan.</p>
      {r.areas.length === 0 && <p>No shifts on this event.</p>}
      {r.areas.map((a) => (
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
          {a.review && !a.review.waived && <p><strong>The lead said.</strong> Short: {a.review.understaffed}. Too many: {a.review.overstaffed}. Went wrong: {a.review.wentWrong}.</p>}
        </section>
      ))}

      <h2>No-shows</h2>
      <table>
        <thead><tr><th>Group</th><th>Confirmed shifts</th><th>No-shows</th><th>Rate</th></tr></thead>
        <tbody>
          {[...r.byPool, ...r.byTier].map((g) => <tr key={g.group}><td>{g.group}</td><td>{g.people}</td><td>{g.noShows}</td><td>{pct(g.noShows, g.people)}</td></tr>)}
        </tbody>
      </table>
      <p><small>The tier is each person&rsquo;s tier today, which already counts this event.</small></p>

      <h2>Help requests</h2>
      {r.helpByCategory.length === 0 ? <p>None.</p> : (
        <>
          {([['By category', r.helpByCategory], ['By position', r.helpByPosition]] as const).map(([label, rows]) => (
            <table key={label}>
              <thead><tr><th>{label}</th><th>Requests</th></tr></thead>
              <tbody>{rows.map(([k, n]) => <tr key={k}><td>{k}</td><td>{n}</td></tr>)}</tbody>
            </table>
          ))}
        </>
      )}

      <h2>Alerts, by time to resolve</h2>
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

      <h2>Equipment</h2>
      <p>Not tracked yet: Callboard does not check equipment out to people, so there is nothing to list as unreturned. The close checklist in each area&rsquo;s playbook is where returns are asked for today.</p>
    </main>
  );
}
