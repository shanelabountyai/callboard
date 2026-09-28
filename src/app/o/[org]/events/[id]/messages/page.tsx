import Link from 'next/link';
import { notFound } from 'next/navigation';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { resolveAudience } from '@/lib/broadcast';
import { MAX_ATTEMPTS } from '@/modules/notifications/outbox';
import { fmtDay, fmtTime, fmtWhen } from '@/lib/time';
import { resend, send } from './actions';
import { Compose } from './compose';

export const metadata = { title: 'Messages' };

// Message an audience (PRD 4): the picker shows the recipient count on every option before sending,
// and each past message shows acked / sent / failed per person, with one button for the non-ackers.
export default async function Messages({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<{ sent?: string; resent?: string }> }) {
  const { org, id } = await params;
  const q = await searchParams;
  const ctx = await requireOrg(org);
  const event = await db.event.findFirst({
    where: { id, ...inOrg(ctx) },
    include: {
      aors: { orderBy: { name: 'asc' } },
      areas: { orderBy: { name: 'asc' } },
      shifts: { include: { position: { include: { area: true } }, day: true }, orderBy: { startAt: 'asc' } },
      broadcasts: { orderBy: { createdAt: 'desc' }, take: 20, include: { recipients: { include: { person: true }, orderBy: { person: { name: 'asc' } } } } },
    },
  });
  if (!event) notFound();
  const tz = event.timezone;
  const people = await db.person.findMany({ where: { ...inOrg(ctx), assignments: { some: { eventId: id, status: { in: ['invited', 'confirmed'] } } } }, orderBy: { name: 'asc' } });
  const count = async (aud: string) => (await resolveAudience(ctx.orgId, id, aud).catch(() => ({ people: [] }))).people.length;
  const options: [string, string, number][] = [];
  for (const [aud, label] of [['event', 'Whole event'], ['unconfirmed', 'Still unconfirmed'], ['unchecked', 'Not checked in (shift now or in 3 hours)'], ['float', 'Float pool']] as const) options.push([aud, label, await count(aud)]);
  for (const a of event.aors) options.push([`aor:${a.id}`, `AoR: ${a.name}`, await count(`aor:${a.id}`)]);
  for (const a of event.areas) options.push([`area:${a.id}`, `Area: ${a.name}`, await count(`area:${a.id}`)]);
  for (const s of event.shifts) options.push([`shift:${s.id}`, `Shift: ${s.position.area.name} · ${s.position.name}, ${fmtDay(s.day.date, 'UTC')} ${fmtTime(s.startAt, tz)}`, await count(`shift:${s.id}`)]);
  for (const p of people) options.push([`person:${p.id}`, `Person: ${p.name}`, 1]);
  const outboxIds = event.broadcasts.flatMap((b) => b.recipients.map((r) => r.outboxId)).filter((x): x is string => !!x);
  const outbox = new Map((await db.outbox.findMany({ where: { id: { in: outboxIds } }, select: { id: true, sentAt: true, attempts: true, lastError: true } })).map((o) => [o.id, o]));
  const status = (r: (typeof event.broadcasts)[number]['recipients'][number]) => {
    if (r.ackedAt) return `acked ${fmtTime(r.ackedAt, tz)}`;
    if (r.person.smsOptOut) return 'no SMS (opted out)';
    const o = r.outboxId ? outbox.get(r.outboxId) : undefined;
    if (!o) return 'sent';
    if (o.sentAt) return 'delivered to carrier';
    return o.attempts >= MAX_ATTEMPTS ? `failed: ${o.lastError ?? 'unknown'}` : o.attempts ? (o.lastError ? `retrying (${o.lastError})` : 'sending') : 'queued';
  };
  const bind = <A extends unknown[], R>(fn: (slug: string, ...a: A) => R) => fn.bind(null, ctx.slug);
  const base = `/o/${ctx.slug}/events/${event.id}`;

  return (
    <main>
      <p className="crumbs"><Link href={base}>{event.name}</Link> <span>Messages</span> <Link href={`${base}/board`}>Board</Link></p>
      <h1>Message people: {event.name}</h1>
      {q.sent && <p role="status">Sent to {q.sent} {q.sent === '1' ? 'person' : 'people'}.</p>}
      {q.resent && <p role="status">Re-sent to {q.resent} who had not answered.</p>}
      <ActionForm action={bind(send)}>
        <input type="hidden" name="eventId" value={event.id} />
        <label>To <select name="audience" required>{options.map(([v, l, n]) => <option key={v} value={v} disabled={n === 0}>{l} ({n})</option>)}</select></label>
        <Compose />
        <p><label><input type="checkbox" name="requiresAck" /> Ask for a one-tap “Got it”</label></p>
        <button type="submit" className="primary">Send</button>
      </ActionForm>

      <h2>Sent</h2>
      {event.broadcasts.length === 0 && <p>Nothing sent yet.</p>}
      {event.broadcasts.map((b) => {
        const acked = b.recipients.filter((r) => r.ackedAt).length;
        return (
          <article key={b.id}>
            <p><strong>{fmtWhen(b.createdAt, tz)}</strong> · to {b.audience} ({b.recipients.length}){b.requiresAck && ` · ${acked} of ${b.recipients.length} got it`}</p>
            <p className="pre">{b.body}</p>
            <details>
              <summary>Per person</summary>
              <ul className="plain">{b.recipients.map((r) => { const st = status(r); return <li key={r.id} className="row">{r.person.name} · <span className="pill" data-status={st.split(/[ :]/)[0]}>{st}</span></li>; })}</ul>
            </details>
            {b.requiresAck && acked < b.recipients.length && (
              <ActionForm action={bind(resend)}>
                <input type="hidden" name="id" value={b.id} />
                <button type="submit">Re-send to the {b.recipients.length - acked} who have not answered</button>
              </ActionForm>
            )}
          </article>
        );
      })}
    </main>
  );
}
