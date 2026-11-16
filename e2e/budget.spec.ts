import { promises as fs } from 'node:fs';
import * as XLSX from 'xlsx';
import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { makeBudgetXlsx } from './fixtures/makeBudgetXlsx';
import { expectNoHorizontalScroll, freshApp, setupShip } from './helpers';

// The clock is 2026-10-25T09:00Z and the ship is at UTC+03:00, so the ship's today is 2026-10-25 (October 2026).
// Every wait is on what the page shows, never a fixed sleep.

const pad = (page: Page) => page.getByRole('group', { name: 'Amount pad' });
const key = (page: Page, k: string) => pad(page).getByRole('button', { name: k, exact: true });
const categories = (page: Page) => page.getByRole('group', { name: 'Category' });
const category = (page: Page, name: string) => categories(page).getByRole('button', { name, exact: true });
const save = (page: Page) => page.getByRole('button', { name: 'Save', exact: true });
const entries = (page: Page) => page.getByRole('list', { name: 'Entries' }).getByRole('listitem');
const toConfirm = (page: Page) => page.getByRole('list', { name: 'To confirm' }).getByRole('listitem');
const potCard = (page: Page, pot: string) => page.getByRole('region', { name: pot, exact: true });
/** The cells of a table row, its header cell included. */
const cells = (row: Locator) => row.locator('th, td');

async function typeAmount(page: Page, amount: string): Promise<void> {
  for (const k of amount) await key(page, k).click();
}

/** A ship, then the quick add screen opened from Home's "+ Expense". */
async function openQuickAdd(page: Page): Promise<void> {
  await freshApp(page); await setupShip(page);
  await page.getByRole('link', { name: '+ Expense' }).click();
  await expect(page).toHaveURL(/#\/budget\/add$/);
  await expect(pad(page)).toBeVisible();
}

/** The live (not deleted) entries as stored in IndexedDB, to see what was really written. */
function storedEntries(page: Page): Promise<Record<string, any>[]> {
  return page.evaluate(() => new Promise<Record<string, any>[]>((resolve, reject) => {
    const open = indexedDB.open('masterpiece');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = open.result.transaction('budgetEntries').objectStore('budgetEntries').getAll();
      request.onsuccess = () => { open.result.close(); resolve((request.result as Record<string, any>[]).filter((e) => !e.deleted)); };
    };
  }));
}

/** The live records of a table as stored in IndexedDB. */
function stored(page: Page, table: string): Promise<Record<string, any>[]> {
  return page.evaluate((table) => new Promise<Record<string, any>[]>((resolve, reject) => {
    const open = indexedDB.open('masterpiece');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = open.result.transaction(table).objectStore(table).getAll();
      request.onsuccess = () => { open.result.close(); resolve((request.result as Record<string, any>[]).filter((e) => !e.deleted)); };
    };
  }), table);
}

/** Writes records straight into a table, such as one the test needs to exist already. */
function seed(page: Page, table: string, records: Record<string, unknown>[]): Promise<void> {
  return page.evaluate(({ table, records }) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('masterpiece');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(table, 'readwrite');
      const stamp = { createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: 'test', deleted: false, scope: 'personal' };
      for (const r of records) tx.objectStore(table).put({ ...stamp, ...r });
      tx.oncomplete = () => { open.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), { table, records });
}

test('budget: Home has a Budget card and a "+ Expense" button, and the manifest a shortcut to quick add', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  const card = page.getByRole('link', { name: /^Budget/ });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page).toHaveURL(/#\/budget$/);
  await expect(page.getByRole('navigation', { name: 'Budget sections' }).getByRole('link'))
    .toHaveText(['Dashboard', 'Month', 'Forecast', 'Net worth', 'Scenarios', 'Plan']);
  await expect(page.getByRole('link', { name: '+ Expense' })).toBeVisible();
  const manifest = await (await page.request.get('./manifest.webmanifest')).json();
  expect(manifest.shortcuts).toEqual([{ name: 'Add expense', url: './#/budget/add' }]);
});

test('budget: an expense in 3 taps shows in the month, and Undo removes exactly it', async ({ page }) => {
  await openQuickAdd(page);
  await expect(page.getByRole('button', { name: 'Today', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(save(page)).toBeDisabled();                       // no amount, no category yet
  await typeAmount(page, '60');                                    // 1: the amount
  await category(page, 'Groceries, food & drink').click();          // 2: the category
  await save(page).click();                                         // 3: Save
  await expect(page).toHaveURL(/#\/budget\/month\/2026-10$/);
  await expect(page.getByRole('heading', { name: 'October 2026' })).toBeVisible();
  await expect(entries(page)).toHaveCount(1);
  await expect(entries(page).first()).toContainText('€60.00');
  await expect(entries(page).first()).toContainText('Groceries, food & drink');
  await expect(potCard(page, 'Needs')).toContainText('Spent €60.00');
  await expect(page.getByRole('status').getByText('Saved €60.00 to Groceries, food & drink.')).toBeVisible();

  // A second expense, so that Undo of the first must remove only it.
  await page.getByRole('link', { name: '+ Expense' }).click();
  await typeAmount(page, '4,5');
  await category(page, 'Cafés & restaurants').click();
  await save(page).click();
  await expect(entries(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(entries(page)).toHaveCount(1);
  await expect(entries(page).first()).toContainText('€60.00');
  expect((await storedEntries(page)).map((e) => e.amount)).toEqual([6000]);
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
});

test('budget: the Undo toast goes after 5 s', async ({ page }) => {
  await openQuickAdd(page);
  await typeAmount(page, '7');
  await category(page, 'Pharmacy').click();
  await save(page).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await page.mouse.move(0, 0);   // off the toast, which stays up while the pointer is on it (it can come up under Save)
  await page.clock.fastForward(5_100);
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  await expect(entries(page)).toHaveCount(1);
});

test('budget: a fast double tap on Save writes one entry', async ({ page }) => {
  await openQuickAdd(page);
  await typeAmount(page, '12,50');
  await category(page, 'Pharmacy').click();
  await save(page).dblclick();
  await expect(page).toHaveURL(/#\/budget\/month\/2026-10$/);
  await expect(entries(page)).toHaveCount(1);
  expect((await storedEntries(page)).map((e) => e.amount)).toEqual([1250]);
});

test('budget: the shorthand "fuel 60" saves €60.00 to Fuel', async ({ page }) => {
  await openQuickAdd(page);
  await page.getByLabel('Type it').fill('fuel 60');
  await expect(category(page, 'Fuel & parking')).toHaveAttribute('aria-pressed', 'true');
  await save(page).click();
  await expect(entries(page)).toHaveCount(1);
  await expect(entries(page).first()).toContainText('€60.00');
  await expect(entries(page).first()).toContainText('Fuel & parking');
  const [stored] = await storedEntries(page);
  expect(stored).toMatchObject({ amount: 6000, categoryId: 'budget-cat:needs:fuel-parking', date: '2026-10-25', kind: 'expense', status: 'actual' });
});

test('budget: Repeat last fills the last expense, and the last category used comes first', async ({ page }) => {
  await openQuickAdd(page);
  await typeAmount(page, '3,2');
  await category(page, 'Cafés & restaurants').click();
  await save(page).click();
  await expect(entries(page)).toHaveCount(1);
  await page.getByRole('link', { name: '+ Expense' }).click();
  await expect(categories(page).getByRole('button').first()).toHaveText('Cafés & restaurants');
  await page.getByRole('button', { name: 'Repeat last' }).click();
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('3,20');
  await expect(category(page, 'Cafés & restaurants')).toHaveAttribute('aria-pressed', 'true');
  await save(page).click();
  await expect(entries(page)).toHaveCount(2);
});

test('budget: catch up adds 3 entries in a row without leaving the pad', async ({ page }) => {
  await openQuickAdd(page);
  await page.getByRole('link', { name: 'Catch up' }).click();
  await expect(page).toHaveURL(/#\/budget\/catch-up$/);
  const added = page.getByRole('list', { name: 'Added' }).getByRole('listitem');
  const rows: [string, string, string][] = [['20', 'Fuel & parking', 'Yesterday'], ['8', 'Pharmacy', '2 days ago'], ['15', 'Shopping', 'Today']];
  for (const [amount, name, day] of rows) {
    await typeAmount(page, amount);
    await category(page, name).click();
    await page.getByRole('button', { name: day, exact: true }).click();
    await save(page).click();
    await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('');   // back on an empty pad
  }
  await expect(added).toHaveCount(3);
  await expect(page).toHaveURL(/#\/budget\/catch-up$/);
  const stored = (await storedEntries(page)).map((e) => [e.amount, e.date]).sort();
  expect(stored).toEqual([[1500, '2026-10-25'], [2000, '2026-10-24'], [800, '2026-10-23']].sort());
  await page.goto('./#/budget/month/2026-10');
  await expect(entries(page)).toHaveCount(3);
});

test('budget: a recurring item and a fund set-aside to confirm move from planned to spent', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/budget/month/2026-10');
  await expect(page.getByRole('heading', { name: 'October 2026' })).toBeVisible();   // the budget is set up
  await seed(page, 'budgetRecurring', [{ id: 'rec-netflix', name: 'Netflix', amount: 1299, categoryId: 'budget-cat:wants:subscriptions', day: 5, startYm: '2026-01' }]);
  await seed(page, 'budgetFunds', [{ id: 'fund-car', name: 'Car insurance', amount: 60000, dueYm: '2027-03', categoryId: 'budget-cat:needs:registration-insurance', startBalance: 0 }]);
  await page.reload();
  await expect(toConfirm(page)).toHaveCount(2);
  const netflix = toConfirm(page).filter({ hasText: 'Netflix' });
  await expect(netflix).toContainText('€12.99');
  await expect(potCard(page, 'Wants')).toContainText('Planned €12.99');
  await netflix.getByRole('button', { name: 'Confirm' }).click();
  await expect(toConfirm(page)).toHaveCount(1);
  await expect(potCard(page, 'Wants')).toContainText('Spent €12.99');
  await expect(potCard(page, 'Wants')).toContainText('Planned €0.00');

  const fund = toConfirm(page).filter({ hasText: 'Car insurance' });
  await expect(fund).toContainText('€100.00');
  await fund.getByRole('button', { name: 'Edit amount' }).click();
  await fund.getByLabel('Amount for Car insurance').fill('120');
  await fund.getByRole('button', { name: 'Confirm' }).click();
  await expect(toConfirm(page)).toHaveCount(0);
  await expect(potCard(page, 'Needs')).toContainText('Spent €120.00');

  await page.reload();                                               // opening the month again makes nothing twice
  await expect(page.getByRole('heading', { name: 'October 2026' })).toBeVisible();
  await expect(potCard(page, 'Wants')).toContainText('Spent €12.99');
  await expect(toConfirm(page)).toHaveCount(0);
  expect((await storedEntries(page)).filter((e) => e.recurringId === 'rec-netflix')).toHaveLength(1);
});

test('budget: an entry saved as a favourite is a chip on the pad', async ({ page }) => {
  await openQuickAdd(page);
  await typeAmount(page, '2,5');
  await category(page, 'Cafés & restaurants').click();
  await page.getByLabel('Note').fill('Coffee');
  await save(page).click();
  await entries(page).first().getByRole('button', { name: 'Add to favourites' }).click();
  await expect(entries(page).first().getByRole('button', { name: 'In favourites' })).toBeDisabled();
  await page.getByRole('link', { name: '+ Expense' }).click();
  await page.getByRole('button', { name: 'Coffee €2.50' }).click();
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('2,50');
  await expect(page.getByLabel('Note')).toHaveValue('Coffee');
  await save(page).click();
  await expect(entries(page)).toHaveCount(2);
});

test('budget: a salary added as income shows in the month as received', async ({ page }) => {
  await openQuickAdd(page);
  await page.getByRole('group', { name: 'Entry type' }).getByRole('button', { name: 'Income' }).click();
  await expect(categories(page)).toHaveCount(0);
  await typeAmount(page, '4500');
  await expect(save(page)).toBeDisabled();                       // no source yet
  await page.getByRole('group', { name: 'Source' }).getByRole('button', { name: 'Salary' }).click();
  await save(page).click();
  await expect(page).toHaveURL(/#\/budget\/month\/2026-10$/);
  await expect(page.getByText('Received €4,500.00')).toBeVisible();
  await expect(entries(page).first()).toContainText('Salary');
  await expect(entries(page).first()).toContainText('+€4,500.00');
  expect(await storedEntries(page)).toMatchObject([{ kind: 'income', incomeSource: 'salary', amount: 450000, status: 'actual' }]);
});

test('budget: "+ Income" in the month; a sale of property can name the asset sold', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/budget/month/2026-10');
  await expect(page.getByRole('heading', { name: 'October 2026' })).toBeVisible();
  await seed(page, 'budgetAssets', [{ id: 'asset-boat', name: 'Old boat', includeInNetWorth: true }]);
  await page.getByRole('link', { name: '+ Income' }).click();
  await expect(page.getByRole('group', { name: 'Entry type' }).getByRole('button', { name: 'Income' })).toHaveAttribute('aria-pressed', 'true');
  await typeAmount(page, '3000');
  await expect(page.getByLabel('Sold asset')).toHaveCount(0);
  await page.getByRole('group', { name: 'Source' }).getByRole('button', { name: 'Sale of property' }).click();
  await page.getByLabel('Sold asset').selectOption({ label: 'Old boat' });
  await save(page).click();
  await expect(page.getByText('Received €3,000.00')).toBeVisible();
  expect(await storedEntries(page)).toMatchObject([{ kind: 'income', incomeSource: 'property', soldAssetId: 'asset-boat', amount: 300000 }]);
});

test('budget: "Same as last time" on an entry starts quick add from it', async ({ page }) => {
  await openQuickAdd(page);
  await typeAmount(page, '18,9');
  await category(page, 'Pharmacy').click();
  await save(page).click();
  await expect(entries(page)).toHaveCount(1);
  await entries(page).first().getByRole('link', { name: 'Same as last time' }).click();
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('18,90');
  await expect(category(page, 'Pharmacy')).toHaveAttribute('aria-pressed', 'true');
  await save(page).click();
  await expect(entries(page)).toHaveCount(2);
});

test('budget: a typed or pasted amount is read by the money rules, and a minus is refused', async ({ page }) => {
  await openQuickAdd(page);
  const amount = page.getByLabel('Amount', { exact: true });
  await amount.fill('-5');
  await expect(page.getByRole('alert')).toContainText('can’t be below zero');
  await category(page, 'Groceries, food & drink').click();
  await expect(save(page)).toBeDisabled();
  await amount.fill('1.234,56');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await save(page).click();
  await expect(page.getByRole('status').getByText('Saved €1,234.56 to Groceries, food & drink.')).toBeVisible();
  await expect(entries(page).first()).toContainText('€1,234.56');
  expect((await storedEntries(page)).map((e) => e.amount)).toEqual([123456]);
});

test('budget: typing on a keyboard drops what is not an amount, and the shorthand keeps a typed note', async ({ page }) => {
  await openQuickAdd(page);
  await page.getByLabel('Amount', { exact: true }).fill('€ 12,5x');
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('12,5');
  await page.getByLabel('Note').fill('for the trip');
  await page.getByLabel('Type it').fill('fuel 60');
  await expect(page.getByLabel('Note')).toHaveValue('for the trip');
  await page.getByLabel('Type it').fill('fuel 60 shell');
  await expect(page.getByLabel('Note')).toHaveValue('shell');
  await page.getByLabel('Type it').fill('fuel 60');
  await expect(page.getByLabel('Note')).toHaveValue('');
});

test('budget: the Undo toast stays up while the pointer is on it', async ({ page }) => {
  await openQuickAdd(page);
  await typeAmount(page, '7');
  await category(page, 'Pharmacy').click();
  await save(page).click();
  await page.getByRole('button', { name: 'Undo' }).hover();
  await page.clock.fastForward(8_000);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(entries(page)).toHaveCount(0);
});

test('budget: an entry can be edited and deleted in the month', async ({ page }) => {
  await openQuickAdd(page);
  await typeAmount(page, '10');
  await category(page, 'Pharmacy').click();
  await page.getByLabel('Note').fill('vitamins');
  await save(page).click();
  await expect(entries(page)).toHaveCount(1);
  await expect(entries(page).first()).toContainText('vitamins');
  await entries(page).first().getByRole('button', { name: 'Edit' }).click();
  await entries(page).first().getByLabel('Amount').fill('11,40');
  await entries(page).first().getByRole('button', { name: 'Save' }).click();
  await expect(entries(page).first()).toContainText('€11.40');
  await entries(page).first().getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(entries(page)).toHaveCount(0);
  expect(await storedEntries(page)).toEqual([]);
});

test('budget: with two debts, a Debts expense asks which debt it pays', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/budget/add');
  await expect(pad(page)).toBeVisible();
  await seed(page, 'budgetDebts', [
    { id: 'debt-car', name: 'Car loan', startBalance: 500000, yearlyRatePct: 6, instalment: 20000, startYm: '2026-01' },
    { id: 'debt-card', name: 'Visa', startBalance: 100000, yearlyRatePct: 0, instalment: 5000, startYm: '2026-01' },
  ]);
  await page.reload();
  await typeAmount(page, '200');
  await page.getByText('More categories').click();
  await category(page, 'Loan instalment').click();
  await expect(save(page)).toBeDisabled();
  await page.getByLabel('Which debt?').selectOption({ label: 'Car loan' });
  await save(page).click();
  await expect(entries(page)).toHaveCount(1);
  const [stored] = await storedEntries(page);
  expect(stored).toMatchObject({ amount: 20000, debtId: 'debt-car' });
});

test('budget: quick add works offline after a reload', async ({ page, context }) => {
  await freshApp(page); await setupShip(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload(); // now served by the service worker, so the budget chunk must come from its cache
  await page.getByRole('link', { name: '+ Expense' }).click();
  await typeAmount(page, '5');
  await category(page, 'Cafés & restaurants').click();
  await save(page).click();
  await expect(entries(page)).toHaveCount(1);
  await expect(entries(page).first()).toContainText('€5.00');
});

test('budget: no horizontal scroll at 360 px', async ({ page }) => {
  await openQuickAdd(page);
  await expectNoHorizontalScroll(page);
  await typeAmount(page, '1234');
  await category(page, 'Groceries, food & drink').click();
  await page.getByLabel('Note').fill('A very long note about the weekly shopping at the big supermarket in town');
  await save(page).click();
  await expect(entries(page)).toHaveCount(1);
  await expectNoHorizontalScroll(page);
  await page.goto('./#/budget/catch-up');
  await expect(pad(page)).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.goto('./#/budget');
  await expectNoHorizontalScroll(page);
});

test('budget: with the app lock on, the budget is behind the lock', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop'); // the passcode path; the fingerprint path is covered in lock.spec
  await freshApp(page);
  await setupShip(page, 'MV OCEAN STAR', 'UTC+03:00', { skipLock: false });
  await page.getByLabel('New passcode').fill('2580');
  await page.getByLabel('Repeat passcode').fill('2580');
  await page.getByRole('button', { name: 'Turn on app lock' }).click();
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');
  await page.goto('./#/budget/add');
  await expect(pad(page)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Masterpiece is locked' })).toBeVisible();
  await expect(pad(page)).toHaveCount(0);
  await expect(page.getByText('Budget')).toHaveCount(0);
  await page.getByLabel('Passcode').fill('2580');
  await expect(pad(page)).toBeVisible();
});

// ---- Plan screens and starting balances ----

/** A ship, then a Plan section. */
async function openPlan(page: Page, section: string): Promise<void> {
  await freshApp(page); await setupShip(page);
  await page.goto(`./#/budget/plan/${section}`);
  await expect(page.getByRole('link', { name: '← Plan' })).toBeVisible();
}

/** Answers the "This month only" / "From this month on" dialog of a target edit. */
async function chooseScope(page: Page, scope: 'This month only' | 'From this month on'): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(scope).check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
}

test('budget plan: the Plan tab lists every part of the plan', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/budget');
  await page.getByRole('navigation', { name: 'Budget sections' }).getByRole('link', { name: 'Plan' }).click();
  await expect(page).toHaveURL(/#\/budget\/plan$/);
  await expect(page.getByRole('list', { name: 'Plan' }).getByRole('link')).toHaveText([
    /^Targets/, /^Categories/, /^Recurring/, /^Sinking funds/, /^Debts/, /^Goals/, /^Assets/, /^Rotation/, /^Assumptions/, /^Starting balances/,
  ]);
  await page.getByRole('link', { name: /^Debts/ }).click();
  await expect(page).toHaveURL(/#\/budget\/plan\/debts$/);
  await expect(page.getByRole('navigation', { name: 'Budget sections' }).getByRole('link', { name: 'Plan' })).toHaveAttribute('aria-current', 'page');
});

test('budget plan: a pot target "from this month on" passes to later months, not to one edited on its own', async ({ page }) => {
  await openPlan(page, 'targets');
  await expect(page.getByRole('heading', { name: 'October 2026' })).toBeVisible();
  await page.getByLabel('Planned income').fill('4000');
  await page.getByRole('button', { name: 'Save planned income' }).click();
  await chooseScope(page, 'From this month on');

  // December first: 30% for that month only.
  await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.getByRole('heading', { name: 'December 2026' })).toBeVisible();
  const needs = page.getByRole('region', { name: 'Needs', exact: true });
  await needs.getByLabel('Needs target', { exact: true }).fill('30');
  await needs.getByRole('button', { name: 'Save' }).click();
  await chooseScope(page, 'This month only');
  await expect(needs).toContainText('This month only');

  // Then October: 50% from this month on.
  await page.getByRole('button', { name: 'Previous month' }).click();
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page.getByRole('heading', { name: 'October 2026' })).toBeVisible();
  await needs.getByLabel('Needs target', { exact: true }).fill('50');
  await expect(needs).toContainText('= €2,000.00');
  await needs.getByRole('button', { name: 'Save' }).click();
  await chooseScope(page, 'From this month on');
  await expect(page.getByText('Targets add up to 50% — adjust to 100%.')).toBeVisible();

  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(needs.getByLabel('Needs target', { exact: true })).toHaveValue('50');
  await expect(needs).toContainText('From October 2026');

  await page.goto('./#/budget/month/2026-11');
  await expect(potCard(page, 'Needs')).toContainText('Target €2,000.00 (50% of income)');
  await page.goto('./#/budget/month/2026-12');
  await expect(potCard(page, 'Needs')).toContainText('Target €1,200.00 (30% of income)');
  await page.goto('./#/budget/month/2027-01');
  await expect(potCard(page, 'Needs')).toContainText('Target €2,000.00 (50% of income)');
});

test('budget plan: a target as an amount, and a category target', async ({ page }) => {
  await openPlan(page, 'targets');
  await page.getByLabel('Planned income').fill('4000');
  await page.getByRole('button', { name: 'Save planned income' }).click();
  await chooseScope(page, 'From this month on');
  const wants = page.getByRole('region', { name: 'Wants', exact: true });
  await wants.getByLabel('Wants target as').selectOption({ label: 'Amount' });
  await wants.getByLabel('Wants target', { exact: true }).fill('600');
  await expect(wants).toContainText('= 15% of income');
  await wants.getByRole('button', { name: 'Save' }).click();
  await chooseScope(page, 'From this month on');

  const cats = page.getByRole('form', { name: 'Category target' });
  await cats.getByLabel('Category').selectOption({ label: 'Cafés & restaurants' });
  await cats.getByLabel('Monthly target').fill('150');
  await cats.getByRole('button', { name: 'Save' }).click();
  await chooseScope(page, 'This month only');
  await expect(page.getByRole('list', { name: 'Category targets' })).toContainText('Cafés & restaurants');
  await expect(page.getByRole('list', { name: 'Category targets' })).toContainText('€150.00');

  await page.goto('./#/budget/month/2026-10');
  await expect(potCard(page, 'Wants')).toContainText('Target €600.00 (15% of income)');
  await expect(page.getByRole('region', { name: 'Categories' })).toContainText('€0.00 of €150.00');
});

test('budget plan: categories can be added, renamed with synonyms, hidden, moved and reordered', async ({ page }) => {
  await openPlan(page, 'categories');
  const add = page.getByRole('form', { name: 'New category' });
  await add.getByLabel('Name').fill('Boat fuel');
  await add.getByLabel('Pot').selectOption({ label: 'Wants' });
  await add.getByRole('button', { name: 'Add category' }).click();
  const wants = page.getByRole('list', { name: 'Wants' });
  await expect(wants.getByRole('listitem').last()).toContainText('Boat fuel');
  await wants.getByRole('listitem').filter({ hasText: 'Boat fuel' }).getByRole('button', { name: 'Up' }).click();
  await expect(wants.getByRole('listitem').last()).toContainText('Other wants');

  const pet = page.getByRole('listitem').filter({ hasText: 'Pet food & vet' });
  await pet.getByRole('button', { name: 'Edit' }).click();
  const editing = page.getByRole('form', { name: 'Edit Pet food & vet' });
  await editing.getByLabel('Name').fill('Rex');
  await editing.getByLabel('Other words for it').fill('dog, vet');
  await editing.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Rex' })).toBeVisible();

  const school = page.getByRole('listitem').filter({ hasText: 'Kindergarten / school' });
  await school.getByRole('button', { name: 'Hide' }).click();
  await expect(school).toContainText('Hidden');

  const gifts = page.getByRole('listitem').filter({ hasText: 'Gifts & celebrations' });
  await gifts.getByLabel('Move Gifts & celebrations to').selectOption({ label: 'Needs' });
  await expect(page.getByRole('list', { name: 'Needs' })).toContainText('Gifts & celebrations');

  await page.goto('./#/budget/add');
  await page.getByText('More categories').click();
  await page.getByLabel('Type it').fill('dog 12');
  await expect(category(page, 'Rex')).toHaveAttribute('aria-pressed', 'true');
  await expect(category(page, 'Kindergarten / school')).toHaveCount(0);
  await expect(category(page, 'Boat fuel')).toBeVisible();
});

test('budget plan: a recurring template makes a planned item to confirm', async ({ page }) => {
  await openPlan(page, 'recurring');
  const add = page.getByRole('form', { name: 'New template' });
  await add.getByLabel('Name').fill('Gym');
  await add.getByLabel('Amount').fill('35');
  await add.getByLabel('Category').selectOption({ label: 'Training / gym' });
  await add.getByLabel('Day of the month').fill('3');
  await add.getByRole('button', { name: 'Add template' }).click();
  const gym = page.getByRole('list', { name: 'Templates' }).getByRole('listitem').filter({ hasText: 'Gym' });
  await expect(gym).toContainText('€35.00');
  await expect(gym).toContainText('from October 2026');
  await page.goto('./#/budget/month/2026-10');
  await expect(toConfirm(page).filter({ hasText: 'Gym' })).toContainText('€35.00');
  expect(await stored(page, 'budgetRecurring')).toMatchObject([{ name: 'Gym', amount: 3500, day: 3, startYm: '2026-10', categoryId: 'budget-cat:needs:training-gym' }]);
});

test('budget plan: with two debts, a Debts template must say which debt it pays, and one without is flagged', async ({ page }) => {
  await openPlan(page, 'recurring');
  await seed(page, 'budgetDebts', [
    { id: 'debt-car', name: 'Car loan', startBalance: 500000, yearlyRatePct: 6, instalment: 20000, startYm: '2026-01' },
    { id: 'debt-card', name: 'Visa', startBalance: 100000, yearlyRatePct: 0, instalment: 5000, startYm: '2026-01' },
  ]);
  await seed(page, 'budgetRecurring', [{ id: 'rec-old', name: 'Old loan payment', amount: 20000, categoryId: 'budget-cat:debts:loan-instalment', day: 5, startYm: '2026-01' }]);
  await page.goto('./#/budget/plan');
  await expect(page.getByRole('link', { name: /Recurring/ })).toContainText('Which debt?');
  await page.goto('./#/budget/plan/recurring');
  const old = page.getByRole('list', { name: 'Templates' }).getByRole('listitem').filter({ hasText: 'Old loan payment' });
  await expect(old).toContainText('Which debt?');

  const add = page.getByRole('form', { name: 'New template' });
  await add.getByLabel('Name').fill('Car loan');
  await add.getByLabel('Amount').fill('300');
  await add.getByLabel('Category').selectOption({ label: 'Loan instalment' });
  await expect(add.getByRole('button', { name: 'Add template' })).toBeDisabled();
  await add.getByLabel('Which debt?').selectOption({ label: 'Car loan' });
  await add.getByRole('button', { name: 'Add template' }).click();
  await expect(page.getByRole('list', { name: 'Templates' }).getByRole('listitem').filter({ hasText: 'until Car loan is paid' })).toBeVisible();

  await old.getByRole('button', { name: 'Choose the debt' }).click();
  const edit = page.getByRole('form', { name: 'Edit Old loan payment' });
  await edit.getByLabel('Which debt?').selectOption({ label: 'Visa' });
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('list', { name: 'Templates' })).not.toContainText('Which debt?');
  await expect(page.getByRole('list', { name: 'Templates' })).toContainText('until Visa is paid');
  expect((await stored(page, 'budgetRecurring')).map((t) => t.untilDebtId).sort()).toEqual(['debt-car', 'debt-card']);
});

test('budget plan: a yearly fund shows its set-aside, to confirm in the month', async ({ page }) => {
  await openPlan(page, 'funds');
  const add = page.getByRole('form', { name: 'New fund' });
  await add.getByLabel('Name').fill('Car registration');
  await add.getByLabel('Amount').fill('600');
  await add.getByLabel('Due month').fill('2027-03');
  await add.getByLabel('Repeats').selectOption({ label: 'Every year' });
  await add.getByLabel('Category').selectOption({ label: 'Registration & insurance' });
  await add.getByRole('button', { name: 'Add fund' }).click();
  const fund = page.getByRole('list', { name: 'Funds' }).getByRole('listitem').filter({ hasText: 'Car registration' });
  await expect(fund).toContainText('Due March 2027');
  await expect(fund).toContainText('€100.00 to set aside this month');
  expect(await stored(page, 'budgetFunds')).toMatchObject([{ name: 'Car registration', amount: 60000, dueYm: '2027-03', repeatMonths: 12, startBalance: 0 }]);
  await page.goto('./#/budget/month/2026-10');
  const row = toConfirm(page).filter({ hasText: 'Car registration' });
  await expect(row).toContainText('€100.00');
  await row.getByRole('button', { name: 'Confirm' }).click();
  await page.goto('./#/budget/plan/funds');
  await expect(fund).toContainText('Balance €100.00');
  await expect(fund).toContainText('Set aside this month');
});

test('budget plan: a debt at 6% shows its debt-free month and what an extra would do', async ({ page }) => {
  await openPlan(page, 'debts');
  const add = page.getByRole('form', { name: 'New debt' });
  await add.getByLabel('Name').fill('Car loan');
  await add.getByLabel('Balance').fill('1000');
  await add.getByLabel('Yearly rate (%)').fill('6');
  await add.getByLabel('Instalment').fill('100');
  await expect(add.getByLabel('From month', { exact: true })).toHaveValue('2026-10');
  await add.getByRole('button', { name: 'Add debt' }).click();
  const debt = page.getByRole('list', { name: 'Debts' }).getByRole('listitem').filter({ hasText: 'Car loan' });
  // €1,000.00 at 0.5% a month, €100.00 a month: 11 payments, October 2026 to August 2027.
  await expect(debt).toContainText('Debt-free in August 2027');
  await expect(debt).toContainText("With an extra €50.00/month you'd be debt-free in April 2027 (4 months sooner)");
  await debt.getByLabel('Try an extra per month').fill('200');
  await expect(debt).toContainText("With an extra €200.00/month you'd be debt-free in January 2027 (7 months sooner)");
  expect(await stored(page, 'budgetDebts')).toMatchObject([{ name: 'Car loan', startBalance: 100000, yearlyRatePct: 6, instalment: 10000, startYm: '2026-10' }]);

  // A planned extra of €50.00 a month is stored on the debt: the plan (and the forecast) pay it off in April 2027, and the
  // what-if goes on top of it.
  await debt.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('form', { name: 'Edit Car loan' });
  await edit.getByLabel('Extra each month').fill('50');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(debt).toContainText('Extra €50.00 a month from October 2026');
  await expect(debt).toContainText('Debt-free in April 2027');
  await debt.getByLabel('Try an extra per month').fill('150');
  await expect(debt).toContainText("With an extra €150.00/month you'd be debt-free in January 2027 (3 months sooner)");
  expect(await stored(page, 'budgetDebts')).toMatchObject([{ extraSteps: [{ fromYm: '2026-10', monthly: 5000 }] }]);

  // A second step: €100.00 from January 2027 on; the €50.00 keeps its months.
  await debt.getByRole('button', { name: 'Edit' }).click();
  await expect(edit.getByRole('list', { name: 'Planned extra' })).toContainText('Extra €50.00 a month from October 2026');
  await edit.getByLabel('Extra each month').fill('100');
  await edit.getByLabel('Extra from month').fill('2027-01');
  await edit.getByRole('button', { name: 'Add extra' }).click();
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(debt).toContainText('Extra €50.00 a month from October 2026; Extra €100.00 a month from January 2027');
  expect((await stored(page, 'budgetDebts'))[0].extraSteps).toEqual([{ fromYm: '2026-10', monthly: 5000 }, { fromYm: '2027-01', monthly: 10000 }]);
});

test('budget plan: a goal suggests a monthly amount; the emergency fund target is 6 × Needs', async ({ page }) => {
  await openPlan(page, 'goals');
  const add = page.getByRole('form', { name: 'New goal' });
  await add.getByLabel('Name').fill('Holiday');
  await add.getByLabel('Amount').fill('1200');
  await add.getByLabel('Target month').fill('2027-03');
  await add.getByLabel('Category').selectOption({ label: 'Savings goals' });
  await add.getByRole('button', { name: 'Add goal' }).click();
  const goal = page.getByRole('list', { name: 'Goals' }).getByRole('listitem').filter({ hasText: 'Holiday' });
  // October to March is 6 months: €1,200.00 ÷ 6.
  await expect(goal).toContainText('Suggested €200.00 a month');
  await expect(goal).toContainText('Saved €0.00 of €1,200.00 (0%)');
  await expect(page.getByRole('region', { name: 'Emergency fund target' })).toContainText('6 × average monthly Needs');
});

test('budget plan: an asset with a value, in or out of the net worth', async ({ page }) => {
  await openPlan(page, 'assets');
  const add = page.getByRole('form', { name: 'New asset' });
  await add.getByLabel('Name').fill('Flat');
  await add.getByLabel('Value').fill('150000');
  await add.getByRole('button', { name: 'Add asset' }).click();
  const flat = page.getByRole('list', { name: 'Assets' }).getByRole('listitem').filter({ hasText: 'Flat' });
  await expect(flat).toContainText('€150,000.00');
  await flat.getByLabel('In net worth').uncheck();
  await expect.poll(async () => (await stored(page, 'budgetAssets'))[0]?.includeInNetWorth).toBe(false);
  expect(await stored(page, 'budgetCorrections')).toMatchObject([{ account: `asset:${(await stored(page, 'budgetAssets'))[0].id}`, ym: '2026-10', balance: 15000000 }]);
});

test('budget plan: the rotation comes from the crew record marked as me, and offers an update when it changes', async ({ page }) => {
  await openPlan(page, 'rotation');
  const [ship] = await stored(page, 'ships');
  const me = {
    id: 'crew-me', shipId: ship.id, scope: 'ship', surname: 'Horvat', givenNames: 'Ivo', rank: 'master', nationality: 'Croatian', dateOfBirth: '1980-02-03',
    placeOfBirth: 'Split', passportNo: 'X1234567', passportExpiry: '2030-01-01', seamansBookNo: '', seamansBookExpiry: '', signOnDate: '2026-06-15',
    signOnPort: 'Rijeka', contractMonths: 8,
  };
  await seed(page, 'crew', [me]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Pay' })).toBeVisible();
  await expect(page.getByLabel('Months on')).toHaveValue('8');
  await expect(page.getByLabel('Months off')).toHaveValue('4');
  await expect(page.getByLabel('Paid in')).toHaveValue('same');
  await expect(page.getByLabel('Paid at home (%)')).toHaveValue('0');

  await page.getByLabel('Which crew member is you?').selectOption({ label: 'Horvat, Ivo — Master · MV OCEAN STAR' });
  await page.getByRole('button', { name: 'Use my contract from MV OCEAN STAR' }).click();
  const periods = page.getByRole('list', { name: 'Periods' }).getByRole('listitem');
  await expect(periods).toHaveCount(1);
  await expect(periods.first()).toContainText('15 Jun 2026 – 14 Feb 2027');
  await expect(periods.first()).toContainText('From your contract');
  await expect(page.getByText('Your contract from MV OCEAN STAR is in the plan.')).toBeVisible();
  const [settings] = await stored(page, 'budgetSettings');
  expect(settings.meCrewId).toBe('crew-me');
  expect(settings.rotation.periods).toEqual([{ signOn: '2026-06-15', signOff: '2027-02-14', crewId: 'crew-me' }]);

  await page.getByLabel('Monthly salary onboard').fill('5200');
  await page.getByLabel('From month', { exact: true }).fill('2026-06');
  await page.getByRole('button', { name: 'Add salary' }).click();
  await expect(page.getByRole('list', { name: 'Salary' })).toContainText('€5,200.00 from June 2026');

  // The contract is extended on the ship: the budget does not change until asked.
  await seed(page, 'crew', [{ ...me, contractMonths: 9 }]);
  await page.reload();
  await expect(page.getByText('Your contract from MV OCEAN STAR has changed: 15 Jun 2026 – 14 Mar 2027.')).toBeVisible();
  expect((await stored(page, 'budgetSettings'))[0].rotation.periods[0].signOff).toBe('2027-02-14');
  await page.getByRole('button', { name: 'Update from contract' }).click();
  await expect(periods.first()).toContainText('15 Jun 2026 – 14 Mar 2027');
  expect((await stored(page, 'budgetSettings'))[0].rotation.periods).toEqual([{ signOn: '2026-06-15', signOff: '2027-03-14', crewId: 'crew-me' }]);

  await page.getByLabel('Months off').fill('3');
  await page.getByLabel('Paid in').selectOption({ label: 'The next month' });
  await page.getByRole('button', { name: 'Save pattern and pay' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  expect((await stored(page, 'budgetSettings'))[0].rotation).toMatchObject({ patternOn: 8, patternOff: 3, paidNextMonth: true, salaryFrom: [{ ym: '2026-06', amount: 520000 }] });
});

test('budget plan: assumptions start with no return or inflation, and say what they are', async ({ page }) => {
  await openPlan(page, 'assumptions');
  await expect(page.getByLabel('Expected yearly return (%)')).toHaveValue('');
  await expect(page.getByLabel('Inflation (% a year)')).toHaveValue('');
  await expect(page.getByLabel('Withdrawal rate (%)')).toHaveValue('4');
  await expect(page.getByText('an assumption, not advice')).toBeVisible();
  await expect(page.getByText('Projection — not a forecast or financial advice.')).toBeVisible();
  await expect(page.getByText(/grows smoothly through the year/)).toBeVisible();
  await expect(page.getByLabel('Emergency fund (months of Needs)')).toHaveValue('6');
  await expect(page.getByLabel('Forecast horizon')).toHaveValue('24');
  await expect(page.getByLabel('Buffer')).toHaveValue('');
  await page.getByLabel('Expected yearly return (%)').fill('0');
  await page.getByLabel('Inflation (% a year)').fill('2,5');
  await page.getByLabel('Forecast horizon').selectOption({ label: '36 months' });
  await page.getByRole('button', { name: 'Save assumptions' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  const [settings] = await stored(page, 'budgetSettings');
  expect(settings.assumptions).toEqual({ yearlyReturnPct: 0, withdrawalRatePct: 4, inflationPct: 2.5, emergencyMonths: 6, fundReminderDays: 30 });
  expect(settings.horizon).toBe(36);
  expect(settings.bufferCents).toBeUndefined();
  await page.getByLabel('Inflation (% a year)').fill('');
  await page.getByRole('button', { name: 'Save assumptions' }).click();
  await expect.poll(async () => (await stored(page, 'budgetSettings'))[0].assumptions.inflationPct).toBeUndefined();
});

test('budget plan: starting balances on first run, then the bank shows on the dashboard', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/budget');
  await seed(page, 'budgetDebts', [{ id: 'debt-car', name: 'Car loan', startBalance: 500000, yearlyRatePct: 6, instalment: 20000, startYm: '2026-01' }]);
  await page.reload();
  await page.getByRole('link', { name: /^Starting balances/ }).click();
  await expect(page).toHaveURL(/#\/budget\/plan\/start$/);
  await expect(page.getByLabel('Balances at the end of')).toHaveValue('2026-09');
  await page.getByLabel('Bank & cash').fill('2500');
  await page.getByLabel('Investments').fill('10.000');
  await page.getByLabel('Car loan').fill('4000');
  await page.getByRole('button', { name: 'Save starting balances' }).click();
  await expect(page.getByText('Starting balances saved.')).toBeVisible();
  const corrections = (await stored(page, 'budgetCorrections')).map((c) => [c.account, c.ym, c.balance]).sort();
  expect(corrections).toEqual([['bank', '2026-09', 250000], ['debt:debt-car', '2026-09', 400000], ['investments', '2026-09', 1000000]]);

  await page.goto('./#/budget');
  await expect(page.getByText('Bank & cash €2,500.00')).toBeVisible();
  await expect(page.getByRole('link', { name: /^Starting balances/ })).toHaveCount(0);

  // Saving again changes the same corrections rather than adding more.
  await page.goto('./#/budget/plan/start');
  await expect(page.getByLabel('Bank & cash')).toHaveValue('2500');
  await page.getByLabel('Bank & cash').fill('2600');
  await page.getByRole('button', { name: 'Save starting balances' }).click();
  await expect(page.getByText('Starting balances saved.')).toBeVisible();
  expect((await stored(page, 'budgetCorrections')).filter((c) => c.account === 'bank').map((c) => c.balance)).toEqual([260000]);
});

test('budget plan: no horizontal scroll at 360 px', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/budget/plan');
  await expect(page.getByRole('list', { name: 'Plan' })).toBeVisible();
  await seed(page, 'budgetDebts', [{ id: 'debt-car', name: 'A car loan with a very long name from the bank in town', startBalance: 500000, yearlyRatePct: 6, instalment: 20000, startYm: '2026-01' }]);
  await seed(page, 'budgetFunds', [{ id: 'fund-car', name: 'Car registration and insurance for the year', amount: 60000, dueYm: '2027-03', repeatMonths: 12, startBalance: 0 }]);
  await expectNoHorizontalScroll(page);
  for (const section of ['targets', 'categories', 'recurring', 'funds', 'debts', 'goals', 'assets', 'rotation', 'assumptions', 'start']) {
    await page.goto(`./#/budget/plan/${section}`);
    await expect(page.getByRole('link', { name: '← Plan' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
});

// ---- Dashboard, forecast, net worth, scenarios, trends and charts ----

const ETF = 'budget-cat:savings:index-funds-etfs-e-g-s-p-500';
/** On board from July 2026 to February 2027, then 8 on and 4 off: March to June 2027 are 4 home months. */
const ROTATION = {
  salaryFrom: [{ ym: '2026-01', amount: 500000 }], periods: [{ signOn: '2026-07-01', signOff: '2027-02-28' }], patternOn: 8, patternOff: 4,
  paidNextMonth: false, paidAtHomePct: 0,
};

/** Changes the stored budget settings (the budget must have been opened once, so that they exist). */
async function patchSettings(page: Page, patch: Record<string, unknown>): Promise<void> {
  const [current] = await stored(page, 'budgetSettings');
  await seed(page, 'budgetSettings', [{ ...current, ...patch, assumptions: { ...current.assumptions, ...(patch.assumptions as object | undefined) } }]);
}

/** A ship, the budget opened once (which sets it up), then a plan: the rotation, salary, a Needs target and starting balances. */
async function openWithPlan(page: Page, opts: { needs: number; settings?: Record<string, unknown>; bank?: boolean; extra?: () => Promise<void> }): Promise<void> {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/budget');
  await expect(page.getByRole('link', { name: /^Starting balances/ })).toBeVisible();
  await patchSettings(page, { rotation: ROTATION, ...opts.settings });
  await seed(page, 'budgetMonths', [{ id: 'm-2026-10', ym: '2026-10', potTargets: { needs: { fromOn: { kind: 'amount', value: opts.needs } } }, categoryTargets: {} }]);
  if (opts.bank !== false) await seed(page, 'budgetCorrections', [{ id: 'c-bank', account: 'bank', ym: '2026-09', balance: 300000 }]);
  await opts.extra?.();
  await page.reload();
}

/** Shows a chart as a table: the chart's own toggle, then its table, named as the chart is. */
async function expectChartTable(page: Page, name: string): Promise<void> {
  const figure = page.getByRole('figure', { name });
  await expect(figure.getByRole('img', { name })).toBeVisible();
  await figure.getByRole('button', { name: 'Show as table' }).click();
  await expect(figure.getByRole('table', { name })).toBeVisible();
  await expect(figure.getByRole('img', { name })).toHaveCount(0);
  await figure.getByRole('button', { name: 'Show as chart' }).click();
  await expect(figure.getByRole('img', { name })).toBeVisible();
}

test('budget forecast: without a bank balance it asks for one', async ({ page }) => {
  await openWithPlan(page, { needs: 450000, bank: false });
  await page.goto('./#/budget/forecast');
  await expect(page.getByText('Enter your bank balance to see the forecast')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Starting balances' })).toBeVisible();
});

test('budget forecast: 4 home months bring free to spend below the buffer in a home month, and the lowest point', async ({ page }) => {
  await openWithPlan(page, { needs: 450000, settings: { bufferCents: 200000 } });
  await page.goto('./#/budget/forecast');
  await page.getByLabel('Horizon').selectOption({ label: '12 months' });
  const table = page.getByRole('table', { name: 'Forecast by month' });
  await expect(table.getByRole('row')).toHaveCount(13);
  // €3,000.00 at the end of September; +€5,000.00 salary and −€4,500.00 Needs on board, −€4,500.00 at home.
  await expect(cells(table.getByRole('row').nth(1))).toHaveText(['October 2026', 'Onboard', '€5,000.00', '€4,500.00', '€3,500.00', '€3,500.00']);
  await expect(cells(table.getByRole('row').filter({ hasText: 'March 2027' }))).toHaveText(['March 2027', 'Home', '€0.00', '€4,500.00', '€1,000.00', '€1,000.00']);
  const warnings = page.getByRole('list', { name: 'Warnings' });
  await expect(warnings).toContainText('Free to spend drops below €2,000.00 in March 2027');
  await expect(warnings).toContainText('Bank goes negative in April 2027');
  await expect(page.getByText('Lowest: −€12,500.00 in June 2027 (home)')).toBeVisible();
  expect((await stored(page, 'budgetSettings'))[0].horizon).toBe(12);

  const assumptions = page.getByRole('region', { name: 'Assumptions' });
  await expect(assumptions).toContainText('Salary onboard: €5,000.00 a month');
  await expect(assumptions).toContainText('8 months on, 4 off');
  await expect(assumptions).toContainText('Needs: its targets');
  await expect(assumptions).toContainText('Expected return: not entered');
  await expect(assumptions.getByRole('link', { name: 'Edit rotation and pay' })).toHaveAttribute('href', '#/budget/plan/rotation');
  await expect(assumptions.getByRole('link', { name: 'Edit assumptions' })).toHaveAttribute('href', '#/budget/plan/assumptions');
  await expect(page.getByText('Projection — not a forecast or financial advice.')).toBeVisible();
  await expectChartTable(page, 'Bank and free to spend by month');
});

/** The plan for the scenario tests: €2,000.00 of Needs, €50,000.00 invested, €1,000.00 a month into an ETF, and the rates. */
async function openScenarioPlan(page: Page): Promise<void> {
  await openWithPlan(page, {
    needs: 200000,
    settings: { assumptions: { yearlyReturnPct: 5, inflationPct: 2, withdrawalRatePct: 4, yearlySpendingCents: 2400000 } },
    extra: async () => {
      await seed(page, 'budgetCorrections', [{ id: 'c-inv', account: 'investments', ym: '2026-09', balance: 5000000 }]);
      await seed(page, 'budgetRecurring', [{ id: 'tpl-etf', name: 'ETF', amount: 100000, categoryId: ETF, day: 5, startYm: '2026-10' }]);
    },
  });
}

test('budget scenarios: a car changes the lowest bank month and the freedom date, and Apply to plan makes the planned entry', async ({ page }) => {
  await openScenarioPlan(page);
  await page.goto('./#/budget/scenarios');
  await expect(page.getByText('No scenarios yet.')).toBeVisible();
  await page.getByLabel('Scenario name').fill('Car');
  await page.getByRole('button', { name: 'Add scenario' }).click();
  await expect(page).toHaveURL(/#\/budget\/scenarios\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Car' })).toBeVisible();

  await page.getByLabel('Kind of change').selectOption({ label: 'One-off purchase or income' });
  const change = page.getByRole('form', { name: 'New change' });
  await change.getByLabel('What').fill('Car');
  await change.getByLabel('Month').fill('2027-05');
  await change.getByLabel('Amount').fill('18000');
  await change.getByLabel('Pot').selectOption({ label: 'Wants' });
  await change.getByRole('button', { name: 'Add change' }).click();
  await page.getByLabel('Kind of change').selectOption({ label: 'Investment contribution from a month on' });
  await change.getByLabel('From month').fill('2027-05');
  await change.getByLabel('Each month').fill('500');
  await change.getByRole('button', { name: 'Add change' }).click();
  const changes = page.getByRole('list', { name: 'Changes' }).getByRole('listitem');
  await expect(changes).toHaveCount(2);
  await expect(changes.nth(0)).toContainText('Car: €18,000.00 in May 2027 (Wants)');
  await expect(changes.nth(1)).toContainText('Investments: €500.00 a month from May 2027 on');

  await page.getByRole('link', { name: '← Scenarios' }).click();
  const compare = page.getByRole('table', { name: 'Compare' });
  await expect(cells(compare.getByRole('row').first())).toHaveText(['', 'Base plan', 'Car']);
  await expect(cells(compare.getByRole('row').filter({ hasText: 'Lowest bank' }))).toHaveText(['Lowest bank', '€1,000.00 in June 2027', '−€16,000.00 in June 2027']);
  await expect(cells(compare.getByRole('row').filter({ hasText: 'Freedom date' }))).toHaveText(['Freedom date', 'January 2058', 'October 2071']);
  await expect(cells(compare.getByRole('row').filter({ hasText: 'Net worth in 1 year' }))).toHaveText(['Net worth in 1 year', '€71,772.58', '€53,752.14']);
  await expectChartTable(page, 'Net worth by month, base plan and scenarios');

  await page.getByRole('link', { name: 'Car', exact: true }).click();
  await page.getByRole('button', { name: 'Apply to plan' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Planned purchase in May 2027: Car, €18,000.00');
  await expect(dialog).toContainText('Investments: €500.00 a month from May 2027 on (replacing ETF)');
  await expect(dialog).toContainText('A snapshot is taken first');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Car is in the plan. A snapshot was taken first.')).toBeVisible();
  const [scenario] = await stored(page, 'budgetScenarios');
  const entry = (await storedEntries(page)).find((e) => e.id === `scenario:${scenario.id}:0:2027-05`);
  expect(entry).toMatchObject({ kind: 'expense', date: '2027-05-01', amount: 1800000, status: 'planned', note: 'Car', oneOff: true, categoryId: 'budget-cat:wants:other-wants' });
  expect(await stored(page, 'snapshots')).toHaveLength(1);
  const templates = await stored(page, 'budgetRecurring');
  expect(templates.map((t) => [t.name, t.amount, t.startYm, t.endYm])).toEqual(expect.arrayContaining([['ETF', 100000, '2026-10', '2027-04'], ['ETF', 50000, '2027-05', undefined]]));
  await page.goto('./#/budget/month/2027-05');
  await expect(toConfirm(page).filter({ hasText: 'Car' })).toContainText('€18,000.00');
});

test('budget net worth: the history after a correction, the savings rate and the freedom date', async ({ page }) => {
  await openScenarioPlan(page);
  await page.goto('./#/budget/net-worth');
  const table = page.getByRole('table', { name: 'Net worth history' });
  // €3,000.00 in the bank and €50,000.00 invested.
  await expect(table.getByRole('row').filter({ hasText: 'September 2026' })).toContainText('€53,000.00');
  await expect(page.getByText('At this plan: January 2058 (in 31 years 3 months)')).toBeVisible();
  await expect(page.getByText('Projection — not a forecast or financial advice.').first()).toBeVisible();
  await expect(page.getByText('an assumption, not advice')).toBeVisible();
  await expect(page.getByText(/Freedom number: €600,000\.00 in today's euros/)).toBeVisible();
  await expect(page.getByText(/grows smoothly through the year/)).toBeVisible();
  await expect(page.getByText('Savings rate (12 months): no income recorded yet')).toBeVisible();
  await expectChartTable(page, 'Net worth by month');

  await page.goto('./#/budget/plan/start');
  await page.getByLabel('Balances at the end of').fill('2026-10');
  await page.getByLabel('Investments').fill('60000');
  await page.getByRole('button', { name: 'Save starting balances' }).click();
  await expect(page.getByText('Starting balances saved.')).toBeVisible();
  await page.goto('./#/budget/net-worth');
  await expect(table.getByRole('row').filter({ hasText: 'October 2026' })).toContainText('€63,000.00');
});

test('budget dashboard: pots, bank and free to spend, the next 3 months, funds due, warnings and the net worth line', async ({ page }) => {
  await openScenarioPlan(page);
  await seed(page, 'budgetFunds', [{ id: 'fund-ins', name: 'Insurance', amount: 30000, dueYm: '2026-12', startBalance: 10000 }]);
  await seed(page, 'budgetEntries', [
    { id: 'e-food', kind: 'expense', date: '2026-10-03', amount: 50000, categoryId: 'budget-cat:needs:groceries-food-drink', status: 'actual' },
    { id: 'e-old', kind: 'expense', date: '2026-09-03', amount: 3500, categoryId: 'budget-cat:needs:training-gym', status: 'planned', note: 'Gym' },
  ]);
  await page.goto('./#/budget');
  await expect(page.getByText('Bank & cash €2,500.00 · Free to spend €2,400.00')).toBeVisible();
  const pots = page.getByRole('figure', { name: 'This month by pot' });
  await expect(pots.getByRole('img', { name: 'This month by pot' })).toBeVisible();
  await pots.getByRole('button', { name: 'Show as table' }).click();
  await expect(cells(pots.getByRole('row').filter({ hasText: 'Needs' }))).toHaveText(['Needs', '€2,000.00', '€500.00', '25%']);
  const next = page.getByRole('table', { name: 'The next 3 months' });
  await expect(next.getByRole('row')).toHaveCount(4);
  await expect(next.getByRole('row').nth(1)).toContainText('October 2026');
  await expect(page.getByRole('list', { name: 'Funds due soon' })).toContainText('Insurance');
  await expect(page.getByRole('list', { name: 'Funds due soon' })).toContainText('December 2026');
  await expect(page.getByText('1 item to confirm in earlier months')).toBeVisible();
  await expect(page.getByText(/^Net worth €[\d,.]+ · Freedom date: January 2058$/)).toBeVisible();
});

test('budget trends: per pot and category across months, income planned vs received, balances over time', async ({ page }) => {
  await openScenarioPlan(page);
  await seed(page, 'budgetEntries', [
    { id: 'e-1', kind: 'expense', date: '2026-09-03', amount: 40000, categoryId: 'budget-cat:needs:groceries-food-drink', status: 'actual' },
    { id: 'e-2', kind: 'expense', date: '2026-10-03', amount: 50000, categoryId: 'budget-cat:needs:groceries-food-drink', status: 'actual' },
    { id: 'e-3', kind: 'income', date: '2026-10-01', amount: 500000, incomeSource: 'salary', status: 'actual' },
  ]);
  await page.goto('./#/budget/trends');
  await expectChartTable(page, 'Spending by pot');
  await page.getByLabel('Category').selectOption({ label: 'Groceries, food & drink' });
  const category = page.getByRole('figure', { name: 'Groceries, food & drink by month' });
  await category.getByRole('button', { name: 'Show as table' }).click();
  await expect(category.getByRole('row').filter({ hasText: 'October 2026' })).toContainText('€500.00');
  await expect(category.getByRole('row').filter({ hasText: 'September 2026' })).toContainText('€400.00');
  await expectChartTable(page, 'Income planned and received');
  await expectChartTable(page, 'Balances over time');
});

test('budget: every chart and screen fits 360 px', async ({ page }) => {
  await openScenarioPlan(page);
  await seed(page, 'budgetScenarios', [{ id: 'sc-long', name: 'A scenario with a long name about a car and a longer contract', changes: [
    { kind: 'oneOff', ym: '2027-05', amount: 1800000, pot: 'wants', label: 'A car bought from the dealer in town' },
  ] }]);
  for (const path of ['', '/forecast', '/net-worth', '/scenarios', '/scenarios/sc-long', '/trends']) {
    await page.goto(`./#/budget${path}`);
    await expect(page.locator('figure svg').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
});

test('budget excel: a 3-month workbook is reviewed and imported, the months match its totals, and it exports back', async ({ page }, info) => {
  // The workbook is made up: invented labels and amounts in the layout of the user's own.
  const file = info.outputPath('budget.xlsx'); await makeBudgetXlsx(file);
  await freshApp(page); await setupShip(page);
  await page.goto('./#/budget');
  await page.getByRole('link', { name: /^Import from Excel/ }).click();
  await expect(page).toHaveURL(/#\/budget\/import$/);
  await page.getByLabel('Budget workbook').setInputFiles(file);
  await expect(page.getByText('3 months: August 2026 to October 2026.')).toBeVisible();

  // One step when the labels match; the one that does not is offered as a new category, or mapped to another.
  await expect(page.getByText('1 label has no category yet')).toBeVisible();
  await expect(page.getByLabel('Needs: Čišćenje')).toHaveValue('new');
  await page.getByLabel('Needs: Čišćenje').selectOption({ label: 'Other › Other needs (Needs)' });
  await page.getByText('Adjust', { exact: true }).click();
  await expect(page.getByLabel('Needs: Apoteka')).toHaveValue('budget-cat:needs:pharmacy');
  await expect(page.getByLabel('The debt balance (STANJA) is')).toHaveValue('new');
  await page.getByLabel('Bank & cash at the end of October 2026').fill('2500');

  const preview = page.getByRole('table', { name: 'Totals per pot' });
  await expect(cells(preview.getByRole('row').filter({ hasText: 'August 2026' }))).toHaveText(
    ['August 2026', '€3,200.00', '€1,415.50', '€800.00', '€105.00', '€300.00', '€200.00', '14'],
  );
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Import 3 months' }).click();
  await expect(page.getByText('Imported 3 months, 32 entries.')).toBeVisible();
  expect((await page.evaluate(() => new Promise<number>((resolve) => {
    const open = indexedDB.open('masterpiece');
    open.onsuccess = () => { const r = open.result.transaction('snapshots').objectStore('snapshots').count(); r.onsuccess = () => { open.result.close(); resolve(r.result); }; };
  })))).toBeGreaterThan(0);

  await page.goto('./#/budget/month/2026-08');
  await expect(potCard(page, 'Needs')).toContainText('Spent €1,415.50');
  await expect(potCard(page, 'Savings & investments')).toContainText('Spent €800.00');
  await expect(potCard(page, 'Wants')).toContainText('Spent €105.00');
  await expect(potCard(page, 'Debts')).toContainText('Spent €300.00');
  await expect(potCard(page, 'Emergency fund')).toContainText('Spent €200.00');
  await page.goto('./#/budget/month/2026-09');
  await expect(potCard(page, 'Needs')).toContainText('Spent €1,119.00');
  const corrections = (await stored(page, 'budgetCorrections')).map((c) => [c.account.startsWith('debt:') ? 'debt' : c.account, c.ym, c.balance]).sort();
  expect(corrections).toContainEqual(['bank', '2026-10', 250000]);
  expect(corrections).toContainEqual(['investments', '2026-10', 1380000]);
  expect(corrections).toContainEqual(['debt', '2026-10', 404000]);
  expect((await stored(page, 'budgetCategories')).find((c) => c.id === 'budget-cat:needs:other-needs')?.synonyms).toEqual(['Čišćenje']);

  // Importing again replaces the imported entries; it never doubles them.
  await page.goto('./#/budget/import');
  await page.getByLabel('Budget workbook').setInputFiles(file);
  await expect(page.getByText('Every line matches a category.')).toBeVisible();
  await expect(page.getByText('32 entries imported before are replaced.')).toBeVisible();
  await page.getByRole('button', { name: 'Import 3 months' }).click();
  await expect(page.getByText('Imported 3 months, 32 entries.')).toBeVisible();
  expect(await storedEntries(page)).toHaveLength(32);

  await page.goto('./#/budget');
  await page.getByRole('link', { name: /^Export to Excel/ }).click();
  await page.getByLabel('A range of months').check();
  await page.getByLabel('From', { exact: true }).fill('2026-08');
  await page.getByLabel('To', { exact: true }).fill('2026-10');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export to Excel' }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('budget-2026-08-to-2026-10.xlsx');
  await expect(page.getByText('Exported.')).toBeVisible();
  const book = XLSX.read(await fs.readFile(await saved.path()), { type: 'array' });
  expect(book.SheetNames).toEqual(['Summary', 'August 2026', 'September 2026', 'October 2026']);
  const summary = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.Summary, { header: 1 });
  expect(summary[1].slice(0, 8)).toEqual(['August 2026', 3200, 100, 1415.5, 800, 105, 300, 200]);
});
