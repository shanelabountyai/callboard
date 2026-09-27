import { db } from '@/core/db';

// The position card library (PRD 6). A card is a key with a line of versions; "the card" is its latest.
export const slug = (title: string) => title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
export const cardLines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

/** The latest version of every card in the org, by title. */
export async function latestCards(orgId: string) {
  const all = await db.positionCard.findMany({ where: { orgId }, orderBy: [{ key: 'asc' }, { version: 'desc' }] });
  return all.filter((c, i) => all[i - 1]?.key !== c.key).sort((a, b) => a.title.localeCompare(b.title));
}
