// Prints every person's phone link for one event, for a demo on a laptop where no text can arrive.
// Usage: npm run links [-- "Event name"]   (default: Spring Expo). Local databases only (INV-18).
import { db } from '@/core/db';
import { ensurePersonLink } from '@/lib/links';
import { linkExpiry } from '@/lib/staffing';

const name = process.argv[2] ?? 'Spring Expo';
const event = await db.event.findFirst({
  where: { name, isTemplate: false },
  orderBy: { createdAt: 'desc' },
  include: { days: { orderBy: { date: 'desc' }, take: 1 }, aors: { select: { leadId: true, deputyId: true } } },
});
if (!event) throw new Error(`No event named "${name}"`);
const leads = new Set(event.aors.flatMap((a) => [a.leadId, a.deputyId]));
const people = await db.person.findMany({ where: { orgId: event.orgId }, orderBy: { name: 'asc' } });
const expires = linkExpiry(event.days[0]?.date ?? new Date());
for (const p of people) {
  const url = await ensurePersonLink(db, { orgId: event.orgId, eventId: event.id, personId: p.id }, expires);
  console.log(`${p.name.padEnd(14)} ${leads.has(p.id) ? 'lead ' : '     '} ${url}`);
}
await db.$disconnect();
