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
  await page.clock.runFor(60_000);
  await expect(page.getByTestId('ship-clock')).toHaveText('12:01 LT (UTC+03:00)');
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

test('the Theme select in Settings and the header button are one setting, and a reload keeps it', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  const select = page.getByLabel('Theme', { exact: true });
  const html = page.locator('html');
  await expect(select.locator('option')).toHaveText(['Day', 'Night', 'High contrast']);
  await expect(select).toHaveValue('day');
  await expect(html).toHaveAttribute('data-theme', 'day');

  await select.selectOption({ label: 'Night' });
  await expect(html).toHaveAttribute('data-theme', 'night');
  await expect(page.getByRole('button', { name: 'Theme: Night' })).toBeVisible();
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'night');
  await expect(page.getByRole('button', { name: 'Theme: Night' })).toBeVisible();
  await expect(select).toHaveValue('night');

  await select.selectOption({ label: 'High contrast' });
  await expect(html).toHaveAttribute('data-theme', 'contrast');
  await expect(page.getByRole('button', { name: 'Theme: High contrast' })).toBeVisible();

  // The header button changes the same setting, and the select follows it.
  await page.getByRole('button', { name: 'Theme: High contrast' }).click();
  await expect(html).toHaveAttribute('data-theme', 'day');
  await expect(select).toHaveValue('day');
  await page.getByRole('button', { name: 'Theme: Day' }).click();
  await expect(select).toHaveValue('night');
  await expectNoHorizontalScroll(page);
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
  await expect(chips.getByRole('link')).toHaveText(['Particulars', 'Crew', 'Reliefs', 'Expiring', 'Certificates', 'Voyage', "Ship's time"]);
  for (const name of ['Particulars', 'Crew', 'Reliefs', 'Expiring', 'Certificates', 'Voyage', "Ship's time"]) await expect(chips.getByRole('link', { name })).toBeVisible();
  await expect(chips.getByRole('link', { name: 'Particulars' })).toHaveAttribute('aria-current', 'page');
  await expectNoHorizontalScroll(page);

  await page.goto('./#/nowhere');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
});

test.describe('theme before the app starts', () => {
  test.use({ serviceWorkers: 'block' }); // so that page.route sees every request

  test('the stored theme is on <html> before any script of the app runs, and a bad value is ignored', async ({ page }) => {
    await freshApp(page); await setupShip(page);
    await page.getByRole('button', { name: 'Theme: Day' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');

    // From here on the app's own scripts never load, so only the inline script in index.html can set the theme.
    await page.route('**/assets/*.js', (route) => route.abort());
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(11, 22, 34)');

    await page.evaluate(() => localStorage.setItem('mp-theme', 'purple'));
    await page.reload();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });
});
