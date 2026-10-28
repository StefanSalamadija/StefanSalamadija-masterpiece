import { promises as fs } from 'node:fs';
import * as XLSX from 'xlsx';
import { test, expect } from '@playwright/test';
import type { Download, Page } from '@playwright/test';
import { expectNoHorizontalScroll, freshApp, setupShip } from './helpers';

// The clock is 2026-10-25T09:00Z and the ship is at UTC+03:00, so the ship's today is 2026-10-25.

const DEFAULT_HEADERS = [
  'No.', 'Surname', 'Given names', 'Rank', 'Nationality', 'Date of birth', 'Place of birth', 'Passport no.', 'Passport expiry',
  'Sign-on date', 'Sign-on port',
];
const MASTER_ROW = ['1', 'PETROVIĆ', 'Ivan', 'Master', 'Serbian', '05-JAN-1985', 'Kotor', '012345678', '01-MAR-2030', '01-JUN-2026', 'Rotterdam'];
const AB_ROW = ['2', 'KOVAČ', 'Luka', 'AB', 'Croatian', '28-FEB-1990', 'Split', 'X1', '31-DEC-2031', '10-AUG-2026', 'Antwerp'];

const sheetOf = (page: Page) => page.getByTestId('crew-list-sheet');
const crewRow = (page: Page, name: string) => page.getByRole('list', { name: 'Crew' }).getByRole('listitem').filter({ hasText: name });
// "Next port" alone would match "Agents at next port" as well.
const nextPort = (page: Page) => page.getByLabel('Next port', { exact: true });

interface NewMember {
  surname: string;
  givenNames: string;
  rank: string;
  nationality: string;
  dateOfBirth: string;
  placeOfBirth: string;
  passportNo: string;
  passportExpiry: string;
  signOn: string;
  signOnPort: string;
  seamansBookNo?: string;
  contractMonths?: string;
}

const MASTER: NewMember = {
  surname: 'PETROVIĆ', givenNames: 'Ivan', rank: 'Master', nationality: 'Serbian', dateOfBirth: '1985-01-05', placeOfBirth: 'Kotor',
  passportNo: '012345678', passportExpiry: '2030-03-01', signOn: '2026-06-01', signOnPort: 'Rotterdam',
};
const AB: NewMember = {
  surname: 'KOVAČ', givenNames: 'Luka', rank: 'AB', nationality: 'Croatian', dateOfBirth: '1990-02-28', placeOfBirth: 'Split',
  passportNo: 'X1', passportExpiry: '2031-12-31', signOn: '2026-08-10', signOnPort: 'Antwerp',
};

/** Fills in the Add form and saves it, which leaves the browser on the crew list. */
async function addMember(page: Page, m: NewMember): Promise<void> {
  await page.goto('./#/ship/crew/new');
  await page.getByLabel('Surname').fill(m.surname);
  await page.getByLabel('Given names').fill(m.givenNames);
  await page.getByLabel('Rank').selectOption({ label: m.rank });
  await page.getByLabel('Nationality').fill(m.nationality);
  await page.getByLabel('Date of birth').fill(m.dateOfBirth);
  await page.getByLabel('Place of birth').fill(m.placeOfBirth);
  await page.getByLabel('Passport no.').fill(m.passportNo);
  await page.getByLabel('Passport expiry').fill(m.passportExpiry);
  if (m.seamansBookNo) await page.getByLabel("Seaman's book no.").fill(m.seamansBookNo);
  await page.getByLabel("Seaman's book expiry").fill('2030-01-01');
  await page.getByLabel('Sign-on date').fill(m.signOn);
  await page.getByLabel('Sign-on port').fill(m.signOnPort);
  if (m.contractMonths) await page.getByLabel('Contract length (months)').fill(m.contractMonths);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew$/);
}

/** Signs a member off through the dialog on the crew list and waits for it to close. */
async function signOff(page: Page, who: string, date: string): Promise<void> {
  await page.goto('./#/ship/crew');
  await crewRow(page, who).getByRole('button', { name: 'Sign off' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Sign-off date').fill(date);
  await dialog.getByRole('button', { name: 'Sign off' }).click();
  await expect(dialog).toHaveCount(0);
}

/** The ship MV OCEAN STAR with its IMO number, call sign and flag, whose voyage's next port is Rotterdam. */
async function setUpShip(page: Page): Promise<void> {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/particulars');
  await page.getByLabel('IMO number').fill('9074729');
  await page.getByLabel('Call sign').fill('9HAB2');
  await page.getByLabel('Flag', { exact: true }).fill('Malta');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.goto('./#/ship/voyage');
  await nextPort(page).fill('Rotterdam');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
}

/** The ship, with the Master and one AB aboard. */
async function setUpCrew(page: Page, master: NewMember = MASTER): Promise<void> {
  await setUpShip(page);
  await addMember(page, master);
  await addMember(page, AB);
}

/** The rows of the sheet's table as text, the header row first. */
function tableRows(page: Page): Promise<string[][]> {
  return sheetOf(page).getByRole('row').evaluateAll((rows) =>
    rows.map((row) => [...row.querySelectorAll('th, td')].map((cell) => (cell.textContent ?? '').trim())),
  );
}

/** The ship record's saved columns, as stored in IndexedDB. */
function storedColumns(page: Page): Promise<unknown> {
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
            resolve((request.result[0] as { crewListColumns?: unknown }).crewListColumns);
          };
        };
      }),
  );
}

/** Writes `columns` into the ship record the way a damaged backup could have left them. */
function storeColumns(page: Page, columns: unknown): Promise<void> {
  return page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('masterpiece');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('ships', 'readwrite');
          const store = tx.objectStore('ships');
          const all = store.getAll();
          all.onsuccess = () => store.put({ ...all.result[0], crewListColumns: value });
          tx.onerror = () => reject(tx.error);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    columns,
  );
}

/** A row without the blank cells at its end, which the sheet's range may or may not reach. */
function withoutTrailingBlanks(row: string[]): string[] {
  let end = row.length;
  while (end > 0 && row[end - 1] === '') end -= 1;
  return row.slice(0, end);
}

/** What the downloaded .xlsx holds, read with SheetJS: its sheet names and the rows of its first sheet as text. */
async function readExport(download: Download): Promise<{ sheetNames: string[]; rows: string[][] }> {
  const book = XLSX.read(await fs.readFile(await download.path()), { type: 'array' });
  const sheet = book.Sheets[book.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', blankrows: true });
  return { sheetNames: book.SheetNames, rows: rows.map((row) => withoutTrailingBlanks(row.map(String))) };
}

/** Whether `<html>` has the class that the print rules of the sheet key on. */
function printingClass(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.classList.contains('printing-crew-list'));
}

/** The size in points and the number of pages of what the browser prints of the screen it is on, on the page that screen asks for. */
async function printedPages(page: Page): Promise<{ width: number; height: number; pages: number }> {
  const pdf = new TextDecoder('latin1').decode(await page.pdf({ preferCSSPageSize: true }));
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf);
  expect(box, 'the printed file names its page size').not.toBeNull();
  return { width: Number(box![1]), height: Number(box![2]), pages: (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length };
}

test('print crew list and export to Excel', async ({ page }) => {
  await setUpCrew(page);
  await page.goto('./#/ship/crew');
  await page.getByRole('button', { name: 'Print crew list' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew\/print$/);
  const sheet = sheetOf(page);
  await expect(sheet.getByRole('heading', { name: 'CREW LIST' })).toBeVisible();
  await expect(sheet).toContainText('Vessel MV OCEAN STAR');
  await expect(sheet).toContainText('IMO 9074729');
  await expect(sheet).toContainText('Call sign 9HAB2');
  await expect(sheet).toContainText('Flag Malta');
  await expect(sheet).toContainText('Port Rotterdam');                  // the next port of the voyage
  await expect(sheet).toContainText('Date 25-OCT-2026');                // the As at of the crew list
  await expect(page.getByLabel('Port', { exact: true })).toHaveValue('Rotterdam');
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-10-25');
  await expect(sheet.getByRole('row')).toHaveCount(3);                  // header + 2 crew
  expect(await tableRows(page)).toEqual([DEFAULT_HEADERS, MASTER_ROW, AB_ROW]);
  await expect(sheet).toContainText('Master: Ivan PETROVIĆ');
  await expect(sheet).toContainText("Ship's stamp");
  await expect(sheet).toContainText('Printed with Masterpiece');

  // One checkbox per column, the default ones ticked.
  const columns = page.getByRole('group', { name: 'Columns' });
  await expect(columns.getByRole('checkbox')).toHaveCount(15);
  await expect(columns.getByRole('checkbox', { checked: true })).toHaveCount(11);
  await expect(page.getByLabel("Seaman's book no.")).not.toBeChecked();
  await expect(page.getByLabel('Passport no.')).toBeChecked();

  await page.getByLabel('Place of birth').uncheck();
  await expect(sheet.getByRole('columnheader', { name: 'Place of birth' })).toHaveCount(0);
  await expect(sheet.getByRole('columnheader')).toHaveCount(10);
  await expect.poll(() => storedColumns(page)).not.toContain('placeOfBirth');   // it is saved with the ship before the page is left
  await page.reload();
  await expect(page.getByLabel('Place of birth')).not.toBeChecked();
  await expect(sheet.getByRole('columnheader', { name: 'Place of birth' })).toHaveCount(0);
  // A reload forgets the crew list's date and filter, which are kept only while the app is open: the date is today again.
  await expect(sheet).toContainText('Date 25-OCT-2026');

  // Print opens the browser's print dialog, which a test cannot drive: it is asked for once.
  await page.evaluate(() => {
    const counter = window as unknown as { printCalls: number };
    counter.printCalls = 0;
    window.print = () => { counter.printCalls += 1; };
  });
  await page.getByRole('button', { name: 'Print', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { printCalls: number }).printCalls)).toBe(1);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export to Excel' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('crew-list-mv-ocean-star-2026-10-25.xlsx');
  await expect(page.getByRole('status')).toHaveText('Crew list exported.');
  const exported = await readExport(file);
  expect(exported.sheetNames).toEqual(['Crew list']);
  const withoutPlace = (row: string[]) => row.filter((_, i) => i !== 6);
  expect(exported.rows).toEqual([
    ['CREW LIST'],
    ['Vessel', 'MV OCEAN STAR', 'IMO', '9074729'],
    ['Call sign', '9HAB2', 'Flag', 'Malta'],
    ['Port', 'Rotterdam', 'Date', '25-OCT-2026'],
    [],
    withoutPlace(DEFAULT_HEADERS),
    withoutPlace(MASTER_ROW),
    withoutPlace(AB_ROW),
  ]);

  // Printing: only the sheet, and nothing of the screen's controls or bars.
  expect(await printingClass(page)).toBe(true);                           // what the print rules key on, with no `:has()`
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Export to Excel' })).toBeHidden();
  await expect(page.getByLabel('Passport no.')).toBeHidden();
  await expect(page.getByRole('banner')).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Ship sections' })).toBeHidden();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('columnheader')).toHaveCount(10);
  await page.emulateMedia({ media: null });

  // On one A4 landscape page...
  const printed = await printedPages(page);
  expect(printed.width).toBeCloseTo(842, -1);
  expect(printed.height).toBeCloseTo(595, -1);
  expect(printed.pages).toBe(1);
  // ...which is this sheet's only: the crew list prints on the browser's own page.
  await page.goto('./#/ship/crew');
  await expect(page.getByRole('button', { name: 'Print crew list' })).toBeVisible();
  expect(await printingClass(page)).toBe(false);                          // gone with the sheet: it is not left on the other screens
  const other = await printedPages(page);
  expect(other.height).toBeGreaterThan(other.width);
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('banner')).toBeVisible();                   // and the header is still printed there, as it was
  await page.emulateMedia({ media: null });
});

test('the sheet takes the crew list\'s All filter and As at date, and its date can be changed', async ({ page }) => {
  await setUpCrew(page);
  await signOff(page, 'KOVAČ', '2026-09-30');
  await page.goto('./#/ship/crew');
  await page.getByRole('button', { name: 'Print crew list' }).click();
  await expect(sheetOf(page).getByRole('row')).toHaveCount(2);                  // the header and the Master: the AB has left
  await expect(sheetOf(page)).not.toContainText('KOVAČ');

  // Export to Excel on the crew list opens the same sheet; with All, the contract that ended is on it.
  await page.goto('./#/ship/crew');
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'All' }).click();
  await page.getByRole('button', { name: 'Export to Excel' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew\/print$/);
  await expect(sheetOf(page).getByRole('row')).toHaveCount(3);
  expect((await tableRows(page)).map((row) => row[1])).toEqual(['Surname', 'PETROVIĆ', 'KOVAČ']);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export to Excel' }).click();
  const { rows } = await readExport(await download);
  expect(rows.slice(5).map((row) => row[1])).toEqual(['Surname', 'PETROVIĆ', 'KOVAČ']);
  expect(rows[7]).toEqual(['2', 'KOVAČ', 'Luka', 'AB', 'Croatian', '28-FEB-1990', 'Split', 'X1', '31-DEC-2031', '10-AUG-2026', 'Antwerp']);

  // The As at date is the sheet's date, and the date printed with it.
  await page.goto('./#/ship/crew');
  await page.getByLabel('As at').fill('2026-07-01');
  await page.getByRole('button', { name: 'Print crew list' }).click();
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-07-01');
  await expect(sheetOf(page)).toContainText('Date 01-JUL-2026');
  await expect(sheetOf(page).getByRole('row')).toHaveCount(3);                  // All shows every contract, whatever the date

  // With Onboard it is who was onboard on that day, and changing the date on the sheet changes who that is.
  await page.goto('./#/ship/crew');
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Onboard' }).click();
  await page.getByRole('button', { name: 'Print crew list' }).click();
  await expect(sheetOf(page).getByRole('row')).toHaveCount(2);                  // 2026-07-01: the Master only
  await page.getByLabel('Date', { exact: true }).fill('2026-09-15');
  await expect(sheetOf(page).getByRole('row')).toHaveCount(3);                  // 2026-09-15: both
  await expect(sheetOf(page)).toContainText('Date 15-SEP-2026');
  const dated = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export to Excel' }).click();
  expect((await dated).suggestedFilename()).toBe('crew-list-mv-ocean-star-2026-09-15.xlsx');
});

test('the port can be changed on the sheet, and is the one in the file', async ({ page }) => {
  await setUpCrew(page);
  await page.goto('./#/ship/crew/print');
  await page.getByLabel('Port', { exact: true }).fill('Antwerp');
  await expect(sheetOf(page)).toContainText('Port Antwerp');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export to Excel' }).click();
  const { rows } = await readExport(await download);
  expect(rows[3]).toEqual(['Port', 'Antwerp', 'Date', '25-OCT-2026']);
  // Emptied, the port is left blank: the sheet does not fall back to the voyage.
  await page.getByLabel('Port', { exact: true }).fill('');
  await expect(sheetOf(page)).toContainText('Port Date 25-OCT-2026');
  const blank = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export to Excel' }).click();
  expect((await readExport(await blank)).rows[3]).toEqual(['Port', '', 'Date', '25-OCT-2026']);
});

test('the Master line is the Master onboard on the sheet\'s date, and blank when there is none', async ({ page }) => {
  await setUpCrew(page);
  await page.goto('./#/ship/crew/print');
  const line = sheetOf(page).locator('.sheet-master-line');
  await expect(line).toHaveText('Master: Ivan PETROVIĆ');

  // Before the Master signed on, nobody is Master: the line stays, and is blank.
  await page.getByLabel('Date', { exact: true }).fill('2026-05-01');
  await expect(sheetOf(page)).toContainText('Date 01-MAY-2026');
  await expect(line).toHaveText('Master:');
  await expect(sheetOf(page)).toContainText("Ship's stamp");

  // A Master who has signed off is the Master up to the day of the sign-off, and not after it. The AB is never one.
  await signOff(page, 'PETROVIĆ', '2026-10-10');
  await page.goto('./#/ship/crew/print');
  await expect(line).toHaveText('Master:');
  await page.getByLabel('Date', { exact: true }).fill('2026-10-10');
  await expect(line).toHaveText('Master: Ivan PETROVIĆ');
  await page.getByLabel('Date', { exact: true }).fill('2026-10-11');
  await expect(line).toHaveText('Master:');
});

test('at least one column stays ticked; the choice is saved with the ship, and a damaged one is ignored', async ({ page }) => {
  await setUpCrew(page);
  await page.goto('./#/ship/crew/print');
  const columns = page.getByRole('group', { name: 'Columns' });
  const ticked = columns.getByRole('checkbox', { checked: true });
  await expect(ticked).toHaveCount(11);

  for (const label of DEFAULT_HEADERS.filter((header) => header !== 'Surname')) await columns.getByLabel(label, { exact: true }).uncheck();
  await expect(ticked).toHaveCount(1);
  await expect(sheetOf(page).getByRole('columnheader')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);

  // The last one cannot be taken off: the box stays ticked, the sheet keeps its column, and the page says why.
  await columns.getByLabel('Surname', { exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Choose at least one column.');
  await expect(columns.getByLabel('Surname', { exact: true })).toBeChecked();
  await columns.getByLabel('Surname', { exact: true }).click();         // and again, with the message already there
  await expect(columns.getByLabel('Surname', { exact: true })).toBeChecked();
  await expect(page.getByRole('alert')).toHaveText('Choose at least one column.');
  await expect(sheetOf(page).getByRole('columnheader')).toHaveText(['Surname']);
  await expect.poll(() => storedColumns(page)).toEqual(['surname']);
  // The file has that one column, under the same header block.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export to Excel' }).click();
  expect((await readExport(await download)).rows).toEqual([
    ['CREW LIST'],
    ['Vessel', 'MV OCEAN STAR', 'IMO', '9074729'],
    ['Call sign', '9HAB2', 'Flag', 'Malta'],
    ['Port', 'Rotterdam', 'Date', '25-OCT-2026'],
    [],
    ['Surname'],
    ['PETROVIĆ'],
    ['KOVAČ'],
  ]);

  // Ticking a column again takes the message away; the columns come in the order of the sheet, not of the ticking.
  await columns.getByLabel('CoC no.', { exact: true }).check();
  await columns.getByLabel('Rank', { exact: true }).check();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(sheetOf(page).getByRole('columnheader')).toHaveText(['Surname', 'Rank', 'CoC no.']);
  await expect.poll(() => storedColumns(page)).toEqual(['surname', 'rank', 'cocNumber']);
  await page.reload();
  await expect(ticked).toHaveCount(3);
  await expect(sheetOf(page).getByRole('columnheader')).toHaveText(['Surname', 'Rank', 'CoC no.']);

  // A stored choice with keys that are not columns keeps the ones that are; one with none is the default columns.
  await storeColumns(page, ['shoeSize', 'givenNames', 7]);
  await page.reload();
  await expect(sheetOf(page).getByRole('columnheader')).toHaveText(['Given names']);
  for (const damaged of [['shoeSize'], [], 'surname', null]) {
    await storeColumns(page, damaged);
    await page.reload();
    await expect(sheetOf(page).getByRole('columnheader')).toHaveText(DEFAULT_HEADERS);
  }
});

test('the optional columns: the seaman\'s book, the CoC number and the end of the contract', async ({ page }) => {
  await setUpCrew(page, { ...MASTER, seamansBookNo: 'SB-998', contractMonths: '4' });
  await page.goto('./#/ship/crew');
  await crewRow(page, 'PETROVIĆ').getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Add document' }).click();
  await page.getByLabel('Document', { exact: true }).selectOption({ label: 'Certificate of Competency (CoC)' });
  await page.getByLabel('Number').fill('CoC-123');
  await page.getByLabel('Issue date').fill('2024-01-01');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Edit crew member' })).toBeVisible();

  await page.goto('./#/ship/crew/print');
  const columns = page.getByRole('group', { name: 'Columns' });
  for (const label of ["Seaman's book no.", "Seaman's book expiry", 'CoC no.', 'Contract end']) await columns.getByLabel(label, { exact: true }).check();
  const rows = await tableRows(page);
  // The columns come in the order of the list, so the sign-on date and port are between the book and the CoC.
  expect(rows[0]).toEqual([
    ...DEFAULT_HEADERS.slice(0, 9), "Seaman's book no.", "Seaman's book expiry", 'Sign-on date', 'Sign-on port', 'CoC no.', 'Contract end',
  ]);
  expect(rows[1].slice(9)).toEqual(['SB-998', '01-JAN-2030', '01-JUN-2026', 'Rotterdam', 'CoC-123', '01-OCT-2026']);
  expect(rows[2].slice(13)).toEqual(['', '']);                            // the AB has no CoC entered and no contract length
});

test('export works offline: the Excel writer is loaded when it is asked for, from the service worker\'s cache', async ({ page, context }) => {
  await setUpCrew(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();                                                    // from now on the service worker serves the page
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  const scripts: string[] = [];
  page.on('request', (request) => { if (request.resourceType() === 'script') scripts.push(request.url()); });
  await page.goto('./#/ship/crew/print');
  await expect(sheetOf(page).getByRole('row')).toHaveCount(3);
  await page.getByLabel('Passport no.').uncheck();
  await expect(sheetOf(page).getByRole('columnheader', { name: 'Passport no.' })).toHaveCount(0);
  // Opening the sheet, choosing columns and printing need no spreadsheet code.
  expect(scripts.filter((url) => /crewListWorkbook|xlsx/.test(url))).toEqual([]);

  await context.setOffline(true);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export to Excel' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('crew-list-mv-ocean-star-2026-10-25.xlsx');
  expect(scripts.filter((url) => /crewListWorkbook/.test(url))).toHaveLength(1);
  await expect(page.getByRole('status')).toHaveText('Crew list exported.');
  const withoutPassport = (row: string[]) => row.filter((_, i) => i !== 7);
  const { rows } = await readExport(file);
  expect(rows.slice(5)).toEqual([withoutPassport(DEFAULT_HEADERS), withoutPassport(MASTER_ROW), withoutPassport(AB_ROW)]);
});

test('the sheet fits a phone: the options do not scroll the page, and a wide table scrolls inside its own box', async ({ page }) => {
  await setUpCrew(page);
  await page.goto('./#/ship/crew');
  await expectNoHorizontalScroll(page);                                   // the new buttons wrap
  await page.goto('./#/ship/crew/print');
  const columns = page.getByRole('group', { name: 'Columns' });
  for (const label of ["Seaman's book no.", "Seaman's book expiry", 'CoC no.', 'Contract end']) await columns.getByLabel(label, { exact: true }).check();
  await expect(sheetOf(page).getByRole('columnheader')).toHaveCount(15);
  await expectNoHorizontalScroll(page);
  const box = sheetOf(page).getByRole('region', { name: 'Crew list table' });
  const [scrollWidth, clientWidth] = await box.evaluate((element) => [element.scrollWidth, element.clientWidth]);
  expect(scrollWidth).toBeGreaterThan(clientWidth);                       // wider than the phone, so it scrolls in its box
  await box.focus();
  await expect(box).toBeFocused();                                        // and a keyboard can scroll it
});

test('a date or a number is never broken over two lines when printed, a name may be', async ({ page }) => {
  await setUpCrew(page);
  await page.goto('./#/ship/crew/print');
  const columns = page.getByRole('group', { name: 'Columns' });
  for (const label of ["Seaman's book no.", "Seaman's book expiry", 'CoC no.', 'Contract end']) await columns.getByLabel(label, { exact: true }).check();
  // Narrow, so that the columns have to give way; what is printed has no scroll box to hide the breaks in.
  await page.setViewportSize({ width: 360, height: 740 });
  await page.emulateMedia({ media: 'print' });
  const lines = await sheetOf(page).locator('td').evaluateAll((cells) =>
    cells.map((cell) => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
      return { kind: cell.className, text: cell.textContent ?? '', lines: tops.size, white: getComputedStyle(cell).whiteSpace };
    }),
  );
  const dates = lines.filter((cell) => cell.kind === 'col-date' && cell.text !== '');
  const numbers = lines.filter((cell) => cell.kind === 'col-number' && cell.text !== '');
  expect(dates.map((cell) => cell.text)).toContain('05-JAN-1985');
  expect(numbers.map((cell) => cell.text)).toContain('012345678');
  for (const cell of [...dates, ...numbers]) {
    expect(cell.lines, cell.text).toBe(1);
    expect(cell.white, cell.text).toBe('nowrap');
  }
  for (const cell of lines.filter((c) => c.kind === 'col-text')) expect(cell.white, cell.text).toBe('normal');   // names and places may wrap
});

test('on a laptop-wide screen the 11 default columns fit the table\'s box; on a phone it scrolls', async ({ page }) => {
  await setUpCrew(page);
  await page.goto('./#/ship/crew/print');
  await expect(sheetOf(page).getByRole('columnheader')).toHaveCount(11);
  const box = sheetOf(page).getByRole('region', { name: 'Crew list table' });
  const widths = () => box.evaluate((element) => [element.scrollWidth, element.clientWidth]);

  await page.setViewportSize({ width: 900, height: 800 });
  const [wide, wideBox] = await widths();
  expect(wide).toBeLessThanOrEqual(wideBox);                              // no sideways scrolling at 900 px
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(900);
  await page.setViewportSize({ width: 1280, height: 800 });
  const [roomy, roomyBox] = await widths();
  expect(roomy).toBeLessThanOrEqual(roomyBox);

  await page.setViewportSize({ width: 360, height: 740 });
  const [narrow, narrowBox] = await widths();
  expect(narrow).toBeGreaterThan(narrowBox);                              // on a phone the cells keep to one line and the box scrolls
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test('the printed table fits the width of an A4 page in landscape, with 11 columns and with all 15', async ({ page }) => {
  await setUpCrew(page, {
    ...MASTER, surname: 'PETROVIĆ-ŠAŠIĆ', givenNames: 'Ivan Marko', nationality: 'Montenegrin', passportNo: 'P1234567890123',
    seamansBookNo: 'SB-99887766554433', contractMonths: '6',
  });
  await page.goto('./#/ship/crew/print');
  await expect(sheetOf(page).getByRole('columnheader')).toHaveCount(11);
  // The width of the page's print area: 297 mm less the two 10 mm margins, which is 1047 CSS pixels.
  await page.setViewportSize({ width: 1047, height: 800 });
  await page.emulateMedia({ media: 'print' });
  const box = sheetOf(page).locator('.sheet-table-wrap');
  const fits = () => box.evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(await fits()).toBe(true);

  await page.emulateMedia({ media: null });
  for (const label of ["Seaman's book no.", "Seaman's book expiry", 'CoC no.', 'Contract end']) await page.getByLabel(label, { exact: true }).check();
  await expect(sheetOf(page).getByRole('columnheader')).toHaveCount(15);
  await page.emulateMedia({ media: 'print' });
  expect(await fits()).toBe(true);
  expect(await sheetOf(page).locator('td.col-date').first().evaluate((cell) => getComputedStyle(cell).whiteSpace)).toBe('nowrap');
});
