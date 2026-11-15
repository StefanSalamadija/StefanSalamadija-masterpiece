import { DEFAULT_CATEGORIES } from '../budget/catalog';
import { addMonths } from '../budget/months';
import type {
  BaseRecord, BudgetAsset, BudgetCategory, BudgetCorrection, BudgetDebt, BudgetEntry, BudgetFund, BudgetFundMove, BudgetGoal, BudgetMonth,
  BudgetRecurring, BudgetScenario, BudgetSettings, BudgetTableName, Ym,
} from '../domain/types';
import { createRecord, softDelete, updateRecord } from './records';
import { syncTable } from './schema';
import type { MasterpieceDB } from './schema';
import { guardWrite } from './storage';

/*
 * The budget's data: one personal record per category, entry, month plan, template, fund, fund record, debt, goal,
 * asset, correction and scenario, and one settings record. Every write goes through `createRecord` / `updateRecord` /
 * `softDelete`, so records are stamped by this device and never hard-deleted. Money is checked to be whole cents
 * before anything is stored.
 */

/** The record kept in each budget table. */
export interface BudgetRecordOf {
  budgetCategories: BudgetCategory; budgetEntries: BudgetEntry; budgetMonths: BudgetMonth; budgetRecurring: BudgetRecurring;
  budgetFunds: BudgetFund; budgetFundMoves: BudgetFundMove; budgetDebts: BudgetDebt; budgetGoals: BudgetGoal; budgetAssets: BudgetAsset;
  budgetCorrections: BudgetCorrection; budgetScenarios: BudgetScenario; budgetSettings: BudgetSettings;
}
/** What a new record of a budget table is made of: its fields, without the record's own (id, stamps, scope). */
export type BudgetFields<T extends BudgetTableName> = Omit<BudgetRecordOf[T], keyof BaseRecord>;

const SETTINGS_KEY = 'budget';
/** The fields that hold money, in any budget table. Each one must be whole cents. */
const MONEY_FIELDS = ['amount', 'balance', 'startBalance', 'instalment', 'plannedIncome', 'bufferCents'] as const;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Refuses money that is not whole cents: amounts are never stored as floats. */
function assertCents(fields: object): void {
  const values = fields as Record<string, unknown>;
  for (const key of MONEY_FIELDS) {
    if (key in values && values[key] !== undefined && !Number.isSafeInteger(values[key])) {
      throw new Error(`${key} must be a whole number of cents, not ${String(values[key])}.`);
    }
  }
}

function assertEntry(fields: Partial<BudgetEntry>): void {
  assertCents(fields);
  if (fields.date !== undefined && !DATE.test(fields.date)) throw new Error(`An entry's date must be YYYY-MM-DD, not ${fields.date}.`);
}

/** Adds a personal record to a budget table. */
export function createBudgetRecord<T extends BudgetTableName>(db: MasterpieceDB, table: T, fields: BudgetFields<T>): Promise<BudgetRecordOf[T]> {
  try {
    assertCents(fields);
  } catch (error) {
    return Promise.reject(error);
  }
  return createRecord<BudgetRecordOf[T]>(db, table, fields, { scope: 'personal' });
}

/** Changes a live budget record. A field set to `undefined` is removed (see `updateRecord`). */
export function updateBudgetRecord<T extends BudgetTableName>(
  db: MasterpieceDB, table: T, id: string, patch: Partial<BudgetFields<T>>,
): Promise<BudgetRecordOf[T]> {
  try {
    assertCents(patch);
  } catch (error) {
    return Promise.reject(error);
  }
  return updateRecord<BudgetRecordOf[T]>(db, table, id, patch as Partial<BudgetRecordOf[T]>);
}

/** Deletes a budget record: it stays as a tombstone, so the deletion reaches other devices. */
export function deleteBudgetRecord(db: MasterpieceDB, table: BudgetTableName, id: string): Promise<void> {
  return softDelete(db, table, id);
}

/** The live records of a budget table, in primary-key order. */
export function listBudget<T extends BudgetTableName>(db: MasterpieceDB, table: T): Promise<BudgetRecordOf[T][]> {
  return syncTable(db, table).filter((r) => !r.deleted).toArray() as unknown as Promise<BudgetRecordOf[T][]>;
}

/** The live categories in their order (hidden ones included: they are kept for history). */
export async function listCategories(db: MasterpieceDB): Promise<BudgetCategory[]> {
  const categories = await db.budgetCategories.filter((c) => !c.deleted).toArray();
  return categories.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function defaultSettings(): BudgetFields<'budgetSettings'> {
  return {
    key: SETTINGS_KEY,
    rotation: { salaryFrom: [], periods: [], patternOn: 8, patternOff: 4, paidNextMonth: false, paidAtHomePct: 0 },
    // The expected return and inflation are left out: the user enters them (0% is allowed).
    assumptions: { withdrawalRatePct: 4, emergencyMonths: 6, fundReminderDays: 30 },
    favourites: [],
    forecastMethod: { needs: 'targets', savings: 'targets', wants: 'targets', debts: 'targets', emergency: 'targets' },
    horizon: 24,
  };
}

/**
 * Sets the budget up the first time it is opened: the default categories and the default settings. Once there is a
 * settings record (made here, or brought by a backup from another device, even one since deleted) it does nothing, so
 * it never brings back a category the user deleted. Categories are seeded only into an empty category table. It runs
 * in one transaction, so two calls at once still seed once.
 */
export function ensureBudgetSetup(db: MasterpieceDB): Promise<void> {
  return guardWrite(() =>
    // `settings` is in the scope because `createRecord` reads the device id from it.
    db.transaction('rw', [db.budgetCategories, db.budgetSettings, db.settings], async () => {
      if ((await db.budgetSettings.where('key').equals(SETTINGS_KEY).count()) > 0) return;
      if ((await db.budgetCategories.count()) === 0) {
        for (const [order, category] of DEFAULT_CATEGORIES.entries()) {
          await createBudgetRecord(db, 'budgetCategories', { ...category, order, hidden: false });
        }
      }
      await createBudgetRecord(db, 'budgetSettings', defaultSettings());
    }),
  );
}

/**
 * The budget settings. There is one record; should two devices each have made one before they first exchanged a
 * backup, the oldest live one is used, so that every device reads the same. Refuses when the budget is not set up.
 */
export async function getBudgetSettings(db: MasterpieceDB): Promise<BudgetSettings> {
  const all = await db.budgetSettings.where('key').equals(SETTINGS_KEY).filter((s) => !s.deleted).toArray();
  all.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (all.length === 0) throw new Error('The budget is not set up yet (see ensureBudgetSetup).');
  return all[0];
}

/** Changes the budget settings. Their key never changes. */
export async function updateBudgetSettings(
  db: MasterpieceDB, patch: Partial<Omit<BudgetFields<'budgetSettings'>, 'key'>>,
): Promise<BudgetSettings> {
  const { id } = await getBudgetSettings(db);
  const { key: _key, ...rest } = patch as Partial<BudgetFields<'budgetSettings'>>;
  return updateBudgetRecord(db, 'budgetSettings', id, rest);
}

/** Adds an expense or income entry. The amount must be whole cents and the date `YYYY-MM-DD`. */
export function addEntry(db: MasterpieceDB, e: BudgetFields<'budgetEntries'>): Promise<BudgetEntry> {
  try {
    assertEntry(e);
  } catch (error) {
    return Promise.reject(error);
  }
  return createBudgetRecord(db, 'budgetEntries', e);
}

/** Changes a live entry. */
export function updateEntry(db: MasterpieceDB, id: string, patch: Partial<BudgetFields<'budgetEntries'>>): Promise<BudgetEntry> {
  try {
    assertEntry(patch);
  } catch (error) {
    return Promise.reject(error);
  }
  return updateBudgetRecord(db, 'budgetEntries', id, patch);
}

/** Undoes an entry: it is deleted as a tombstone (never removed), so the undo reaches other devices too. */
export function undoEntry(db: MasterpieceDB, id: string): Promise<void> {
  return deleteBudgetRecord(db, 'budgetEntries', id);
}

/** The live entries dated in a month, by date. */
export function entriesInMonth(db: MasterpieceDB, ym: Ym): Promise<BudgetEntry[]> {
  return db.budgetEntries.where('date').between(`${ym}-01`, `${addMonths(ym, 1)}-01`, true, false).filter((e) => !e.deleted).toArray();
}

/** The plan of a month, if one was saved for it. */
export function getMonth(db: MasterpieceDB, ym: Ym): Promise<BudgetMonth | undefined> {
  return db.budgetMonths.where('ym').equals(ym).filter((m) => !m.deleted).first();
}
