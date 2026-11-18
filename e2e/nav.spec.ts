import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoHorizontalScroll, expectRedOnly, freshApp, openShipSection, setTheme, setupShip } from './helpers';

const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const tab = (page: Page, name: string) => mainNav(page).getByRole('link', { name, exact: true });
const hub = (page: Page) => page.getByRole('navigation', { name: 'Ship sections', exact: true });
const sectionBar = (page: Page) => page.getByRole('navigation', { name: 'Ship section', exact: true });
const pill = (page: Page) => page.getByRole('banner').getByRole('button', { name: /MV / });

const TILES = ['Crew', 'Crew documents', 'Certificates', 'Contracts & reliefs', 'Voyage', "Ship's time", 'Draft survey', 'Particulars'];

/** Each tile, the address it opens and the heading of that screen. */
const SECTIONS: [string, RegExp, string][] = [
  ['Crew', /#\/ship\/crew$/, 'Crew'],
  ['Crew documents', /#\/ship\/crew-documents$/, 'Crew documents'],
  ['Certificates', /#\/ship\/certificates$/, 'Certificates'],
  ['Contracts & reliefs', /#\/ship\/reliefs$/, 'Reliefs'],
  ['Voyage', /#\/ship\/voyage$/, 'Voyage'],
  ["Ship's time", /#\/ship\/time$/, "Ship's time"],
  ['Draft survey', /#\/ship\/survey$/, 'Draft survey'],
  ['Particulars', /#\/ship\/particulars$/, 'Vessel particulars'],
];

/** Each More row, the address it opens and the heading it shows. */
const MORE: [string, RegExp, string][] = [
  ['Tools', /#\/tools$/, 'Tools'],
  ['Library', /#\/library$/, 'Library'],
  ['Profiles', /#\/profiles$/, 'Ship profiles'],
  ['Settings', /#\/settings$/, 'Settings'],
  ['Backup and restore', /#\/settings\?at=backup$/, 'Backup'],
  ['App lock', /#\/settings\?at=lock$/, 'App lock'],
];

test('the bottom bar has Home, Ship, Forms, Budget and More, and lights the tab of the screen', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await expect(mainNav(page).getByRole('link')).toHaveText(['Home', 'Ship', 'Forms', 'Budget', 'More']);
  await expect(tab(page, 'Home')).toHaveAttribute('aria-current', 'page');
  for (const [name, url] of [['Ship', /#\/ship$/], ['Forms', /#\/forms$/], ['Budget', /#\/budget$/], ['More', /#\/more$/], ['Home', /#\/$/]] as const) {
    await tab(page, name).click();
    await expect(page).toHaveURL(url);
    await expect(tab(page, name)).toHaveAttribute('aria-current', 'page');
    await expect(mainNav(page).locator('[aria-current="page"]')).toHaveCount(1);
  }
});

test('the Ship tab opens the hub of eight tiles, each opening its section with a way back', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await tab(page, 'Ship').click();
  await expect(page).toHaveURL(/#\/ship$/);
  await expect(page.getByRole('heading', { name: 'Ship', exact: true })).toBeVisible();
  await expect(hub(page).getByRole('link')).toHaveCount(8);
  for (const [i, name] of TILES.entries()) await expect(hub(page).getByRole('link').nth(i)).toHaveAccessibleName(name);
  await expect(sectionBar(page)).toHaveCount(0);

  for (const [name, url, heading] of SECTIONS) {
    await openShipSection(page, name);
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(sectionBar(page)).toContainText(name);
    await expect(tab(page, 'Ship')).toHaveAttribute('aria-current', 'page');
    await sectionBar(page).getByRole('link', { name: '‹ Ship' }).click();
    await expect(page).toHaveURL(/#\/ship$/);
    await expect(hub(page)).toBeVisible();
  }
});

test('a section screen deeper in names the tile it belongs to', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/crew/new');
  await expect(page.getByRole('heading', { name: 'Add crew member' })).toBeVisible();
  await expect(sectionBar(page)).toContainText('Crew');
  await page.goto('./#/ship/survey/data');
  await expect(sectionBar(page)).toContainText('Draft survey');
  await expect(tab(page, 'Ship')).toHaveAttribute('aria-current', 'page');
});

test('More lists six rows, each opening its screen with More lit', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await tab(page, 'More').click();
  await expect(page.getByRole('heading', { name: 'More', exact: true })).toBeVisible();
  const rows = page.getByRole('main').getByRole('list').getByRole('link');
  await expect(rows).toHaveText(MORE.map(([name]) => name));

  for (const [name, url, heading] of MORE) {
    await tab(page, 'More').click();
    await page.getByRole('main').getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(tab(page, 'More')).toHaveAttribute('aria-current', 'page');
  }
});

test('App lock and Backup and restore scroll to their section of Settings and focus its heading', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.setViewportSize({ width: 360, height: 640 });
  await tab(page, 'More').click();
  await page.getByRole('main').getByRole('link', { name: 'App lock', exact: true }).click();
  const lock = page.getByRole('heading', { name: 'App lock', exact: true });
  await expect(lock).toBeFocused();
  await expect(lock).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(page.locator('#settings-lock')).toContainText('App lock');
  await expect(page.locator('#settings-display')).toContainText('Display');

  await tab(page, 'More').click();
  await page.getByRole('main').getByRole('link', { name: 'Backup and restore', exact: true }).click();
  const backup = page.getByRole('heading', { name: 'Backup', exact: true });
  await expect(backup).toBeFocused();
  await expect(backup).toBeInViewport();
  await expect(page.locator('#settings-backup')).toContainText('Export full backup');
});

test('the ship pill opens Switch ship: a ship is chosen there, and Manage ship profiles opens Profiles', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/profiles');
  await page.getByRole('button', { name: 'New ship' }).click();
  await page.getByLabel('Ship name').fill('MV SEA BREEZE');
  await page.getByRole('button', { name: 'Create ship' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('./#/');
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');
  await expect(pill(page)).toHaveAttribute('aria-haspopup', 'dialog');

  await pill(page).click();
  const sheet = page.getByRole('dialog', { name: 'Switch ship' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: /MV OCEAN STAR/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByRole('button', { name: /MV SEA BREEZE/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(pill(page)).toHaveAttribute('aria-expanded', 'true');
  // The focus starts on the active ship, once the list is in.
  await expect(sheet.getByRole('button', { name: /MV OCEAN STAR/ })).toBeFocused();
  await expectNoHorizontalScroll(page);
  // A sheet from the bottom: the whole width, down to the bottom edge, only its top corners rounded, a line on top only.
  const box = await sheet.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      left: r.left, width: r.width, bottomGap: window.innerHeight - r.bottom, viewport: window.innerWidth,
      corners: [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius],
      borders: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth],
    };
  });
  expect(box).toEqual({
    left: 0, width: box.viewport, bottomGap: 0, viewport: box.viewport,
    corners: ['20px', '20px', '0px', '0px'], borders: ['1px', '0px', '0px', '0px'],
  });
  await sheet.getByRole('button', { name: /MV SEA BREEZE/ }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('banner')).toContainText('MV SEA BREEZE');
  await expect(pill(page)).toBeFocused();
  await expect(pill(page)).toHaveAttribute('aria-expanded', 'false');

  // Escape closes it, and the focus is back on the pill.
  await pill(page).click();
  await expect(page.getByRole('dialog', { name: 'Switch ship' }).getByRole('button', { name: /MV SEA BREEZE/ })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(pill(page)).toBeFocused();

  // So does a tap on the backdrop, above the sheet.
  await pill(page).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.mouse.click(180, 20);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('banner')).toContainText('MV SEA BREEZE');

  await pill(page).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Manage ship profiles' }).click();
  await expect(page).toHaveURL(/#\/profiles$/);
  await expect(page.getByRole('heading', { name: 'Ship profiles' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the old routes still open their screens, and an unknown one is Home', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  const routes: [string, string][] = [
    ['#/ship/particulars', 'Vessel particulars'], ['#/ship/crew/new', 'Add crew member'], ['#/budget/add', 'Quick add'],
    ['#/tools', 'Tools'], ['#/library', 'Library'], ['#/profiles', 'Ship profiles'], ['#/settings', 'Settings'],
  ];
  for (const [hash, heading] of routes) {
    await page.goto(`./${hash}`);
    await expect(page.getByRole('heading', { name: heading, exact: true }), hash).toBeVisible();
  }
  await page.goto('./#/nowhere');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(tab(page, 'Home')).toHaveAttribute('aria-current', 'page');
});

test('the header holds the ship pill, the clock and the theme button: no logo and no Masterpiece title', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  const banner = page.getByRole('banner');
  await expect(banner.getByRole('img')).toHaveCount(0);
  await expect(banner.getByRole('heading')).toHaveCount(0);
  await expect(banner).not.toContainText('Masterpiece');
  await expect(page.getByTestId('ship-clock')).toHaveText('12:00 LT (UTC+03:00)');
  await expect(page.getByTestId('ship-clock').locator('.visually-hidden')).toHaveText(' (UTC+03:00)');
  const header = await banner.boundingBox();
  expect(header?.height).toBe(56);
  const nav = await mainNav(page).boundingBox();
  expect(nav?.height).toBe(64);
});

test('no sideways scroll on the hub, More and the switcher', async ({ page }) => {
  await freshApp(page); await setupShip(page, 'MV OCEAN STAR WITH A VERY LONG MADE-UP NAME');
  await page.goto('./#/ship');
  await expect(hub(page)).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.goto('./#/more');
  await expect(page.getByRole('heading', { name: 'More', exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await pill(page).click();
  await expect(page.getByRole('dialog', { name: 'Switch ship' })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('Night red draws the hub, More and the switcher in red and black only', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await setTheme(page, 'Night red');
  await page.goto('./#/ship');
  await expect(hub(page)).toBeVisible();
  await expectRedOnly(page);
  await page.goto('./#/more');
  await expect(page.getByRole('heading', { name: 'More', exact: true })).toBeVisible();
  await expectRedOnly(page);
  await openShipSection(page, 'Crew');
  await expect(sectionBar(page)).toBeVisible();
  await expectRedOnly(page);
  await pill(page).click();
  await expect(page.getByRole('dialog', { name: 'Switch ship' })).toBeVisible();
  await expectRedOnly(page);
});

test('in High contrast the switcher is still a sheet from the bottom, with a heavy line on top only', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await setTheme(page, 'High contrast');
  await pill(page).click();
  const sheet = page.getByRole('dialog', { name: 'Switch ship' });
  await expect(sheet).toBeVisible();
  const box = await sheet.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      full: r.left === 0 && r.width === window.innerWidth && r.bottom === window.innerHeight,
      corners: [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius],
      borders: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth],
    };
  });
  expect(box).toEqual({ full: true, corners: ['20px', '20px', '0px', '0px'], borders: ['3px', '0px', '0px', '0px'] });
});
