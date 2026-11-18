import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { allowWrites, expectInputFonts, expectNoHorizontalScroll, expectRedOnly, expectTargets, failWrites, freshApp, setTheme, setupShip, showUpdateBanner } from './helpers';

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

const BODY = () => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.body).color];
const STATUS_BAR = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content');

test('the theme button cycles Day, Dark, Night red and High contrast, each theme persists, and print is black on white', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'day');
  expect(await page.evaluate(STATUS_BAR)).toBe('#0B2545');

  await page.getByRole('button', { name: 'Theme: Day' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(BODY)).toEqual(['rgb(11, 22, 34)', 'rgb(230, 237, 245)']); // Dark keeps today's navy: #0B1622, #E6EDF5
  expect(await page.evaluate(STATUS_BAR)).toBe('#0E1B2B');

  await page.getByRole('button', { name: 'Theme: Dark' }).click();
  await expect(html).toHaveAttribute('data-theme', 'red');
  expect(await page.evaluate(BODY)).toEqual(['rgb(0, 0, 0)', 'rgb(224, 74, 58)']); // Night red: #000000, #E04A3A
  expect(await page.evaluate(STATUS_BAR)).toBe('#000000');
  await expectRedOnly(page);

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'red');
  await page.emulateMedia({ media: 'print' });
  expect(await page.evaluate(BODY)).toEqual(['rgb(255, 255, 255)', 'rgb(0, 0, 0)']);
  await page.emulateMedia({ media: 'screen' });

  await page.getByRole('button', { name: 'Theme: Night red' }).click();
  await expect(html).toHaveAttribute('data-theme', 'contrast');
  expect(await page.evaluate(STATUS_BAR)).toBe('#000000');
  await page.getByRole('button', { name: 'Theme: High contrast' }).click();
  await expect(html).toHaveAttribute('data-theme', 'day');
  expect(await page.evaluate(STATUS_BAR)).toBe('#0B2545');
});

test('the Theme select in Settings and the header button are one setting, and a reload keeps it', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  const select = page.getByLabel('Theme', { exact: true });
  const html = page.locator('html');
  await expect(select.locator('option')).toHaveText(['Day', 'Dark', 'Night red', 'High contrast']);
  await expect(select).toHaveValue('day');
  await expect(html).toHaveAttribute('data-theme', 'day');

  await select.selectOption({ label: 'Dark' });
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Theme: Dark' })).toBeVisible();
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Theme: Dark' })).toBeVisible();
  await expect(select).toHaveValue('dark');

  await select.selectOption({ label: 'High contrast' });
  await expect(html).toHaveAttribute('data-theme', 'contrast');
  await expect(page.getByRole('button', { name: 'Theme: High contrast' })).toBeVisible();

  // The header button changes the same setting, and the select follows it.
  await page.getByRole('button', { name: 'Theme: High contrast' }).click();
  await expect(html).toHaveAttribute('data-theme', 'day');
  await expect(select).toHaveValue('day');
  await page.getByRole('button', { name: 'Theme: Day' }).click();
  await expect(select).toHaveValue('dark');
  await page.getByRole('button', { name: 'Theme: Dark' }).click();
  await expect(select).toHaveValue('red');
  await expectNoHorizontalScroll(page);
});

test('Night red draws nothing but red and black on Home, Settings and the crew form', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await setTheme(page, 'Night red');
  await expectRedOnly(page);
  await page.goto('./#/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expectRedOnly(page);
  await page.goto('./#/ship/crew/new');
  await expect(page.getByRole('heading', { name: 'Add crew member' })).toBeVisible();
  // A date with a value, and its first segment focused: the browser highlights the segment it is in.
  const date = page.getByLabel('Date of birth');
  await date.fill('1980-03-14');
  await date.click({ position: { x: 16, y: 24 } });
  await expect(date).toBeFocused();
  await expectRedOnly(page);
});

test('Night red draws ticked checkboxes and placeholders in red', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await setTheme(page, 'Night red');
  await page.goto('./#/ship/crew/print');
  const ticked = page.locator('input[type="checkbox"]:checked').first();
  await expect(ticked).toBeVisible();
  await ticked.focus();
  await expectRedOnly(page);
  await page.goto('./#/budget/add');
  await expect(page.locator('input[placeholder]').first()).toBeVisible();
  await expectRedOnly(page);
});

test('a device that stored the old Night theme opens in Dark', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.evaluate(() => new Promise<void>((done, failed) => {
    const open = indexedDB.open('masterpiece');
    open.onerror = () => failed(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const store = db.transaction('settings', 'readwrite').objectStore('settings');
      const get = store.get('device');
      get.onsuccess = () => {
        const put = store.put({ ...get.result, theme: 'night' });
        put.onsuccess = () => { db.close(); done(); };
        put.onerror = () => failed(put.error);
      };
    };
  }));
  await page.evaluate(() => localStorage.setItem('mp-theme', 'night'));
  await page.goto('./#/settings');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByLabel('Theme', { exact: true })).toHaveValue('dark');
  await expect(page.getByRole('button', { name: 'Theme: Dark' })).toBeVisible();
});

test('the installed app starts on black, whatever the theme', async ({ page }) => {
  await page.goto('./');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await page.request.get(new URL(href!, page.url()).toString())).json();
  expect([manifest.theme_color, manifest.background_color]).toEqual(['#000000', '#000000']);
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

test('navigation links, the Ship hub tiles, and unknown routes falling back to Home', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  const main = page.getByRole('navigation', { name: 'Main' });
  await expect(main.getByRole('link')).toHaveText(['Home', 'Ship', 'Forms', 'Budget', 'More']);
  for (const name of ['Home', 'Ship', 'Forms', 'Budget', 'More']) await expect(main.getByRole('link', { name, exact: true })).toBeVisible();
  await main.getByRole('link', { name: 'Forms' }).click();
  await expect(page).toHaveURL(/#\/forms$/);
  await expect(main.getByRole('link', { name: 'Forms' })).toHaveAttribute('aria-current', 'page');
  await expectNoHorizontalScroll(page);
  await main.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByRole('navigation', { name: 'Ship sections', exact: true })).toHaveCount(0);

  await main.getByRole('link', { name: 'Ship', exact: true }).click();
  await expect(page).toHaveURL(/#\/ship$/);
  const tiles = page.getByRole('navigation', { name: 'Ship sections', exact: true });
  const names = ['Crew', 'Crew documents', 'Certificates', 'Contracts & reliefs', 'Voyage', "Ship's time", 'Draft survey', 'Particulars'];
  // By accessible name: each tile also holds its status line, which is its description.
  await expect(tiles.getByRole('link')).toHaveCount(names.length);
  for (const [i, name] of names.entries()) await expect(tiles.getByRole('link').nth(i)).toHaveAccessibleName(name);
  for (const name of names) await expect(tiles.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Ship', exact: true })).toHaveAttribute('aria-current', 'page');
  await expectNoHorizontalScroll(page);

  await page.goto('./#/nowhere');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
});

/** Adds one crew member through the form, so that the edit form has its documents and buttons. */
async function addCrewMember(page: Page): Promise<void> {
  await page.goto('./#/ship/crew/new');
  await page.getByLabel('Surname').fill('EXAMPLE');
  await page.getByLabel('Given names').fill('R.');
  await page.getByLabel('Rank').selectOption({ label: 'Master' });
  await page.getByLabel('Date of birth').fill('1980-03-14');
  await page.getByLabel('Passport expiry').fill('2030-01-01');
  await page.getByLabel("Seaman's book expiry").fill('2030-01-01');
  await page.getByLabel('Sign-on date').fill('2026-06-01');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew$/);
}

test('every control is at least 44 px and every input 16 px: Home, Settings, the crew form and quick add', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await expect(page.getByRole('heading', { name: 'Home' })).toBeAttached();
  await expectTargets(page); await expectInputFonts(page);

  await page.goto('./#/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  // The 24 px checkbox is tapped through its label, which is the 48 px row.
  const auto = page.getByRole('checkbox', { name: 'Night red automatically' }).locator('xpath=ancestor::label');
  expect((await auto.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await expectTargets(page); await expectInputFonts(page);

  await addCrewMember(page);
  await page.getByRole('list', { name: 'Crew' }).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Surname')).toHaveValue('EXAMPLE');
  await expectTargets(page); await expectInputFonts(page);

  await page.goto('./#/budget/add');
  const catchUp = page.getByRole('link', { name: 'Catch up' });
  await expect(catchUp).toBeVisible();
  expect((await catchUp.boundingBox())!.height).toBeGreaterThanOrEqual(48); // 63×20 before (spec §7)
  await expectTargets(page); await expectInputFonts(page);
});

test('Night red: a confirm dialog, the error toast and the update banner are red and black only', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await setTheme(page, 'Night red');

  await page.goto('./#/profiles');
  await page.getByRole('list', { name: 'Ships' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectRedOnly(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('./#/ship/certificates/new');
  await page.getByLabel('Certificate', { exact: true }).selectOption({ label: 'IOPP' });
  await failWrites(page);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toContainText('Storage on this device is full.');
  await expectRedOnly(page);
  await page.getByRole('button', { name: 'Dismiss error' }).click();

  await page.goto('./#/');
  await showUpdateBanner(page);
  await expectRedOnly(page);
});

/** The computed colours of an element, its border, radius and shadow. */
const look = (selector: string) => (sel: string) => {
  const s = getComputedStyle(document.querySelector(sel)!);
  return { bg: s.backgroundColor, color: s.color, border: s.borderTopColor, radius: s.borderTopLeftRadius, shadow: s.boxShadow };
};

test('the toast is filled in Day and a tinted box with a red edge in Dark and Night red; dialogs are surface-1 with a large radius', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/certificates/new');
  await page.getByLabel('Certificate', { exact: true }).selectOption({ label: 'IOPP' });
  await failWrites(page);
  await page.getByRole('button', { name: 'Save' }).click();
  const toast = page.locator('.toast');
  await expect(toast).toBeVisible();
  await allowWrites(page); // so that the theme button below can save; the toast stays until it is dismissed
  // Day: --danger with --on-danger.
  expect(await page.evaluate(look('.toast'), '.toast')).toMatchObject({ bg: 'rgb(179, 38, 30)', color: 'rgb(255, 255, 255)' });
  await page.getByRole('button', { name: 'Theme: Day' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // Dark: --danger-bg, --text, a --danger border.
  expect(await page.evaluate(look('.toast'), '.toast')).toMatchObject({ bg: 'rgb(61, 18, 16)', color: 'rgb(230, 237, 245)', border: 'rgb(255, 107, 94)' });
  await page.getByRole('button', { name: 'Theme: Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'red');
  // Night red: the same, in its reds, and no shadow.
  expect(await page.evaluate(look('.toast'), '.toast')).toEqual({ bg: 'rgb(74, 6, 6)', color: 'rgb(224, 74, 58)', border: 'rgb(255, 90, 69)', radius: '12px', shadow: 'none' });
  await page.getByRole('button', { name: 'Dismiss error' }).click();

  await page.goto('./#/profiles');
  await page.getByRole('list', { name: 'Ships' }).getByRole('button', { name: 'Delete' }).click();
  const dialog = page.locator('dialog.dialog[open]');
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(look('dialog.dialog[open]'), 'dialog.dialog[open]')).toMatchObject({ bg: 'rgb(18, 0, 0)', radius: '20px' });
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('dialog.dialog[open]')!, '::backdrop').backgroundColor)).toBe('rgba(0, 0, 0, 0.6)');
});

test.describe('theme before the app starts', () => {
  test.use({ serviceWorkers: 'block' }); // so that page.route sees every request

  test('the stored theme is on <html> before any script of the app runs, and a bad value is ignored', async ({ page }) => {
    await freshApp(page); await setupShip(page);
    await page.getByRole('button', { name: 'Theme: Day' }).click();
    await page.getByRole('button', { name: 'Theme: Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'red');

    // From here on the app's own scripts never load, so only the inline script in index.html can set the theme.
    await page.route('**/assets/*.js', (route) => route.abort());
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'red');
    expect(await page.evaluate(BODY)).toEqual(['rgb(0, 0, 0)', 'rgb(224, 74, 58)']);
    expect(await page.evaluate(STATUS_BAR)).toBe('#000000');

    // A mirror from before piece 7 still says night: it paints Dark.
    await page.evaluate(() => localStorage.setItem('mp-theme', 'night'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(BODY)).toEqual(['rgb(11, 22, 34)', 'rgb(230, 237, 245)']);
    expect(await page.evaluate(STATUS_BAR)).toBe('#0E1B2B');

    await page.evaluate(() => localStorage.setItem('mp-theme', 'purple'));
    await page.reload();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
    expect(await page.evaluate(STATUS_BAR)).toBe('#0B2545');
  });
});
