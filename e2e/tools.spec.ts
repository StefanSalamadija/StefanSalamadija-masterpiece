import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoHorizontalScroll, freshApp, setupShip } from './helpers';

const row = (page: Page, id: string) => page.getByTestId(`unit-${id}`);

test('tools: opens offline from Home and lists the tools', async ({ page, context }) => {
  await freshApp(page); await setupShip(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload(); // now served by the service worker, so the Tools chunk must come from its cache
  await page.getByRole('link', { name: /^Tools/ }).click();
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
