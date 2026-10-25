import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoHorizontalScroll, freshApp, setupShip } from './helpers';

const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const shipList = (page: Page) => page.getByRole('list', { name: 'Ships' });
const row = (page: Page, name: string) => shipList(page).getByRole('listitem').filter({ hasText: name });

async function openParticulars(page: Page): Promise<void> {
  await mainNav(page).getByRole('link', { name: 'Ship', exact: true }).click();
  await page.getByRole('navigation', { name: 'Ship sections' }).getByRole('link', { name: 'Particulars' }).click();
  await expect(page.getByLabel('Ship name')).toBeVisible();
}

async function openProfiles(page: Page): Promise<void> {
  await mainNav(page).getByRole('link', { name: 'Profiles', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New ship' })).toBeVisible();
}

/** Saves `fields` (label → text) on the Particulars screen of the active ship. */
async function saveParticulars(page: Page, fields: Record<string, string>): Promise<void> {
  await openParticulars(page);
  for (const [label, value] of Object.entries(fields)) await page.getByLabel(label).fill(value);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
}

/** Every ship record as stored in IndexedDB, to check what was really written. */
function storedShips(page: Page): Promise<{ particulars: Record<string, unknown> }[]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('masterpiece');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('ships').objectStore('ships').getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
        };
      }),
  );
}

test('particulars validation and save', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openParticulars(page);
  await page.getByLabel('IMO number').fill('9074728');
  await expect(page.getByText("IMO check digit doesn't match — please re-check the number.")).toBeVisible();
  await page.getByLabel('GT').fill('-5');
  await expect(page.getByRole('alert')).toHaveText('Must be a positive number.');
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await page.getByLabel('GT').fill('32500'); await page.getByLabel('LOA (m)').fill('229');
  await page.getByRole('button', { name: 'Save' }).click(); await expect(page.getByText('Saved')).toBeVisible();
  await page.reload(); await expect(page.getByLabel('IMO number')).toHaveValue('9074728');
  await expectNoHorizontalScroll(page);
});

test('particulars lists the fields in order, and keeps numbers as numbers', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openParticulars(page);
  const labels = [
    'Ship name', 'IMO number', 'Call sign', 'MMSI', 'Flag', 'Port of registry', 'GT', 'NT', 'DWT (summer)', 'LOA (m)',
    'Beam (m)', 'Year built', 'Owners', 'Managers (ISM company)', 'P&I club', 'Classification society',
  ];
  const shown = await page.locator('form .field label').allTextContents();
  expect(shown).toEqual(labels);

  await page.getByLabel('GT').fill('32500.5');
  await page.getByLabel('Year built').fill('2015');
  await page.getByLabel('Flag').fill('  Malta ');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  const [ship] = await storedShips(page);
  expect(ship.particulars).toMatchObject({ name: 'MV OCEAN STAR', gt: 32500.5, yearBuilt: 2015, flag: 'Malta' });
  expect('loa' in ship.particulars).toBe(false); // an empty number is left out, not stored as ''

  // Clearing a number removes it, and "Saved" goes away on the next edit.
  await page.getByLabel('Year built').fill('');
  await expect(page.getByText('Saved')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  expect('yearBuilt' in (await storedShips(page))[0].particulars).toBe(false);
});

test('particulars: the ship name is required, and a bad MMSI blocks saving', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openParticulars(page);
  await page.getByLabel('Ship name').fill('   ');
  await expect(page.getByRole('alert')).toHaveText('Ship name is required.');
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await page.getByLabel('Ship name').fill('MV OCEAN STAR II');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();

  await page.getByLabel('MMSI').fill('12345');
  await expect(page.getByRole('alert')).toHaveText('MMSI must be 9 digits.');
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await page.getByLabel('MMSI').fill('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR II');
});

test('profiles: new, switch, copy, rename, delete', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await saveParticulars(page, { 'IMO number': '9074726', 'LOA (m)': '229', Flag: 'Malta' });
  await openProfiles(page);
  await expect(row(page, 'MV OCEAN STAR')).toContainText('Active');
  await expect(row(page, 'MV OCEAN STAR').getByRole('button', { name: 'Make active' })).toHaveCount(0);

  await page.getByRole('button', { name: 'New ship' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Ship name').fill('MV SEA BREEZE'); await page.getByRole('button', { name: 'Create ship' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await row(page, 'MV SEA BREEZE').getByRole('button', { name: 'Make active' }).click();
  await expect(page.getByRole('banner')).toContainText('MV SEA BREEZE');
  await expect(row(page, 'MV SEA BREEZE')).toContainText('Active');
  await expect(row(page, 'MV OCEAN STAR')).not.toContainText('Active');

  await row(page, 'MV OCEAN STAR').getByRole('button', { name: 'Copy' }).click();
  await page.getByLabel('New ship name').fill('MV OCEAN PEARL'); await page.getByRole('button', { name: 'Copy ship' }).click();
  await expect(row(page, 'MV OCEAN PEARL')).toHaveCount(1);
  await row(page, 'MV OCEAN PEARL').getByRole('button', { name: 'Make active' }).click();
  await expect(page.getByRole('banner')).toContainText('MV OCEAN PEARL');
  await openParticulars(page);
  await expect(page.getByLabel('Ship name')).toHaveValue('MV OCEAN PEARL');
  await expect(page.getByLabel('IMO number')).toHaveValue('');
  await expect(page.getByLabel('LOA (m)')).toHaveValue('229');
  await expect(page.getByLabel('Flag')).toHaveValue('Malta');

  await openProfiles(page);
  await row(page, 'MV SEA BREEZE').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog')).toContainText('This removes 0 crew, 0 certificates and 0 voyages from this device.');
  await expect(page.getByRole('dialog')).toContainText('A backup made earlier still contains them.');
  await expect(page.getByRole('heading', { name: 'Delete MV SEA BREEZE?' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete ship' }).click();
  await expect(row(page, 'MV SEA BREEZE')).toHaveCount(0);
  await expect(page.getByRole('banner')).toContainText('MV OCEAN PEARL'); // the active ship was not the deleted one
  await expectNoHorizontalScroll(page);
});

test('profiles: rename, cancel, and the blank-name rule in every dialog', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openProfiles(page);

  // New ship: the name field has the focus; a blank name is refused, and the dialog stays open.
  await page.getByRole('button', { name: 'New ship' }).click();
  await expect(page.getByLabel('Ship name')).toBeFocused();
  await page.getByRole('button', { name: 'Create ship' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Ship name is required.');
  await expect(page.getByLabel('Ship name')).toBeFocused();
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(shipList(page).getByRole('listitem')).toHaveCount(1);

  // Rename: prefilled with the current name; blank is refused; Escape closes without changing anything.
  await row(page, 'MV OCEAN STAR').getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('heading', { name: 'Rename ship' })).toBeVisible();
  await expect(page.getByLabel('Ship name')).toHaveValue('MV OCEAN STAR');
  await page.getByLabel('Ship name').fill('  ');
  await page.getByRole('dialog').getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Ship name is required.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');

  await row(page, 'MV OCEAN STAR').getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel('Ship name').fill('MV OCEAN STAR II');
  await page.getByLabel('Ship name').press('Enter'); // Enter in the field submits
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR II');
  await expect(row(page, 'MV OCEAN STAR II')).toBeVisible();

  // Copy: the name starts empty, the certificate box is off, and a blank name is refused.
  await row(page, 'MV OCEAN STAR II').getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByLabel('New ship name')).toHaveValue('');
  await expect(page.getByLabel('Copy certificate list (names only)')).not.toBeChecked();
  await page.getByRole('button', { name: 'Copy ship' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Ship name is required.');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(shipList(page).getByRole('listitem')).toHaveCount(1);
});

test('profiles: the delete dialog starts on Cancel, and Cancel keeps the ship', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openProfiles(page);
  await row(page, 'MV OCEAN STAR').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row(page, 'MV OCEAN STAR')).toBeVisible();
});

test('particulars: a change of the active ship, made in another tab, replaces the draft', async ({ page, context }) => {
  await freshApp(page); await setupShip(page);
  await openProfiles(page);
  await page.getByRole('button', { name: 'New ship' }).click();
  await page.getByLabel('Ship name').fill('MV SEA BREEZE'); await page.getByRole('button', { name: 'Create ship' }).click();
  await expect(row(page, 'MV SEA BREEZE')).toBeVisible();
  await saveParticulars(page, { 'Call sign': 'ABCD' });
  await page.getByLabel('Call sign').fill('UNSAVED');

  const other = await context.newPage();
  await other.goto('./#/profiles');
  await row(other, 'MV SEA BREEZE').getByRole('button', { name: 'Make active' }).click();
  await expect(row(other, 'MV SEA BREEZE')).toContainText('Active');

  await expect(page.getByLabel('Ship name')).toHaveValue('MV SEA BREEZE');
  await expect(page.getByLabel('Call sign')).toHaveValue('');
});

test('profiles: the new ship starts at the chosen offset', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openProfiles(page);
  await page.getByRole('button', { name: 'New ship' }).click();
  await page.getByLabel('Ship name').fill('MV LATE WATCH');
  await page.getByLabel("Ship's time (UTC offset)").selectOption({ label: 'UTC-05:00' });
  await page.getByRole('button', { name: 'Create ship' }).click();
  await row(page, 'MV LATE WATCH').getByRole('button', { name: 'Make active' }).click();
  await expect(page.getByTestId('ship-clock')).toHaveText('04:00 LT (UTC-05:00)');
});

test('profiles: deleting the last ship returns to the welcome screen', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openProfiles(page);
  await row(page, 'MV OCEAN STAR').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { name: 'Delete MV OCEAN STAR?' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete ship' }).click();
  await expect(page.getByRole('button', { name: 'Create your first ship' })).toBeVisible();
});

test.describe('in a time zone of its own', () => {
  test.use({ timezoneId: 'Asia/Kolkata' }); // UTC+05:30, with no summer time

  test('the new ship dialog offers the device offset, like the welcome screen', async ({ page }) => {
    await freshApp(page); await setupShip(page, 'MV OCEAN STAR', 'UTC+03:00');
    await openProfiles(page);
    await page.getByRole('button', { name: 'New ship' }).click();
    await expect(page.getByLabel("Ship's time (UTC offset)")).toHaveValue('330');
  });
});

test('particulars: a decimal comma is read as a decimal point', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openParticulars(page);
  // Text inputs with a decimal keypad: `type="number"` would read "229,5" as 2295.
  for (const label of ['GT', 'NT', 'DWT (summer)', 'LOA (m)', 'Beam (m)']) {
    await expect(page.getByLabel(label)).toHaveAttribute('type', 'text');
    await expect(page.getByLabel(label)).toHaveAttribute('inputmode', 'decimal');
  }
  await expect(page.getByLabel('Year built')).toHaveAttribute('inputmode', 'numeric');

  await page.getByLabel('LOA (m)').fill('229,5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  expect((await storedShips(page))[0].particulars.loa).toBe(229.5);
  await page.reload();
  await expect(page.getByLabel('LOA (m)')).toHaveValue('229.5');
});

test('particulars: a malformed number is refused, and never replaces the saved one', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await saveParticulars(page, { 'Beam (m)': '32.2' });

  for (const bad of ['2e', '1,000.5', '1.2.3', '.5', '5.', '12 5']) {
    await page.getByLabel('Beam (m)').fill(bad);
    await expect(page.getByRole('alert'), bad).toHaveText('Enter a number, e.g. 229.5.');
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    await expect(page.getByText('Saved')).toHaveCount(0);
  }
  await page.reload();
  await expect(page.getByLabel('Beam (m)')).toHaveValue('32.2');
  expect((await storedShips(page))[0].particulars.beam).toBe(32.2);

  // A number that parses still meets the positive-number check, and blanking the field removes the value.
  await page.getByLabel('Beam (m)').fill('0');
  await expect(page.getByRole('alert')).toHaveText('Must be a positive number.');
  await page.getByLabel('Beam (m)').fill('  ');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  expect('beam' in (await storedShips(page))[0].particulars).toBe(false);
});

test('particulars: year built is a whole year from 1900 to next year', async ({ page }) => {
  await freshApp(page); await setupShip(page); // the ship's date is 2026-10-25
  await openParticulars(page);
  for (const bad of ['-5.5', '1899', '2028', '2012.5', 'abc', '20 12']) {
    await page.getByLabel('Year built').fill(bad);
    await expect(page.getByRole('alert'), bad).toHaveText('Enter a year, e.g. 2012.');
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  }
  for (const good of ['1900', '2012', '2027']) {
    await page.getByLabel('Year built').fill(good);
    await expect(page.getByRole('alert'), good).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
  }
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  expect((await storedShips(page))[0].particulars.yearBuilt).toBe(2027);
});

test('profiles: closing a dialog returns the focus to the button that opened it', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openProfiles(page);
  await page.getByRole('button', { name: 'New ship' }).click();
  await expect(page.getByLabel('Ship name')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New ship' })).toBeFocused();

  await row(page, 'MV OCEAN STAR').getByRole('button', { name: 'Rename' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(row(page, 'MV OCEAN STAR').getByRole('button', { name: 'Rename' })).toBeFocused();
});

test('profiles: a failed write keeps the dialog open, with the message and what was typed', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openProfiles(page);
  await page.getByRole('button', { name: 'New ship' }).click();
  await page.getByLabel('Ship name').fill('MV SEA BREEZE');
  // Every write now fails the way a full disk does.
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { restoreWrites: () => void }).restoreWrites = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = () => {
      throw new DOMException('The disk is full.', 'QuotaExceededError');
    };
  });
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Create ship' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Storage on this device is full.');
  await expect(dialog.getByRole('link', { name: 'Export backup' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(1); // the message in the dialog only, not the toast as well
  await expect(page.getByLabel('Ship name')).toHaveValue('MV SEA BREEZE');
  await expect(dialog.getByRole('button', { name: 'Create ship' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeEnabled();

  await page.evaluate(() => (window as unknown as { restoreWrites: () => void }).restoreWrites());
  await dialog.getByRole('button', { name: 'Create ship' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row(page, 'MV SEA BREEZE')).toBeVisible();
});

test('profiles: while a write is running, Cancel is off and Escape does nothing', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openProfiles(page);
  await page.getByRole('button', { name: 'New ship' }).click();
  await page.getByLabel('Ship name').fill('MV SEA BREEZE');
  // A second connection keeps a write transaction on the ship tables open, so the app's own write has to wait.
  await page.evaluate(
    () =>
      new Promise<void>((started, failed) => {
        const w = window as unknown as { releaseWrites: () => void };
        let hold = true;
        w.releaseWrites = () => {
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
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Create ship' }).click();
  await expect(dialog.getByRole('button', { name: 'Create ship' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();

  await page.evaluate(() => (window as unknown as { releaseWrites: () => void }).releaseWrites());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row(page, 'MV SEA BREEZE')).toBeVisible();
});
