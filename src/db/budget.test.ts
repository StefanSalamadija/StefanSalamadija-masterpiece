import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CATEGORIES } from '../budget/catalog';
import type { BudgetCategory, BudgetEntry, BudgetSettings } from '../domain/types';
import {
  addEntry, createBudgetRecord, deleteBudgetRecord, ensureBudgetSetup, entriesInMonth, getBudgetSettings, listBudget, listCategories,
  undoEntry, updateBudgetRecord, updateBudgetSettings, updateEntry,
} from './budget';
import { allTables } from './records';
import { openDb } from './schema';
import { getSettings } from './settings';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-15T09:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const freshDb = () => openDb('budget-' + crypto.randomUUID());

// Invented figures only.
const coffee = (over: Partial<Omit<BudgetEntry, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy' | 'deleted' | 'scope'>> = {}) => ({
  kind: 'expense' as const, date: '2026-11-14', amount: 320, status: 'actual' as const, note: 'Coffee', ...over,
});

describe('ensureBudgetSetup', () => {
  it('seeds exactly the default categories, in order, all personal and shown', async () => {
    const db = freshDb();
    await ensureBudgetSetup(db);
    const categories = await listCategories(db);
    expect(categories.map(({ pot, group, name }) => ({ pot, ...(group !== undefined ? { group } : {}), name }))).toEqual([...DEFAULT_CATEGORIES]);
    expect(categories.map((c) => c.order)).toEqual(DEFAULT_CATEGORIES.map((_, i) => i));
    expect(categories.every((c) => c.scope === 'personal' && !c.deleted && !c.hidden)).toBe(true);
    expect(new Set(categories.map((c) => c.id)).size).toBe(DEFAULT_CATEGORIES.length);
    db.close();
  });

  it('writes the default settings once', async () => {
    const db = freshDb();
    await ensureBudgetSetup(db);
    const settings = await getBudgetSettings(db);
    expect(settings).toMatchObject({
      key: 'budget', scope: 'personal', horizon: 24, favourites: [],
      rotation: { salaryFrom: [], periods: [], patternOn: 8, patternOff: 4, paidNextMonth: false, paidAtHomePct: 0 },
      assumptions: { withdrawalRatePct: 4, emergencyMonths: 6, fundReminderDays: 30 },
      forecastMethod: { needs: 'targets', savings: 'targets', wants: 'targets', debts: 'targets', emergency: 'targets' },
    });
    // The expected return and inflation are the user's to enter; the buffer defaults to a month of Needs, worked out.
    expect(settings.assumptions).not.toHaveProperty('yearlyReturnPct');
    expect(settings.assumptions).not.toHaveProperty('inflationPct');
    expect(settings).not.toHaveProperty('bufferCents');
    // Seeded with the same id and stamp on every device (see the two-device test below).
    expect(settings).toMatchObject({ id: 'budget-settings', updatedBy: 'seed', createdAt: '1970-01-01T00:00:00.000Z' });
    db.close();
  });

  it('gives the defaults the same ids on every device, so two devices that each seeded merge into one set', async () => {
    const [a, b] = [freshDb(), freshDb()];
    await ensureBudgetSetup(a);
    vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
    await ensureBudgetSetup(b);
    const [mine, theirs] = [await allTables(a), await allTables(b)];
    expect(theirs.budgetCategories).toEqual(mine.budgetCategories);
    expect(theirs.budgetSettings).toEqual(mine.budgetSettings);
    expect(mine.budgetCategories.map((c) => c.id)).toContain('budget-cat:wants:cafes-restaurants');
    expect(mine.budgetCategories.map((c) => c.id)).toContain('budget-cat:needs:children-s-needs');
    a.close();
    b.close();
  });

  it('is idempotent: run again, or twice at once, it adds nothing', async () => {
    const db = freshDb();
    await Promise.all([ensureBudgetSetup(db), ensureBudgetSetup(db)]);
    await ensureBudgetSetup(db);
    const tables = await allTables(db);
    expect(tables.budgetCategories).toHaveLength(DEFAULT_CATEGORIES.length);
    expect(tables.budgetSettings).toHaveLength(1);
    db.close();
  });

  it('leaves alone what the user changed, and never brings back a category they deleted', async () => {
    const db = freshDb();
    await ensureBudgetSetup(db);
    const [first] = await listCategories(db);
    await deleteBudgetRecord(db, 'budgetCategories', first.id);
    await updateBudgetSettings(db, { horizon: 60 });
    await ensureBudgetSetup(db);
    expect(await listCategories(db)).toHaveLength(DEFAULT_CATEGORIES.length - 1);
    expect((await getBudgetSettings(db)).horizon).toBe(60);
    db.close();
  });

  it('seeds nothing when a budget came from another device first', async () => {
    const db = freshDb();
    const other = freshDb();
    await ensureBudgetSetup(other);
    const theirs = await allTables(other);
    await db.budgetCategories.bulkPut(theirs.budgetCategories.slice(0, 3) as BudgetCategory[]);
    await db.budgetSettings.bulkPut(theirs.budgetSettings as BudgetSettings[]);
    await ensureBudgetSetup(db);
    expect(await db.budgetCategories.count()).toBe(3);
    expect(await db.budgetSettings.count()).toBe(1);
    db.close();
    other.close();
  });
});

describe('entries', () => {
  it('adds a personal entry in whole cents and finds it by its month', async () => {
    const db = freshDb();
    const added = await addEntry(db, coffee());
    expect(added).toMatchObject({ kind: 'expense', amount: 320, scope: 'personal', deleted: false, createdAt: '2026-11-15T09:00:00.000Z' });
    await addEntry(db, coffee({ date: '2026-12-01' }));
    await addEntry(db, coffee({ date: '2026-10-31' }));
    expect((await entriesInMonth(db, '2026-11')).map((e) => e.id)).toEqual([added.id]);
    expect(await db.budgetEntries.get(added.id)).toEqual(added);
    db.close();
  });

  it('refuses an amount that is not whole cents, and a date that is not a date', async () => {
    const db = freshDb();
    await expect(addEntry(db, coffee({ amount: 3.2 }))).rejects.toThrow();
    await expect(addEntry(db, coffee({ amount: Number.NaN }))).rejects.toThrow();
    await expect(addEntry(db, coffee({ date: '14.11.2026' }))).rejects.toThrow();
    expect(await db.budgetEntries.count()).toBe(0);
    db.close();
  });

  it('is edited in place, and an edit to whole cents only', async () => {
    const db = freshDb();
    const added = await addEntry(db, coffee());
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'));
    const edited = await updateEntry(db, added.id, { amount: 350, note: undefined });
    expect(edited).toMatchObject({ id: added.id, amount: 350, updatedAt: '2026-11-15T10:00:00.000Z' });
    expect(edited).not.toHaveProperty('note');
    await expect(updateEntry(db, added.id, { amount: 1.5 })).rejects.toThrow();
    db.close();
  });

  it('undo leaves a tombstone, so the removal reaches other devices', async () => {
    const db = freshDb();
    const added = await addEntry(db, coffee());
    vi.setSystemTime(new Date('2026-11-15T09:01:00Z'));
    await undoEntry(db, added.id);
    const stored = await db.budgetEntries.get(added.id);
    expect(stored).toMatchObject({ deleted: true, updatedAt: '2026-11-15T09:01:00.000Z', amount: 320 });
    expect(await entriesInMonth(db, '2026-11')).toEqual([]);
    expect(await listBudget(db, 'budgetEntries')).toEqual([]);
    db.close();
  });
});

describe('the other budget tables', () => {
  it('create, list, change and delete personal records', async () => {
    const db = freshDb();
    const fund = await createBudgetRecord(db, 'budgetFunds', { name: 'Car insurance', amount: 60000, dueYm: '2027-05', startBalance: 0 });
    const debt = await createBudgetRecord(db, 'budgetDebts', { name: 'Car loan', startBalance: 900000, yearlyRatePct: 5.5, instalment: 25000, startYm: '2026-01' });
    expect(fund.scope).toBe('personal');
    expect((await listBudget(db, 'budgetFunds')).map((f) => f.id)).toEqual([fund.id]);
    const renamed = await updateBudgetRecord(db, 'budgetFunds', fund.id, { name: 'Car insurance (yearly)' });
    expect(renamed.name).toBe('Car insurance (yearly)');
    await deleteBudgetRecord(db, 'budgetDebts', debt.id);
    expect(await listBudget(db, 'budgetDebts')).toEqual([]);
    expect((await db.budgetDebts.get(debt.id))?.deleted).toBe(true);
    db.close();
  });

  it('refuses nested money that is not whole cents, and takes a pot target as a fractional percentage', async () => {
    const db = freshDb();
    await ensureBudgetSetup(db);
    const month = (over: object) => ({ ym: '2026-11', potTargets: {}, categoryTargets: {}, ...over });
    await expect(createBudgetRecord(db, 'budgetMonths', month({ categoryTargets: { c1: { thisOnly: 12.5 } } }))).rejects.toThrow();
    await expect(createBudgetRecord(db, 'budgetMonths', month({ potTargets: { needs: { thisOnly: { kind: 'amount', value: 0.5 } } } }))).rejects.toThrow();
    await expect(createBudgetRecord(db, 'budgetMonths', month({ potTargets: { needs: { thisOnly: { kind: 'pct', value: 101 } } } }))).rejects.toThrow();
    // A target must be a "from this month on" or "this month only" edit; a bare target or another key is refused.
    await expect(createBudgetRecord(db, 'budgetMonths', month({ potTargets: { needs: { kind: 'pct', value: 50 } } }))).rejects.toThrow();
    await expect(createBudgetRecord(db, 'budgetMonths', month({ plannedIncome: 450000 }))).rejects.toThrow();
    await expect(createBudgetRecord(db, 'budgetMonths', month({ plannedIncome: { thisOnly: 4500.5 } }))).rejects.toThrow();
    await expect(createBudgetRecord(db, 'budgetMonths', month({ potTargets: { needs: { kind: 'pct', value: 50, inherited: false } } }))).rejects.toThrow();
    await expect(createBudgetRecord(db, 'budgetMonths', month({ categoryTargets: { c1: { amount: 100, origin: 'later' } } }))).rejects.toThrow();
    const saved = await createBudgetRecord(db, 'budgetMonths', month({ potTargets: { needs: { thisOnly: { kind: 'pct', value: 52.5 } } },
      categoryTargets: { c1: { fromOn: null } }, plannedIncome: { fromOn: 450000, thisOnly: 400000 } }));
    await expect(updateBudgetRecord(db, 'budgetMonths', saved.id, { plannedIncome: { fromOn: 4500.5 } })).rejects.toThrow();
    await expect(updateBudgetSettings(db, { favourites: [{ name: 'Coffee', amount: 3.2, categoryId: 'c1' }] })).rejects.toThrow();
    await expect(updateBudgetSettings(db, { fixedSpend: { wants: 100.01 } })).rejects.toThrow();
    const { rotation } = await getBudgetSettings(db);
    await expect(updateBudgetSettings(db, { rotation: { ...rotation, salaryFrom: [{ ym: '2026-01', amount: 4500.5 }] } })).rejects.toThrow();
    await expect(createBudgetRecord(db, 'budgetScenarios', { name: 'Raise', changes: [{ kind: 'salary', fromYm: '2027-01', amount: 0.5 }] })).rejects.toThrow();
    expect(await db.budgetMonths.count()).toBe(1);
    expect((await getBudgetSettings(db)).favourites).toEqual([]);
    db.close();
  });

  it('refuses money that is not whole cents in any table', async () => {
    const db = freshDb();
    await expect(createBudgetRecord(db, 'budgetGoals', { name: 'Boat', amount: 100.5, targetYm: '2030-01' })).rejects.toThrow();
    const goal = await createBudgetRecord(db, 'budgetGoals', { name: 'Boat', amount: 1000000, targetYm: '2030-01' });
    await expect(updateBudgetRecord(db, 'budgetGoals', goal.id, { amount: 0.1 })).rejects.toThrow();
    db.close();
  });
});
