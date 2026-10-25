import { promises as fs } from 'node:fs';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoHorizontalScroll, freshApp, setupShip } from './helpers';
import { makeCrewXlsx } from './fixtures/makeCrewXlsx';
import type { CrewSheetRow } from './fixtures/makeCrewXlsx';

// The clock is 2026-10-25T09:00Z and the ship is at UTC+03:00, so the ship's today is 2026-10-25.

const previewList = (page: Page) => page.getByRole('list', { name: 'Preview' });
const previewRow = (page: Page, text: string | RegExp) => previewList(page).getByRole('listitem').filter({ hasText: text });

/** Every record of an IndexedDB store as stored, to check what was really written. */
function stored(page: Page, store: 'crew' | 'ships' | 'snapshots'): Promise<Record<string, any>[]> {
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

/** Adds a crew member on the Add form, which leaves the browser on the crew list. */
async function addMember(page: Page, m: { surname: string; givenNames: string; dateOfBirth: string; passportNo: string; signOn: string }): Promise<void> {
  await page.goto('./#/ship/crew/new');
  await page.getByLabel('Surname').fill(m.surname);
  await page.getByLabel('Given names').fill(m.givenNames);
  await page.getByLabel('Rank').selectOption({ label: 'Master' });
  await page.getByLabel('Date of birth').fill(m.dateOfBirth);
  await page.getByLabel('Passport no.').fill(m.passportNo);
  await page.getByLabel('Sign-on date').fill(m.signOn);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew$/);
}

/** Signs a member off on the crew list, through the dialog. */
async function signOff(page: Page, who: string, date: string, port = ''): Promise<void> {
  await page.goto('./#/ship/crew');
  await page.getByRole('list', { name: 'Crew' }).getByRole('listitem').filter({ hasText: who }).getByRole('button', { name: 'Sign off' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Sign-off date').fill(date);
  await dialog.getByLabel('Sign-off port').fill(port);
  await dialog.getByRole('button', { name: 'Sign off' }).click();
  await expect(dialog).toHaveCount(0);
}

test('import crew from Excel, fix error, re-import shows no changes', async ({ page }, info) => {
  const file = info.outputPath('crew.xlsx'); await makeCrewXlsx(file);
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/crew/import');
  await page.getByLabel('Crew list file').setInputFiles(file);
  await expect(page.getByLabel('Header row')).toHaveValue('4');
  await expect(page.getByRole('listitem').filter({ hasText: 'New' })).toHaveCount(2);
  const err = page.getByRole('listitem').filter({ hasText: "O'BRIEN" });
  await expect(err).toContainText('Enter a valid date.');
  await expect(page.getByRole('button', { name: 'Import 2 crew' })).toBeEnabled();
  await err.getByRole('button', { name: 'Fix' }).click();
  await page.getByLabel('Date of birth').fill('1990-02-28'); await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Import 3 crew' }).click();
  await expect(page.getByText('Imported 3 crew.')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: /PETROVIĆ|O'BRIEN|ŠAŠIĆ/ })).toHaveCount(3);
  await page.goto('./#/ship/crew/import'); await page.getByLabel('Crew list file').setInputFiles(file);
  await expect(page.getByRole('listitem').filter({ hasText: 'No changes' })).toHaveCount(2); // the O'BRIEN row still has its bad date in the file
  await expectNoHorizontalScroll(page);
});
test('old .xls crew list imports the same way', async ({ page }, info) => {
  const xls = info.outputPath('crew.xls'); await makeCrewXlsx(xls, 'biff8');
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/crew/import');
  await page.getByLabel('Crew list file').setInputFiles(xls);
  await expect(page.getByLabel('Header row')).toHaveValue('4');
  await expect(page.getByRole('listitem').filter({ hasText: 'New' })).toHaveCount(2);
});
test('unsupported and unreadable files are explained', async ({ page }, info) => {
  const pdf = info.outputPath('crew.pdf'); await fs.writeFile(pdf, '%PDF-1.4');
  const bad = info.outputPath('locked.xlsx'); await fs.writeFile(bad, 'not a workbook');
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/crew/import');
  await page.getByLabel('Crew list file').setInputFiles(pdf);
  await expect(page.getByRole('alert')).toHaveText("This file type isn't supported. Use an Excel file (.xlsx or .xls) or a CSV file.");
  await page.getByLabel('Crew list file').setInputFiles(bad);
  await expect(page.getByRole('alert')).toContainText('password-protected');
});

test('the preview says what will happen to each row, and the wizard fits a phone', async ({ page }, info) => {
  const file = info.outputPath('crew.xlsx'); await makeCrewXlsx(file);
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/crew/import');
  await expect(page.getByLabel('Crew list file')).toHaveAttribute('accept', '.xlsx,.xls,.csv');
  await page.getByLabel('Crew list file').setInputFiles(file);
  await expect(page.getByLabel('Sheet')).toHaveValue('0');
  await expect(page.getByLabel('Header row')).toHaveAttribute('inputmode', 'numeric');
  await expect(page.getByLabel('Header row')).toHaveAttribute('type', 'text');
  // One select per column, labelled by its header, with the guessed field chosen.
  await expect(page.getByLabel('Surname', { exact: true })).toHaveValue('surname');
  await expect(page.getByLabel('Passport No', { exact: true })).toHaveValue('passportNo');
  await expect(page.getByLabel('No.', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('No.', { exact: true }).locator('option').first()).toHaveText('— ignore —');
  await expect(page.getByLabel('Date format')).toHaveValue('day-first');
  await expect(page.getByLabel('Date format').locator('option')).toHaveText(['Day first (DD.MM.YYYY)', 'Year first (YYYY-MM-DD)']);
  await expect(page.getByLabel('Sign-on date for rows without one')).toHaveValue('2026-10-25');

  await expect(previewList(page).getByRole('listitem')).toHaveCount(3);
  await expect(previewRow(page, 'PETROVIĆ')).toContainText('Row 5');
  await expect(previewRow(page, 'PETROVIĆ')).toContainText('New');
  await expect(previewRow(page, "O'BRIEN")).toContainText('Error');
  await expect(previewRow(page, "O'BRIEN").getByRole('button', { name: 'Fix' })).toBeVisible();
  await expect(previewRow(page, 'ŠAŠIĆ').getByRole('button', { name: 'Fix' })).toHaveCount(0);
  await expect(page.getByText('2 new, 1 error')).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('fixing a row shows only its form; Cancel keeps the wizard as it was, and Done checks the row again', async ({ page }, info) => {
  const file = info.outputPath('crew.xlsx'); await makeCrewXlsx(file);
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/crew/import');
  await page.getByLabel('Crew list file').setInputFiles(file);
  await previewRow(page, 'ŠAŠIĆ').getByLabel('Skip').check();
  await previewRow(page, "O'BRIEN").getByRole('button', { name: 'Fix' }).click();

  await expect(page.getByRole('heading', { name: 'Fix row 6' })).toBeVisible();
  await expect(page.getByLabel('Surname')).toHaveValue("O'BRIEN");
  await expect(page.getByRole('alert')).toHaveText('Enter a valid date.'); // what is wrong is shown from the start
  await expect(page.getByLabel('Crew list file')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Import crew from Excel' })).toBeHidden();
  await expect(page.getByRole('list', { name: 'Preview' })).toHaveCount(0);
  await expect(page.getByLabel('Header row')).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  await page.getByLabel('Date of birth').fill('2099-01-01');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByLabel('Crew list file')).toBeVisible();
  await expect(page.getByText('crew.xlsx', { exact: true })).toBeVisible(); // the file is named in the page, not only by the input
  await expect(page.getByLabel('Header row')).toHaveValue('4');
  await expect(previewRow(page, "O'BRIEN")).toContainText('Error');
  await expect(previewRow(page, 'ŠAŠIĆ').getByLabel('Skip')).toBeChecked(); // the skip survived

  await previewRow(page, "O'BRIEN").getByRole('button', { name: 'Fix' }).click();
  await page.getByLabel('Date of birth').fill('2099-01-01');
  await page.getByRole('button', { name: 'Done' }).click();
  // The edit is kept even though it is still wrong, and the row says so; the skip is kept as well.
  await expect(previewRow(page, "O'BRIEN")).toContainText('Date of birth must be in the past.');
  await expect(previewRow(page, "O'BRIEN")).toBeFocused();                       // the focus goes back to the row that was fixed
  await expect(previewRow(page, 'ŠAŠIĆ').getByLabel('Skip')).toBeChecked();
  await expect(page.getByRole('button', { name: 'Import 1 crew' })).toBeEnabled();
});

test('a CSV crew list imports too, with its letters as they are', async ({ page }, info) => {
  const csv = info.outputPath('crew.csv');
  await fs.writeFile(csv, 'Surname;Given names;Rank;Date of birth;Passport No\n"ŠAŠIĆ";Marko;C/O;12.12.1990;P77\nĐORĐEVIĆ;Nikola;Bosun;03.03.1980;P78\n');
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/crew/import');
  await page.getByLabel('Crew list file').setInputFiles(csv);
  await expect(page.getByLabel('Sheet')).toContainText('crew');
  await expect(previewRow(page, 'Marko ŠAŠIĆ')).toContainText('New');
  await expect(previewRow(page, 'Nikola ĐORĐEVIĆ')).toContainText('New');
  await page.getByRole('button', { name: 'Import 2 crew' }).click();
  await expect(page.getByText('Imported 2 crew.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Crew' })).toContainText('Marko ŠAŠIĆ');
  await expect(page.getByRole('list', { name: 'Crew' })).toContainText('Nikola ĐORĐEVIĆ');
});

test('the header row is checked, and changing it or a column rebuilds the preview', async ({ page }, info) => {
  const file = info.outputPath('crew.xlsx'); await makeCrewXlsx(file);
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/crew/import');
  await page.getByLabel('Crew list file').setInputFiles(file);
  await expect(previewList(page).getByRole('listitem')).toHaveCount(3);

  for (const bad of ['0', '10', 'four', '2.5', '']) {
    await page.getByLabel('Header row').fill(bad);
    await expect(page.getByRole('alert')).toHaveText('Enter a row number between 1 and 9.');
    await expect(previewList(page)).toHaveCount(0);
  }
  await page.getByLabel('Header row').fill('1');   // "CREW LIST" is no header: nothing is recognised
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('No crew found below the header row.')).toBeVisible();
  await page.getByLabel('Header row').fill('4');
  await expect(previewList(page).getByRole('listitem')).toHaveCount(3);

  // A column that is ignored is not read: without ranks every row is an error.
  await page.getByLabel('Rank', { exact: true }).selectOption({ label: '— ignore —' });
  await expect(previewRow(page, 'PETROVIĆ')).toContainText('Rank is required.');
  await expect(page.getByRole('button', { name: /^Import \d+ crew$/ })).toBeDisabled();
  // A column that takes a field over from another column leaves that one ignored.
  await page.getByLabel('No.', { exact: true }).selectOption({ label: 'Surname' });
  await expect(page.getByLabel('No.', { exact: true })).toHaveValue('surname');
  await expect(page.getByLabel('Surname', { exact: true })).toHaveValue('');
  await expect(previewRow(page, 'Ivan 1')).toBeVisible();
});

test('skipping a row takes it out of the import', async ({ page }, info) => {
  const file = info.outputPath('crew.xlsx'); await makeCrewXlsx(file);
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/crew/import');
  await page.getByLabel('Crew list file').setInputFiles(file);
  await expect(page.getByRole('button', { name: 'Import 2 crew' })).toBeEnabled();
  await previewRow(page, 'ŠAŠIĆ').getByLabel('Skip').check();
  await expect(page.getByRole('button', { name: 'Import 1 crew' })).toBeEnabled();
  await expect(page.getByText('1 new, 1 error, 1 skipped')).toBeVisible();
  await previewRow(page, 'PETROVIĆ').getByLabel('Skip').check();
  await expect(page.getByRole('button', { name: 'Import 0 crew' })).toBeDisabled();
  await previewRow(page, 'PETROVIĆ').getByLabel('Skip').uncheck();
  await page.getByRole('button', { name: 'Import 1 crew' }).click();
  await expect(page.getByText('Imported 1 crew.')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: /PETROVIĆ|O'BRIEN|ŠAŠIĆ/ })).toHaveCount(1);
  await expect(page.getByRole('listitem').filter({ hasText: 'PETROVIĆ' })).toHaveCount(1);
  await expect(page.getByRole('listitem').filter({ hasText: 'ŠAŠIĆ' })).toHaveCount(0);
});

test('a person already onboard under another passport is an overlap, and Skip moves the row out of the errors', async ({ page }, info) => {
  const file = info.outputPath('crew.xlsx'); await makeCrewXlsx(file);
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'PETROVIĆ', givenNames: 'Ivan', dateOfBirth: '1985-01-05', passportNo: 'OLD1', signOn: '2026-06-01' });
  await page.goto('./#/ship/crew/import'); await page.getByLabel('Crew list file').setInputFiles(file);

  const row = previewRow(page, 'PETROVIĆ');
  await expect(row).toContainText('Error');
  await expect(row).toContainText("This overlaps Ivan PETROVIĆ's contract from 2026-06-01 (still onboard).");
  await expect(page.getByRole('button', { name: 'Import 1 crew' })).toBeEnabled();   // only ŠAŠIĆ
  await expect(page.getByText('1 new, 2 errors')).toBeVisible();

  await row.getByLabel('Skip').check();
  await expect(page.getByText('1 new, 1 error, 1 skipped')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import 1 crew' })).toBeEnabled();
  await page.getByRole('button', { name: 'Import 1 crew' }).click();
  await expect(page.getByText('Imported 1 crew.')).toBeVisible();
  expect((await stored(page, 'crew')).map((m) => m.surname).sort()).toEqual(['PETROVIĆ', 'ŠAŠIĆ']);
});

test('two rows of the file for one person that overlap are both errors until one is skipped', async ({ page }, info) => {
  const rows: CrewSheetRow[] = [
    ['Surname', 'Given names', 'Rank', 'Date of birth', 'Passport No', 'Sign on'],
    ['PETROVIĆ', 'Ivan', 'Master', '05.01.1985', 'A1', '01.07.2026'],
    ['PETROVIĆ', 'Ivan', 'Master', '05.01.1985', 'B1', '15.08.2026'],
  ];
  const file = info.outputPath('crew.xlsx'); await makeCrewXlsx(file, 'xlsx', rows);
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/crew/import');
  await page.getByLabel('Crew list file').setInputFiles(file);
  await expect(previewRow(page, 'This overlaps row 3 of this file.')).toHaveCount(1);
  await expect(previewRow(page, 'This overlaps row 2 of this file.')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Import 0 crew' })).toBeDisabled();
  await previewList(page).getByRole('listitem').nth(1).getByLabel('Skip').check();
  await expect(page.getByRole('button', { name: 'Import 1 crew' })).toBeEnabled();
});

test('a passport fixed to be another row\'s flags both rows', async ({ page }, info) => {
  const rows: CrewSheetRow[] = [
    ['Surname', 'Given names', 'Rank', 'Date of birth', 'Passport No'],
    ['HORVAT', 'Ana', 'AB', '07.07.1977', 'P1'],
    ['KOVAČ', 'Luka', 'OS', '31.02.1990', 'P2'],
  ];
  const file = info.outputPath('crew.xlsx'); await makeCrewXlsx(file, 'xlsx', rows);
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/crew/import');
  await page.getByLabel('Crew list file').setInputFiles(file);
  await expect(page.getByRole('button', { name: 'Import 1 crew' })).toBeEnabled();

  await previewRow(page, 'KOVAČ').getByRole('button', { name: 'Fix' }).click();
  await page.getByLabel('Date of birth').fill('1990-02-28');
  await page.getByLabel('Passport no.').fill('p 1');
  await page.getByRole('button', { name: 'Done' }).click();

  for (const who of ['HORVAT', 'KOVAČ']) {
    await expect(previewRow(page, who)).toContainText('Error');
    await expect(previewRow(page, who)).toContainText('Duplicate passport number in this file.');
  }
  await expect(page.getByRole('button', { name: 'Import 0 crew' })).toBeDisabled();

  await previewRow(page, 'KOVAČ').getByLabel('Skip').check();
  await expect(previewRow(page, 'HORVAT')).toContainText('New');
  await expect(page.getByRole('button', { name: 'Import 1 crew' })).toBeEnabled();
});

test('a full name column is ignored, with a note, when the surname or the given names are mapped too', async ({ page }, info) => {
  const rows: CrewSheetRow[] = [
    ['Name', 'Surname', 'Given names', 'Rank', 'Passport No'],
    ['PETROVIĆ Ivan', 'PETROVIĆ', 'Ivan', 'Master', 'P1'],
  ];
  const file = info.outputPath('crew.xlsx'); await makeCrewXlsx(file, 'xlsx', rows);
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/crew/import');
  const note = page.getByText('Full name is ignored because Surname or Given names are mapped.');
  await expect(note).toHaveCount(0);
  await page.getByLabel('Crew list file').setInputFiles(file);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('fullName');
  await expect(note).toBeVisible();
  await page.getByLabel('Surname', { exact: true }).selectOption({ label: '— ignore —' });
  await page.getByLabel('Given names', { exact: true }).selectOption({ label: '— ignore —' });
  await expect(note).toHaveCount(0);
  await expect(previewRow(page, 'Ivan PETROVIĆ')).toContainText('New');
});

test('the import takes a before-import snapshot and saves the mapping, which the next import uses', async ({ page }, info) => {
  const rows: CrewSheetRow[] = [
    ['No.', 'Surname', 'Given names', 'Rank', 'Date of birth', 'Passport No'],
    ['1', 'PETROVIĆ', 'Ivan', 'Master', '1985-01-05', '012345678'],
    ['2', 'ŠAŠIĆ', 'Marko', 'C/O', '1990-12-12', 'P77'],
  ];
  const file = info.outputPath('crew-list.xlsx'); await makeCrewXlsx(file, 'xlsx', rows);
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'HORVAT', givenNames: 'Ana', dateOfBirth: '1977-07-07', passportNo: 'H1', signOn: '2026-01-01' });
  await page.goto('./#/ship/crew/import'); await page.getByLabel('Crew list file').setInputFiles(file);
  // The user maps the "No." column to the seaman's book number and picks the date format; both are saved with the ship.
  await page.getByLabel('No.', { exact: true }).selectOption({ label: "Seaman's book no." });
  await page.getByLabel('Date format').selectOption({ label: 'Year first (YYYY-MM-DD)' });
  await page.getByRole('button', { name: 'Import 2 crew' }).click();
  await expect(page.getByText('Imported 2 crew.')).toBeVisible();

  const snapshots = await stored(page, 'snapshots');
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]).toMatchObject({ reason: 'before-import', note: 'crew-list.xlsx' });
  expect(snapshots[0].data.crew.map((m: { surname: string }) => m.surname)).toEqual(['HORVAT']); // as it was before the import
  const crewAfterImport = await stored(page, 'crew');
  expect(crewAfterImport).toHaveLength(3);

  const [ship] = await stored(page, 'ships');
  expect(ship.crewImportMapping).toEqual({
    byHeader: { no: 'seamansBookNo', surname: 'surname', givennames: 'givenNames', rank: 'rank', dateofbirth: 'dateOfBirth', passportno: 'passportNo' },
    dateFormat: 'year-first',
  });
  const created = (await stored(page, 'crew')).find((m) => m.surname === 'PETROVIĆ');
  expect(created).toMatchObject({ seamansBookNo: '1', passportNo: '012345678', signOnDate: '2026-10-25', deleted: false, scope: 'ship' });

  await page.goto('./#/ship/crew/import'); await page.getByLabel('Crew list file').setInputFiles(file);
  await expect(page.getByLabel('No.', { exact: true })).toHaveValue('seamansBookNo');
  await expect(page.getByLabel('Date format')).toHaveValue('year-first');
  await expect(page.getByRole('listitem').filter({ hasText: 'No changes' })).toHaveCount(2);
  // A file with nothing new offers nothing to import, and nothing was written: the crew is as it was and no snapshot was added.
  await expect(page.getByRole('button', { name: 'Import 0 crew' })).toBeDisabled();
  expect(await stored(page, 'crew')).toEqual(crewAfterImport);
  expect(await stored(page, 'snapshots')).toHaveLength(1);
});

test('the flash after an import is shown once', async ({ page }, info) => {
  const file = info.outputPath('crew.xlsx'); await makeCrewXlsx(file);
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/crew/import');
  await page.getByLabel('Crew list file').setInputFiles(file);
  await page.getByRole('button', { name: 'Import 2 crew' }).click();
  await expect(page.getByRole('status')).toHaveText('Imported 2 crew.');
  await page.goto('./#/ship/particulars');
  await page.goto('./#/ship/crew');
  await expect(page.getByRole('list', { name: 'Crew' })).toBeVisible();
  await expect(page.getByText('Imported 2 crew.')).toHaveCount(0);
});

test('the spreadsheet reader is loaded when a file is chosen, and importing works offline', async ({ page, context }, info) => {
  const file = info.outputPath('crew.xlsx'); await makeCrewXlsx(file);
  await freshApp(page); await setupShip(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();                                                // from now on the service worker serves the page
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  const scripts: string[] = [];
  page.on('request', (request) => { if (request.resourceType() === 'script') scripts.push(request.url()); });
  await page.goto('./#/ship/crew/import');
  await expect(page.getByLabel('Crew list file')).toBeVisible();
  expect(scripts.filter((url) => /readSpreadsheet/.test(url))).toEqual([]);

  await context.setOffline(true);
  await page.getByLabel('Crew list file').setInputFiles(file);
  await expect(previewRow(page, 'ŠAŠIĆ')).toContainText('New');
  expect(scripts.filter((url) => /readSpreadsheet/.test(url))).toHaveLength(1);
  await page.getByRole('button', { name: 'Import 2 crew' }).click();
  await expect(page.getByText('Imported 2 crew.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Crew' }).getByRole('listitem')).toHaveCount(2);
});

test('choosing a file again reads it again, so a file saved over (or repaired) is not ignored', async ({ page }, info) => {
  const file = info.outputPath('crew.xlsx');
  const header: CrewSheetRow = ['Surname', 'Given names', 'Rank', 'Date of birth', 'Passport No'];
  await fs.writeFile(file, 'not a workbook');
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/crew/import');
  await page.getByLabel('Crew list file').setInputFiles(file);
  await expect(page.getByRole('alert')).toContainText('password-protected');

  await makeCrewXlsx(file, 'xlsx', [header, ['ŠAŠIĆ', 'Marko', 'C/O', '12.12.1990', 'P77']]);   // saved again, as the message says
  await page.getByLabel('Crew list file').setInputFiles(file);
  await expect(previewList(page).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('crew.xlsx', { exact: true })).toBeVisible();
  // The input has let go of the file, which is what lets the browser report the same file when it is chosen again.
  expect(await page.getByLabel('Crew list file').evaluate((input: HTMLInputElement) => input.files?.length)).toBe(0);

  await makeCrewXlsx(file, 'xlsx', [header, ['ŠAŠIĆ', 'Marko', 'C/O', '12.12.1990', 'P77'], ['KOVAČ', 'Luka', 'OS', '01.02.1991', 'P78']]);
  await page.getByLabel('Crew list file').setInputFiles(file);
  await expect(previewList(page).getByRole('listitem')).toHaveCount(2);
  await expect(previewRow(page, 'Luka KOVAČ')).toContainText('New');
});

test('Back while a row is being fixed returns to the preview, as it was', async ({ page }, info) => {
  const file = info.outputPath('crew.xlsx'); await makeCrewXlsx(file);
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/crew/import');
  await page.getByLabel('Crew list file').setInputFiles(file);
  await previewRow(page, 'ŠAŠIĆ').getByLabel('Skip').check();
  // Opening and closing the form is not a change of route: the router (and the scroll memory) hear of none.
  await page.evaluate(() => {
    (window as unknown as { hashChanges: number }).hashChanges = 0;
    window.addEventListener('hashchange', () => { (window as unknown as { hashChanges: number }).hashChanges += 1; });
  });
  await previewRow(page, "O'BRIEN").getByRole('button', { name: 'Fix' }).click();
  await expect(page.getByRole('heading', { name: 'Fix row 6' })).toBeVisible();
  await page.getByLabel('Date of birth').fill('1990-02-28');   // typed, but not applied

  await page.goBack();
  await expect(page).toHaveURL(/#\/ship\/crew\/import$/);
  await expect(page.getByRole('heading', { name: 'Fix row 6' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Import crew from Excel' })).toBeVisible();
  await expect(page.getByLabel('Header row')).toHaveValue('4');
  await expect(previewRow(page, 'ŠAŠIĆ').getByLabel('Skip')).toBeChecked();
  await expect(previewRow(page, "O'BRIEN")).toContainText('Error');   // what was typed was dropped, like Cancel
  await expect(previewRow(page, "O'BRIEN")).toBeFocused();

  // The form can be opened again, and Done and Cancel leave it the same way.
  await previewRow(page, "O'BRIEN").getByRole('button', { name: 'Fix' }).click();
  await page.getByLabel('Date of birth').fill('1990-02-28'); await page.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew\/import$/);
  await expect(previewRow(page, "O'BRIEN")).toContainText('New');
  await expect(page.getByRole('button', { name: 'Import 2 crew' })).toBeEnabled();   // PETROVIĆ and O'BRIEN; ŠAŠIĆ is skipped
  expect(await page.evaluate(() => (window as unknown as { hashChanges: number }).hashChanges)).toBe(0);
});

test('fixes and skips stay when only the way the cells are read changes, and go, with a notice, when the columns change', async ({ page }, info) => {
  const file = info.outputPath('crew.xlsx'); await makeCrewXlsx(file);
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/crew/import');
  await page.getByLabel('Crew list file').setInputFiles(file);
  const cleared = page.getByRole('status').filter({ hasText: 'Your fixes and skips were cleared because the columns changed.' });
  await previewRow(page, 'ŠAŠIĆ').getByLabel('Skip').check();
  await previewRow(page, "O'BRIEN").getByRole('button', { name: 'Fix' }).click();
  await page.getByLabel('Date of birth').fill('1990-02-28'); await page.getByRole('button', { name: 'Done' }).click();
  await expect(previewRow(page, "O'BRIEN")).toContainText('New');

  await page.getByLabel('Sign-on date for rows without one').fill('2026-11-01');
  await page.getByLabel('Date format').selectOption({ label: 'Year first (YYYY-MM-DD)' });   // the dotted dates are no dates any more
  await expect(previewRow(page, 'PETROVIĆ')).toContainText('Error');
  await expect(previewRow(page, 'ŠAŠIĆ').getByLabel('Skip')).toBeChecked();
  await expect(previewRow(page, "O'BRIEN")).toContainText('New');                              // its fix is kept
  await expect(cleared).toHaveCount(0);
  await page.getByLabel('Date format').selectOption({ label: 'Day first (DD.MM.YYYY)' });
  await expect(previewRow(page, 'PETROVIĆ')).toContainText('New');

  await page.getByLabel('Given names', { exact: true }).selectOption({ label: '— ignore —' });
  await expect(cleared).toBeVisible();
  await expect(previewRow(page, 'ŠAŠIĆ').getByLabel('Skip')).not.toBeChecked();
  await expect(previewRow(page, 'Jean-Luc')).toHaveCount(0);   // the given names are gone, and with them the fix of the row
  await expect(previewList(page).getByRole('listitem').filter({ hasText: "O'BRIEN" })).toContainText('Error');
  await previewRow(page, 'ŠAŠIĆ').getByLabel('Skip').check();   // the next thing the user does takes the notice away
  await expect(cleared).toHaveCount(0);
  await expect(page.getByRole('status')).toBeEmpty();
});

test('a column the user ignored although its header is known stays ignored on the next import', async ({ page }, info) => {
  const file = info.outputPath('crew.xlsx'); await makeCrewXlsx(file);
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/crew/import');
  await page.getByLabel('Crew list file').setInputFiles(file);
  await expect(page.getByLabel('Date of birth', { exact: true })).toHaveValue('dateOfBirth');
  await page.getByLabel('Date of birth', { exact: true }).selectOption({ label: '— ignore —' });
  await expect(page.getByRole('button', { name: 'Import 3 crew' })).toBeEnabled();    // the bad date was in the ignored column
  await page.getByRole('button', { name: 'Import 3 crew' }).click();
  await expect(page.getByText('Imported 3 crew.')).toBeVisible();
  expect((await stored(page, 'ships'))[0].crewImportMapping.ignored).toEqual(['dateofbirth']);
  expect((await stored(page, 'crew')).map((m) => m.dateOfBirth)).toEqual(['', '', '']);

  await page.goto('./#/ship/crew/import'); await page.getByLabel('Crew list file').setInputFiles(file);
  await expect(page.getByLabel('Date of birth', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Surname', { exact: true })).toHaveValue('surname');
  await expect(page.getByRole('listitem').filter({ hasText: 'No changes' })).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Import 0 crew' })).toBeDisabled();
});

test('an update row says which contract it updates and what it changes, and writes only that', async ({ page }, info) => {
  const rows: CrewSheetRow[] = [
    ['Surname', 'Given names', 'Rank', 'Date of birth', 'Passport No', 'Passport expiry'],
    ['HORVAT', 'Ana', 'C/O', '07.07.1977', 'H1', '01.01.2031'],
  ];
  const file = info.outputPath('crew.xlsx'); await makeCrewXlsx(file, 'xlsx', rows);
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'HORVAT', givenNames: 'Ana', dateOfBirth: '1977-07-07', passportNo: 'H1', signOn: '2026-01-01' });
  await signOff(page, 'Ana HORVAT', '2026-10-10', 'Santos');
  const [before] = await stored(page, 'crew');
  expect(before).toMatchObject({ signOffDate: '2026-10-10', signOffPort: 'Santos', rank: 'master', passportExpiry: '' });

  await page.goto('./#/ship/crew/import'); await page.getByLabel('Crew list file').setInputFiles(file);
  const row = previewRow(page, 'Ana HORVAT');
  await expect(row).toContainText('Update');
  await expect(row).toContainText('Updates the contract from 2026-01-01');
  await expect(row).toContainText('Rank: Master → Chief Officer');
  await expect(row).toContainText('Passport expiry: — → 2031-01-01');
  await expect(row.getByRole('button', { name: 'Fix' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Import 1 crew' }).click();
  await expect(page.getByText('Imported 1 crew.')).toBeVisible();

  const crew = await stored(page, 'crew');
  expect(crew).toHaveLength(1);
  expect(crew[0]).toEqual({ ...before, rank: 'chiefOfficer', passportExpiry: '2031-01-01', updatedAt: crew[0].updatedAt });
  expect(crew[0].updatedAt).not.toBe(before.updatedAt);
});

test('a passport of an earlier contract is an error, and the earlier contract is not changed', async ({ page }, info) => {
  const rows: CrewSheetRow[] = [
    ['Surname', 'Given names', 'Rank', 'Date of birth', 'Passport No'],
    ['HORVAT', 'Ana', 'C/O', '07.07.1977', 'P1'],      // the passport of the contract of 2025
    ['KOVAČ', 'Luka', 'OS', '01.02.1991', 'P78'],
  ];
  const file = info.outputPath('crew.xlsx'); await makeCrewXlsx(file, 'xlsx', rows);
  await freshApp(page); await setupShip(page);
  await addMember(page, { surname: 'HORVAT', givenNames: 'Ana', dateOfBirth: '1977-07-07', passportNo: 'P1', signOn: '2025-01-01' });
  await signOff(page, 'Ana HORVAT', '2025-06-30');
  await addMember(page, { surname: 'HORVAT', givenNames: 'Ana', dateOfBirth: '1977-07-07', passportNo: 'P2', signOn: '2026-06-01' });   // renewed passport
  const before = await stored(page, 'crew');
  expect(before).toHaveLength(2);

  await page.goto('./#/ship/crew/import'); await page.getByLabel('Crew list file').setInputFiles(file);
  const row = previewRow(page, 'Ana HORVAT');
  await expect(row).toContainText('Error');
  await expect(row).toContainText("This passport belongs to an earlier contract. Ana HORVAT's latest contract (from 2026-06-01) has passport P2.");
  await expect(row.getByRole('button', { name: 'Fix' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import 1 crew' })).toBeEnabled();    // only KOVAČ

  await row.getByLabel('Skip').check();
  await page.getByRole('button', { name: 'Import 1 crew' }).click();
  await expect(page.getByText('Imported 1 crew.')).toBeVisible();
  const after = await stored(page, 'crew');
  expect(after).toHaveLength(3);
  for (const m of before) expect(after.find((a) => a.id === m.id)).toEqual(m);   // neither HORVAT contract was touched
});

test.describe('while the file is read', () => {
  test.use({ serviceWorkers: 'block' }); // so that page.route sees the request for the spreadsheet reader

  test('"Reading file…" is announced until the preview is there', async ({ page }, info) => {
    const file = info.outputPath('crew.xlsx'); await makeCrewXlsx(file);
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/assets/readSpreadsheet-*.js', async (route) => { await gate; await route.continue(); });
    await freshApp(page); await setupShip(page); await page.goto('./#/ship/crew/import');
    await page.getByLabel('Crew list file').setInputFiles(file);
    await expect(page.getByRole('status')).toHaveText('Reading file…');
    release();
    await expect(previewList(page)).toBeVisible();
    await expect(page.getByRole('status')).toBeEmpty(); // the region stays on the page, and only its text goes
  });
});
