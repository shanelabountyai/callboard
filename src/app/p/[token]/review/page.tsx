import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { db } from '@/core/db';
import { clientIp } from '@/core/http';
import { aor as stripe } from '@/lib/colors';
import { readPersonLink } from '@/lib/links';
import { reviewSheet } from '@/lib/review';
import { ReviewFields } from '@/lib/review-fields';
import { firstName } from '@/lib/staffing';
import { fmtWhen } from '@/lib/time';

// The lead's three-minute review (PRD 6): one form per area they own, what happened already filled in from check-in.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Review your crew', robots: { index: false, follow: false } };

export default async function LeadReview({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string; error?: string }> }) {
  const { token } = await params;
  const { done, error } = await searchParams;
  const link = await readPersonLink(token, clientIp(await headers()));
  if (link === 'limited') return <main className="floor"><h1>Too many requests</h1><p>Wait a few minutes and try again.</p></main>;
  if (!link) notFound();
  const { person, event, orgId } = link;
  const scope = { orgId, eventId: event.id };
  const aors = await db.aor.findMany({ where: { ...scope, OR: [{ leadId: person.id }, { deputyId: person.id }] }, select: { id: true } });
  if (!aors.length) notFound(); // the review is a lead's page; "not yours" reads as "not found"
  const areas = await reviewSheet(scope, aors.map((a) => a.id));
  const left = areas.filter((a) => !a.review).length;

  return (
    <main className="floor">
      <p className="crumbs"><a href={`/p/${token}`}>Back to your page</a></p>
      <h1>Review: {event.name}</h1>
      {done && <p role="status">Saved. {left ? `${left} to go.` : 'That is everything. Thank you.'}</p>}
      {error && <p role="alert">That did not save. Answer all three questions for the area and try again; if it still fails, reload this page first.</p>}
      {event.status !== 'closed' ? (
        <p>Hi {firstName(person.name)}. The review opens when the planner closes the event.</p>
      ) : (
        <>
          <p>Hi {firstName(person.name)}. What happened is filled in from check-in, so change only what is wrong. The three questions per area are the part only you can answer.</p>
          {areas.map((area) => (
            <section key={area.id} className="stripe" style={stripe(area.aor?.color)}>
              <h2>{area.name}</h2>
              {area.review && <p>{area.review.waived ? 'Waived by the planner.' : `Reviewed by ${area.review.by}, ${fmtWhen(area.review.at, event.timezone)}. Saving again replaces it.`}</p>}
              <form method="post" action={`/p/${token}/review/save`}>
                <ReviewFields area={area} event={event} />
                <button type="submit" className="primary">Save {area.name}</button>
              </form>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
