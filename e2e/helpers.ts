import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** A new browser profile (so no data), with the clock fixed to `opts.time` (default 2026-10-25T09:00Z) but still running. */
export async function freshApp(page: Page, opts: { time?: string } = {}): Promise<void> {
  await page.clock.install({ time: opts.time ?? '2026-10-25T09:00:00Z' });
  await page.goto('./');
}

/**
 * Creates the first ship from the welcome screen. `offset` is the label of the ship's-time option, such as `UTC+03:00`.
 * After `Create ship` the app shows either the protect step (heading `Protect Masterpiece`, which covers the whole screen) or
 * the header (banner). With `skipLock` (the default) the protect step is answered with `Skip for now`, and the helper then
 * waits for the header to show the ship. With `skipLock: false` it returns as soon as either is on screen, so a test of the
 * protect step finds it still there.
 */
export async function setupShip(
  page: Page, name = 'MV OCEAN STAR', offset = 'UTC+03:00', opts: { skipLock?: boolean } = {},
): Promise<void> {
  const { skipLock = true } = opts;
  await page.getByRole('button', { name: 'Create your first ship' }).click();
  await page.getByLabel('Ship name').fill(name);
  await page.getByLabel("Ship's time (UTC offset)").selectOption({ label: offset });
  await page.getByRole('button', { name: 'Create ship' }).click();
  const protect = page.getByRole('heading', { name: 'Protect Masterpiece' });
  const header = page.getByRole('banner');
  // Never both at once: the protect step is a full screen of its own, with no header behind it.
  await expect(protect.or(header)).toBeVisible();
  if (!skipLock) return;
  if (await protect.isVisible()) await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(header).toContainText(name);
}

/** At phone width (360 px) the page must not scroll sideways. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await page.setViewportSize({ width: 360, height: 740 });
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(360);
}

type TestHooks = { restoreWrites?: () => void; releaseWrites?: () => void };

/** From now on every write fails the way a full disk does, until `allowWrites`. */
export function failWrites(page: Page): Promise<void> {
  return page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as TestHooks).restoreWrites = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = () => {
      throw new DOMException('The disk is full.', 'QuotaExceededError');
    };
  });
}

export function allowWrites(page: Page): Promise<void> {
  return page.evaluate(() => (window as unknown as TestHooks).restoreWrites?.());
}

/** A second connection keeps a write transaction on the ship tables open, so the app's own writes have to wait for `releaseWrites`. */
export function holdWrites(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((started, failed) => {
        let hold = true;
        (window as unknown as TestHooks).releaseWrites = () => {
          hold = false;
        };
        const open = indexedDB.open('masterpiece');
        open.onerror = () => failed(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['ships', 'clockChanges', 'settings'], 'readwrite');
          tx.oncomplete = () => db.close();
          const store = tx.objectStore('settings');
          const keepOpen = (): void => {
            if (hold) store.get('device').onsuccess = keepOpen;
          };
          store.get('device').onsuccess = () => {
            started();
            keepOpen();
          };
        };
      }),
  );
}

export function releaseWrites(page: Page): Promise<void> {
  return page.evaluate(() => (window as unknown as TestHooks).releaseWrites?.());
}
