import { test, expect } from '@playwright/test';

test('app loads with title', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveTitle('Masterpiece');
  await expect(page.getByRole('heading', { name: 'Masterpiece' })).toBeVisible();
});

test('works offline after first visit', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Masterpiece' })).toBeVisible();
});

test('manifest is installable', async ({ page, request }) => {
  await page.goto('./');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const m = await (await request.get(new URL(href!, page.url()).href)).json();
  expect(m.name).toBe('Masterpiece');
  expect(m.display).toBe('standalone');
  expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
});
