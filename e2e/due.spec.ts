import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoHorizontalScroll, expectRedOnly, freshApp, setTheme, setupShip } from './helpers';

// The clock is 2026-11-17T09:00Z and the ship is at UTC+03:00, so the ship's today is 2026-11-17. The data is made up:
// R. EXAMPLE's passport ran out on 12 Nov (5 days ago) and the International Load Line certificate expires on 1 Dec (in
// 14 days).

const TIME = '2026-11-17T09:00:00Z';
const PASSPORT = 'Passport · 2nd Officer R. EXAMPLE';
const CERTIFICATE = 'International Load Line';

const group = (page: Page, name: 'Overdue' | 'Due soon') => page.getByRole('region', { name });
const rowOf = (page: Page, title: string) => page.getByRole('listitem').filter({ hasText: title });
const views = (page: Page) => page.getByRole('navigation', { name: 'Due views' });

async function madeUpShip(page: Page): Promise<void> {
  await freshApp(page, { time: TIME });
  await setupShip(page);

  await page.goto('./#/ship/crew/new');
  await page.getByLabel('Surname').fill('EXAMPLE');
  await page.getByLabel('Given names').fill('Robert');
  await page.getByLabel('Rank').selectOption({ label: '2nd Officer' });
  await page.getByLabel('Date of birth').fill('1980-03-14');
  await page.getByLabel('Passport expiry').fill('2026-11-12');
  await page.getByLabel("Seaman's book expiry").fill('2030-01-01');
  await page.getByLabel('Sign-on date').fill('2026-10-01');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew$/);

  await page.goto('./#/ship/certificates/new');
  await page.getByLabel('Certificate', { exact: true }).selectOption({ label: CERTIFICATE });
  await page.getByLabel('Number').fill('LL-0001');
  await page.getByLabel('Expiry date').fill('2026-12-01');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/certificates$/);
}

test('All due lists every alert, the overdue first, with the days in words', async ({ page }) => {
  await madeUpShip(page);
  await page.goto('./#/due');
  await expect(page.getByRole('heading', { name: 'Due', exact: true })).toBeVisible();
  await expect(views(page).getByRole('link')).toHaveText(['All due', 'Before next port']);
  await expect(views(page).getByRole('link', { name: 'All due' })).toHaveAttribute('aria-current', 'page');
  await expect(views(page).getByRole('link', { name: 'Before next port' })).not.toHaveAttribute('aria-current', /.*/);

  const passport = group(page, 'Overdue').getByRole('listitem');
  await expect(passport).toHaveCount(1);
  await expect(passport).toContainText(PASSPORT);
  await expect(passport).toContainText('Expired 12 Nov');
  await expect(passport.locator('.status')).toHaveText('5 d over');
  await expect(passport.locator('.status')).toHaveAttribute('data-tone', 'danger');

  const certificate = group(page, 'Due soon').getByRole('listitem');
  await expect(certificate).toHaveCount(1);
  await expect(certificate).toContainText(CERTIFICATE);
  await expect(certificate).toContainText('Ship certificate · 1 Dec');
  await expect(certificate.locator('.status')).toHaveText('in 14 d');
  await expect(certificate.locator('.status')).toHaveAttribute('data-tone', 'warn');

  // The whole row is the link to the record.
  await certificate.getByRole('link').click();
  await expect(page).toHaveURL(/#\/ship\/certificates\/[^/]+$/);
  await page.goBack();
  await rowOf(page, PASSPORT).getByRole('link').click();
  await expect(page).toHaveURL(/#\/ship\/crew\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Edit crew member' })).toBeVisible();
});

test('the old Expiring route opens Before next port, and Back skips it', async ({ page }) => {
  await madeUpShip(page);
  await page.goto('./#/ship/crew');
  await expect(page.getByRole('heading', { name: 'Crew', exact: true })).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#/ship/expiring'; });
  await expect(page).toHaveURL(/#\/due\/port$/);
  await expect(views(page).getByRole('link', { name: 'Before next port' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('list', { name: 'Expiring' })).toContainText('Passport expired 2026-11-12');

  await page.goBack();
  await expect(page).toHaveURL(/#\/ship\/crew$/);
  await expect(page.getByRole('heading', { name: 'Crew', exact: true })).toBeVisible();

  // The Ship chip goes straight to the new view; the views link to each other.
  await page.getByRole('navigation', { name: 'Ship sections' }).getByRole('link', { name: 'Expiring' }).click();
  await expect(page).toHaveURL(/#\/due\/port$/);
  await views(page).getByRole('link', { name: 'All due' }).click();
  await expect(page).toHaveURL(/#\/due$/);
  await expect(group(page, 'Due soon')).toContainText(CERTIFICATE);
});

test('Crew documents lists the crew papers and not the ship certificates', async ({ page }) => {
  await madeUpShip(page);
  await page.goto('./#/ship/crew-documents');
  await expect(page.getByRole('heading', { name: 'Crew documents' })).toBeVisible();
  await expect(group(page, 'Overdue')).toContainText(PASSPORT);
  await expect(page.getByText(CERTIFICATE)).toHaveCount(0);
  await expect(group(page, 'Due soon')).toHaveCount(0);
  await page.getByRole('link', { name: 'Before next port' }).click();
  await expect(page).toHaveURL(/#\/due\/port$/);
});

test('an empty ship has nothing due', async ({ page }) => {
  await freshApp(page, { time: TIME });
  await setupShip(page);
  await page.goto('./#/due');
  await expect(page.getByText('✓ Nothing due', { exact: true })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await page.goto('./#/ship/crew-documents');
  await expect(page.getByText('✓ Nothing due', { exact: true })).toBeVisible();
  await page.goto('./#/due/port');
  await expect(page.getByText('Nothing expires in that time.')).toBeVisible();
});

test('All due prints black on white, the rows and chips in words', async ({ page }) => {
  await madeUpShip(page);
  await setTheme(page, 'Night red');
  await page.goto('./#/due');
  await expect(group(page, 'Overdue').getByRole('listitem')).toHaveCount(1);
  await page.emulateMedia({ media: 'print' });
  const colours = await page.evaluate(() => {
    const look = (el: Element) => { const s = getComputedStyle(el); return [s.color, s.backgroundColor]; };
    return {
      body: look(document.body),
      rows: [...document.querySelectorAll('.list-row')].map(look),
      chips: [...document.querySelectorAll('.status')].map(look),
    };
  });
  const WHITE = ['rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)'];
  expect(colours.body).toEqual(['rgb(0, 0, 0)', 'rgb(255, 255, 255)']);
  expect(colours.chips).toHaveLength(2);
  for (const [color, background] of [...colours.rows, ...colours.chips]) {
    expect(color).toBe('rgb(0, 0, 0)');
    expect(WHITE).toContain(background);
  }
  await expect(rowOf(page, PASSPORT)).toBeVisible();
  await expect(rowOf(page, PASSPORT)).toContainText('5 d over');
  await expect(rowOf(page, CERTIFICATE)).toContainText('in 14 d');
  await expect(group(page, 'Overdue').getByRole('heading', { name: 'Overdue' })).toBeVisible();
  await expect(views(page)).toBeHidden();
  await page.emulateMedia({ media: null });
});

test('Due is red only in Night red, and fits a phone', async ({ page }) => {
  await madeUpShip(page);
  await setTheme(page, 'Night red');
  for (const [path, heading] of [['/due', 'Due'], ['/due/port', 'Due'], ['/ship/crew-documents', 'Crew documents']]) {
    await page.goto(`./#${path}`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.locator('.list-row').first()).toBeVisible();
    await expectRedOnly(page);
    await expectNoHorizontalScroll(page);
  }
});
