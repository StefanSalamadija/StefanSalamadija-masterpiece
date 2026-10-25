import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { allowWrites, expectNoHorizontalScroll, failWrites, freshApp, setupShip } from './helpers';

// The clock is 2026-10-25T09:00Z and the ship is at UTC+03:00, so the ship's clock reads 12:00. It keeps running.

const clock = (page: Page) => page.getByTestId('ship-clock');
const history = (page: Page) => page.getByRole('list', { name: 'History' });
const historyItems = (page: Page) => history(page).getByRole('listitem');
const previousVoyages = (page: Page) => page.getByRole('list', { name: 'Previous voyages' });
// "Next port" alone would match "Agents at next port" as well.
const nextPort = (page: Page) => page.getByLabel('Next port', { exact: true });

type Stored = Record<string, unknown> & { id: string; deleted: boolean; createdAt: string };

/** Every record of a table as stored in IndexedDB, deleted ones included, oldest first, to check what was really written. */
function stored(page: Page, table: 'voyages' | 'clockChanges'): Promise<Stored[]> {
  return page.evaluate(
    (name) =>
      new Promise<Stored[]>((resolve, reject) => {
        const open = indexedDB.open('masterpiece');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction(name).objectStore(name).getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve((request.result as Stored[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
          };
        };
      }),
    table,
  );
}

test('ship time: advance, schedule, takes effect', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/time');
  await page.getByRole('button', { name: 'Advance 1 h' }).click();
  await expect(page.getByTestId('ship-clock')).toHaveText('13:00 LT (UTC+04:00)');
  await page.getByLabel("Change at (ship's time)").fill('2026-10-26T02:00');
  await page.getByLabel('New offset').selectOption({ label: 'UTC+05:00' });
  await page.getByRole('button', { name: 'Schedule' }).click();
  const scheduled = historyItems(page).filter({ hasText: 'Scheduled' });
  await expect(scheduled).toContainText('UTC+05:00');
  // 02:00 on the 26th at the offset in effect now (+04:00) is 22:00Z on the 25th.
  expect((await stored(page, 'clockChanges')).map((c) => c.effectiveAt).pop()).toBe('2026-10-25T22:00:00.000Z');
  await page.clock.fastForward('14:00:00');                      // past 2026-10-25T22:00Z
  await expect(page.getByTestId('ship-clock')).toContainText('(UTC+05:00)');
  await expect(historyItems(page).filter({ hasText: 'Scheduled' })).toHaveCount(0);
  await expect(history(page).getByRole('button', { name: 'Cancel' })).toHaveCount(0);   // it has happened: it stays
  await expectNoHorizontalScroll(page);
});

test('ship time: shows the ship time and its offset, and a clock change from the header follows at once', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/time');
  await expect(page.getByRole('heading', { name: "Ship's time" })).toBeVisible();
  await expect(page.getByText(/^Ship's time 12:\d{2} \(UTC\+03:00\)$/)).toBeVisible();
  await page.getByRole('button', { name: 'Retard 1 h' }).click();
  await expect(page.getByText(/^Ship's time 11:\d{2} \(UTC\+02:00\)$/)).toBeVisible();
});

test('ship time: Advance twice stacks to +2 h, newest change first in the history', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/time');
  await page.getByRole('button', { name: 'Advance 1 h' }).click();
  await page.getByRole('button', { name: 'Advance 1 h' }).click();
  await expect(clock(page)).toContainText('(UTC+05:00)');
  const items = historyItems(page);
  await expect(items).toHaveCount(3);
  // Each change is shown at the ship's time of the offset in effect just before it.
  await expect(items.nth(0)).toHaveText(/^2026-10-25 13:\d{2} → UTC\+05:00$/);
  await expect(items.nth(1)).toHaveText(/^2026-10-25 12:\d{2} → UTC\+04:00$/);
  await expect(items.nth(2)).toHaveText(/^2026-10-25 12:\d{2} → UTC\+03:00$/);
  expect((await stored(page, 'clockChanges')).map((c) => c.toOffsetMinutes)).toEqual([180, 240, 300]);
});

test('ship time: a double click moves the clock once', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/time');
  await page.getByRole('button', { name: 'Advance 1 h' }).dblclick();
  await expect(clock(page)).toContainText('(UTC+04:00)');
  await expect(historyItems(page)).toHaveCount(2);
  expect(await stored(page, 'clockChanges')).toHaveLength(2);
});

test('ship time: Retard 1 h sets the clock back an hour', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/time');
  await page.getByRole('button', { name: 'Retard 1 h' }).click();
  await expect(clock(page)).toHaveText('11:00 LT (UTC+02:00)');
  await expect(historyItems(page).first()).toHaveText(/^2026-10-25 12:\d{2} → UTC\+02:00$/);
});

test('ship time: Set offset and Apply set the clock to any offset, and the 1 h buttons stop at the ends', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/time');
  const apply = page.getByRole('button', { name: 'Apply' });
  await expect(page.getByLabel('Set offset')).toHaveValue('180');   // the current offset
  await expect(apply).toBeDisabled();                                // nothing to apply yet
  await page.getByLabel('Set offset').selectOption({ label: 'UTC+05:30' });
  await apply.click();
  await expect(clock(page)).toHaveText('14:30 LT (UTC+05:30)');
  await expect(historyItems(page).first()).toHaveText(/^2026-10-25 12:\d{2} → UTC\+05:30$/);
  await expect(page.getByLabel('Set offset')).toHaveValue('330');
  await expect(apply).toBeDisabled();

  await page.getByLabel('Set offset').selectOption({ label: 'UTC+14:00' });
  await apply.click();
  await expect(clock(page)).toContainText('(UTC+14:00)');
  await expect(page.getByRole('button', { name: 'Advance 1 h' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Retard 1 h' })).toBeEnabled();

  await page.getByLabel('Set offset').selectOption({ label: 'UTC-12:00' });
  await apply.click();
  await expect(clock(page)).toContainText('(UTC-12:00)');
  await expect(page.getByRole('button', { name: 'Retard 1 h' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Advance 1 h' })).toBeEnabled();
  expect((await stored(page, 'clockChanges')).map((c) => c.toOffsetMinutes)).toEqual([180, 330, 840, -720]);
  await expectNoHorizontalScroll(page);
});

test('ship time: a time that is not in the future cannot be scheduled', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/time');
  const when = page.getByLabel("Change at (ship's time)");
  const schedule = page.getByRole('button', { name: 'Schedule' });
  await schedule.click();
  await expect(page.getByRole('alert')).toHaveText('Enter the date and time of the change.');
  await expect(when).toBeFocused();

  // 10:00 ship's time is 07:00Z, two hours ago.
  await when.fill('2026-10-25T10:00');
  await page.getByLabel('New offset').selectOption({ label: 'UTC+05:00' });
  await schedule.click();
  await expect(page.getByRole('alert')).toHaveText('Choose a time in the future.');
  await expect(when).toBeFocused();
  await expect(historyItems(page)).toHaveCount(1);
  expect(await stored(page, 'clockChanges')).toHaveLength(1);

  // The message goes as soon as the time is changed, and a time ahead is accepted.
  await when.fill('2026-10-25T23:00');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await schedule.click();
  await expect(historyItems(page)).toHaveCount(2);
  await expect(when).toHaveValue('');
});

test('ship time: a scheduled change can be cancelled, a change that has happened cannot', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/time');
  await page.getByLabel("Change at (ship's time)").fill('2026-10-26T02:00');
  await page.getByLabel('New offset').selectOption({ label: 'UTC+05:00' });
  await page.getByRole('button', { name: 'Schedule' }).click();
  const items = historyItems(page);
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Scheduled');
  await expect(items.nth(0)).toContainText('2026-10-26 02:00 → UTC+05:00');
  // The one that happened (the ship's first) has neither the mark nor a button.
  await expect(items.nth(1)).not.toContainText('Scheduled');
  await expect(items.nth(1).getByRole('button')).toHaveCount(0);

  await items.nth(0).getByRole('button', { name: 'Cancel' }).click();
  await expect(items).toHaveCount(1);
  await expect(history(page).getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  const records = await stored(page, 'clockChanges');
  expect(records.map((c) => [c.toOffsetMinutes, c.deleted])).toEqual([[180, false], [300, true]]);   // soft-deleted, not removed

  // Cancelling the change did not touch the clock.
  await expect(clock(page)).toContainText('(UTC+03:00)');
});

test('ship time: a failed write is reported and nothing is changed; trying again works', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/time');
  await failWrites(page);
  await page.getByRole('button', { name: 'Advance 1 h' }).click();
  await expect(page.getByRole('alert')).toContainText('Storage on this device is full.');
  await expect(clock(page)).toContainText('(UTC+03:00)');
  await expect(historyItems(page)).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Advance 1 h' })).toBeEnabled();
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await allowWrites(page);
  await page.getByRole('button', { name: 'Advance 1 h' }).click();
  await expect(clock(page)).toContainText('(UTC+04:00)');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('ship time: the ship nav leads to the screen', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Ship', exact: true }).click();
  await page.getByRole('navigation', { name: 'Ship sections' }).getByRole('link', { name: "Ship's time" }).click();
  await expect(page).toHaveURL(/#\/ship\/time$/);
  await expect(page.getByRole('button', { name: 'Advance 1 h' })).toBeVisible();
});

test('voyage save and start new', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/voyage');
  await page.getByLabel('Voyage no.').fill('V-2611'); await nextPort(page).fill('Rotterdam');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Start new voyage' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start new voyage' }).click();
  await expect(page.getByLabel('Voyage no.')).toHaveValue('');
  await expect(previousVoyages(page).getByRole('listitem').filter({ hasText: 'V-2611' })).toBeVisible();
  await expect(previousVoyages(page).getByRole('listitem')).toHaveText('V-2611 · — → Rotterdam');
  await expectNoHorizontalScroll(page);
});

test('voyage: Start new voyage is not offered until there is a voyage', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/voyage');
  await expect(page.getByLabel('Voyage no.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start new voyage' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Previous voyages' })).toBeVisible();
  await expect(page.getByText('No previous voyages yet.')).toBeVisible();
  await expect(previousVoyages(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Save' }).click();             // an empty voyage may be saved: nothing is required
  await expect(page.getByRole('button', { name: 'Start new voyage' })).toBeVisible();
  expect(await stored(page, 'voyages')).toHaveLength(1);
});

test('voyage: the ETA and its offset are saved, kept over a reload, and stored as typed', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/voyage');
  await expect(page.getByLabel('ETA UTC offset')).toHaveValue('180');   // the ship's offset now
  await page.getByLabel('Voyage no.').fill('V-2611');
  await page.getByLabel('Last port').fill('Santos');
  await nextPort(page).fill('Rotterdam');
  await page.getByLabel('ETA (local)').fill('2026-11-02T14:30');
  await page.getByLabel('ETA UTC offset').selectOption({ label: 'UTC+01:00' });
  await page.getByLabel('Cargo').fill('32,000 MT soybeans');
  await page.getByLabel('Charterers').fill('ADM');
  await page.getByLabel('Agents at next port').fill('Wilhelmsen Rotterdam\n+31 10 555 0100');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Voyage no.')).toHaveValue('V-2611');
  await expect(page.getByLabel('Last port')).toHaveValue('Santos');
  await expect(nextPort(page)).toHaveValue('Rotterdam');
  await expect(page.getByLabel('ETA (local)')).toHaveValue('2026-11-02T14:30');
  await expect(page.getByLabel('ETA UTC offset')).toHaveValue('60');
  await expect(page.getByLabel('Cargo')).toHaveValue('32,000 MT soybeans');
  await expect(page.getByLabel('Charterers')).toHaveValue('ADM');
  await expect(page.getByLabel('Agents at next port')).toHaveValue('Wilhelmsen Rotterdam\n+31 10 555 0100');

  const voyages = await stored(page, 'voyages');
  expect(voyages).toHaveLength(1);
  expect(voyages[0]).toMatchObject({
    active: true, deleted: false, voyageNo: 'V-2611', lastPort: 'Santos', nextPort: 'Rotterdam',
    etaLocal: '2026-11-02T14:30', etaOffsetMinutes: 60, cargo: '32,000 MT soybeans', charterers: 'ADM',
    agents: 'Wilhelmsen Rotterdam\n+31 10 555 0100',
  });
  await expectNoHorizontalScroll(page);
});

test('voyage: saving again updates the voyage; an ETA can be cleared', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/voyage');
  await page.getByLabel('Voyage no.').fill('V-1'); await page.getByLabel('ETA (local)').fill('2026-11-02T14:30');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Start new voyage' })).toBeVisible();
  await page.getByLabel('Voyage no.').fill('  V-1A  '); await page.getByLabel('ETA (local)').fill('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  const voyages = await stored(page, 'voyages');
  expect(voyages).toHaveLength(1);
  expect(voyages[0]).toMatchObject({ voyageNo: 'V-1A', etaLocal: '', active: true });
});

test('voyage: Start new voyage asks first, ends the voyage and begins a blank one; the previous ones are listed newest first', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/voyage');
  await page.getByLabel('Voyage no.').fill('V-1'); await page.getByLabel('Last port').fill('Santos'); await nextPort(page).fill('Rotterdam');
  await page.getByRole('button', { name: 'Save' }).click();

  // Cancelling leaves everything as it was.
  await page.getByRole('button', { name: 'Start new voyage' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Voyage no.')).toHaveValue('V-1');
  expect(await stored(page, 'voyages')).toHaveLength(1);

  await page.getByRole('button', { name: 'Start new voyage' }).click();
  await dialog.getByRole('button', { name: 'Start new voyage' }).click();
  await expect(page.getByLabel('Voyage no.')).toHaveValue('');
  await expect(page.getByLabel('ETA UTC offset')).toHaveValue('180');
  await page.getByLabel('Voyage no.').fill('V-2'); await page.getByLabel('Last port').fill('Rotterdam');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Start new voyage' }).click();
  await dialog.getByRole('button', { name: 'Start new voyage' }).click();
  await expect(page.getByLabel('Voyage no.')).toHaveValue('');

  const items = previousVoyages(page).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveText('V-2 · Rotterdam → —');
  await expect(items.nth(1)).toHaveText('V-1 · Santos → Rotterdam');

  const voyages = await stored(page, 'voyages');
  expect(voyages.map((v) => [v.voyageNo, v.active])).toEqual([['V-1', false], ['V-2', false], ['', true]]);
});

test('voyage: a failed start leaves the voyage as it was, in the dialog, and trying again works', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/voyage');
  await page.getByLabel('Voyage no.').fill('V-1');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Start new voyage' }).click();
  const dialog = page.getByRole('dialog');
  await failWrites(page);
  await dialog.getByRole('button', { name: 'Start new voyage' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Storage on this device is full.');
  expect(await stored(page, 'voyages')).toMatchObject([{ voyageNo: 'V-1', active: true }]);
  await allowWrites(page);
  await dialog.getByRole('button', { name: 'Start new voyage' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Voyage no.')).toHaveValue('');
  expect(await stored(page, 'voyages')).toHaveLength(2);
});

test('voyage: a failed save is reported and what was typed is kept', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/voyage');
  await page.getByLabel('Voyage no.').fill('V-9');
  await failWrites(page);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toContainText('Storage on this device is full.');
  await expect(page.getByLabel('Voyage no.')).toHaveValue('V-9');
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
  expect(await stored(page, 'voyages')).toHaveLength(0);
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await allowWrites(page);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Start new voyage' })).toBeVisible();
  expect(await stored(page, 'voyages')).toHaveLength(1);
});

test('voyage: the ship nav leads to the screen', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Ship', exact: true }).click();
  await page.getByRole('navigation', { name: 'Ship sections' }).getByRole('link', { name: 'Voyage' }).click();
  await expect(page).toHaveURL(/#\/ship\/voyage$/);
  await expect(page.getByLabel('Voyage no.')).toBeVisible();
});
