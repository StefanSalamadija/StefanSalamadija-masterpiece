import { importWrites, norm } from '../budget/excel/import';
import type { Choice, ImportChoices, SheetMonth } from '../budget/excel/import';
import type { BudgetCategory } from '../domain/types';
import { addEntry, createBudgetRecord, deleteBudgetRecord, listBudget, listCategories, updateBudgetRecord } from './budget';
import type { BudgetFields } from './budget';
import type { MasterpieceDB } from './schema';
import { takeSnapshot } from './snapshots';
import { guardWrite } from './storage';

/** The name of the debt made for STANJA's DUGOVANJA when the user has none. */
export const IMPORTED_DEBT_NAME = 'Loan';

/**
 * Imports the months read from a budget workbook (base §3.9, v2 §3.9.3). A `before-import` snapshot, named after the
 * file, is taken first; then, in one transaction: the new categories the choices ask for (one with the same name in
 * the same pot is used instead), the debt STANJA's balance goes to when a new one was asked for, the months' imported
 * entries replaced, their plans and notes, the balances, and the synonyms learnt. A month after `currentYm` comes in as
 * planned items to confirm (see `importWrites`).
 */
export async function importBudget(
  db: MasterpieceDB, months: SheetMonth[], choices: ImportChoices, fileName: string, currentYm?: string,
): Promise<{ months: number; entries: number }> {
  await takeSnapshot(db, 'before-import', fileName);
  const tables = [db.budgetCategories, db.budgetEntries, db.budgetMonths, db.budgetCorrections, db.budgetDebts, db.settings];
  return guardWrite(() =>
    db.transaction('rw', tables, async () => {
      const categories = await listCategories(db);
      let nextOrder = categories.reduce((max, c) => Math.max(max, c.order), -1) + 1;
      const made = new Map<string, BudgetCategory>();
      const resolve = async (choice: Choice): Promise<Choice> => {
        if ('categoryId' in choice) return choice;
        const { pot, name, group } = choice.newCategory;
        const key = `${pot}|${norm(name)}`;
        const found = made.get(key) ?? categories.find((c) => c.pot === pot && norm(c.name) === norm(name));
        if (found) return { categoryId: found.id };
        const created = await createBudgetRecord(db, 'budgetCategories', { pot, name, ...(group !== undefined && { group }), order: nextOrder++, hidden: false });
        made.set(key, created);
        return { categoryId: created.id };
      };
      const mapping: Record<string, Choice> = {};
      for (const [key, choice] of Object.entries(choices.mapping)) mapping[key] = await resolve(choice);
      const resolved: ImportChoices = { ...choices, mapping, wants: await resolve(choices.wants) };

      if (choices.debtId === 'new') {
        const first = months.find((m) => m.balances.debts !== undefined);
        if (first) {
          const debt = await createBudgetRecord(db, 'budgetDebts', {
            name: IMPORTED_DEBT_NAME, startBalance: first.balances.debts!, yearlyRatePct: 0, instalment: 0, startYm: first.ym,
          });
          resolved.debtId = debt.id;
        } else {
          delete resolved.debtId;
        }
      }

      const all = [...categories, ...made.values()];
      const [entries, budgetMonths, corrections] = await Promise.all([
        listBudget(db, 'budgetEntries'), listBudget(db, 'budgetMonths'), listBudget(db, 'budgetCorrections'),
      ]);
      const w = importWrites({ months, choices: resolved, categories: all, entries, budgetMonths, corrections, currentYm });
      for (const id of w.deleteEntryIds) await deleteBudgetRecord(db, 'budgetEntries', id);
      for (const e of w.entries) await addEntry(db, e);
      for (const m of w.months.create) await createBudgetRecord(db, 'budgetMonths', m);
      for (const m of w.months.update) {
        const patch: Partial<BudgetFields<'budgetMonths'>> = { plannedIncome: m.plannedIncome, potTargets: m.potTargets, categoryTargets: m.categoryTargets, notes: m.notes };
        await updateBudgetRecord(db, 'budgetMonths', m.id, patch);
      }
      for (const c of w.corrections.create) await createBudgetRecord(db, 'budgetCorrections', c);
      for (const u of w.corrections.update) await updateBudgetRecord(db, 'budgetCorrections', u.id, { balance: u.balance });
      for (const s of w.synonyms) await updateBudgetRecord(db, 'budgetCategories', s.categoryId, { synonyms: s.synonyms });
      return { months: months.length, entries: w.entries.length };
    }),
  );
}
