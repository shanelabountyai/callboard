import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import type { PositionCard } from '@/generated/prisma/client';
import { CardView } from '@/lib/card-view';
import { fmtWhen } from '@/lib/time';
import { createCard, saveCard } from './actions';

export const metadata = { title: 'Position cards' };

const LABELS: [keyof PositionCard, string][] = [['title', 'title'], ['purpose', 'purpose'], ['duties', 'what you do'], ['situations', 'what to do if'], ['never', 'never'], ['demands', 'skills and demands'], ['minAge', 'minimum age']];

function Fields({ card }: { card?: PositionCard }) {
  return (
    <>
      <label>Title <input name="title" required maxLength={80} defaultValue={card?.title} placeholder="Registration greeter" /></label>
      <label>Purpose, in one line <input name="purpose" maxLength={200} defaultValue={card?.purpose} placeholder="The first face an attendee sees" /></label>
      <label>What you do (one per line, five at most) <textarea name="duties" rows={5} cols={60} defaultValue={card?.duties} /></label>
      <label>What to do if (one per line, five at most) <textarea name="situations" rows={5} cols={60} defaultValue={card?.situations} placeholder="A VIP is not on the list: radio your lead, never turn them away" /></label>
      <label>What you must never do <textarea name="never" rows={2} cols={60} maxLength={1000} defaultValue={card?.never} /></label>
      <label>Skills and physical demands <textarea name="demands" rows={2} cols={60} maxLength={1000} defaultValue={card?.demands} placeholder="On your feet four hours" /></label>
      <label>Minimum age (blank = none) <input name="minAge" type="number" min={0} max={99} defaultValue={card?.minAge ?? ''} /></label>
    </>
  );
}

// The library (PRD 6): what each job is, written once. What to wear, where to report, the lead and the
// call time are not here: they are filled per event from the position, the area and the shift.
export default async function Cards({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const all = await db.positionCard.findMany({ where: inOrg(ctx), orderBy: [{ key: 'asc' }, { version: 'desc' }], include: { _count: { select: { positions: true } } } });
  const users = await db.user.findMany({ where: { id: { in: [...new Set(all.map((c) => c.changedBy))] } }, select: { id: true, name: true, email: true } });
  const who = (id: string) => { const u = users.find((x) => x.id === id); return u ? u.name || u.email : 'someone no longer here'; };
  const keys = [...new Set(all.map((c) => c.key))].map((k) => all.filter((c) => c.key === k)).sort((a, b) => a[0]!.title.localeCompare(b[0]!.title));
  const bind = <A extends unknown[], R>(fn: (slug: string, ...a: A) => R) => fn.bind(null, ctx.slug);

  return (
    <main>
      <h1>Position cards</h1>
      <p>{keys.length} in the library. A card says what the job is. Uniform, location, lead and call time come from each event, so one card serves every event that uses it.</p>
      {keys.map((versions) => {
        const card = versions[0]!;
        return (
          <section key={card.key} id={card.key} className="card">
            <h2>{card.title} <small>version {card.version}{card.minAge !== null && ` · ${card.minAge} and over`}</small></h2>
            <CardView card={card} />
            <details>
              <summary>Edit {card.title}</summary>
              <p>Saving makes version {card.version + 1}. Events still being planned pick it up; a live or closed event keeps the version it ran with.</p>
              <ActionForm action={bind(saveCard)}>
                <input type="hidden" name="id" value={card.id} />
                <Fields card={card} />
                <button type="submit">Save as version {card.version + 1}</button>
              </ActionForm>
            </details>
            <details>
              <summary>History ({versions.length})</summary>
              <ul className="plain">
                {versions.map((v, i) => {
                  const prev = versions[i + 1];
                  const changed = prev ? LABELS.filter(([k]) => v[k] !== prev[k]).map(([, l]) => l).join(', ') : 'created';
                  return <li key={v.id}>Version {v.version} · {who(v.changedBy)} · {fmtWhen(v.createdAt, 'UTC')} UTC · {changed} · on {v._count.positions} {v._count.positions === 1 ? 'position' : 'positions'}</li>;
                })}
              </ul>
            </details>
          </section>
        );
      })}
      <h2>Add a card</h2>
      <ActionForm action={bind(createCard)}>
        <Fields />
        <button type="submit">Add card</button>
      </ActionForm>
    </main>
  );
}
