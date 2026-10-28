import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoHorizontalScroll, freshApp, setupShip } from './helpers';

// The clock is 2026-10-25T09:00Z and the ship is at UTC+03:00, so the ship's today is 2026-10-25.

const reliefList = (page: Page) => page.getByRole('list', { name: 'Reliefs' });
const reliefRow = (page: Page, name: string) => reliefList(page).getByRole('listitem').filter({ hasText: name });
const alertsRegion = (page: Page) => page.getByRole('region', { name: 'Alerts' });
const alertItems = (page: Page) => alertsRegion(page).getByRole('listitem');
const shipChips = (page: Page) => page.getByRole('navigation', { name: 'Ship sections' });

interface NewMember {
  surname: string;
  givenNames?: string;
  signOn?: string;
  /** Contract length (months), as typed. */
  contractMonths?: string;
  reliefDate?: string;
  reliefPort?: string;
}

/** Fills in the Add form, with the contract length and the planned relief when given, and saves it, which leaves the browser on the crew list. */
async function addMember(page: Page, m: NewMember): Promise<void> {
  await page.goto('./#/ship/crew/new');
  await page.getByLabel('Surname').fill(m.surname);
  await page.getByLabel('Given names').fill(m.givenNames ?? 'Ivan');
  await page.getByLabel('Rank').selectOption({ label: 'Master' });
  await page.getByLabel('Date of birth').fill('1985-01-05');
  await page.getByLabel('Passport expiry').fill('2030-01-01');
  await page.getByLabel("Seaman's book expiry").fill('2030-01-01');
  await page.getByLabel('Sign-on date').fill(m.signOn ?? '2026-06-01');
  if (m.contractMonths !== undefined) await page.getByLabel('Contract length (months)').fill(m.contractMonths);
  if (m.reliefDate !== undefined) await page.getByLabel('Planned relief date').fill(m.reliefDate);
  if (m.reliefPort !== undefined) await page.getByLabel('Planned relief port').fill(m.reliefPort);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew$/);
}

type Store = 'ships' | 'crew';

/** Every record of a table as stored in IndexedDB, to check what was really written. */
function stored(page: Page, store: Store): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    (name) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('masterpiece');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction(name).objectStore(name).getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
        };
      }),
    store,
  );
}

/** Writes `value` as the maximum months onboard of every ship straight into IndexedDB, as a damaged backup or a hand edit could; the app has to be reloaded to see it. */
function storeMaxMonths(page: Page, value: unknown): Promise<void> {
  return page.evaluate(
    (months) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('masterpiece');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('ships', 'readwrite');
          const store = tx.objectStore('ships');
          const all = store.getAll();
          all.onsuccess = () => {
            for (const ship of all.result) store.put({ ...ship, maxMonthsOnboard: months });
          };
          tx.onerror = () => reject(tx.error);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    value,
  );
}

/** Types the ship's limit on the months onboard on the Particulars screen and saves it. */
async function saveMaxMonths(page: Page, text: string): Promise<void> {
  await page.goto('./#/ship/particulars');
  await page.getByLabel('Maximum months onboard').fill(text);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
}

test('reliefs view shows overdue relief and onboard limit', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, {
    surname: 'PETROVIĆ', givenNames: 'Ivan', signOn: '2025-11-20', contractMonths: '9', reliefDate: '2026-11-05', reliefPort: 'Santos',
  });
  await page.goto('./#/ship/reliefs');
  const row = reliefRow(page, 'Ivan PETROVIĆ');
  await expect(row).toContainText('Contract ends 2026-08-20');
  await expect(row.getByText('Relief overdue')).toBeVisible();
  await expect(row.getByText('Onboard limit reached')).toBeVisible();  // 2025-11-20 + 11 months = 2026-10-20
  await expect(row).toContainText('Relief 2026-11-05 Santos');
  await expect(row).toContainText('Onboard 340 days');
  await expect(row.locator('[data-band="red"]')).toHaveCount(2);
  await page.goto('./#/ship/particulars'); await page.getByLabel('Maximum months onboard').fill('12');
  await expect(page.getByRole('alert')).toHaveText('Enter a number from 1 to 11.');
  await expectNoHorizontalScroll(page);
});

test('the Reliefs chip follows Crew, and the screen lists the onboard crew by contract end, those with no length last', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'NOLENGTH', givenNames: 'No', signOn: '2026-05-01' });
  await addMember(page, { surname: 'LATER', givenNames: 'Late', signOn: '2026-09-01', contractMonths: '6' });       // ends 2027-03-01
  await addMember(page, { surname: 'SOONER', givenNames: 'Soon', signOn: '2026-08-01', contractMonths: '4' });      // ends 2026-12-01
  await addMember(page, { surname: 'SIGNEDOFF', givenNames: 'Gone', signOn: '2026-01-01', contractMonths: '2' });
  await addMember(page, { surname: 'FUTURE', givenNames: 'Not yet', signOn: '2026-11-01', contractMonths: '3' });
  await page.getByRole('list', { name: 'Crew' }).getByRole('listitem').filter({ hasText: 'Gone SIGNEDOFF' }).getByRole('button', { name: 'Sign off' }).click();
  await page.getByRole('dialog').getByLabel('Sign-off date').fill('2026-03-01');
  await page.getByRole('dialog').getByRole('button', { name: 'Sign off' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await shipChips(page).getByRole('link', { name: 'Reliefs' }).click();
  await expect(page).toHaveURL(/#\/ship\/reliefs$/);
  await expect(page.getByRole('heading', { name: 'Reliefs' })).toBeVisible();
  await expect(shipChips(page).getByRole('link')).toHaveText(['Particulars', 'Crew', 'Reliefs', 'Expiring', 'Certificates', 'Voyage', "Ship's time"]);
  await expect(shipChips(page).getByRole('link', { name: 'Reliefs' })).toHaveAttribute('aria-current', 'page');
  await expect(reliefList(page).getByRole('listitem')).toHaveText([/Soon SOONER/, /Late LATER/, /No NOLENGTH/]);
  await expect(reliefRow(page, 'Soon SOONER')).toContainText('Contract ends 2026-12-01');
  await expect(reliefRow(page, 'Soon SOONER')).toContainText('Onboard 86 days');
  await expect(reliefRow(page, 'Late LATER')).toContainText('Contract ends 2027-03-01');
  await expect(reliefRow(page, 'No NOLENGTH')).toContainText('No contract length');
  await expect(reliefRow(page, 'No NOLENGTH')).not.toContainText('Relief');       // no relief is planned, and no warning is due
  await expect(page.locator('[data-band]')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test('a row of the reliefs opens the crew member to edit', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'PETROVIĆ', contractMonths: '6', reliefDate: '2026-12-02', reliefPort: 'Rotterdam' });
  await page.goto('./#/ship/reliefs');
  await reliefRow(page, 'Ivan PETROVIĆ').getByRole('link').click();
  await expect(page).toHaveURL(/#\/ship\/crew\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Edit crew member' })).toBeVisible();
  await expect(page.getByLabel('Contract length (months)')).toHaveValue('6');
  await expect(page.getByLabel('Planned relief date')).toHaveValue('2026-12-02');
  await expect(page.getByLabel('Planned relief port')).toHaveValue('Rotterdam');
});

test('reliefs says so when nobody is onboard', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/reliefs');
  await expect(page.getByText('Nobody is onboard on 2026-10-25.')).toBeVisible();
  await expect(reliefList(page)).toHaveCount(0);
});

test('crew edit: the contract length is a whole-number text box, checked as typed', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/crew/new');
  const months = page.getByLabel('Contract length (months)');
  await expect(months).toHaveAttribute('type', 'text');
  await expect(months).toHaveAttribute('inputmode', 'numeric');
  await page.getByLabel('Surname').fill('PETROVIĆ');
  await page.getByLabel('Rank').selectOption({ label: 'Master' });
  await page.getByLabel('Sign-on date').fill('2026-06-01');

  for (const text of ['abc', '6.5', '0', '25', '-3']) {
    await months.fill(text);
    await expect(page.getByRole('alert')).toHaveText('Enter whole months between 1 and 24.');
  }
  await months.fill('6');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await months.fill('');
  await expect(page.getByRole('alert')).toHaveCount(0);   // empty is fine: the contract has no length

  await months.fill('6.5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew\/new$/);
  await expect(months).toBeFocused();
  expect(await stored(page, 'crew')).toHaveLength(0);
});

test('crew edit: a planned relief before the sign-on is refused, and the planned relief is saved and cleared', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/crew/new');
  await page.getByLabel('Surname').fill('PETROVIĆ');
  await page.getByLabel('Rank').selectOption({ label: 'Master' });
  await page.getByLabel('Sign-on date').fill('2026-06-01');
  await page.getByLabel('Planned relief date').fill('2026-05-31');
  await expect(page.getByRole('alert')).toHaveText("Planned relief can't be before sign-on.");
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew\/new$/);
  await expect(page.getByLabel('Planned relief date')).toBeFocused();
  expect(await stored(page, 'crew')).toHaveLength(0);

  await page.getByLabel('Planned relief date').fill('2026-06-01');          // the sign-on day is allowed
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('Planned relief date').fill('2026-11-05');
  await page.getByLabel('Planned relief port').fill('  Santos ');
  await page.getByLabel('Contract length (months)').fill(' 6 ');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew$/);
  const [saved] = await stored(page, 'crew');
  expect(saved).toMatchObject({ contractMonths: 6, reliefPlannedDate: '2026-11-05', reliefPlannedPort: 'Santos' });

  // Emptying the boxes removes the fields; they are not kept as empty text.
  await page.getByRole('list', { name: 'Crew' }).getByRole('listitem').filter({ hasText: 'PETROVIĆ' }).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Contract length (months)')).toHaveValue('6');
  await page.getByLabel('Contract length (months)').fill('');
  await page.getByLabel('Planned relief date').fill('');
  await page.getByLabel('Planned relief port').fill('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew$/);
  const [cleared] = await stored(page, 'crew');
  for (const key of ['contractMonths', 'reliefPlannedDate', 'reliefPlannedPort']) expect(key in cleared).toBe(false);
});

test('a contract that is near its end, or past the onboard limit, is an alert on Home that opens the reliefs', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'PETROVIĆ', givenNames: 'Ivan', signOn: '2026-06-01', contractMonths: '5' });       // ends 2026-11-01
  await page.goto('./#/');
  await expect(alertItems(page)).toHaveCount(1);
  const alert = alertItems(page).first();
  await expect(alert).toContainText('Ivan PETROVIĆ');
  await expect(alert).toContainText('Contract ends 2026-11-01');
  await expect(alert.locator('[data-band="amber"]')).toHaveText('Relief due soon');
  await expect(alert.getByRole('link')).toHaveAttribute('href', '#/ship/reliefs');
  await expectNoHorizontalScroll(page);

  await alert.getByRole('link').click();
  await expect(page).toHaveURL(/#\/ship\/reliefs$/);
  await expect(reliefRow(page, 'Ivan PETROVIĆ')).toContainText('Contract ends 2026-11-01');
  await expect(reliefRow(page, 'Ivan PETROVIĆ').getByText('Relief due soon')).toBeVisible();

  // Once the contract has ended it is red; a person over the limit has an alert of their own.
  await addMember(page, { surname: 'LONG', givenNames: 'Stay', signOn: '2025-09-01', contractMonths: '12' });         // limit 2026-08-01, contract ends 2026-09-01
  await page.goto('./#/');
  await expect(alertItems(page)).toHaveCount(3);
  // Red first, by date: the limit (2026-08-01) is reached before the contract ended (2026-09-01).
  await expect(alertItems(page)).toContainText([
    'Over 11-month onboard limit since 2026-08-01',
    'Contract ended 2026-09-01 — relief overdue',
    'Contract ends 2026-11-01',
  ]);
  await expect(alertItems(page).nth(0).locator('[data-band="red"]')).toHaveText('Onboard limit reached');
  await expect(alertItems(page).nth(1).locator('[data-band="red"]')).toHaveText('Relief overdue');
});

test("the ship's own maximum months onboard changes the limit badge and the alert", async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'PETROVIĆ', givenNames: 'Ivan', signOn: '2026-01-25' });   // 11 months: 2026-12-25; 9 months: 2026-10-25
  await page.goto('./#/ship/reliefs');
  await expect(reliefRow(page, 'Ivan PETROVIĆ')).toBeVisible();
  await expect(page.locator('[data-band]')).toHaveCount(0);

  await page.goto('./#/ship/particulars');
  await expect(page.getByLabel('Maximum months onboard')).toHaveValue('');
  await expect(page.getByLabel('Maximum months onboard')).toHaveAttribute('inputmode', 'numeric');
  await expect(page.getByText('Leave blank for 11 months.')).toBeVisible();
  await saveMaxMonths(page, '9');
  expect((await stored(page, 'ships'))[0]).toMatchObject({ maxMonthsOnboard: 9 });

  await page.goto('./#/ship/reliefs');
  await expect(reliefRow(page, 'Ivan PETROVIĆ').getByText('Onboard limit reached')).toBeVisible();
  await page.goto('./#/');
  await expect(alertItems(page)).toHaveCount(1);
  await expect(alertItems(page).first()).toContainText('Over 9-month onboard limit since 2026-10-25');

  // A reload keeps it, and a blank box goes back to the default of 11 months.
  await page.reload();
  await page.goto('./#/ship/particulars');
  await expect(page.getByLabel('Maximum months onboard')).toHaveValue('9');
  await saveMaxMonths(page, '');
  expect('maxMonthsOnboard' in (await stored(page, 'ships'))[0]).toBe(false);
  await page.goto('./#/ship/reliefs');
  await expect(reliefRow(page, 'Ivan PETROVIĆ')).toBeVisible();
  await expect(page.locator('[data-band]')).toHaveCount(0);
});

test('maximum months onboard: only whole months from 1 to 11 are accepted, and Save waits for a good value', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/particulars');
  const field = page.getByLabel('Maximum months onboard');
  await expect(page.getByRole('heading', { name: 'Crew policy' })).toBeVisible();
  for (const text of ['0', '12', '6.5', 'abc', '-1']) {
    await field.fill(text);
    await expect(page.getByRole('alert')).toHaveText('Enter a number from 1 to 11.');
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  }
  for (const text of ['1', '11', ' 6 ', '']) {
    await field.fill(text);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
  }
});

test('a re-joined contract keeps the contract length but has no planned relief', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, {
    surname: 'PETROVIĆ', givenNames: 'Ivan', signOn: '2026-06-01', contractMonths: '6', reliefDate: '2026-10-12', reliefPort: 'Santos',
  });
  const crewRow = page.getByRole('list', { name: 'Crew' }).getByRole('listitem').filter({ hasText: 'Ivan PETROVIĆ' });
  await crewRow.getByRole('button', { name: 'Sign off' }).click();
  await page.getByRole('dialog').getByLabel('Sign-off date').fill('2026-10-10');
  await page.getByRole('dialog').getByRole('button', { name: 'Sign off' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'All' }).click();
  await crewRow.getByRole('button', { name: 'Re-join' }).click();
  await page.getByRole('dialog').getByLabel('Sign-on date').fill('2026-10-20');
  await page.getByRole('dialog').getByLabel('Sign-on port').fill('Rotterdam');
  await page.getByRole('dialog').getByRole('button', { name: 'Re-join' }).click();
  await expect(crewRow).toHaveCount(2);

  const crew = await stored(page, 'crew');
  const [ended] = crew.filter((m) => m.signOnDate === '2026-06-01');
  const [rejoined] = crew.filter((m) => m.signOnDate === '2026-10-20');
  expect(ended).toMatchObject({ contractMonths: 6, reliefPlannedDate: '2026-10-12', reliefPlannedPort: 'Santos' });
  expect(rejoined).toMatchObject({ contractMonths: 6, signOnPort: 'Rotterdam' });
  expect('reliefPlannedDate' in rejoined).toBe(false);
  expect('reliefPlannedPort' in rejoined).toBe(false);

  await page.goto('./#/ship/reliefs');
  await expect(reliefList(page).getByRole('listitem')).toHaveCount(1);
  const row = reliefRow(page, 'Ivan PETROVIĆ');
  await expect(row).toContainText('Contract ends 2027-04-20');
  await expect(row).toContainText('Onboard 6 days');
  await expect(row).not.toContainText('Santos');
  await expect(row).not.toContainText(/Relief \d{4}-/);

  await row.getByRole('link').click();
  await expect(page.getByLabel('Contract length (months)')).toHaveValue('6');
  await expect(page.getByLabel('Planned relief date')).toHaveValue('');
  await expect(page.getByLabel('Planned relief port')).toHaveValue('');
});

test('long names and port names do not push the screens past 360 px', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, {
    surname: 'VAN DER BERG-PETROVIĆ-SCHMIDT-ALEXANDRAKOPOULOS', givenNames: 'Jean-Luc Alexander Maximilian Bartholomew',
    signOn: '2025-09-01', contractMonths: '12',
    reliefDate: '2026-11-05', reliefPort: 'Port of Santos Brazil Terminal Number Seven Extension Berth Supercalifragilisticexpialidocious',
  });
  await addMember(page, { surname: 'SHORT', givenNames: 'Al', signOn: '2026-05-01', contractMonths: '6', reliefDate: '2026-11-05', reliefPort: 'Rijeka' });
  const longName = 'Jean-Luc Alexander Maximilian Bartholomew VAN DER BERG-PETROVIĆ-SCHMIDT-ALEXANDRAKOPOULOS';

  await page.goto('./#/ship/reliefs');
  await expect(reliefRow(page, longName)).toBeVisible();
  await expect(reliefRow(page, longName).getByText('Relief overdue')).toBeVisible();
  await expect(reliefRow(page, longName).getByText('Onboard limit reached')).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.goto('./#/');
  await expect(alertItems(page).filter({ hasText: longName })).toHaveCount(2);
  await expectNoHorizontalScroll(page);

  await page.goto('./#/ship/reliefs');
  await reliefRow(page, longName).getByRole('link').click();
  await expect(page.getByLabel('Planned relief port')).toHaveValue(/Supercalifragilisticexpialidocious$/);
  await expectNoHorizontalScroll(page);

  await page.goto('./#/ship/particulars');
  await expect(page.getByLabel('Maximum months onboard')).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('a damaged maximum months onboard in the ship record is not used: 11 months apply, and no alert or crew member goes missing', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'PETROVIĆ', givenNames: 'Ivan', signOn: '2025-09-01', contractMonths: '12' });   // limit 2026-08-01, contract ended 2026-09-01
  await addMember(page, { surname: 'OTHER', givenNames: 'Ana', signOn: '2026-06-01' });                             // nothing to warn about

  for (const damaged of [6.5, '9', 0, 12]) {
    await storeMaxMonths(page, damaged);
    await page.reload();
    await page.goto('./#/');
    await expect(alertItems(page), `Home with ${JSON.stringify(damaged)}`).toHaveCount(2);
    await expect(alertItems(page)).toContainText([
      'Over 11-month onboard limit since 2026-08-01',
      'Contract ended 2026-09-01 — relief overdue',
    ]);
    await page.goto('./#/ship/reliefs');
    await expect(reliefList(page).getByRole('listitem'), `Reliefs with ${JSON.stringify(damaged)}`).toHaveCount(2);
    await expect(reliefRow(page, 'Ivan PETROVIĆ').getByText('Onboard limit reached')).toBeVisible();
    await expect(reliefRow(page, 'Ana OTHER').locator('[data-band]')).toHaveCount(0);
  }

  // The Particulars screen shows what is stored, with the message, so that it can be put right.
  await storeMaxMonths(page, 6.5);
  await page.reload();
  await page.goto('./#/ship/particulars');
  await expect(page.getByLabel('Maximum months onboard')).toHaveValue('6.5');
  await expect(page.getByRole('alert')).toHaveText('Enter a number from 1 to 11.');
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await page.getByLabel('Maximum months onboard').fill('9');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  expect((await stored(page, 'ships'))[0]).toMatchObject({ maxMonthsOnboard: 9 });
});
