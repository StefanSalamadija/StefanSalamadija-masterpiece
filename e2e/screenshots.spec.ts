import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FAKE_INITIAL, makeSurveyWorkbook } from './fixtures/makeSurveyWorkbook';
import { makePdf } from './fixtures/makePdf';
import { toolboxTalkDocx } from '../src/forms/testing/wordFixtures';
import { freshApp, setTheme, setupShip } from './helpers';
import type { ThemeLabel } from './helpers';

// Screenshots of the main screens at 360 px in every theme, for the reviewers. They are written to SCREENSHOT_DIR (the
// session scratchpad) and never committed; without SCREENSHOT_DIR the spec is skipped. The data is made up.
//
//   SCREENSHOT_DIR=/path/to/shots npx playwright test e2e/screenshots.spec.ts --project=android --trace off

declare const process: { env: Record<string, string | undefined> };
const DIR = process.env.SCREENSHOT_DIR;

/** What a screen that reads its records shows once they are in: its rows or its empty text. */
const DUE_READY = '.list-row, .due-none, .empty';

/**
 * The screens captured, as `<name>-<theme>.png`. Later tasks add theirs here. `ready`, when given, is what to wait for
 * before the shot, for a screen whose content loads after its heading. `open`, when given, goes on from `path` to a screen
 * whose address holds a record's id.
 */
export const SCREENS: { name: string; path: string; ready?: string; open?: (page: Page) => Promise<void> }[] = [
  // Home's card and Due list, and the hub's status lines, come in once the ship's records are read.
  { name: 'home', path: '/', ready: '.voyage-card' },
  { name: 'ship', path: '/ship', ready: '.hub-status:not(:empty)' },
  { name: 'more', path: '/more' },
  { name: 'particulars', path: '/ship/particulars' },
  { name: 'crew', path: '/ship/crew' },
  { name: 'crew-new', path: '/ship/crew/new' },
  { name: 'crew-edit', path: '/ship/crew', open: (page) => page.getByRole('button', { name: 'Edit' }).first().click(), ready: '.crew-documents' },
  {
    name: 'crew-document-new', path: '/ship/crew',
    open: async (page) => {
      await page.getByRole('button', { name: 'Edit' }).first().click();
      await page.getByRole('button', { name: 'Add document' }).click();
    },
    ready: '.crew-document-form',
  },
  { name: 'crew-import', path: '/ship/crew/import' },
  { name: 'crew-print', path: '/ship/crew/print', ready: '.sheet-table' },
  { name: 'certificate-new', path: '/ship/certificates/new' },
  { name: 'certificate-edit', path: '/ship/certificates', open: (page) => page.locator('.list-row').first().click(), ready: '.certificate-form' },
  { name: 'certificates', path: '/ship/certificates' },
  { name: 'reliefs', path: '/ship/reliefs' },
  { name: 'due', path: '/due', ready: DUE_READY },
  { name: 'due-port', path: '/due/port', ready: DUE_READY },
  { name: 'crew-documents', path: '/ship/crew-documents', ready: DUE_READY },
  { name: 'voyage', path: '/ship/voyage' },
  { name: 'time', path: '/ship/time' },
  { name: 'survey', path: '/ship/survey' },
  { name: 'forms', path: '/forms' },
  { name: 'tools', path: '/tools' },
  { name: 'library', path: '/library' },
  { name: 'budget', path: '/budget' },
  { name: 'profiles', path: '/profiles' },
  { name: 'settings', path: '/settings' },
];

const THEMES: { label: ThemeLabel; id: string }[] = [
  { label: 'Day', id: 'day' },
  { label: 'Dark', id: 'dark' },
  { label: 'Night red', id: 'red' },
  { label: 'High contrast', id: 'contrast' },
];

test.skip(!DIR, 'Set SCREENSHOT_DIR to take the screenshots.');
test.use({ viewport: { width: 360, height: 780 } });

/**
 * A made-up ship on 2026-11-17 (ship's time UTC+03:00): one crew member whose passport ran out on 10 Nov, a certificate
 * due on 1 Dec (in 14 days), and a voyage with a next port and its ETA.
 */
async function madeUpShip(page: Page): Promise<void> {
  await freshApp(page, { time: '2026-11-17T09:00:00Z' });
  await setupShip(page);

  await page.goto('./#/ship/crew/new');
  await page.getByLabel('Surname').fill('EXAMPLE');
  await page.getByLabel('Given names').fill('R.');
  await page.getByLabel('Rank').selectOption({ label: 'Master' });
  await page.getByLabel('Date of birth').fill('1980-03-14');
  await page.getByLabel('Passport expiry').fill('2026-11-10');
  await page.getByLabel("Seaman's book expiry").fill('2030-01-01');
  await page.getByLabel('Sign-on date').fill('2026-08-01');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew$/);

  await page.goto('./#/ship/certificates/new');
  await page.getByLabel('Certificate', { exact: true }).selectOption({ label: 'International Load Line' });
  await page.getByLabel('Number').fill('LL-0001');
  await page.getByLabel('Expiry date').fill('2026-12-01');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/certificates$/);

  await page.goto('./#/ship/voyage');
  await page.getByLabel('Voyage no.').fill('V-112');
  await page.getByLabel('Next port', { exact: true }).fill('Example Harbour');
  await page.getByLabel('ETA (local)').fill('2026-11-19T14:00');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
}

for (const theme of THEMES) {
  test(`main screens in ${theme.label}`, async ({ page }) => {
    test.setTimeout(120_000);
    await madeUpShip(page);
    await setTheme(page, theme.label);
    for (const screen of SCREENS) {
      await page.goto(`./#${screen.path}`);
      await expect(page.getByRole('heading').first()).toBeVisible();
      if (screen.open) await screen.open(page);
      if (screen.ready) await expect(page.locator(screen.ready).first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.screenshot({ path: `${DIR}/${screen.name}-${theme.id}.png`, fullPage: true });
    }
  });
}

/** Writes made-up records straight into a table of the app's database. */
function seed(page: Page, table: string, records: Record<string, unknown>[]): Promise<void> {
  return page.evaluate(({ table, records }) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('masterpiece');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(table, 'readwrite');
      const stamp = { createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', updatedBy: 'test', deleted: false, scope: 'personal' };
      for (const r of records) tx.objectStore(table).put({ ...stamp, ...r });
      tx.oncomplete = () => { open.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), { table, records });
}

/** A made-up budget: a rotation, balances, a car loan and four months of spending in every pot, so that the charts draw. */
async function madeUpBudget(page: Page): Promise<void> {
  await page.goto('./#/budget');
  await expect(page.getByRole('link', { name: /^Starting balances/ })).toBeVisible();
  const settings = await page.evaluate(() => new Promise<Record<string, any>>((resolve) => {
    const open = indexedDB.open('masterpiece');
    open.onsuccess = () => {
      const request = open.result.transaction('budgetSettings').objectStore('budgetSettings').getAll();
      request.onsuccess = () => { open.result.close(); resolve(request.result[0]); };
    };
  }));
  await seed(page, 'budgetSettings', [{
    ...settings,
    rotation: { salaryFrom: [{ ym: '2026-01', amount: 500000 }], periods: [{ signOn: '2026-07-01', signOff: '2027-02-28' }], patternOn: 8, patternOff: 4, paidNextMonth: false, paidAtHomePct: 0 },
    assumptions: { ...settings.assumptions, yearlyReturnPct: 5, inflationPct: 2, withdrawalRatePct: 4, yearlySpendingCents: 2400000 },
  }]);
  await seed(page, 'budgetMonths', [{ id: 'm-2026-08', ym: '2026-08', potTargets: { needs: { fromOn: { kind: 'amount', value: 200000 } } }, categoryTargets: {} }]);
  await seed(page, 'budgetCorrections', [
    { id: 'c-bank', account: 'bank', ym: '2026-07', balance: 300000 },
    { id: 'c-inv', account: 'investments', ym: '2026-07', balance: 2000000 },
    { id: 'c-em', account: 'emergency', ym: '2026-07', balance: 600000 },
  ]);
  await seed(page, 'budgetDebts', [{ id: 'debt-car', name: 'Car loan', startBalance: 1200000, yearlyRatePct: 6, instalment: 60000, startYm: '2026-07' }]);
  const entries: Record<string, unknown>[] = [];
  ['2026-08', '2026-09', '2026-10', '2026-11'].forEach((ym, i) => {
    const day = (d: number) => `${ym}-0${d}`;
    entries.push(
      { id: `e-g-${i}`, kind: 'expense', date: day(3), amount: 120000 + i * 15000, categoryId: 'budget-cat:needs:groceries-food-drink', status: 'actual' },
      { id: `e-w-${i}`, kind: 'expense', date: day(4), amount: 40000 + (i % 2) * 30000, categoryId: 'budget-cat:wants:other-wants', status: 'actual' },
      { id: `e-s-${i}`, kind: 'expense', date: day(5), amount: 100000, categoryId: 'budget-cat:savings:index-funds-etfs-e-g-s-p-500', status: 'actual' },
      { id: `e-d-${i}`, kind: 'expense', date: day(6), amount: 60000, categoryId: 'budget-cat:debts:loan-instalment', debtId: 'debt-car', status: 'actual' },
      { id: `e-i-${i}`, kind: 'income', date: day(1), amount: 500000 - (i === 2 ? 50000 : 0), incomeSource: 'salary', status: 'actual' },
    );
  });
  await seed(page, 'budgetEntries', entries);
}

const BALLAST = [['Introduction and ballast exchange rates'], ['Pumps and valves'], ['The ballast exchange procedure for the tanks']];

/**
 * The piece screens (budget, library, survey, tools) with made-up content in them, as `<name>-<theme>.png`: the budget
 * charts with data, quick add, a pdf open with a found word marked, a survey with its result and a converter in use.
 */
for (const theme of THEMES) {
  test(`piece screens in ${theme.label}`, async ({ page }) => {
    test.setTimeout(120_000);
    await freshApp(page, { time: '2026-11-17T09:00:00Z' });
    await setupShip(page);
    await madeUpBudget(page);

    await page.goto('./#/ship/survey/data');
    await page.getByLabel('Import ship data from workbook').setInputFiles({
      name: 'Made_up_draft_survey.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(makeSurveyWorkbook()),
    });
    await page.getByRole('button', { name: 'Save ship data' }).click();
    await expect(page.getByText('Ship data saved.')).toBeVisible();

    await page.goto('./#/library');
    await page.getByLabel('Import documents').setInputFiles([{ name: 'Ballast Manual.pdf', mimeType: 'application/pdf', buffer: Buffer.from(makePdf(BALLAST)) }]);
    await expect(page.getByRole('list', { name: 'Documents' }).getByRole('listitem')).toHaveCount(1);

    await setTheme(page, theme.label);
    const shot = async (name: string) => {
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.screenshot({ path: `${DIR}/${name}-${theme.id}.png`, fullPage: true });
    };

    await page.goto('./#/budget');
    await expect(page.locator('.ring').first()).toBeVisible();
    await shot('budget-dashboard');
    await page.goto('./#/budget/trends');
    await expect(page.getByRole('figure', { name: 'Balances over time' }).getByRole('img')).toBeVisible();
    await page.getByLabel('Category').selectOption({ label: 'Groceries, food & drink' });
    await shot('budget-trends');
    await page.goto('./#/budget/forecast');
    await expect(page.locator('figure svg').first()).toBeVisible();
    await shot('budget-forecast');
    await page.goto('./#/budget/add');
    await expect(page.getByRole('group', { name: 'Amount pad' })).toBeVisible();
    await shot('budget-add');

    await page.goto('./#/library');
    await page.getByLabel('Search library').fill('exchange');
    await expect(page.getByRole('list', { name: 'Search results' })).toBeVisible();
    await shot('library-search');
    await page.getByRole('list', { name: 'Search results' }).getByRole('link', { name: /Page 3/ }).click();
    await expect(page.locator('.pdf-page[data-page="3"] .textLayer mark').first()).toBeVisible();
    await shot('library-pdf');

    await page.goto('./#/ship/survey');
    await page.getByRole('button', { name: 'New initial survey' }).click();
    const labels: Record<string, string> = { fP: 'Forward port', fS: 'Forward starboard', mP: 'Midships port', mS: 'Midships starboard', aP: 'Aft port', aS: 'Aft starboard' };
    for (const [key, label] of Object.entries(labels)) await page.getByLabel(label, { exact: true }).fill(String(FAKE_INITIAL.drafts[key as keyof typeof FAKE_INITIAL.drafts]));
    await page.getByLabel('Density (t/m³)').fill(String(FAKE_INITIAL.density));
    await expect(page.locator('.survey-result-value')).toBeVisible();
    await page.locator('.survey-result').scrollIntoViewIfNeeded();
    await shot('survey-result');

    await page.goto('./#/tools/length');
    await page.getByTestId('unit-m').fill('12,5');
    await expect(page.getByTestId('unit-ft')).toHaveValue('41.01');
    await shot('tools-length');
  });
}

/** Writes the theme into this device's settings, for a screen shown before the Settings screen can be reached. */
async function themeOnDevice(page: Page, id: string): Promise<void> {
  await page.evaluate((theme) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('masterpiece');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const store = open.result.transaction('settings', 'readwrite').objectStore('settings');
      const get = store.get('device');
      get.onsuccess = () => {
        store.put({ ...(get.result ?? { id: 'device' }), theme });
        store.transaction.oncomplete = () => { open.result.close(); resolve(); };
      };
      get.onerror = () => reject(get.error);
    };
  }), id);
}

/** The screens met before the app itself, and a form being filled: first run, the lock screen and form fill. */
for (const theme of THEMES) {
  test(`entry screens and form fill in ${theme.label}`, async ({ page }) => {
    test.setTimeout(120_000);
    const shot = async (name: string) => {
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.screenshot({ path: `${DIR}/${name}-${theme.id}.png`, fullPage: true });
    };
    await freshApp(page, { time: '2026-11-17T09:00:00Z' });
    await expect(page.getByRole('button', { name: 'Create your first ship' })).toBeVisible();
    await themeOnDevice(page, theme.id);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);
    await expect(page.getByRole('button', { name: 'Create your first ship' })).toBeVisible();
    await shot('first-run');

    await setupShip(page, 'MV OCEAN STAR', 'UTC+03:00', { skipLock: false });
    await page.getByLabel('New passcode').fill('2580');
    await page.getByLabel('Repeat passcode').fill('2580');
    await page.getByRole('button', { name: 'Turn on app lock' }).click();
    await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Masterpiece is locked' })).toBeVisible();
    await shot('lock');
    await page.getByLabel('Passcode').fill('2580');
    await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');

    await page.goto('./#/forms');
    await page.getByLabel('Import form').setInputFiles({
      name: 'toolbox.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(toolboxTalkDocx()),
    });
    await page.getByRole('button', { name: 'Save form' }).click();
    await expect(page.getByRole('status')).toHaveText('Form saved.');
    await page.getByRole('list', { name: 'Forms' }).getByRole('link', { name: /^TST-01 · / }).click();
    await expect(page.getByRole('heading', { name: 'TST-01 Toolbox Talk', exact: true })).toBeVisible();
    await shot('form-fill');
  });
}
