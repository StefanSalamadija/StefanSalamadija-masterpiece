import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FAKE_FINAL, FAKE_INITIAL, makeSurveyWorkbook } from './fixtures/makeSurveyWorkbook';
import { expectNoHorizontalScroll, freshApp, setupShip } from './helpers';

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
  await page.getByRole('link', { name: 'Ship', exact: true }).click();
  await page.getByRole('navigation', { name: 'Ship sections' }).getByRole('link', { name: 'Draft survey' }).click();
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
