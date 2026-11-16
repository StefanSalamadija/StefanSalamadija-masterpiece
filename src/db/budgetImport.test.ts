import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { budgetWorkbook } from '../../e2e/fixtures/makeBudgetXlsx';
import { defaultChoices, readBudgetWorkbook } from '../budget/excel/import';
import { addEntry, defaultCategoryId, ensureBudgetSetup, listBudget, listCategories } from './budget';
import { importBudget } from './budgetImport';
import { openDb } from './schema';
import { listSnapshots } from './snapshots';

// Every label and amount comes from the made-up fixture.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-15T09:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const db = openDb('budget-import-' + crypto.randomUUID());
  await ensureBudgetSetup(db);
  const months = (await readBudgetWorkbook(budgetWorkbook().buffer as ArrayBuffer)).months;
  return { db, months };
}

describe('importBudget', () => {
  it('takes a snapshot first, then writes the entries, plan, new categories, a new debt and the balances', async () => {
    const { db, months } = await setup();
    const choices = { ...defaultChoices(months, await listCategories(db), []), debtId: 'new' as const, bank: { ym: '2026-10', balance: 250000 } };
    const result = await importBudget(db, months, choices, 'budget.xlsx');
    expect(result).toEqual({ months: 3, entries: 32 });

    const [snapshot] = await listSnapshots(db);
    expect(snapshot.reason).toBe('before-import');
    expect(snapshot.counts.budgetEntries).toBe(0);

    const cleaning = (await listCategories(db)).filter((c) => c.name === 'Čišćenje');
    expect(cleaning.map((c) => [c.pot, c.group])).toEqual([['needs', 'DRUGO']]);
    const [loan] = await listBudget(db, 'budgetDebts');
    expect([loan.startBalance, loan.startYm]).toEqual([450000, '2026-08']);
    const corrections = await listBudget(db, 'budgetCorrections');
    expect(corrections.filter((c) => c.account === `debt:${loan.id}`).map((c) => c.balance).sort()).toEqual([404000, 427000, 450000]);
    expect(corrections.find((c) => c.account === 'bank')).toMatchObject({ ym: '2026-10', balance: 250000 });
    expect((await listBudget(db, 'budgetMonths')).map((m) => m.ym).sort()).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('importing again replaces the imported entries and keeps the ones added in the app', async () => {
    const { db, months } = await setup();
    const choices = defaultChoices(months, await listCategories(db), []);
    await importBudget(db, months, choices, 'budget.xlsx');
    await addEntry(db, { kind: 'expense', date: '2026-09-12', amount: 1500, categoryId: defaultCategoryId({ pot: 'wants', name: 'Shopping' }), status: 'actual' });

    // The second time, the category made the first time is found by its name.
    const again = defaultChoices(months, await listCategories(db), await listBudget(db, 'budgetDebts'));
    expect(again.mapping['needs|ciscenje']).toEqual({ categoryId: (await listCategories(db)).find((c) => c.name === 'Čišćenje')!.id });
    await importBudget(db, months, again, 'budget.xlsx');

    const live = await listBudget(db, 'budgetEntries');
    expect(live.filter((e) => e.importKey !== undefined)).toHaveLength(32);
    expect(live.filter((e) => e.importKey === undefined).map((e) => e.amount)).toEqual([1500]);
    expect((await listCategories(db)).filter((c) => c.name === 'Čišćenje')).toHaveLength(1);
    expect(await listBudget(db, 'budgetMonths')).toHaveLength(3);
    expect(await listSnapshots(db)).toHaveLength(2);
  });
});
