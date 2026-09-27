import type { PositionCard } from '@/generated/prisma/client';
import { cardLines } from './cards';

type Shown = Pick<PositionCard, 'purpose' | 'duties' | 'situations' | 'never' | 'demands'>;
const SECTIONS: [keyof Shown, string][] = [['duties', 'What you do'], ['situations', 'What to do if'], ['never', 'Never'], ['demands', 'Skills and physical demands']];

/** The card as the person reads it. Where, when, what to wear and who to ask are slots the page fills around it. */
export function CardView({ card }: { card: Shown }) {
  return (
    <>
      {card.purpose && <p><strong>{card.purpose}</strong></p>}
      {SECTIONS.filter(([k]) => cardLines(card[k]).length > 0).map(([k, label]) => (
        <div key={k}>
          <h3>{label}</h3>
          <ul>{cardLines(card[k]).map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      ))}
    </>
  );
}
