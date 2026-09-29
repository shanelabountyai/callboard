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
  await db.query(`DELETE FROM "Event" WHERE name IN ('Spring Expo', 'Autumn Expo', 'Expo template')`); // a fresh expo every run; people are upserted
  await db.query('DELETE FROM "Playbook"'); // the library test starts from the seeded library and the default rules
  await db.query('DELETE FROM "OrgRules"');
  await db.query('UPDATE "Person" SET "wantsBackAt" = NULL');
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
  const shift = page.locator('article').filter({ hasText: 'Floor runner · Exhibit Hall' }).first(); // the heading: once Tom is invited, other shifts' invite lists say "busy: Floor runner"
  await shift.getByText('Invite people to this shift').click();
  await shift.getByLabel(/Tom Alvarez/).check();
  await shift.getByRole('button', { name: 'Send invites' }).click();
  await expect(shift).toContainText('Tom Alvarez (volunteer) · invited');
  // He is now taken for that morning: every other shift at the same time lists him, but he cannot be ticked.
  await expect(page.locator('article').filter({ hasText: 'Badge printer · Registration' }).first().getByLabel(/Tom Alvarez/)).toBeDisabled();

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
  await expect(page.locator('article').filter({ hasText: 'Floor runner · Exhibit Hall' }).first()).toContainText('Tom Alvarez (volunteer) · confirmed');
});

test('run of show: an .xlsx import replaces imported rows and keeps a hand-added line', async ({ page }) => {
  await signInAsAcmeOwner(page);
  await page.getByRole('link', { name: 'Run of show' }).click();
  await page.getByLabel('Time', { exact: true }).fill('18:30'); // exact: the event page's rules mention call time, and it is still on screen while this one loads
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
  const greeter = page.getByRole('row').filter({ hasText: 'Registration · Greeter' }).filter({ hasText: 'Tom Alvarez · confirmed' }); // both of today's Greeter shifts start at the same instant, so row order is arbitrary: take the one Tom is on
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
  const row = page.getByRole('row').filter({ hasText: 'Registration · Greeter' }).filter({ hasText: 'Tom Alvarez · confirmed' });
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
  // Wait for the POST itself: taps.tsx relabels the button on the tap, so "no Got it button" is true before the ack has landed.
  const acked = phone.waitForResponse((r) => r.url().endsWith('/act') && r.request().method() === 'POST');
  await phone.getByRole('button', { name: 'Got it' }).click(); // posts in place and refreshes: the card disappears once acked
  expect((await acked).ok()).toBe(true);
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
  await page.getByRole('link', { name: 'Library' }).click();
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

test('the library: a rule change marks what deviates, a template starts an event, the report and the thank-you follow a close', async ({ page, context }) => {
  await signInAsAcmeOwner(page);
  // Spring Expo is closed (the test above), so it keeps the grace it ran with and says so.
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Event defaults' })).toBeVisible();
  await page.getByLabel(/^No-show grace/).fill('20');
  await page.getByRole('button', { name: 'Save the standard' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Spring Expo' })).toContainText('No-show grace');
  await expect(page.getByRole('row').filter({ hasText: 'Expo template' })).toHaveCount(0); // still planned: it followed

  await page.getByRole('link', { name: 'Library' }).click();
  await page.getByRole('link', { name: 'Lead notes' }).click();
  await expect(page.getByRole('heading', { name: /^Registration version 1/ })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Printer 2 jams above 40 badges an hour' })).toBeVisible();

  await page.getByRole('link', { name: 'Events' }).first().click(); // Templates left the top bar
  await page.getByRole('link', { name: 'start from a template' }).click();
  const tpl = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Expo template/ }) });
  await expect(tpl).toContainText('250 to 1,000');
  await tpl.getByLabel(/name/).fill('Autumn Expo');
  await tpl.getByLabel('First day').fill('2027-10-01');
  await tpl.getByRole('button', { name: 'Start an event from Expo template' }).click();
  await expect(page.getByRole('heading', { name: 'Autumn Expo', level: 1 })).toBeVisible();
  await expect(page.getByText('Rules for this event (all standard)')).toBeVisible();
  await expect(page.getByText('Fri, Oct 1, Sat, Oct 2')).toBeVisible();
  await expect(page.getByLabel('Playbook for Registration')).not.toHaveValue('');

  // Tom checked in at the expo, so the close thanked him; one tap puts him first in his tier on the next event's list.
  const { rows } = await db.query(`SELECT body FROM "CapturedMessage" WHERE "to" = '+15550100006' AND body LIKE '%counted in%' ORDER BY "createdAt" DESC LIMIT 1`);
  const phone = await (await context.browser()!.newContext()).newPage();
  await phone.goto(rows[0].body.match(/https?:\/\/\S+\/p\/[\w-]+/)![0]);
  await phone.getByRole('button', { name: 'Count me in next time' }).click();
  await expect(phone.getByRole('status')).toContainText('You are on the list for next time');
  await page.getByRole('link', { name: 'Staff this event' }).click();
  await expect(page.getByText(/Tom Alvarez.*asked to come back/).first()).toBeAttached(); // in the invite list, which is folded until opened

  await page.getByRole('link', { name: 'Events' }).first().click();
  await expect(page.getByRole('heading', { name: 'New event' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Expo template' })).toHaveCount(0); // a template is not an event
  await page.getByRole('link', { name: 'Spring Expo' }).click();
  await page.getByRole('link', { name: 'Report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Report: Spring Expo' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Registration/ })).toBeVisible();
  await expect(page.getByText(/Provisional: \d of \d areas have no review yet/)).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'volunteer' })).toBeVisible();
});

// PRD 3 swaps, on day two (three weeks out, so nothing here depends on the clock): Tom offers his Greeter shift
// for Jen's Info shift, Jen accepts, the planner sees it waiting on the lead, Marcus approves, and both have moved.
test('swap: a person asks, the colleague accepts, the lead approves, and the two shifts change hands', async ({ page, context }) => {
  await db.query(`UPDATE "Event" SET status = 'confirmed' WHERE name = 'Spring Expo'`); // an earlier test closed it
  const { rows: [event] } = await db.query(`SELECT id, "orgId" FROM "Event" WHERE name = 'Spring Expo'`);
  const person = async (mobile: string) => (await db.query(`SELECT id FROM "Person" WHERE mobile = $1 AND "orgId" = $2`, [mobile, event.orgId])).rows[0].id as string;
  const [tom, jen, marcus] = [await person('+15550100006'), await person('+15550100003'), await person('+15550100001')];
  const shift = async (position: string) => (await db.query(
    `SELECT s.id FROM "Shift" s JOIN "Position" p ON p.id = s."positionId" JOIN "EventDay" d ON d.id = s."dayId"
     WHERE s."eventId" = $1 AND p.name = $2 AND d.date = (SELECT max(date) FROM "EventDay" WHERE "eventId" = $1) ORDER BY s."startAt" LIMIT 1`, [event.id, position])).rows[0].id as string;
  const [greeter, info] = [await shift('Greeter'), await shift('Info')];
  await db.query(`DELETE FROM "Assignment" a USING "Shift" s, "EventDay" d WHERE a."shiftId" = s.id AND s."dayId" = d.id AND a."eventId" = $1 AND a."personId" = ANY($2) AND d.date = (SELECT max(date) FROM "EventDay" WHERE "eventId" = $1)`, [event.id, [tom, jen]]);
  const put = async (shiftId: string, personId: string) => (await db.query(
    `INSERT INTO "Assignment" (id, "orgId", "eventId", "shiftId", "personId", status) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'confirmed') RETURNING id`, [event.orgId, event.id, shiftId, personId])).rows[0].id as string;
  const [tomsShift, jensShift] = [await put(greeter, tom), await put(info, jen)];
  const { ensurePersonLink } = await import('../src/lib/links');
  const { db: prisma } = await import('../src/core/db');
  const url = (personId: string) => ensurePersonLink(prisma, { orgId: event.orgId, eventId: event.id, personId }, new Date(Date.now() + 30 * 86_400_000));
  const open = async (personId: string) => {
    const phone = await (await context.browser()!.newContext()).newPage();
    await phone.goto(await url(personId));
    await expect(phone.getByRole('heading', { name: 'Spring Expo' })).toBeVisible();
    return phone;
  };

  const tomsPhone = await open(tom);
  await tomsPhone.getByText('Swap this shift').click();
  await tomsPhone.getByLabel('Swap with').selectOption(jensShift);
  await tomsPhone.getByRole('button', { name: 'Ask to swap' }).click();
  await expect(tomsPhone.getByRole('status')).toContainText('Asked.');
  await expect(tomsPhone.getByText('Waiting on Jen')).toBeVisible();

  const jensPhone = await open(jen);
  await expect(jensPhone.getByText('Tom Alvarez asks to swap shifts.')).toBeVisible();
  await jensPhone.getByRole('button', { name: 'Accept' }).click();
  await expect(jensPhone.getByRole('status')).toContainText('Accepted.');

  await signInAsAcmeOwner(page);
  await page.getByRole('link', { name: 'Staff this event' }).click();
  await expect(page.getByRole('heading', { name: 'Staff: Spring Expo' })).toBeVisible();
  await expect(page.getByText('both agreed, waiting on Marcus Bell')).toBeVisible();

  const leadsPhone = await open(marcus);
  await expect(leadsPhone.getByRole('heading', { name: 'Swaps to approve' })).toBeVisible();
  await leadsPhone.getByRole('button', { name: 'Approve' }).click();
  await expect(leadsPhone.getByRole('status')).toContainText('Approved.');
  await expect(leadsPhone.getByRole('heading', { name: 'Swaps to approve' })).toHaveCount(0);

  const { rows } = await db.query(`SELECT id, "shiftId" FROM "Assignment" WHERE id = ANY($1)`, [[tomsShift, jensShift]]);
  expect(Object.fromEntries(rows.map((r) => [r.id, r.shiftId]))).toEqual({ [tomsShift]: info, [jensShift]: greeter });
  await tomsPhone.reload();
  await expect(tomsPhone.locator('article').filter({ hasText: 'Info · Info Desk' })).toBeVisible();
  const { rows: [text] } = await db.query(`SELECT body FROM "CapturedMessage" WHERE "to" = '+15550100006' ORDER BY "createdAt" DESC LIMIT 1`);
  expect(text.body).toContain('is approved. You now have Info');
});
