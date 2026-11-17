import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoHorizontalScroll, expectRedOnly, freshApp, setupShip } from './helpers';

// The ship is at UTC+03:00, so its time is three hours ahead of UTC. Night red runs 18:00–06:00 ship's time by default.

const html = (page: Page) => page.locator('html');
const themeButton = (page: Page) => page.getByRole('banner').getByRole('button', { name: /^Theme: / });
const autoMark = (page: Page) => themeButton(page).getByText('A', { exact: true });
const STATUS_BAR = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content');

/** The settings as stored in IndexedDB, to check what was really written. */
function storedSettings(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const open = indexedDB.open('masterpiece');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('settings').objectStore('settings').get('device');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(request.result as Record<string, unknown>);
          };
        };
      }),
  );
}

/** A new device with a ship at UTC+03:00, the clock at `utc`, and Night red automatically turned on in Settings. */
async function autoNightAt(page: Page, utc: string): Promise<void> {
  await freshApp(page, { time: utc });
  await setupShip(page);
  await page.goto('./#/settings');
  await page.getByLabel('Night red automatically').check();
  await expect(page.getByLabel("From (ship's time)")).toHaveValue('18:00');
  await expect(page.getByLabel("To (ship's time)")).toHaveValue('06:00');
  await expect.poll(async () => (await storedSettings(page)).nightAuto).toBe(true);
}

test('Night red comes on by itself at 18:00 ship\'s time', async ({ page }) => {
  await autoNightAt(page, '2026-11-17T14:59:00Z'); // 17:59 on board
  await expect(html(page)).toHaveAttribute('data-theme', 'day');
  await expect(themeButton(page)).toHaveAccessibleName('Theme: Day, automatic');
  await expect(autoMark(page)).toBeVisible();

  await page.clock.runFor(60_000);
  await expect(html(page)).toHaveAttribute('data-theme', 'red');
  await expect(themeButton(page)).toHaveAccessibleName('Theme: Night red, automatic');
  await page.goto('./#/');
  await expect(html(page)).toHaveAttribute('data-theme', 'red');
  await expectRedOnly(page);
});

test('a tap at night holds until the next switch, then automatic takes over again', async ({ page }) => {
  await autoNightAt(page, '2026-11-17T02:58:00Z'); // 05:58 on board
  await expect(html(page)).toHaveAttribute('data-theme', 'red');
  await expect(themeButton(page)).toHaveAccessibleName('Theme: Night red, automatic');

  await themeButton(page).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'contrast');
  await expect(themeButton(page)).toHaveAccessibleName('Theme: High contrast, until 06:00');
  await expect(autoMark(page)).toBeVisible(); // automatic night is still on, a held theme or not
  expect((await storedSettings(page)).themeOverride).toEqual({ theme: 'contrast', until: '2026-11-17T06:00' });

  await page.clock.runFor(120_000); // 06:00 on board
  await expect(html(page)).toHaveAttribute('data-theme', 'day');
  await expect(themeButton(page)).toHaveAccessibleName('Theme: Day, automatic');
  await expect.poll(async () => 'themeOverride' in (await storedSettings(page))).toBe(false);
  expect((await storedSettings(page)).theme).toBe('day');
});

test('a clock change into the window turns Night red on', async ({ page }) => {
  await autoNightAt(page, '2026-11-17T14:20:00Z'); // 17:20 on board
  await expect(html(page)).toHaveAttribute('data-theme', 'day');
  await page.goto('./#/ship/time');
  await page.getByLabel("Change at (ship's time)").fill('2026-11-17T17:30');
  await page.getByLabel('New offset').selectOption({ label: 'UTC+04:00' });
  await page.getByRole('button', { name: 'Schedule' }).click();
  await expect(page.getByRole('list', { name: 'History' }).getByRole('listitem')).toHaveCount(2);
  await expect(html(page)).toHaveAttribute('data-theme', 'day');

  await page.clock.runFor(11 * 60_000); // 14:31Z: the clocks read 18:31 at UTC+04:00
  await expect(page.getByTestId('ship-clock')).toContainText('(UTC+04:00)');
  await expect(html(page)).toHaveAttribute('data-theme', 'red');
});

test.describe('automatic night before the app starts', () => {
  test.use({ serviceWorkers: 'block' }); // so that page.route sees every request

  test('the first paint is already Night red inside the window', async ({ page }) => {
    await autoNightAt(page, '2026-11-17T16:00:00Z'); // 19:00 on board
    await expect(html(page)).toHaveAttribute('data-theme', 'red');

    // From here on the app's own scripts never load, so only the inline script in index.html can set the theme.
    await page.route('**/assets/*.js', (route) => route.abort());
    await page.reload();
    await expect(html(page)).toHaveAttribute('data-theme', 'red');
    expect(await page.evaluate(STATUS_BAR)).toBe('#000000');
  });
});

test('with automatic night off, a tap changes the base theme and a reload keeps it', async ({ page }) => {
  await freshApp(page, { time: '2026-11-17T16:00:00Z' }); // 19:00 on board, but automatic night is off
  await setupShip(page);
  await expect(html(page)).toHaveAttribute('data-theme', 'day');
  await expect(themeButton(page)).toHaveAccessibleName('Theme: Day');
  await expect(autoMark(page)).toHaveCount(0);
  await themeButton(page).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  await expect(themeButton(page)).toHaveAccessibleName('Theme: Dark');
  expect((await storedSettings(page)).theme).toBe('dark');
  await page.reload();
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  await expect(themeButton(page)).toHaveAccessibleName('Theme: Dark');
});

test('Settings: the night hours are chosen from lists, and From must differ from To', async ({ page }) => {
  await autoNightAt(page, '2026-11-17T09:00:00Z');
  await expect(page.getByText("Between From and To in ship's time the app is Night red.")).toBeVisible();
  const from = page.getByLabel("From (ship's time)");
  await expect(from.locator('option')).toHaveCount(96);

  await from.selectOption('06:00');
  await expect(page.getByRole('alert')).toHaveText('From and To must differ.');
  await expect(from).toHaveAttribute('aria-invalid', 'true');
  expect((await storedSettings(page)).nightFrom).toBe('18:00'); // not saved

  await from.selectOption('20:15');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(async () => (await storedSettings(page)).nightFrom).toBe('20:15');

  await expectNoHorizontalScroll(page);

  // Turned off, the hours go out of sight and are kept.
  await page.getByLabel('Night red automatically').uncheck();
  await expect(from).toHaveCount(0);
  await expect.poll(async () => (await storedSettings(page)).nightAuto).toBe(false);
  expect((await storedSettings(page)).nightFrom).toBe('20:15');
});

test('Settings: a change of the night settings, or of the Theme select, ends a held theme', async ({ page }) => {
  await autoNightAt(page, '2026-11-17T16:00:00Z'); // 19:00 on board
  await themeButton(page).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'contrast');
  await page.getByLabel("To (ship's time)").selectOption('07:00');
  await expect(html(page)).toHaveAttribute('data-theme', 'red');
  await expect.poll(async () => 'themeOverride' in (await storedSettings(page))).toBe(false);

  await themeButton(page).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'contrast');
  await page.getByLabel('Theme', { exact: true }).selectOption({ label: 'Dark' });
  await expect(html(page)).toHaveAttribute('data-theme', 'red'); // still the window: the base theme is Dark
  await expect.poll(async () => 'themeOverride' in (await storedSettings(page))).toBe(false);
  expect((await storedSettings(page)).theme).toBe('dark');
});
