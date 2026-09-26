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
