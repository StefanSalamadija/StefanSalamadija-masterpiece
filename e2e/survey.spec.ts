import { promises as fs } from 'node:fs';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import * as XLSX from 'xlsx';
import { FAKE_FINAL, FAKE_INITIAL, makeSurveyWorkbook, moveCell } from './fixtures/makeSurveyWorkbook';
import { expectInputFonts, expectNoHorizontalScroll, expectRedOnly, expectTargets, freshApp, openShipSection, setTheme, setupShip } from './helpers';

// The workbook, the ship and every survey figure here are made up (e2e/fixtures/makeSurveyWorkbook.ts). The expected
// results are the engine's, pinned in src/survey/calc.test.ts: initial nett 4175.858 t, light ship 6850.4 t, final nett
// 16786.6 t. Every wait is on what the page shows, never a fixed sleep.

const WORKBOOK = { name: 'Made_up_draft_survey.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const result = (page: Page) => page.getByRole('region', { name: 'Result' });
const lines = (page: Page) => page.getByRole('region', { name: 'Calculation' });
const surveys = (page: Page) => page.getByRole('list', { name: 'Surveys' }).getByRole('listitem');

/** A ship, then the made-up workbook imported and saved from Ship → Draft survey → Ship data. */
async function importShipData(page: Page, opts: { reviewPreview?: boolean } = {}): Promise<void> {
  await freshApp(page); await setupShip(page);
  await openShipSection(page, 'Draft survey');
  await expect(page).toHaveURL(/#\/ship\/survey$/);
  await expect(page.getByText("Import the ship's data from the company workbook first.")).toBeVisible();
  await page.getByRole('link', { name: 'Ship data' }).click();
  await expect(page).toHaveURL(/#\/ship\/survey\/data$/);
  await page.getByLabel('Import ship data from workbook').setInputFiles({ ...WORKBOOK, buffer: Buffer.from(makeSurveyWorkbook()) });
  const preview = page.getByRole('region', { name: 'Found in the workbook' });
  await expect(preview).toBeVisible();
  if (opts.reviewPreview) {
    await expect(preview).toContainText(WORKBOOK.name);
    await expect(preview.getByRole('row', { name: /LBP/ })).toContainText('150 m');
    await expect(preview.getByRole('row', { name: /Light ship/ })).toContainText('6850.4 t');
    await expect(preview.getByRole('row', { name: /Beam/ })).toContainText('24.6 m');
    await expect(preview).toContainText('Hydrostatic table: 61 rows, 1.000 m to 6.900 m');
    await expect(preview).toContainText('INITIAL look-ups from 2.500 m (LCF from 1.000 m)');
    await expect(preview).toContainText('FINAL look-ups from 4.500 m (LCF from 4.500 m)');
  }
  await page.getByRole('button', { name: 'Save ship data' }).click();
  await expect(page.getByText('Ship data saved.')).toBeVisible();
}

const DRAFT_LABELS = {
  fP: 'Forward port', fS: 'Forward starboard', mP: 'Midships port', mS: 'Midships starboard', aP: 'Aft port', aS: 'Aft starboard',
} as const;
const DEDUCTIBLE_LABELS = {
  ballast: 'Ballast', freshWater: 'Fresh water', vlsfo: 'VLSFO', lsmgo: 'LSMGO', lubOil: 'Lub oil', other: 'Other',
} as const;

/** Types a number as a ship's officer may: with a decimal comma. */
const comma = (x: number) => String(x).replace('.', ',');

async function enterReadings(page: Page, inputs: { drafts: Record<keyof typeof DRAFT_LABELS, number>; density: number; deductibles: Record<keyof typeof DEDUCTIBLE_LABELS, number> }) {
  for (const [key, label] of Object.entries(DRAFT_LABELS)) await page.getByLabel(label, { exact: true }).fill(comma(inputs.drafts[key as keyof typeof DRAFT_LABELS]));
  await page.getByLabel('Density (t/m³)').fill(comma(inputs.density));
  for (const [key, label] of Object.entries(DEDUCTIBLE_LABELS)) await page.getByLabel(label, { exact: true }).fill(comma(inputs.deductibles[key as keyof typeof DEDUCTIBLE_LABELS]));
}

async function newInitial(page: Page): Promise<void> {
  await page.goto('./#/ship/survey');
  await page.getByRole('button', { name: 'New initial survey' }).click();
  await expect(page.getByRole('heading', { name: 'Initial survey' })).toBeVisible();
  await expect(page).toHaveURL(/#\/ship\/survey\/[0-9a-f-]{36}$/);
}

test('survey: the made-up workbook is previewed, saved, and its particulars can be edited, with the LCF source explained', async ({ page }) => {
  await importShipData(page, { reviewPreview: true });
  await expect(page.getByLabel('LBP (m)')).toHaveValue('150');
  await expect(page.getByLabel('Light ship (t)')).toHaveValue('6850.4');
  await expect(page.getByLabel('LCF source')).toHaveValue('workbook');
  await expect(page.getByText(/look swapped/)).toBeVisible();
  await page.getByLabel('Keel plate correction (m)').fill('0,01');
  await page.getByLabel('LCF source').selectOption('tabled');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Keel plate correction (m)')).toHaveValue('0.01');
  await expect(page.getByLabel('LCF source')).toHaveValue('tabled');
  await expectNoHorizontalScroll(page);
});

test('survey: an initial survey typed with decimal commas shows every line and the constant, live', async ({ page }) => {
  await importShipData(page);
  await newInitial(page);
  await expect(result(page)).toContainText('Enter all six drafts and the density');
  await enterReadings(page, FAKE_INITIAL);
  await expect(page.getByLabel('Forward port', { exact: true })).toHaveValue('3,1');
  await expect(lines(page).getByRole('row', { name: /^Quarter Mean/ })).toContainText('3.6276');
  await expect(lines(page).getByRole('row', { name: /^Actual Trim/ })).toContainText('1.1403');
  await expect(lines(page).getByRole('row', { name: /^Nett Displacement/ })).toContainText('4175.858');
  await expect(lines(page).getByRole('row', { name: /^Light Ship/ })).toContainText('6850.400');
  await expect(result(page)).toContainText('Constant');
  await expect(result(page)).toContainText('−2674.542 t');
  // The LCF check line: the other source's first trim correction, until the user confirms the source.
  await expect(page.getByText(/LCF check \(LCF Tabled\)/)).toBeVisible();
  await expect(lines(page).getByRole('row', { name: /^List/ })).toContainText('STBD');
  await expect(lines(page).getByRole('row', { name: /^Deflection/ })).toContainText(/HOG|SAG/);

  // It is saved as it is typed, and listed with its result.
  await page.getByLabel('Port', { exact: true }).fill('Portville');
  await expect(page.getByText('Saved')).toBeVisible();
  await page.goto('./#/ship/survey');
  await expect(surveys(page)).toHaveCount(1);
  await expect(surveys(page).first()).toContainText('Initial survey');
  await expect(surveys(page).first()).toContainText('Portville');
  await expect(surveys(page).first()).toContainText('−2674.542 t');
  await expectNoHorizontalScroll(page);
});

test('survey: a final survey against the initial shows the cargo loaded, positive, with the difference from the shore figure', async ({ page }) => {
  await importShipData(page);
  await newInitial(page);
  await enterReadings(page, FAKE_INITIAL);
  await expect(result(page)).toContainText('−2674.542 t');
  await page.goto('./#/ship/survey');
  await surveys(page).first().getByRole('button', { name: 'New final' }).click();
  await expect(page.getByRole('heading', { name: 'Final survey' })).toBeVisible();
  await enterReadings(page, FAKE_FINAL);
  await page.getByLabel('Shore scale (t)').fill('12600');
  await expect(result(page)).toContainText('Cargo loaded');
  await expect(result(page)).toContainText('12610.742 t');
  await expect(result(page)).toContainText('Difference');
  await expect(result(page)).toContainText('+10.742 t');
  await expect(result(page)).toContainText('+0.085 %');
  await expect(page.getByText('Drafts move opposite to the operation, check the readings')).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  await page.goto('./#/ship/survey');
  await expect(surveys(page)).toHaveCount(2);
  await expect(surveys(page).filter({ hasText: 'Final survey' })).toContainText('Cargo loaded 12610.742 t');
});

test('survey: drafts that move the wrong way for the operation give a warning, not just a minus sign', async ({ page }) => {
  await importShipData(page);
  await newInitial(page);
  await page.getByLabel('Operation').selectOption('discharging');
  await enterReadings(page, FAKE_INITIAL);
  await expect(result(page)).toContainText('Cargo + Constant');
  await page.goto('./#/ship/survey');
  await surveys(page).first().getByRole('button', { name: 'New final' }).click();
  await enterReadings(page, FAKE_FINAL); // deeper than the initial survey, on a discharge
  await expect(result(page)).toContainText('Cargo discharged');
  await expect(result(page)).toContainText('−12610.742 t');
  await expect(page.getByText('Drafts move opposite to the operation, check the readings')).toBeVisible();
});

test('survey: a draft outside the table gives the message and no result', async ({ page }) => {
  await importShipData(page);
  await newInitial(page);
  await enterReadings(page, FAKE_INITIAL);
  await expect(result(page)).toContainText('Constant');
  await page.getByLabel('Midships port', { exact: true }).fill('9,5');
  await page.getByLabel('Midships starboard', { exact: true }).fill('9,5');
  await expect(result(page)).toContainText("Outside the ship's hydrostatic table");
  await expect(result(page)).not.toContainText('Constant');
  await expect(lines(page)).toHaveCount(0);
  // Not a number: said at the field, and no result either.
  await page.getByLabel('Aft port', { exact: true }).fill('4,2,1');
  await expect(page.getByText('Enter a number, e.g. 4,25.')).toBeVisible();
  await expect(result(page)).toContainText('Enter all six drafts and the density');
});

test('survey in Night red: a survey with its result is red and black, the figure in the display size of the mono font', async ({ page }) => {
  await importShipData(page);
  await setTheme(page, 'Night red');
  await newInitial(page);
  await enterReadings(page, FAKE_INITIAL);
  await expect(result(page)).toContainText('−2674.542 t');
  const figure = await result(page).locator('.survey-result-value').evaluate((el) => {
    const style = getComputedStyle(el);
    return { size: style.fontSize, family: style.fontFamily.split(',')[0] };
  });
  expect(figure).toEqual({ size: '36px', family: '"IBM Plex Mono"' });
  await expectRedOnly(page);
  await expectTargets(page);
  await expectInputFonts(page);
  await page.goto('./#/ship/survey');
  await expect(surveys(page)).toHaveCount(1);
  await expectRedOnly(page);
});

test('survey: works offline after a reload, at 360 px', async ({ page, context }) => {
  await importShipData(page);
  await newInitial(page);
  await enterReadings(page, FAKE_INITIAL);
  await expect(page.getByText('Saved')).toBeVisible();
  await expect(result(page)).toContainText('−2674.542 t');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.goto('./#/');
  await page.reload(); // now served by the service worker, so the survey chunk must come from its cache
  await page.goto('./#/ship/survey');
  await expect(surveys(page)).toHaveCount(1);
  await surveys(page).first().getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Initial survey' })).toBeVisible();
  await expect(page.getByLabel('Forward port', { exact: true })).toHaveValue('3.1');
  await expect(result(page)).toContainText('−2674.542 t');
  await expectNoHorizontalScroll(page);
  await page.goto('./#/ship/survey/data');
  await expect(page.getByLabel('LBP (m)')).toHaveValue('150');
  await expectNoHorizontalScroll(page);
});

/** An initial and a final survey of the made-up workbook, with the port, cargo and surveyor on the initial; on the final's screen. */
async function initialAndFinal(page: Page): Promise<void> {
  await importShipData(page);
  await newInitial(page);
  await enterReadings(page, FAKE_INITIAL);
  await page.getByLabel('Port', { exact: true }).fill('Portville');
  await page.getByLabel('Cargo', { exact: true }).fill('Gravel');
  await page.getByLabel('Surveyor', { exact: true }).fill('A. Surveyor');
  await expect(page.getByText('Saved')).toBeVisible();
  await page.goto('./#/ship/survey');
  await surveys(page).first().getByRole('button', { name: 'New final' }).click();
  await expect(page.getByRole('heading', { name: 'Final survey' })).toBeVisible();
  await enterReadings(page, FAKE_FINAL);
  await page.getByLabel('Shore scale (t)').fill('12600');
  await expect(result(page)).toContainText('12610.742 t');
  await expect(page.getByText('Saved')).toBeVisible();
}

test('survey: a new final starts with its initial survey’s voyage details, and a new interim is worked against it too', async ({ page }) => {
  await initialAndFinal(page);
  await expect(page.getByLabel('Port', { exact: true })).toHaveValue('Portville');
  await expect(page.getByLabel('Cargo', { exact: true })).toHaveValue('Gravel');
  await expect(page.getByLabel('Surveyor', { exact: true })).toHaveValue('A. Surveyor');
  await expect(page.getByLabel('Forward port', { exact: true })).toHaveValue('5,75');
  await page.goto('./#/ship/survey');
  await surveys(page).getByRole('button', { name: 'New interim' }).click();
  await expect(page.getByRole('heading', { name: 'Interim survey' })).toBeVisible();
  await expect(page.getByLabel('Shore scale (t)')).toBeVisible();
  await expect(page.getByLabel('Operation')).toHaveCount(0);
  await expect(page.getByLabel('Port', { exact: true })).toHaveValue('Portville');

  // Deleting the initial survey says that the two surveys worked against it lose their result.
  await page.goto('./#/ship/survey');
  // The initial survey is the one row with the buttons that start a final or an interim.
  await surveys(page).filter({ has: page.getByRole('button', { name: 'New final' }) }).getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Initial survey' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete survey' }).click();
  await expect(page.getByRole('dialog')).toContainText('Its 2 final and interim surveys stay, but show no result without it.');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/#\/ship\/survey$/);
  await expect(surveys(page)).toHaveCount(2);
  await expect(surveys(page).first()).toContainText('No result yet');
});

test('survey: the DS Report prints with both columns, and the company workbook is exported filled in', async ({ page }) => {
  await initialAndFinal(page);
  await page.getByRole('link', { name: 'Report and workbook' }).click();
  await expect(page).toHaveURL(/#\/ship\/survey\/[0-9a-f-]{36}\/report$/);
  const report = page.getByRole('article', { name: 'DRAFT SURVEY REPORT' });
  await expect(report).toBeVisible();
  await expect(report).toContainText('MV OCEAN STAR');
  await expect(report).toContainText('Portville');
  await expect(report.getByRole('columnheader', { name: 'Initial' })).toBeVisible();
  await expect(report.getByRole('columnheader', { name: 'Final' })).toBeVisible();
  await expect(report.getByRole('row', { name: /^Nett displacement/ })).toContainText('4175.858');
  await expect(report.getByRole('row', { name: /^Nett displacement/ })).toContainText('16786.600');
  await expect(report.getByRole('table', { name: 'Result' })).toContainText('Cargo loaded');
  await expect(report.getByRole('table', { name: 'Result' })).toContainText('12610.742 t');
  await expect(report.getByRole('table', { name: 'Result' })).toContainText('+10.742 t · +0.085 %');
  await expect(report).toContainText('Surveyor: A. Surveyor');
  await expectNoHorizontalScroll(page);

  // Print opens the browser's print dialog, which a test cannot drive: it is asked for once.
  await page.evaluate(() => {
    const counter = window as unknown as { printCalls: number };
    counter.printCalls = 0;
    window.print = () => { counter.printCalls += 1; };
  });
  await page.getByRole('button', { name: 'Print / Save PDF' }).click();
  expect(await page.evaluate(() => (window as unknown as { printCalls: number }).printCalls)).toBe(1);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export company workbook' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Draft_Survey_MV_OCEAN_STAR_2026-10-25_Initial_Final.xlsx');
  await expect(page.getByText('Company workbook exported.')).toBeVisible();
  const bytes = new Uint8Array(await fs.readFile(await file.path()));
  const book = XLSX.read(bytes, { type: 'array' });
  expect(book.Sheets.INITIAL!.I13!.v).toBe(FAKE_INITIAL.drafts.fP);
  expect(book.Sheets.INITIAL!.H3!.v).toBe('Loading of');
  expect(book.Sheets.INITIAL!.Z5!.v).toBe('Portville');
  expect(book.Sheets.FINAL!.I13!.v).toBe(FAKE_FINAL.drafts.fP);
  expect(book.Sheets.FINAL!.Y37!.v).toBe(12600);
  expect(strFromU8(unzipSync(bytes)['xl/workbook.xml']!)).toMatch(/fullCalcOnLoad="1"/);

  // Printing: the report alone, not the buttons or the app's bars.
  await page.emulateMedia({ media: 'print' });
  await expect(report).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print / Save PDF' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Export company workbook' })).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
});

test('survey: a template whose input cells were not found is not filled in, and the report still works', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/survey/data');
  const changed = makeSurveyWorkbook({ edit: (book) => { moveCell(book.Sheets.INITIAL!, 'B37', 'AT60'); } });
  await page.getByLabel('Import ship data from workbook').setInputFiles({ ...WORKBOOK, buffer: Buffer.from(changed) });
  await expect(page.getByRole('region', { name: 'Found in the workbook' })).toContainText("can't be filled in from the app: INITIAL: Ballast");
  await page.getByRole('button', { name: 'Save ship data' }).click();
  await expect(page.getByText('Ship data saved.')).toBeVisible();
  await newInitial(page);
  await enterReadings(page, FAKE_INITIAL);
  await expect(result(page)).toContainText('−2674.542 t');
  await page.getByRole('link', { name: 'Report and workbook' }).click();
  await expect(page.getByRole('article', { name: 'DRAFT SURVEY REPORT' })).toContainText('Constant (initial)');
  await page.getByRole('button', { name: 'Export company workbook' }).click();
  await expect(page.getByRole('alert')).toContainText("can't be filled in from the app: INITIAL: Ballast wasn't found");
  await expect(page.getByRole('article', { name: 'DRAFT SURVEY REPORT' })).toBeVisible();
});

test('survey: a light ship typed with a thousands separator is refused, not read as 6.85 t', async ({ page }) => {
  await importShipData(page);
  await page.getByLabel('Light ship (t)').fill('6,850');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Enter the number without thousands separators, e.g. 6850.4.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Light ship (t)')).toHaveValue('6850.4');
});
