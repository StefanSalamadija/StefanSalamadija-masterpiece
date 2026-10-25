import { test, expect } from '@playwright/test';
import { expectNoHorizontalScroll, freshApp, setupShip } from './helpers';

test('first ship and header clock', async ({ page }) => {
  await freshApp(page);
  await expect(page.getByRole('heading', { name: 'Masterpiece' })).toBeVisible();
  await expect(page.getByText("Your ship's office in your pocket. Crew, certificates and paperwork — fully offline.")).toBeVisible();
  await expect(page.getByRole('img', { name: 'Masterpiece logo' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Import a backup' })).toHaveAttribute('href', '#/settings/import');
  await expect(page.getByText('Your data stays on this device. No account needed.')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await setupShip(page);
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');
  await expect(page.getByTestId('ship-clock')).toHaveText('12:00 LT (UTC+03:00)');
  await expectNoHorizontalScroll(page);
});

test('theme cycles, persists, and prints black on white', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.getByRole('button', { name: 'Theme: Day' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  const [bg, fg] = await page.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.body).color]);
  expect(bg).toBe('rgb(11, 22, 34)');      // night: dark navy #0B1622
  expect(fg).toBe('rgb(230, 237, 245)');   // #E6EDF5
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  await page.emulateMedia({ media: 'print' });
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(255, 255, 255)');
  expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe('rgb(0, 0, 0)');
});

test('welcome asks for a ship name, and links to the import screen', async ({ page }) => {
  await freshApp(page);
  await page.getByRole('button', { name: 'Create your first ship' }).click();
  await expect(page.getByRole('heading', { name: 'Create your first ship' })).toBeVisible();
  await page.getByRole('button', { name: 'Create ship' }).click();
  await expect(page.getByRole('alert')).toHaveText('Ship name is required.');
  await expectNoHorizontalScroll(page);

  await page.getByRole('link', { name: 'Import a backup' }).click();
  await expect(page.getByRole('heading', { name: 'Import backup' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Masterpiece' })).toBeVisible();
});

test('navigation links, the ship chips, and unknown routes falling back to Home', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  const main = page.getByRole('navigation', { name: 'Main' });
  for (const name of ['Home', 'Ship', 'Profiles', 'Settings']) await expect(main.getByRole('link', { name })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Ship sections' })).toHaveCount(0);

  await main.getByRole('link', { name: 'Ship' }).click();
  await expect(page).toHaveURL(/#\/ship\/particulars$/);
  const chips = page.getByRole('navigation', { name: 'Ship sections' });
  for (const name of ['Particulars', 'Crew', 'Certificates', 'Voyage', "Ship's time"]) await expect(chips.getByRole('link', { name })).toBeVisible();
  await expect(chips.getByRole('link', { name: 'Particulars' })).toHaveAttribute('aria-current', 'page');
  await expectNoHorizontalScroll(page);

  await page.goto('./#/nowhere');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
});
