import { liveQuery } from 'dexie';
import { budgetAlerts } from '../budget/alerts';
import type { BudgetAlert } from '../budget/alerts';
import { getBudgetSettings, listBudget } from './budget';
import type { MasterpieceDB } from './schema';

/*
 * The budget's Home alerts, kept up to date. Home imports this module on demand (it is a chunk of its own), so the
 * budget's code stays out of the main chunk: only the tiny hook in Home is there. A budget never opened (no settings)
 * has nothing to say.
 */

/** Calls `onChange` with the alerts for ship's `today`, and again whenever the budget changes; returns the way to stop. */
export function watchBudgetAlerts(db: MasterpieceDB, today: string, onChange: (alerts: BudgetAlert[]) => void, onError: (e: unknown) => void): () => void {
  const subscription = liveQuery(async () => {
    if ((await db.budgetSettings.filter((s) => !s.deleted).count()) === 0) return [];
    const [settings, budgetCategories, budgetEntries, budgetMonths, budgetRecurring, budgetFunds, budgetFundMoves, budgetGoals, budgetCorrections] = await Promise.all([
      getBudgetSettings(db), listBudget(db, 'budgetCategories'), listBudget(db, 'budgetEntries'), listBudget(db, 'budgetMonths'),
      listBudget(db, 'budgetRecurring'), listBudget(db, 'budgetFunds'), listBudget(db, 'budgetFundMoves'), listBudget(db, 'budgetGoals'),
      listBudget(db, 'budgetCorrections'),
    ]);
    return budgetAlerts({
      settings, today,
      data: { budgetCategories, budgetEntries, budgetMonths, budgetRecurring, budgetFunds, budgetFundMoves, budgetGoals, budgetCorrections,
        budgetDebts: [], budgetAssets: [], budgetScenarios: [] },
    });
  }).subscribe({ next: onChange, error: onError });
  return () => subscription.unsubscribe();
}
