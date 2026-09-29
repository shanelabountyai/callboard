import Link from 'next/link';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { RuleFields } from '@/lib/rule-fields';
import { deviations, standardOf } from '@/lib/rules';
import { saveStandard } from './actions';

export const metadata = { title: 'Standard rules' };

// The org's standard (PRD 6) and every event that says otherwise.
export default async function Rules({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const standard = await standardOf(ctx.orgId, db);
  const events = await db.event.findMany({ where: inOrg(ctx), orderBy: { createdAt: 'desc' } });
  const off = events.map((e) => ({ e, rules: deviations(e, standard) })).filter((x) => x.rules.length);

  return (
    <main>
      <h1>Standard rules</h1>
      <p>How this organisation runs an event. A new event starts on these, an event still being planned follows a change made here, and a live or closed event keeps the rules it ran with. Any event can set its own on its page.</p>
      <ActionForm action={saveStandard.bind(null, ctx.slug)}>
        <RuleFields values={standard} />
        <button type="submit">Save the standard</button>
      </ActionForm>

      <h2>Events that deviate</h2>
      {off.length === 0 ? <p>None. Every event is on the standard.</p> : (
        <table>
          <thead><tr><th>Event</th><th>Status</th><th>Differs on</th></tr></thead>
          <tbody>
            {off.map(({ e, rules }) => (
              <tr key={e.id}>
                <td><Link href={`/o/${ctx.slug}/events/${e.id}`}>{e.name}</Link></td>
                <td>{e.isTemplate ? 'template' : e.status}</td>
                <td>{rules.map((r) => r.label).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
