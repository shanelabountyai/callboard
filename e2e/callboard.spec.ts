import { expect, test } from '@playwright/test';
import pg from 'pg';
import { seedDemo } from '../scripts/seed-demo';
import { seedCallboard } from '../scripts/seed-callboard';
import { writeXlsx } from '../tests/helpers/xlsx';

// Phase 1 end to end: a planner invites someone to a shift, the person confirms from their link
// with no login, and the run of show comes in from an .xlsx without touching a hand-added line.
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
test.afterAll(() => db.end());
test.beforeAll(async () => {
  await db.query('DELETE FROM "RateLimit"');
  await db.query(`DELETE FROM "Event" WHERE name = 'Spring Expo'`); // a fresh expo every run; people are upserted
  await db.query('DELETE FROM "PositionCard"'); // the library back to version 1, so the phase 3 test can run twice
  await seedDemo();
  await seedCallboard();
});

async function signInAsAcmeOwner(page: import('@playwright/test').Page) {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'owner@acme.demo.test' }).click();
  await page.getByRole('link', { name: 'Acme Studio' }).click();
  await page.getByRole('link', { name: 'Events' }).first().click();
  await page.getByRole('link', { name: 'Spring Expo' }).click();
}

test('invite from the staff page → SMS link → confirm without a login → planner sees confirmed', async ({ page, context }) => {
  await signInAsAcmeOwner(page);
  await page.getByRole('link', { name: 'Staff this event' }).click();
  const shift = page.locator('article').filter({ hasText: 'Floor runner' }).first();
  await shift.getByText('Invite people to this shift').click();
  await shift.getByLabel(/Tom Alvarez/).check();
  await shift.getByRole('button', { name: 'Send invites' }).click();
  await expect(shift).toContainText('Tom Alvarez (volunteer) · invited');

  // Tom has no email, so exactly one captured message: the SMS with the link.
  const { rows } = await db.query(`SELECT body FROM "CapturedMessage" WHERE "to" = '+15550100006' ORDER BY "createdAt" DESC LIMIT 1`);
  expect(rows[0].body).toContain('Floor runner');
  const url = rows[0].body.match(/https?:\/\/\S+\/p\/[\w-]+/)![0];

  const tom = await context.browser()!.newContext(); // a fresh browser: no planner session
  const phone = await tom.newPage();
  await phone.goto(url);
  await expect(phone.getByRole('heading', { name: 'Spring Expo' })).toBeVisible();
  await expect(phone.getByText('Green vest')).toBeVisible();
  await phone.getByRole('button', { name: 'Confirm' }).first().click();
  await expect(phone.getByRole('status')).toContainText('you are confirmed');
  await tom.close();

  await page.reload();
  await expect(page.locator('article').filter({ hasText: 'Floor runner' }).first()).toContainText('Tom Alvarez (volunteer) · confirmed');
});

test('run of show: an .xlsx import replaces imported rows and keeps a hand-added line', async ({ page }) => {
  await signInAsAcmeOwner(page);
  await page.getByRole('link', { name: 'Run of show' }).click();
  await page.getByLabel('Time').fill('18:30');
  await page.getByLabel('Cue').fill('Staff debrief');
  await page.getByRole('button', { name: 'Add line' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Staff debrief' })).toContainText('manual');

  const xlsx = writeXlsx([['Time', 'Cue', 'Location', 'Who'], [0.333333333, 'Doors open', 'North Lobby', 'Marcus'], ['09:15', 'Keynote', 'Hall A', 'Priya']]);
  await page.getByLabel('File').setInputFiles({ name: 'ros.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx });
  await page.getByRole('button', { name: 'Import' }).click();
  await page.waitForURL(/imported=2/);
  await expect(page.getByRole('status')).toContainText('Imported 2 rows');
  await expect(page.getByText('2 imported, 1 added by hand')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Doors open' })).toContainText('08:00');
  await expect(page.getByRole('row').filter({ hasText: 'Staff debrief' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Opening keynote' })).toHaveCount(0); // the seeded import row is gone
});

// Phase 2: the day of. The seed puts Spring Expo three weeks out, so the spec pulls its first day to today
// with call time 30 minutes ago, then: the planner reads the board, Tom checks himself in from his link,
// the lead taps the rest of the crew in from theirs, and the board shows who is here.
test('day of: board shows overdue, self check-in and lead tap check-in land on the board', async ({ page, context }) => {
  await db.query(`
    UPDATE "Shift" s SET "callAt" = now() - interval '30 minutes', "startAt" = now() + interval '15 minutes', "endAt" = now() + interval '4 hours'
    FROM "EventDay" d, "Event" e WHERE s."dayId" = d.id AND d."eventId" = e.id AND e.name = 'Spring Expo' AND d.date = (SELECT min(date) FROM "EventDay" WHERE "eventId" = e.id)`);
  await db.query(`UPDATE "EventDay" d SET date = (now() AT TIME ZONE 'America/Chicago')::date FROM "Event" e WHERE d."eventId" = e.id AND e.name = 'Spring Expo' AND d.date = (SELECT min(date) FROM "EventDay" WHERE "eventId" = e.id)`);
  await db.query(`UPDATE "Event" SET status = 'live' WHERE name = 'Spring Expo'`);
  const { rows: [tom] } = await db.query(`SELECT id, "orgId" FROM "Person" WHERE mobile = '+15550100006'`);
  const { rows: [event] } = await db.query(`SELECT id FROM "Event" WHERE name = 'Spring Expo'`);
  // Tom is confirmed on the morning Greeter shift (call time passed, grace 15: overdue); Marcus leads Front of house.
  const { rows: [shift] } = await db.query(`SELECT s.id FROM "Shift" s JOIN "Position" p ON p.id = s."positionId" WHERE s."eventId" = $1 AND p.name = 'Greeter' ORDER BY s."startAt" LIMIT 1`, [event.id]);
  await db.query(`DELETE FROM "Assignment" WHERE "shiftId" = $1 AND "personId" = $2`, [shift.id, tom.id]);
  await db.query(`INSERT INTO "Assignment" (id, "orgId", "eventId", "shiftId", "personId", status) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'confirmed')`, [tom.orgId, event.id, shift.id, tom.id]);
  const { ensurePersonLink } = await import('../src/lib/links');
  const { db: prisma } = await import('../src/core/db');
  const expires = new Date(Date.now() + 86_400_000);
  const tomUrl = await ensurePersonLink(prisma, { orgId: tom.orgId, eventId: event.id, personId: tom.id }, expires);
  const { rows: [marcus] } = await db.query(`SELECT id FROM "Person" WHERE mobile = '+15550100001'`);
  const marcusUrl = await ensurePersonLink(prisma, { orgId: tom.orgId, eventId: event.id, personId: marcus.id }, expires);

  await signInAsAcmeOwner(page);
  await page.getByRole('link', { name: 'Coverage board' }).click();
  await expect(page.getByRole('heading', { name: 'Board: Spring Expo' })).toBeVisible();
  const greeter = page.getByRole('row').filter({ hasText: 'Registration · Greeter' }).first();
  await expect(greeter).toBeVisible();
  await greeter.getByText('People').click();
  await expect(greeter).toContainText('Tom Alvarez · confirmed · overdue since');

  const phone = await (await context.browser()!.newContext()).newPage();
  await phone.goto(tomUrl);
  const greeters = phone.locator('article').filter({ hasText: 'Greeter · Registration' }); // both of today's Greeter shifts moved to now; Tom is confirmed on one
  await greeters.filter({ has: phone.getByRole('button', { name: 'Check in' }) }).getByRole('button', { name: 'Check in' }).click(); // taps.tsx posts it and refreshes in place
  await expect(greeters.filter({ hasText: /checked in \d+:\d\d [AP]M/ })).toHaveCount(1);
  await expect(greeters.getByRole('button', { name: 'I’m done' })).toBeVisible();

  const lead = await (await context.browser()!.newContext()).newPage();
  await lead.goto(marcusUrl);
  await expect(lead.getByRole('heading', { name: 'You lead Front of house' })).toBeVisible();
  const hereButtons = lead.getByRole('button', { name: /^Check in / });
  const n = await hereButtons.count();
  expect(n).toBeGreaterThan(0);
  await hereButtons.first().click();
  await expect(lead.getByText(/here \d+:\d\d [AP]M/).first()).toBeVisible();

  await page.reload();
  const row = page.getByRole('row').filter({ hasText: 'Registration · Greeter' }).first();
  await row.getByText('People').click();
  await expect(row).toContainText('Tom Alvarez · confirmed · here');
  await expect(row).not.toContainText('Tom Alvarez · confirmed · overdue');
});

test('messages: a broadcast with Got it reaches the audience and the ack shows on the planner’s list', async ({ page, context }) => {
  await signInAsAcmeOwner(page);
  await page.getByRole('link', { name: 'Messages' }).click();
  await expect(page.getByRole('heading', { name: /^Message people/ })).toBeVisible();
  await page.locator('select[name="audience"]').selectOption('event'); // the select sits inside its label, so its accessible name carries the option text
  await page.locator('textarea[name="body"]').fill('Doors now 9:15, not 9:00.');
  await page.getByLabel(/Got it/).check();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/Sent to \d+ people/);
  await expect(page.getByText(/to Whole event/).first()).toBeVisible();
  const { rows } = await db.query(`SELECT body FROM "CapturedMessage" WHERE "to" = '+15550100006' AND body LIKE '%Doors now 9:15%' ORDER BY "createdAt" DESC LIMIT 1`);
  expect(rows[0].body).toContain('Got it? Reply GOT IT or tap');
  const url = rows[0].body.match(/https?:\/\/\S+\/p\/[\w-]+/)![0];
  const phone = await (await context.browser()!.newContext()).newPage();
  await phone.goto(url);
  await phone.getByRole('button', { name: 'Got it' }).click(); // posts in place and refreshes: the card disappears once acked
  await expect(phone.getByRole('button', { name: 'Got it' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(/1 of \d+ got it/)).toBeVisible();
});

// Phase 3 (PRD 6). Runs last in this file: it closes the event.
test('after the event: the card reaches the person, tiers stay with planners, closing opens the lead’s review', async ({ page, context }) => {
  await signInAsAcmeOwner(page);
  await page.getByRole('link', { name: 'People' }).click();
  // Three seeded past events: Tom came to all of them, Chloe missed two, Dev has only worked two.
  await expect(page.getByRole('row').filter({ hasText: 'Tom Alvarez' })).toContainText('tier 1');
  await expect(page.getByRole('row').filter({ hasText: 'Chloe Zhang' })).toContainText('tier 3');
  await expect(page.getByRole('row').filter({ hasText: 'Dev Patel' })).toContainText('tier 2');

  // The expo is live (the day-of test), so a new version of the card must not reach it.
  await page.getByRole('link', { name: 'Cards' }).click();
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Greeter/ }) });
  await card.getByText('Edit Greeter').click();
  await card.locator('textarea[name="never"]').fill('Leave the post without a swap, or guess at a VIP.');
  await card.getByRole('button', { name: 'Save as version 2' }).click();
  await expect(card.getByRole('heading', { name: /Greeter version 2/ })).toBeVisible();

  const { ensurePersonLink } = await import('../src/lib/links');
  const { db: prisma } = await import('../src/core/db');
  const { rows: [tom] } = await db.query(`SELECT id, "orgId" FROM "Person" WHERE mobile = '+15550100006'`);
  const { rows: [event] } = await db.query(`SELECT id FROM "Event" WHERE name = 'Spring Expo'`);
  const tomUrl = await ensurePersonLink(prisma, { orgId: tom.orgId, eventId: event.id, personId: tom.id }, new Date(Date.now() + 86_400_000));
  const phone = await (await context.browser()!.newContext()).newPage();
  await phone.goto(tomUrl);
  await expect(phone.getByText('Welcome every attendee').first()).toBeVisible();
  await expect(phone.getByText('Leave the post without a swap.', { exact: true }).first()).toBeVisible(); // version 1, frozen
  await expect(phone.getByText(/guess at a VIP/)).toHaveCount(0);
  await expect(phone.getByText(/tier \d/)).toHaveCount(0); // never on a person's own page

  await page.getByRole('link', { name: 'Events' }).first().click();
  await page.getByRole('link', { name: 'Spring Expo' }).click();
  await page.locator('select[name="status"]').selectOption('closed');
  await page.getByRole('button', { name: 'Set status' }).click();
  await expect(page.getByRole('heading', { name: 'Review: Spring Expo' })).toBeVisible();
  await expect(page.getByText(/areas still open/)).toBeVisible();

  const { rows } = await db.query(`SELECT body FROM "CapturedMessage" WHERE "to" = '+15550100001' AND body LIKE '%/review%' ORDER BY "createdAt" DESC LIMIT 1`);
  const lead = await (await context.browser()!.newContext()).newPage();
  await lead.goto(rows[0].body.match(/https?:\/\/\S+\/p\/[\w-]+\/review/)![0]);
  const reg = lead.locator('section').filter({ has: lead.getByRole('heading', { name: 'Registration' }) });
  await expect(reg.getByLabel('What happened: Tom Alvarez')).toHaveValue('late'); // he checked in after call time plus grace
  await reg.getByLabel('Have Tom Alvarez back?').selectOption('yes');
  await reg.getByLabel('When were you short-staffed?').fill('8 to 9am');
  await reg.getByLabel('When did you have too many people?').fill('never');
  await reg.getByLabel('What went wrong?').fill('nothing');
  await reg.getByRole('button', { name: 'Save Registration' }).click();
  await expect(lead.getByRole('status')).toContainText('Saved. 1 to go.'); // Marcus also owns the Info Desk

  await page.reload();
  await expect(page.locator('section').filter({ has: page.getByRole('heading', { name: /^Registration/ }) })).toContainText('Reviewed by Marcus Bell');
});
