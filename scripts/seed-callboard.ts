import { pathToFileURL } from 'node:url';
import { db } from '@/core/db'; // refuses a cloud database (INV-18)
import { zonedToUtc } from '@/lib/time';

// Demo staffing data for the Acme org: a two-day expo with two AoRs, a directory of employees
// and volunteers, and a half-staffed plan. Idempotent: skips if the event exists. Known demo
// numbers are fine because the seed cannot reach production.
const TZ = 'America/Chicago';
const PEOPLE: [string, string, 'employee' | 'volunteer', string][] = [
  ['Marcus Bell', '+15550100001', 'employee', 'Sales'],
  ['Priya Nair', '+15550100002', 'employee', 'Events'],
  ['Jen Park', '+15550100003', 'employee', 'Finance'],
  ['Omar Haddad', '+15550100004', 'employee', 'Marketing'],
  ['Sofia Reyes', '+15550100005', 'employee', 'Operations'],
  ['Tom Alvarez', '+15550100006', 'volunteer', ''],
  ['Ana Lima', '+15550100007', 'volunteer', ''],
  ['Ben Okafor', '+15550100008', 'volunteer', ''],
  ['Chloe Zhang', '+15550100009', 'volunteer', ''],
  ['Dev Patel', '+15550100010', 'volunteer', ''],
  ['Elena Rossi', '+15550100011', 'volunteer', ''],
  ['Finn Murphy', '+15550100012', 'volunteer', ''],
];

export async function seedCallboard(slug = 'acme') {
  const org = await db.org.findUnique({ where: { slug } });
  if (!org) throw new Error(`Org "${slug}" not found: run seed:demo first`);
  const orgId = org.id;
  const people = new Map<string, string>();
  for (const [name, mobile, kind, department] of PEOPLE) {
    const p = await db.person.upsert({
      where: { orgId_mobile: { orgId, mobile } },
      create: { orgId, name, mobile, kind, department, email: kind === 'employee' ? `${name.split(' ')[0]!.toLowerCase()}@acme.demo.test` : null },
      update: { name, kind, department },
    });
    people.set(name, p.id);
  }
  if (await db.event.findFirst({ where: { orgId, name: 'Spring Expo' } })) return 'Spring Expo already seeded';

  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 21);
  start.setUTCHours(0, 0, 0, 0);
  const dates = [start, new Date(start.getTime() + 86_400_000)];
  const event = await db.event.create({
    data: { orgId, name: 'Spring Expo', venue: 'Lakeside Convention Center', timezone: TZ, status: 'staffing', emergencyContact: 'Venue security 555-0100, radio 1', days: { create: dates.map((date) => ({ orgId, date })) } },
    include: { days: true },
  });
  const foh = await db.aor.create({ data: { orgId, eventId: event.id, name: 'Front of house', color: '#2563eb', radioChannel: '2', leadId: people.get('Marcus Bell'), deputyId: people.get('Priya Nair') } });
  const floor = await db.aor.create({ data: { orgId, eventId: event.id, name: 'Exhibit floor', color: '#16a34a', radioChannel: '3', leadId: people.get('Sofia Reyes') } });
  const plan = [
    { area: 'Registration', location: 'North Lobby', aor: foh.id, positions: [
      { name: 'Greeter', min: 2, target: 3, uniform: 'Black polo, name badge', brief: 'Welcome attendees, point them to the right badge line. If a VIP is not on the list, radio channel 2 for Marcus. Never leave the post without a swap.' },
      { name: 'Badge printer', min: 1, target: 2, uniform: 'Black polo', brief: 'Print and hand over badges. Printer 2 jams above 40 an hour: slow the line rather than force it.' },
    ] },
    { area: 'Info Desk', location: 'Hall B entrance', aor: foh.id, positions: [{ name: 'Info', min: 1, target: 2, uniform: 'Black polo', brief: 'Answer where-is questions. Lost child or medical: call venue security on 555-0100, then radio 2.' }] },
    { area: 'Exhibit Hall', location: 'Hall A', aor: floor.id, positions: [
      { name: 'Floor runner', min: 2, target: 3, uniform: 'Green vest over your own clothes', brief: 'Walk the aisles, help exhibitors with power and supplies, report anything blocking an aisle.' },
      { name: 'Floater', min: 0, target: 2, uniform: 'Green vest', brief: 'Wait at the ops desk; the planner will send you where a position is short.', isFloat: true, grace: 20 },
    ] },
  ];
  const shiftIds: string[] = [];
  for (const a of plan) {
    const area = await db.area.create({ data: { orgId, eventId: event.id, name: a.area, location: a.location, aorId: a.aor } });
    for (const p of a.positions) {
      const pos = await db.position.create({ data: { orgId, eventId: event.id, areaId: area.id, name: p.name, minHeadcount: p.min, targetHeadcount: p.target, uniform: p.uniform, brief: p.brief, isFloat: 'isFloat' in p && p.isFloat, graceMin: 'grace' in p ? p.grace : null } });
      for (const day of event.days) {
        for (const [s, e] of [['07:30', '12:00'], ['12:00', '17:00']] as const) {
          const ymd = day.date.toISOString().slice(0, 10);
          const startAt = zonedToUtc(ymd, s, TZ);
          const shift = await db.shift.create({
            data: { orgId, eventId: event.id, positionId: pos.id, dayId: day.id, startAt, endAt: zonedToUtc(ymd, e, TZ), callAt: new Date(startAt.getTime() - 45 * 60_000), needed: p.target },
          });
          shiftIds.push(shift.id);
        }
      }
    }
  }
  // Half-staffed: the first few shifts get people in a mix of states, the rest stay open for the demo.
  const names = [...people.keys()].filter((n) => !['Marcus Bell', 'Sofia Reyes'].includes(n));
  const statuses = ['confirmed', 'confirmed', 'invited', 'declined'] as const;
  for (const [i, shiftId] of shiftIds.slice(0, 6).entries()) {
    for (let k = 0; k < 2; k++) {
      const name = names[(i * 2 + k) % names.length]!;
      await db.assignment.create({ data: { orgId, eventId: event.id, shiftId, personId: people.get(name)!, status: statuses[(i + k) % statuses.length] } });
    }
  }
  const rows = [['08:00', 'Doors open', 'North Lobby', 'Marcus'], ['09:00', 'Opening keynote', 'Hall A', 'Priya'], ['12:00', 'Lunch service', 'Hall B', 'Catering'], ['17:00', 'Floor closes', 'Hall A', 'Sofia']];
  await db.runOfShowRow.createMany({ data: rows.map(([at, cue, area, owner], i) => ({ orgId, eventId: event.id, sourceKey: `${at}|${cue}`, at: at!, cue: cue!, area: area!, owner: owner!, sortOrder: i })) });
  return `Seeded Spring Expo for ${slug}: ${PEOPLE.length} people, ${shiftIds.length} shifts`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(await seedCallboard());
  await db.$disconnect();
}
