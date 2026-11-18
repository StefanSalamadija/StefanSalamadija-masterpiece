import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoHorizontalScroll, freshApp, setupShip } from './helpers';

const row = (page: Page, id: string) => page.getByTestId(`unit-${id}`);

test("tools: opens offline from Home's Converter tile and lists the tools", async ({ page, context }) => {
  await freshApp(page); await setupShip(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload(); // now served by the service worker, so the Tools chunk must come from its cache
  await page.getByRole('navigation', { name: 'Quick actions' }).getByRole('link', { name: 'Converter' }).click();
  await expect(page).toHaveURL(/#\/tools$/);
  await expect(page.getByRole('heading', { name: 'Tools' })).toBeVisible();
  const links = page.getByRole('list', { name: 'Tools' }).getByRole('link');
  await expect(links).toHaveCount(6);
  await links.filter({ hasText: 'Length & distance' }).click();
  await expect(row(page, 'm')).toBeVisible();
  await page.setViewportSize({ width: 360, height: 740 });
  await expectNoHorizontalScroll(page);
});

test('tools: typing metres fills the other rows, and the last edited row leads', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/tools/length');
  await row(page, 'm').fill('12,5');
  await expect(row(page, 'ft')).toHaveValue('41.01');
  await expect(row(page, 'ftin')).toHaveValue(`41' 0¼"`);
  await expect(row(page, 'shackle')).toHaveValue('0.45');
  await row(page, 'ft').fill('10');
  await expect(row(page, 'm')).toHaveValue('3.048');
  await expect(row(page, 'ft')).toHaveValue('10');
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(row(page, 'm')).toHaveValue('');
});

test('tools: an invalid entry marks only its own row', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/tools/length');
  await row(page, 'm').fill('-1');
  await expect(page.getByRole('alert')).toHaveText('Must be 0 or more');
  await expect(row(page, 'm')).toHaveAttribute('aria-invalid', 'true');
  await expect(row(page, 'ft')).toHaveValue('');
});

test('tools: quantity tabs, and the last used group is marked', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/tools/mass-volume');
  await row(page, 't').fill('1');
  await page.getByRole('tab', { name: 'Volume' }).click();
  await expect(row(page, 'm3')).toBeVisible();
  await expect(row(page, 'm3')).toHaveValue('');
  await page.goto('./#/tools');
  await expect(page.getByRole('list', { name: 'Tools' }).getByRole('listitem').filter({ hasText: 'Mass & volume' })).toContainText('Last used');
  await page.goto('./#/tools/nonsense');
  await expect(page.getByText('Unknown tool')).toBeVisible();
});

test('tools: volume ↔ mass works out the mass, in any unit', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/tools/volume-mass');
  await page.getByLabel('Volume', { exact: true }).fill('100');
  await page.getByLabel('Density', { exact: true }).fill('0,991');
  const mass = page.getByLabel('Mass', { exact: true });
  await expect(mass).toHaveValue('99.100');
  await expect(page.locator('.tool-calculated')).toContainText('Mass');
  await page.getByLabel('Mass unit').selectOption('lt');
  await expect(mass).toHaveValue('97.535');
  // Mass typed in becomes an input, and the oldest input (volume) is worked out instead.
  await mass.fill('50');
  await expect(page.getByLabel('Volume', { exact: true })).toHaveValue('51.264');
  await page.getByLabel('Density', { exact: true }).fill('0');
  await expect(page.getByRole('alert')).toHaveText('Must be above 0');
  await expectNoHorizontalScroll(page);
});

test('tools: speed · distance · time gives the time and the ETA, across a planned clock change', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/tools/sdt');
  await page.getByLabel('Speed (kn)', { exact: true }).fill('12');
  await page.getByLabel('Distance (NM)', { exact: true }).fill('120');
  await expect(page.getByLabel('Time', { exact: true })).toHaveValue('10:00');
  // 09:00Z + 10 h = 19:00Z, 22:00 at UTC+03:00.
  await expect(page.getByTestId('eta')).toHaveText(/^ETA 25 Oct 22:0\d SMT \(UTC\+03:00\) · 19:0\d UTC$/);
  await expect(page.getByText(/Clock change before arrival/)).toHaveCount(0);
  await page.goto('./#/ship/time');
  await page.getByLabel("Change at (ship's time)").fill('2026-10-25T18:00');
  await page.getByLabel('New offset').selectOption({ label: 'UTC+04:00' });
  await page.getByRole('button', { name: 'Schedule' }).click();
  await page.goto('./#/tools/sdt');
  await page.getByLabel('Speed (kn)', { exact: true }).fill('12');
  await page.getByLabel('Distance (NM)', { exact: true }).fill('120');
  await expect(page.getByTestId('eta')).toHaveText(/^ETA 25 Oct 23:0\d SMT \(UTC\+04:00\) · 19:0\d UTC$/);
  await expect(page.getByText('Clock change before arrival: UTC+04:00 from 25 Oct 18:00')).toBeVisible();
  await page.getByLabel('Speed (kn)', { exact: true }).fill('0');
  await expect(page.getByRole('alert')).toHaveText('Must be above 0');
  await expect(page.getByTestId('eta')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test('tools: Beaufort shows its knot band, from a speed or a force', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/tools/physical');
  await row(page, 'kn').fill('30');
  await expect(row(page, 'bf')).toHaveValue('7');
  await expect(page.getByText('Force 7: 28–33 kn')).toBeVisible();
  await row(page, 'bf').fill('6');
  await expect(page.getByText('Force 6: 22–27 kn')).toBeVisible();
});
