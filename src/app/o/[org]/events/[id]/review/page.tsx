import Link from 'next/link';
import { notFound } from 'next/navigation';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { aor as stripe } from '@/lib/colors';
import { REVIEW_ASK_MS, REVIEW_DUE_MS, reviewSheet } from '@/lib/review';
import { ReviewFields } from '@/lib/review-fields';
import { fmtWhen } from '@/lib/time';
import { saveAreaReview, waiveAreaReview } from './actions';

export const metadata = { title: 'Review' };

// After the event (PRD 6): who has reviewed, what is still open, and the planner's way to finish or waive it.
export default async function Review({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  const ctx = await requireOrg(org);
  const event = await db.event.findFirst({ where: { id, ...inOrg(ctx) } });
  if (!event) notFound();
  const areas = await reviewSheet({ orgId: ctx.orgId, eventId: event.id });
  const bind = <A extends unknown[], R>(fn: (slug: string, ...a: A) => R) => fn.bind(null, ctx.slug);
  const tz = event.timezone;
  const closed = event.status === 'closed' && event.closedAt;
  const age = closed ? now().getTime() - event.closedAt!.getTime() : 0;
  const open = areas.filter((a) => !a.review);
  const groups = [...new Set(areas.map((a) => a.aor?.name ?? 'Ungrouped (planner)'))].sort();
  const people = (list: typeof areas) => list.flatMap((a) => a.positions.flatMap((p) => p.shifts.flatMap((s) => s.assignments)));

  return (
    <main>
      <p className="crumbs"><Link href={`/o/${ctx.slug}/events/${event.id}`}>{event.name}</Link> <span>Review</span></p>
      <h1>Review: {event.name}</h1>
      {!closed ? (
        <p>The review opens when the event is closed. Closing it texts each lead their review link; what happened is pre-filled from check-in.</p>
      ) : (
        <>
          <p data-tone={open.length === 0 ? 'green' : age > REVIEW_DUE_MS ? 'red' : 'amber'}>
            Closed {fmtWhen(event.closedAt!, tz)}. {open.length === 0
              ? 'Every area is reviewed or waived.'
              : `${open.length} of ${areas.length} areas still open${age > REVIEW_ASK_MS ? ', more than a week on: finish them from the check-in data or waive them' : age > REVIEW_DUE_MS ? ', past the 72 hours leads were given' : ''}.`}
          </p>
          <table>
            <thead><tr><th>Area of responsibility</th><th>Areas reviewed</th><th>People reviewed</th></tr></thead>
            <tbody>
              {groups.map((g) => {
                const mine = areas.filter((a) => (a.aor?.name ?? 'Ungrouped (planner)') === g);
                const done = mine.filter((a) => a.review).length;
                return (
                  <tr key={g}>
                    <td>{g}</td>
                    <td className="cov" data-tone={done === mine.length ? 'green' : 'red'}>{done} of {mine.length}</td>
                    <td>{people(mine).filter((x) => x.review).length} of {people(mine).length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p><Link href={`/o/${ctx.slug}/events/${event.id}/report`}>The post-event report</Link> is built from check-in, alerts and these reviews.</p>

          {areas.map((area) => (
            <section key={area.id} className="stripe" style={stripe(area.aor?.color)}>
              <h2>{area.name} <small>{area.aor ? `${area.aor.name}` : 'ungrouped'}</small></h2>
              <p>
                {!area.review ? <span className="pill" data-status="overdue">open</span>
                  : area.review.waived ? <>Waived by {area.review.by}, {fmtWhen(area.review.at, tz)}: “{area.review.waiveNote}”</>
                  : <>Reviewed by {area.review.by}, {fmtWhen(area.review.at, tz)}.</>}
              </p>
              <details open={!area.review}>
                <summary>{area.review ? 'See or change the review' : 'Finish this review'}</summary>
                <ActionForm action={bind(saveAreaReview)}>
                  <ReviewFields area={area} event={event} />
                  <button type="submit" className="primary">Save review for {area.name}</button>
                </ActionForm>
              </details>
              {!area.review && (
                <details>
                  <summary>Waive the review for {area.name}</summary>
                  <ActionForm action={bind(waiveAreaReview)}>
                    <input type="hidden" name="areaId" value={area.id} />
                    <label>Why <input name="note" required maxLength={500} placeholder="Lead left the company; nothing unusual on the board" /></label>
                    <button type="submit">Waive</button>
                  </ActionForm>
                </details>
              )}
            </section>
          ))}
        </>
      )}
    </main>
  );
}
