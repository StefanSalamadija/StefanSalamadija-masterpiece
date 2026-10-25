import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { allowWrites, expectNoHorizontalScroll, failWrites, freshApp, setupShip } from './helpers';

// The clock is 2026-10-25T09:00Z and the ship is at UTC+03:00, so the ship's today is 2026-10-25.

const crewList = (page: Page) => page.getByRole('list', { name: 'Crew' });
const crewRow = (page: Page, name: string) => crewList(page).getByRole('listitem').filter({ hasText: name });

interface NewMember {
  surname: string;
  givenNames?: string;
  rank?: string;
  passportExpiry?: string;
  bookExpiry?: string;
  signOn?: string;
}

/** Fills in the Add form and saves it, which leaves the browser on the crew list. */
async function addMember(page: Page, m: NewMember): Promise<void> {
  await page.goto('./#/ship/crew/new');
  await page.getByLabel('Surname').fill(m.surname);
  await page.getByLabel('Given names').fill(m.givenNames ?? 'Ivan');
  await page.getByLabel('Rank').selectOption({ label: m.rank ?? 'Master' });
  await page.getByLabel('Date of birth').fill('1985-01-05');
  await page.getByLabel('Passport expiry').fill(m.passportExpiry ?? '2030-01-01');
  await page.getByLabel("Seaman's book expiry").fill(m.bookExpiry ?? '2030-01-01');
  await page.getByLabel('Sign-on date').fill(m.signOn ?? '2026-06-01');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew$/);
}

/** Signs a member off through the dialog and waits for it to close. */
async function signOff(page: Page, name: string, date: string, port = ''): Promise<void> {
  await crewRow(page, name).getByRole('button', { name: 'Sign off' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Sign-off date').fill(date);
  await dialog.getByLabel('Sign-off port').fill(port);
  await dialog.getByRole('button', { name: 'Sign off' }).click();
  await expect(dialog).toHaveCount(0);
}

type StoredCrew = Record<string, unknown> & { id: string; deleted: boolean };

/** Every crew record as stored in IndexedDB, deleted ones included, to check what was really written. */
function storedCrew(page: Page): Promise<StoredCrew[]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('masterpiece');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('crew').objectStore('crew').getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
        };
      }),
  );
}

/** Writes `count` crew members straight into IndexedDB for the active ship; the app has to be reloaded to show them. */
function seedCrew(page: Page, count: number): Promise<void> {
  return page.evaluate(
    (n) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('masterpiece');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const ships = db.transaction('ships').objectStore('ships').getAll();
          ships.onerror = () => reject(ships.error);
          ships.onsuccess = () => {
            const shipId = (ships.result[0] as { id: string }).id;
            const tx = db.transaction('crew', 'readwrite');
            const now = new Date().toISOString();
            for (let i = 0; i < n; i += 1) {
              tx.objectStore('crew').put({
                id: `seed-${i}`, createdAt: now, updatedAt: now, updatedBy: 'seed', deleted: false, scope: 'ship', shipId,
                surname: `SEED${String(i).padStart(2, '0')}`, givenNames: 'Test', rank: 'ab', nationality: 'Croatian',
                dateOfBirth: '1990-01-01', placeOfBirth: 'Split', passportNo: `P${i}`, passportExpiry: '2030-01-01',
                seamansBookNo: `S${i}`, seamansBookExpiry: '2030-01-01', signOnDate: '2026-01-01', signOnPort: 'Split',
              });
            }
            tx.onerror = () => reject(tx.error);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
          };
        };
      }),
    count,
  );
}

test('crew bands, sign off, as-at, re-join', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/crew/new');
  await page.getByLabel('Surname').fill('PETROVIĆ'); await page.getByLabel('Given names').fill('Ivan');
  await page.getByLabel('Rank').selectOption({ label: 'Master' });
  await page.getByLabel('Date of birth').fill('2027-01-01');
  await expect(page.getByRole('alert')).toHaveText('Date of birth must be in the past.');
  await page.getByLabel('Date of birth').fill('1985-01-05');
  await page.getByLabel('Passport expiry').fill('2027-03-01');      // within 6 months → amber
  await page.getByLabel("Seaman's book expiry").fill('2030-01-01');
  await page.getByLabel('Sign-on date').fill('2026-06-01');
  await page.getByRole('button', { name: 'Save' }).click();
  const row = crewRow(page, 'Ivan PETROVIĆ');
  await expect(row.getByText('Expires soon')).toBeVisible();
  await row.getByRole('button', { name: 'Sign off' }).click();
  await page.getByLabel('Sign-off date').fill('2026-10-10'); await page.getByLabel('Sign-off port').fill('Santos');
  await page.getByRole('dialog').getByRole('button', { name: 'Sign off' }).click();
  await expect(row).toHaveCount(0);                                  // Onboard as at today
  await page.getByLabel('As at').fill('2026-10-10'); await expect(row).toHaveCount(1);
  await page.getByLabel('As at').fill('2026-10-25'); await page.getByRole('button', { name: 'All' }).click();
  await row.getByRole('button', { name: 'Re-join' }).click();
  await page.getByLabel('Sign-on date').fill('2026-10-20'); await page.getByLabel('Sign-on port').fill('Rotterdam');
  await page.getByRole('dialog').getByRole('button', { name: 'Re-join' }).click();
  await expect(row).toHaveCount(2);
  await page.getByRole('button', { name: 'Onboard' }).click(); await expect(row).toHaveCount(1);
  await expectNoHorizontalScroll(page);
});

test('crew: an expired passport shows Expired, measured at the as-at date', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'PETROVIĆ', passportExpiry: '2026-10-01' });
  const row = crewRow(page, 'Ivan PETROVIĆ');
  await expect(row.getByText('Expired')).toBeVisible();
  await expect(row.locator('[data-band="red"]')).toHaveCount(1);

  // Back in time the passport is still valid, and close to its expiry.
  await page.getByLabel('As at').fill('2026-09-01');
  await expect(row.locator('[data-band="amber"]')).toHaveText('Expires soon');
  await page.getByRole('button', { name: 'All' }).click(); // before the sign-on, so only All lists the contract
  await page.getByLabel('As at').fill('2026-01-01');
  await expect(row).toHaveCount(1);
  await expect(row.locator('[data-band]')).toHaveCount(0);
});

test('crew: a member with valid documents has no badge', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'PETROVIĆ' });
  await expect(crewRow(page, 'Ivan PETROVIĆ')).toContainText('Master');
  await expect(crewRow(page, 'Ivan PETROVIĆ').locator('[data-band]')).toHaveCount(0);
});

test('crew list: the Add and Import links, and an empty list', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/crew');
  await expect(page.getByRole('link', { name: 'Add crew member' })).toHaveAttribute('href', '#/ship/crew/new');
  await expect(page.getByRole('link', { name: 'Import from Excel' })).toHaveAttribute('href', '#/ship/crew/import');
  await expect(page.getByLabel('As at')).toHaveValue('2026-10-25');
  await expect(page.getByText('No crew yet.')).toBeVisible();
  await page.getByRole('button', { name: 'All' }).click();
  await expect(page.getByText('No crew yet.')).toBeVisible();
  await page.getByRole('link', { name: 'Add crew member' }).click();
  await expect(page.getByRole('heading', { name: 'Add crew member' })).toBeVisible();
});

test('crew list: the toggle says which view is on, and All ignores the date', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'PETROVIĆ' });
  const onboard = page.getByRole('button', { name: 'Onboard' });
  const all = page.getByRole('button', { name: 'All' });
  await expect(onboard).toHaveAttribute('aria-pressed', 'true');
  await expect(all).toHaveAttribute('aria-pressed', 'false');

  await page.getByLabel('As at').fill('2026-05-31'); // before the sign-on
  await expect(crewRow(page, 'Ivan PETROVIĆ')).toHaveCount(0);
  await all.click();
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(onboard).toHaveAttribute('aria-pressed', 'false');
  await expect(crewRow(page, 'Ivan PETROVIĆ')).toHaveCount(1);
});

test('crew list: an emptied date falls back to today, and the view survives Edit and back but not a reload', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'PETROVIĆ' });
  await signOff(page, 'Ivan PETROVIĆ', '2026-10-10', 'Santos');
  const row = crewRow(page, 'Ivan PETROVIĆ');
  await expect(row).toHaveCount(0);
  await expect(page.getByText('Nobody is onboard on 2026-10-25.')).toBeVisible();

  await page.getByLabel('As at').fill('2026-10-10');
  await expect(row).toHaveCount(1);
  await page.getByLabel('As at').fill(''); // no date: today is used
  await expect(row).toHaveCount(0);
  await expect(page.getByText('Nobody is onboard on 2026-10-25.')).toBeVisible();
  await expect(page.getByLabel('As at')).toHaveValue('');
  await page.getByLabel('As at').fill('2026-10-10');
  await page.getByRole('button', { name: 'All' }).click();

  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit crew member' })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('As at')).toHaveValue('2026-10-10');
  await expect(page.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  await expect(row).toHaveCount(1);

  await page.reload();
  await expect(page.getByLabel('As at')).toHaveValue('2026-10-25');
  await expect(page.getByRole('button', { name: 'Onboard' })).toHaveAttribute('aria-pressed', 'true');
});

test('crew edit: an error shows once its field is changed, and Save shows them all', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/crew/new');
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew\/new$/);
  await expect(page.getByRole('alert')).toHaveText(['Surname is required.', 'Rank is required.', 'Sign-on date is required.']);
  await expect(page.getByLabel('Surname')).toBeFocused();
  expect(await storedCrew(page)).toHaveLength(0);

  await page.getByLabel('Surname').fill('PETROVIĆ');
  await expect(page.getByRole('alert')).toHaveText(['Rank is required.', 'Sign-on date is required.']);
  await page.getByLabel('Rank').selectOption({ label: 'Master' });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('Sign-on date')).toBeFocused(); // the first field with a problem
  await expect(page.getByRole('alert')).toHaveText('Sign-on date is required.');
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
});

test('crew edit: Other asks for the rank, and a blank date of birth is allowed', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/crew/new');
  await expect(page.getByLabel('Rank (other)')).toHaveCount(0);
  await page.getByLabel('Surname').fill('PETROVIĆ');
  await page.getByLabel('Rank').selectOption({ label: 'Other' });
  await page.getByLabel('Sign-on date').fill('2026-06-01');
  await expect(page.getByLabel('Rank (other)')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('Rank (other)')).toBeFocused();
  await expect(page.getByRole('alert')).toHaveText('Rank is required.');

  await page.getByLabel('Rank (other)').fill('Pumpman');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(crewRow(page, 'PETROVIĆ')).toContainText('Pumpman');
  const [stored] = await storedCrew(page);
  expect(stored).toMatchObject({ rank: 'other', rankOther: 'Pumpman', dateOfBirth: '', shipId: expect.any(String) });
});

test('crew edit: opens a member, saves the changes and keeps the sign-off', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'PETROVIĆ' });
  await signOff(page, 'Ivan PETROVIĆ', '2026-10-10', 'Santos');
  await page.getByRole('button', { name: 'All' }).click();
  const [before] = await storedCrew(page);

  await crewRow(page, 'Ivan PETROVIĆ').getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Surname')).toHaveValue('PETROVIĆ');
  await expect(page.getByLabel('Rank')).toHaveValue('master');
  await expect(page.getByLabel('Date of birth')).toHaveValue('1985-01-05');
  await expect(page.getByLabel('Sign-on date')).toHaveValue('2026-06-01');
  await page.getByLabel('Nationality').fill('Croatian');
  await page.getByLabel('Given names').fill('  Ivan Marko ');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL(/#\/ship\/crew$/);
  await expect(crewRow(page, 'Ivan Marko PETROVIĆ')).toHaveCount(1);
  const stored = await storedCrew(page);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    id: before.id, givenNames: 'Ivan Marko', nationality: 'Croatian', signOffDate: '2026-10-10', signOffPort: 'Santos', deleted: false,
  });
});

test('crew edit: a sign-on after the sign-off is refused, at the sign-on field', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'PETROVIĆ' });
  await signOff(page, 'Ivan PETROVIĆ', '2026-10-10');
  await page.getByRole('button', { name: 'All' }).click();
  await crewRow(page, 'Ivan PETROVIĆ').getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Sign-on date').fill('2026-11-01');
  await expect(page.getByRole('alert')).toHaveText("Sign-off can't be before sign-on.");
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew\/[^/]+$/);
  await expect(page.getByLabel('Sign-on date')).toBeFocused();
  expect((await storedCrew(page))[0].signOnDate).toBe('2026-06-01');
});

test('crew edit: an unknown member says so, with a way back', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/crew/no-such-member');
  await expect(page.getByText('Crew member not found.')).toBeVisible();
  await page.getByRole('link', { name: 'Back to crew' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew$/);
  await expect(page.getByRole('link', { name: 'Add crew member' })).toBeVisible();
});

test('crew edit: a deleted member is not found either', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'PETROVIĆ' });
  const [member] = await storedCrew(page);
  await crewRow(page, 'PETROVIĆ').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete crew member' }).click();
  await expect(crewRow(page, 'PETROVIĆ')).toHaveCount(0);
  await page.goto(`./#/ship/crew/${member.id}`);
  await expect(page.getByText('Crew member not found.')).toBeVisible();
});

test('crew sign off: refuses a date before the sign-on, and keeps what was typed', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'PETROVIĆ' });
  await crewRow(page, 'PETROVIĆ').getByRole('button', { name: 'Sign off' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Sign off Ivan PETROVIĆ' })).toBeVisible();
  await expect(dialog.getByLabel('Sign-off date')).toHaveValue('2026-10-25');
  await dialog.getByLabel('Sign-off date').fill('2026-05-01');
  await dialog.getByLabel('Sign-off port').fill('Santos');
  await dialog.getByRole('button', { name: 'Sign off' }).click();
  await expect(dialog.getByRole('alert')).toHaveText("Sign-off can't be before sign-on.");
  await expect(dialog.getByLabel('Sign-off port')).toHaveValue('Santos');
  expect((await storedCrew(page))[0].signOffDate).toBeUndefined();

  await dialog.getByLabel('Sign-off date').fill('');
  await dialog.getByRole('button', { name: 'Sign off' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Sign-off date is required.');

  await dialog.getByLabel('Sign-off date').fill('2026-10-10');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Sign off' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await storedCrew(page))[0]).toMatchObject({ signOffDate: '2026-10-10', signOffPort: 'Santos' });
});

test('crew sign off: Cancel keeps the contract and returns the focus to the button', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'PETROVIĆ' });
  const button = crewRow(page, 'PETROVIĆ').getByRole('button', { name: 'Sign off' });
  await button.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(button).toBeFocused();
  expect((await storedCrew(page))[0].signOffDate).toBeUndefined();
});

test('crew sign off: a row that leaves the view hands the focus to Add crew member', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'PETROVIĆ' });
  await signOff(page, 'PETROVIĆ', '2026-10-10');
  await expect(crewRow(page, 'PETROVIĆ')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Add crew member' })).toBeFocused();
});

test('crew sign off: a failed write keeps the dialog open, with the message and no toast', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'PETROVIĆ' });
  await crewRow(page, 'PETROVIĆ').getByRole('button', { name: 'Sign off' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Sign-off date').fill('2026-10-10');
  await dialog.getByLabel('Sign-off port').fill('Santos');
  await failWrites(page);
  await dialog.getByRole('button', { name: 'Sign off' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Storage on this device is full.');
  await expect(page.getByRole('alert')).toHaveCount(1);
  await expect(dialog.getByLabel('Sign-off port')).toHaveValue('Santos');
  await expect(dialog.getByRole('button', { name: 'Sign off' })).toBeEnabled();

  await allowWrites(page);
  await dialog.getByRole('button', { name: 'Sign off' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await storedCrew(page))[0]).toMatchObject({ signOffDate: '2026-10-10', signOffPort: 'Santos' });
});

test('crew re-join: the new sign-on must be after the sign-off, and the old contract is kept', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'PETROVIĆ', passportExpiry: '2027-03-01' });
  await signOff(page, 'PETROVIĆ', '2026-10-10', 'Santos');
  await page.getByRole('button', { name: 'All' }).click();
  const row = crewRow(page, 'PETROVIĆ');
  await expect(row.getByRole('button', { name: 'Re-join' })).toHaveCount(1);
  await row.getByRole('button', { name: 'Re-join' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Re-join Ivan PETROVIĆ' })).toBeVisible();
  await expect(dialog.getByLabel('Sign-on date')).toHaveValue('2026-10-25');

  await dialog.getByLabel('Sign-on date').fill('2026-10-10');
  await dialog.getByLabel('Sign-on port').fill('Rotterdam');
  await dialog.getByRole('button', { name: 'Re-join' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Sign-on must be after the sign-off date (2026-10-10).');
  expect(await storedCrew(page)).toHaveLength(1);

  await dialog.getByLabel('Sign-on date').fill('2026-10-11');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Re-join' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toHaveCount(2);
  await expect(row.getByRole('button', { name: 'Re-join' })).toHaveCount(1); // only the signed-off contract

  const stored = await storedCrew(page);
  expect(stored).toHaveLength(2);
  const joined = stored.find((m) => m.signOnDate === '2026-10-11');
  expect(joined).toMatchObject({
    surname: 'PETROVIĆ', givenNames: 'Ivan', rank: 'master', passportExpiry: '2027-03-01', signOnPort: 'Rotterdam', deleted: false,
  });
  expect(joined?.signOffDate).toBeUndefined();
  expect(stored.find((m) => m.signOnDate === '2026-06-01')).toMatchObject({ signOffDate: '2026-10-10', signOffPort: 'Santos' });
});

test('crew delete: asks first, then removes the contract from the list and keeps a tombstone', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'PETROVIĆ' });
  await addMember(page, { surname: 'KOVAČ', givenNames: 'Marko', rank: 'Chief Officer' });
  await crewRow(page, 'PETROVIĆ').getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Delete Ivan PETROVIĆ?' })).toBeVisible();
  await expect(dialog).toContainText('This removes this contract from the crew list on this device.');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(crewRow(page, 'PETROVIĆ')).toHaveCount(1);

  await crewRow(page, 'PETROVIĆ').getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Delete crew member' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(crewRow(page, 'PETROVIĆ')).toHaveCount(0);
  await expect(crewRow(page, 'KOVAČ')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Add crew member' })).toBeFocused();
  const stored = await storedCrew(page);
  expect(stored).toHaveLength(2); // a soft delete: the record stays, marked
  expect(stored.find((m) => m.surname === 'PETROVIĆ')?.deleted).toBe(true);
  await page.getByRole('button', { name: 'All' }).click();
  await expect(crewRow(page, 'PETROVIĆ')).toHaveCount(0);
});

test('crew list: members are in rank order', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'ZORIĆ', givenNames: 'Ana', rank: 'AB' });
  await addMember(page, { surname: 'KOVAČ', givenNames: 'Marko', rank: 'Chief Officer' });
  await addMember(page, { surname: 'PETROVIĆ', rank: 'Master' });
  const rows = crewList(page).getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Ivan PETROVIĆ');
  await expect(rows.nth(1)).toContainText('Marko KOVAČ');
  await expect(rows.nth(2)).toContainText('Ana ZORIĆ');
});

test('crew list: the screens and dialogs fit a 360 px phone, even with long names', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, {
    surname: 'PAPADOPOULOS-KARAGEORGIOPOULOS', givenNames: 'Konstantinos-Alexandros Maximilianos', passportExpiry: '2026-10-01',
  });
  await signOff(page, 'PAPADOPOULOS', '2026-10-10', 'Piraeus');
  await page.getByRole('button', { name: 'All' }).click();
  await expect(crewRow(page, 'PAPADOPOULOS').getByRole('button')).toHaveText(['Edit', 'Sign off', 'Re-join', 'Delete']);
  await expectNoHorizontalScroll(page);
  await crewRow(page, 'PAPADOPOULOS').getByRole('button', { name: 'Re-join' }).click();
  await expectNoHorizontalScroll(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await crewRow(page, 'PAPADOPOULOS').getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Surname')).toHaveValue('PAPADOPOULOS-KARAGEORGIOPOULOS');
  await expectNoHorizontalScroll(page);
});

test('crew list: coming back from Edit restores the scroll position of a long list', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await seedCrew(page, 40);
  await page.goto('./#/ship/crew');
  await page.reload();
  const rows = crewList(page).getByRole('listitem');
  await expect(rows).toHaveCount(40);

  await page.evaluate(() => window.scrollTo(0, 1500));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(1500, -1); // a phone snaps it to whole device pixels
  await rows.nth(14).getByRole('button', { name: 'Edit' }).dispatchEvent('click'); // no scrolling of its own
  await expect(page.getByRole('heading', { name: 'Edit crew member' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  await page.goBack();
  await expect(rows).toHaveCount(40);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(1500, -1);

  // Saving goes back to the list the same way.
  await rows.nth(14).getByRole('button', { name: 'Edit' }).dispatchEvent('click');
  await page.getByLabel('Nationality').fill('Croatian');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(rows).toHaveCount(40);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(1500, -1);
});

test('profiles: the delete dialog counts the crew of the ship', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'PETROVIĆ' });
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Profiles', exact: true }).click();
  await page.getByRole('list', { name: 'Ships' }).getByRole('listitem').filter({ hasText: 'MV OCEAN STAR' })
    .getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog')).toContainText('This removes 1 crew, 0 certificates and 0 voyages');
});
