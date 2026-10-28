import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoHorizontalScroll, freshApp, setupShip } from './helpers';

// The app's database is shared by every tab of the app. These tests use two pages of one browser context (so that they
// share the storage) to be the second tab. The clock is 2026-10-25T09:00Z.

const OUTDATED = 'Masterpiece was updated in another tab. Reload to continue.';
const BLOCKED = 'Close Masterpiece in your other tabs to finish the update.';
const OPEN_FAILED = "Masterpiece couldn't open its data. Restart the app; if it keeps happening, free some storage.";
const STORAGE_FULL = 'Storage on this device is full. The change was not saved. Export a backup and free up space.';

/** A page of the app's origin that does not run the app, to hold the database the way another tab would. */
async function plainPage(page: Page): Promise<Page> {
  const other = await page.context().newPage();
  await other.goto('./icon.svg');
  return other;
}

test('another tab upgrades the database: this one stops, says so, and a reload brings it back', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');

  // A newer version of the app in another tab opens the database at a higher version.
  const other = await plainPage(page);
  await other.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('masterpiece', 30);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
      }),
  );

  // The open went through (this tab did not hold it up), and this tab no longer shows the app.
  await expect(page.getByText(OUTDATED)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText(OUTDATED);
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
  await expect(page.getByRole('banner')).toHaveCount(0);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  // Nothing is written from it: the data is as it was.
  const counts = await other.evaluate(
    () =>
      new Promise<{ ships: number; crew: number; snapshots: number }>((resolve, reject) => {
        const request = indexedDB.open('masterpiece');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['ships', 'crew', 'snapshots']);
          const count = (name: string) => new Promise<number>((done) => { tx.objectStore(name).count().onsuccess = (e) => done((e.target as IDBRequest<number>).result); });
          Promise.all([count('ships'), count('crew'), count('snapshots')]).then(([ships, crew, snapshots]) => {
            db.close();
            resolve({ ships, crew, snapshots });
          }, reject);
        };
      }),
  );
  expect(counts).toEqual({ ships: 1, crew: 0, snapshots: 0 });
  await other.close();

  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');
  await expect(page.getByText(OUTDATED)).toHaveCount(0);
});

test('an upgrade that another tab holds up says so, and goes on by itself when the tab lets go', async ({ page }) => {
  // The app before this version, in another tab: version 1 of the database, held open, and it does not close when asked.
  const holder = await plainPage(page);
  await holder.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('masterpiece', 10);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
          const db = request.result;
          for (const name of ['ships', 'crew', 'voyages', 'certificates', 'clockChanges']) {
            const store = db.createObjectStore(name, { keyPath: 'id' });
            if (name !== 'ships') store.createIndex('shipId', 'shipId');
          }
          db.createObjectStore('settings', { keyPath: 'key' });
          db.createObjectStore('snapshots', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
        };
        request.onsuccess = () => {
          (window as unknown as { held: IDBDatabase }).held = request.result;
          resolve();
        };
      }),
  );

  await freshApp(page);
  await expect(page.getByText(BLOCKED)).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(BLOCKED);
  await expect(page.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create your first ship' })).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  await holder.evaluate(() => (window as unknown as { held: IDBDatabase }).held.close());
  await expect(page.getByRole('button', { name: 'Create your first ship' })).toBeVisible();
  await expect(page.getByText(BLOCKED)).toHaveCount(0);
  await holder.close();
});

test.describe('the data cannot be opened', () => {
  /** Every attempt to open the app's database fails with `error`, as a full disk does during an upgrade. */
  async function failOpening(page: Page, error: 'quota' | 'other'): Promise<void> {
    await page.addInitScript((kind) => {
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (this: IDBFactory, ...args: Parameters<IDBFactory['open']>) {
        if (args[0] === 'masterpiece') {
          throw kind === 'quota' ? new DOMException('The quota has been exceeded.', 'QuotaExceededError') : new Error('internal detail 4711');
        }
        return open.apply(this, args);
      };
    }, error);
  }

  test('a full disk shows the storage-full text and Try again, not the error', async ({ page }) => {
    await failOpening(page, 'quota');
    await freshApp(page);
    await expect(page.getByRole('alert')).toHaveText(STORAGE_FULL);
    await expect(page.getByText('QuotaExceededError')).toHaveCount(0);
    await expect(page.getByRole('banner')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create your first ship' })).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    // Try again loads the page again (which fails the same way here, as the disk is still "full").
    await page.evaluate(() => { (window as unknown as { beforeTryAgain: boolean }).beforeTryAgain = true; });
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { beforeTryAgain?: boolean }).beforeTryAgain)).toBeUndefined();
    await expect(page.getByRole('alert')).toHaveText(STORAGE_FULL);
  });

  test('any other failure gives plain guidance and Try again, and none of its own words', async ({ page }) => {
    await failOpening(page, 'other');
    await freshApp(page);
    await expect(page.getByRole('alert')).toHaveText(OPEN_FAILED);
    await expect(page.getByText('internal detail 4711')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
