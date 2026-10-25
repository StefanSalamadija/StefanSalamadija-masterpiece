import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** A new browser profile (so no data), with the clock fixed to `opts.time` (default 2026-10-25T09:00Z) but still running. */
export async function freshApp(page: Page, opts: { time?: string } = {}): Promise<void> {
  await page.clock.install({ time: opts.time ?? '2026-10-25T09:00:00Z' });
  await page.goto('./');
}

/**
 * Creates the first ship from the welcome screen. `offset` is the label of the ship's-time option, such as `UTC+03:00`.
 * With `skipLock` (the default) it also clicks `Skip for now` on the protect step, if that step appears, and then waits
 * for the header to show the ship. Without it, it returns as soon as the header or the protect step is on screen.
 */
export async function setupShip(
  page: Page, name = 'MV OCEAN STAR', offset = 'UTC+03:00', opts: { skipLock?: boolean } = {},
): Promise<void> {
  const { skipLock = true } = opts;
  await page.getByRole('button', { name: 'Create your first ship' }).click();
  await page.getByLabel('Ship name').fill(name);
  await page.getByLabel("Ship's time (UTC offset)").selectOption({ label: offset });
  await page.getByRole('button', { name: 'Create ship' }).click();
  // Either the header of the app, or the protect step, which may cover the whole screen without it.
  const header = page.getByRole('banner');
  const skip = page.getByRole('button', { name: 'Skip for now' });
  await expect(header.or(skip).first()).toBeVisible();
  if (!skipLock) return;
  if (await skip.isVisible()) await skip.click();
  await expect(header).toContainText(name);
}

/** At phone width (360 px) the page must not scroll sideways. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await page.setViewportSize({ width: 360, height: 740 });
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(360);
}
