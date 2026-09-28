import Link from 'next/link';
import { notFound } from 'next/navigation';
import qrcode from 'qrcode-generator';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ensurePersonLink } from '@/lib/links';
import { linkExpiry } from '@/lib/staffing';
import { fmtDay, fmtTime, isYmd, ymd } from '@/lib/time';

export const metadata = { title: 'Printable roster' };

// The last resort when phones die (PRD 5): one sheet per AoR with a QR to the lead's roster and
// In / Out columns to tick by hand and key in later. Print from the browser; the page breaks per AoR.
export default async function Roster({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<{ day?: string }> }) {
  const ctx = await requireOrg((await params).org);
  const { id } = await params;
  const q = await searchParams;
  const event = await db.event.findFirst({
    where: { id, ...inOrg(ctx) },
    include: {
      days: { orderBy: { date: 'asc' } },
      aors: { include: { lead: true, deputy: true }, orderBy: { name: 'asc' } },
      areas: { orderBy: { name: 'asc' }, include: { positions: { orderBy: { name: 'asc' }, include: { shifts: { orderBy: { startAt: 'asc' }, include: { day: true, assignments: { where: { status: 'confirmed' }, include: { person: true }, orderBy: { person: { name: 'asc' } } } } } } } } },
    },
  });
  if (!event) notFound();
  const tz = event.timezone;
  const day = (q.day && isYmd(q.day) ? event.days.find((d) => ymd(d.date) === q.day) : undefined) ?? event.days[0];
  const lastDay = event.days.at(-1)?.date ?? new Date();
  const qr = async (personId: string | null | undefined) => {
    if (!personId) return null;
    const url = await ensurePersonLink(db, { orgId: ctx.orgId, eventId: event.id, personId }, linkExpiry(lastDay));
    const code = qrcode(0, 'M');
    code.addData(url);
    code.make();
    return code.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
  };
  const groups = [...event.aors.map((a) => ({ aor: a, areas: event.areas.filter((x) => x.aorId === a.id) })), { aor: null, areas: event.areas.filter((x) => !x.aorId) }].filter((g) => g.areas.length);
  const base = `/o/${ctx.slug}/events/${event.id}`;

  return (
    <main>
      <p className="crumbs no-print">
        <Link href={base}>{event.name}</Link> <span>Roster</span> <span>Day:</span>
        {event.days.map((d) => <Link key={d.id} href={`${base}/roster?day=${ymd(d.date)}`} aria-current={d.id === day?.id ? 'page' : undefined}>{d.id === day?.id ? <strong>{fmtDay(d.date, 'UTC')}</strong> : fmtDay(d.date, 'UTC')}</Link>)}
        <span>Use your browser’s Print.</span>
      </p>
      {await Promise.all(groups.map(async ({ aor, areas }) => (
        <section key={aor?.id ?? 'planner'} className="sheet card">
          <div className="head">
            <div>
              <h1>{event.name}{day && ` · ${fmtDay(day.date, 'UTC')}`}</h1>
              <h2>{aor?.name ?? 'Ungrouped (planner)'}{aor?.radioChannel && ` · radio ${aor.radioChannel}`}</h2>
              {aor && <p>Lead: {aor.lead ? `${aor.lead.name} ${aor.lead.mobile}` : 'unset'} · Deputy: {aor.deputy ? `${aor.deputy.name} ${aor.deputy.mobile}` : 'none'}</p>}
              {event.emergencyContact && <p>Emergency: {event.emergencyContact}</p>}
            </div>
            {aor?.lead && <div className="qr" dangerouslySetInnerHTML={{ __html: (await qr(aor.leadId))! }} title="Opens the lead's roster" />}
          </div>
          {areas.map((area) => (
            <div key={area.id}>
              <h3>{area.name}{area.location && ` · ${area.location}`}</h3>
              {area.positions.flatMap((pos) => pos.shifts.filter((s) => !day || s.dayId === day.id).map((s) => (
                <table key={s.id}>
                  <caption>{pos.name} · call {fmtTime(s.callAt, tz)} · {fmtTime(s.startAt, tz)} to {fmtTime(s.endAt, tz)} · {s.assignments.length} of {s.needed}</caption>
                  <thead>
                    <tr><th>Name</th><th>Mobile</th><th className="tick">In</th><th className="tick">Out</th></tr>
                  </thead>
                  <tbody>
                    {s.assignments.map((a) => (
                      <tr key={a.id}>
                        <td>{a.person.name}</td><td>{a.person.mobile}</td>
                        <td className="tick" /><td className="tick" />
                      </tr>
                    ))}
                    {Array.from({ length: Math.max(0, s.needed - s.assignments.length) + 1 }).map((_, i) => (
                      <tr key={`blank-${i}`}><td /><td /><td className="tick" /><td className="tick" /></tr>
                    ))}
                  </tbody>
                </table>
              )))}
            </div>
          ))}
        </section>
      )))}
    </main>
  );
}
