import { DEFAULT_CATEGORIES } from '../budget/catalog';
import { addMonths } from '../budget/months';
import { budgetMoneyOk, entryLinksOk } from '../budget/validate';
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
 * `softDelete`, so records are stamped by this device and never hard-deleted. Money, nested amounts included, is
 * checked to be whole cents before anything is stored. The seeded defaults are the one exception to fresh ids: see
 * `ensureBudgetSetup`.
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
/** The id of the one settings record, the same on every device. */
export const SETTINGS_ID = 'budget-settings';
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Refuses money that is not whole cents, nested amounts included: amounts are never stored as floats. */
function assertCents(fields: object): void {
  if (!budgetMoneyOk(fields as Record<string, unknown>)) throw new Error('A budget amount must be a whole number of cents.');
}

function assertEntry(fields: Partial<BudgetEntry>): void {
  assertCents(fields);
  if (fields.date !== undefined && !DATE.test(fields.date)) throw new Error(`An entry's date must be YYYY-MM-DD, not ${fields.date}.`);
  if (!entryLinksOk(fields as Record<string, unknown>)) throw new Error("An entry's category, fund, debt, asset or template must be an id.");
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

/** `Cafés & restaurants` → `cafes-restaurants`: a category name as a stable piece of an id. */
function slug(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** The id of a default category, the same on every device: `budget-cat:<pot>:<slug of its name>`. */
export function defaultCategoryId(category: { pot: string; name: string }): string {
  return `budget-cat:${category.pot}:${slug(category.name)}`;
}

/**
 * The stamp of a seeded default. It is the same on every device, so two devices that each seed before their first
 * exchange hold byte-identical defaults, which the merge sees as one record (no change, no conflict). Being at the
 * epoch, an untouched default also counts as unchanged since any exchange, so a later edit of it on the other device
 * comes in as an update.
 */
const SEED_STAMP = {
  createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z', updatedBy: 'seed', deleted: false, scope: 'personal' as const,
};

/**
 * Sets the budget up the first time it is opened: the default categories and the default settings, with fixed ids and
 * stamps (see `SEED_STAMP`). Once there is a settings record (made here, or brought by a backup from another device,
 * even one since deleted) it does nothing, so it never brings back a category the user deleted. Categories are seeded
 * only into an empty category table. It runs in one transaction, so two calls at once still seed once.
 */
export function ensureBudgetSetup(db: MasterpieceDB): Promise<void> {
  return guardWrite(() =>
    db.transaction('rw', [db.budgetCategories, db.budgetSettings], async () => {
      if ((await db.budgetSettings.where('key').equals(SETTINGS_KEY).count()) > 0) return;
      if ((await db.budgetCategories.count()) === 0) {
        await db.budgetCategories.bulkAdd(DEFAULT_CATEGORIES.map((category, order) => ({
          ...category, order, hidden: false, id: defaultCategoryId(category), ...SEED_STAMP,
        })));
      }
      await db.budgetSettings.add({ ...defaultSettings(), id: SETTINGS_ID, ...SEED_STAMP });
    }),
  );
}

/**
 * The budget settings: the one record with `SETTINGS_ID`, while it is live; else the oldest other live record with the
 * settings key, so that every device reads the same. Refuses when the budget is not set up.
 */
export async function getBudgetSettings(db: MasterpieceDB): Promise<BudgetSettings> {
  const seeded = await db.budgetSettings.get(SETTINGS_ID);
  if (seeded && !seeded.deleted) return seeded;
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
