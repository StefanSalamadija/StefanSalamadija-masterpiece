import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
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

/** Writes records straight into budget tables (the Plan screens that make them come later). */
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
