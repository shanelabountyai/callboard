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

// The card library (PRD 6): what each job is. Uniform, location, lead and call time stay on the event.
const CARDS: { title: string; purpose: string; duties: string[]; situations: string[]; never: string; demands: string }[] = [
  { title: 'Greeter', purpose: 'The first face an attendee sees.', duties: ['Welcome every attendee', 'Point them to the right badge line', 'Keep the doorway clear'], situations: ['A VIP is not on the list: radio your lead, never turn them away', 'Someone is lost: walk them to the info desk'], never: 'Leave the post without a swap.', demands: 'On your feet for the whole shift.' },
  { title: 'Badge printer', purpose: 'Every attendee leaves with the right badge.', duties: ['Print and hand over badges', 'Check the name against ID', 'Keep badge stock topped up'], situations: ['The printer jams: slow the line rather than force it', 'A name is misspelled: reprint, keep the old badge'], never: 'Hand a badge to anyone but the person named on it.', demands: 'Comfortable with a laptop and a label printer.' },
  { title: 'Info', purpose: 'The answer to where-is and when-is.', duties: ['Answer questions', 'Hand out maps', 'Log lost property'], situations: ['Lost child or medical: call venue security first, then radio your lead'], never: 'Guess. Radio your lead if you do not know.', demands: '' },
  { title: 'Floor runner', purpose: 'Keeps the exhibit floor moving.', duties: ['Walk the aisles', 'Help exhibitors with power and supplies', 'Report anything blocking an aisle'], situations: ['An exhibitor has no power: radio your lead with the booth number'], never: 'Move an exhibitor’s stock without them.', demands: 'Lifting up to 15 kg; a lot of walking.' },
  { title: 'Floater', purpose: 'Goes where a position is short.', duties: ['Wait at the ops desk', 'Go where the planner sends you', 'Read the card for the position you are sent to'], situations: [], never: 'Wander off: the planner needs to find you in a minute.', demands: '' },
];
// The rest of the library (PRD 6): how Registration is run, and the house rules.
const PLAYBOOK = {
  title: 'Registration',
  staffing: ['Greeter 7:30 to 9am: min 2, target 3', 'Greeter 9am to close: min 1, target 2', 'Badge printer all day: min 1, target 2'],
  breakPlan: ['One at a time from 9:30am, 15 minutes each', 'Never both badge printers at once'],
  floatPlan: ['One floater held at the ops desk from 7:30 to 9am'],
  equipment: ['2 radios, channel 2', '2 badge printers and 4 boxes of stock', 'VIP list, printed, at the ops desk'],
  setup: ['Both printers tested with a real badge', 'Line ropes out by 7:15', 'VIP list checked against the latest export'],
  close: ['Radios back to the charging station', 'Unprinted badges boxed and labelled', 'Lost property to the Info Desk'],
  failurePoints: ['Printer 2 jams above 40 badges an hour', 'The 8 to 9am rush needs every greeter on the door'],
};
const HOUSE_RULES = {
  breaks: '15 minutes every 4 hours. Never two people from one position at once.',
  minors: 'Under 18: never alone at a position, and no shifts that end after 9pm.',
  moves: 'A lead moves people inside their own areas. Across areas, ask the planner.',
};

async function seedLibrary(orgId: string, userId: string) {
  const playbook = await db.playbook.upsert({
    where: { orgId_key_version: { orgId, key: 'registration', version: 1 } },
    create: { orgId, key: 'registration', version: 1, title: PLAYBOOK.title, changedBy: userId, ...Object.fromEntries(Object.entries(PLAYBOOK).filter(([k]) => k !== 'title').map(([k, v]) => [k, (v as string[]).join('\n')])) },
    update: {},
  });
  await db.area.updateMany({ where: { orgId, name: 'Registration', playbookId: null }, data: { playbookId: playbook.id } });
  await db.orgRules.upsert({ where: { orgId }, create: { orgId, ...HOUSE_RULES }, update: {} });
  await db.event.updateMany({ where: { orgId, breaks: '', minors: '', moves: '' }, data: HOUSE_RULES }); // events seeded before the rules existed
}

// Past events give the directory a history, so tiers mean something in the demo: who showed, who was late, who never came.
const PAST: [string, number][] = [['Winter Summit', 200], ['Autumn Forum', 290], ['Summer Fair', 380]]; // name, days ago
const HISTORY: Record<string, ('showed' | 'late' | 'no_show')[]> = {
  'Tom Alvarez': ['showed', 'showed', 'showed'], 'Ana Lima': ['showed', 'late', 'showed'], 'Jen Park': ['showed', 'showed', 'showed'],
  'Ben Okafor': ['no_show', 'showed', 'showed'], 'Chloe Zhang': ['no_show', 'showed', 'no_show'], 'Dev Patel': ['showed', 'showed'],
};

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
  const owner = await db.membership.findFirstOrThrow({ where: { orgId, role: 'owner' }, select: { userId: true } });
  const cards = new Map<string, string>();
  for (const c of CARDS) {
    const key = c.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const card = await db.positionCard.upsert({
      where: { orgId_key_version: { orgId, key, version: 1 } },
      create: { orgId, key, version: 1, title: c.title, purpose: c.purpose, duties: c.duties.join('\n'), situations: c.situations.join('\n'), never: c.never, demands: c.demands, changedBy: owner.userId },
      update: {},
    });
    cards.set(c.title, card.id);
    // An expo seeded before the library existed gets its cards too.
    await db.position.updateMany({ where: { orgId, name: c.title, cardId: null, event: { name: 'Spring Expo' } }, data: { cardId: card.id } });
  }
  for (const [n, [name, daysAgo]] of PAST.entries()) {
    if (await db.event.findFirst({ where: { orgId, name } })) continue;
    const date = new Date(Date.now() - daysAgo * 86_400_000);
    date.setUTCHours(0, 0, 0, 0);
    const ymd = date.toISOString().slice(0, 10);
    const [startAt, endAt] = [zonedToUtc(ymd, '08:00', TZ), zonedToUtc(ymd, '12:00', TZ)];
    const callAt = new Date(startAt.getTime() - 45 * 60_000);
    const past = await db.event.create({ data: { orgId, name, venue: 'Lakeside Convention Center', timezone: TZ, status: 'closed', closedAt: new Date(endAt.getTime() + 3_600_000), days: { create: { orgId, date } } }, include: { days: true } });
    const aor = await db.aor.create({ data: { orgId, eventId: past.id, name: 'Front of house', color: '#2563eb', leadId: people.get('Marcus Bell') } });
    const area = await db.area.create({ data: { orgId, eventId: past.id, name: 'Registration', location: 'North Lobby', aorId: aor.id } });
    const pos = await db.position.create({ data: { orgId, eventId: past.id, areaId: area.id, name: 'Greeter', minHeadcount: 2, targetHeadcount: 6, cardId: cards.get('Greeter') } });
    const shift = await db.shift.create({ data: { orgId, eventId: past.id, positionId: pos.id, dayId: past.days[0]!.id, callAt, startAt, endAt, needed: 6 } });
    for (const [who, outcomes] of Object.entries(HISTORY)) {
      const o = outcomes[n];
      if (!o) continue;
      const checkedInAt = o === 'no_show' ? null : new Date(callAt.getTime() + (o === 'late' ? 40 : 5) * 60_000);
      await db.assignment.create({
        data: { orgId, eventId: past.id, shiftId: shift.id, personId: people.get(who)!, status: 'confirmed', checkedInAt, checkInMethod: checkedInAt ? 'lead' : '', checkedOutAt: checkedInAt && endAt, checkOutMethod: checkedInAt ? 'lead' : '' },
      });
    }
    await db.areaReview.create({ data: { orgId, eventId: past.id, areaId: area.id, understaffed: '8 to 9am', overstaffed: 'After 11am', wentWrong: 'Badge stock ran low at 9', by: 'Marcus Bell', at: new Date(endAt.getTime() + 86_400_000) } });
  }
  if (await db.event.findFirst({ where: { orgId, name: 'Spring Expo' } })) {
    await seedLibrary(orgId, owner.userId);
    return 'Spring Expo already seeded';
  }

  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 21);
  start.setUTCHours(0, 0, 0, 0);
  const dates = [start, new Date(start.getTime() + 86_400_000)];
  const event = await db.event.create({
    data: { orgId, name: 'Spring Expo', venue: 'Lakeside Convention Center', timezone: TZ, status: 'staffing', emergencyContact: 'Venue security 555-0100, radio 1', days: { create: dates.map((date) => ({ orgId, date })) } },
    include: { days: true },
  });
  const foh = await db.aor.create({ data: { orgId, eventId: event.id, name: 'Front of house', color: '#2563eb', radioChannel: '2', leadId: people.get('Marcus Bell'), deputyId: people.get('Priya Nair') } });
  const floor = await db.aor.create({ data: { orgId, eventId: event.id, name: 'Exhibit floor', color: '#059669', radioChannel: '3', leadId: people.get('Sofia Reyes') } });
  const plan = [
    { area: 'Registration', location: 'North Lobby', aor: foh.id, positions: [
      { name: 'Greeter', min: 2, target: 3, uniform: 'Black polo, name badge', brief: 'VIP list is at the ops desk; radio channel 2 for Marcus.' },
      { name: 'Badge printer', min: 1, target: 2, uniform: 'Black polo', brief: 'Printer 2 jams above 40 an hour.' },
    ] },
    { area: 'Info Desk', location: 'Hall B entrance', aor: foh.id, positions: [{ name: 'Info', min: 1, target: 2, uniform: 'Black polo', brief: 'Venue security is 555-0100; your radio channel is 2.' }] },
    { area: 'Exhibit Hall', location: 'Hall A', aor: floor.id, positions: [
      { name: 'Floor runner', min: 2, target: 3, uniform: 'Green vest over your own clothes', brief: '' },
      { name: 'Floater', min: 0, target: 2, uniform: 'Green vest', brief: 'The ops desk is by the Hall A loading door.', isFloat: true, grace: 20 },
    ] },
  ];
  const shiftIds: string[] = [];
  for (const a of plan) {
    const area = await db.area.create({ data: { orgId, eventId: event.id, name: a.area, location: a.location, aorId: a.aor } });
    for (const p of a.positions) {
      const pos = await db.position.create({ data: { orgId, eventId: event.id, areaId: area.id, name: p.name, minHeadcount: p.min, targetHeadcount: p.target, uniform: p.uniform, brief: p.brief, cardId: cards.get(p.name), isFloat: 'isFloat' in p && p.isFloat, graceMin: 'grace' in p ? p.grace : null } });
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
  await seedLibrary(orgId, owner.userId);
  return `Seeded Spring Expo for ${slug}: ${PEOPLE.length} people, ${shiftIds.length} shifts`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(await seedCallboard());
  await db.$disconnect();
}
