import type { BudgetSettings, Cents, Ym } from '../domain/types';
import { forecast } from './forecast';
import type { BudgetData } from './forecast';
import { addMonths, ymOf } from './months';

/*
 * Each debt's payoff as the plan pays it, for Plan → Debts: read from `forecast()` itself, so the Plan and the
 * Forecast never disagree (the instalment or the template that takes its place, the stored extra, the planned payments
 * on the debt and this month's actual ones). The forecast needs a bank start; a debt's payoff does not depend on the
 * bank, so without one a start of €0 at the end of last month stands in. It looks 10 years ahead, and 60 years when a debt
 * is not paid off by then.
 */

export interface DebtPayoff { debtFreeYm?: Ym; totalInterest: Cents }

const NEAR = 120;
const FAR = 720;

export function debtPayoffs(input: { today: string; data: BudgetData; settings: BudgetSettings; whatIfExtra?: { debtId: string; amount: Cents } }):
  Record<string, DebtPayoff> {
  const cur = ymOf(input.today);
  const hasBank = input.data.budgetCorrections.some((c) => !c.deleted && c.account === 'bank' && c.ym <= cur);
  const data: BudgetData = hasBank ? input.data : {
    ...input.data,
    budgetCorrections: [...input.data.budgetCorrections, {
      id: 'debt-plan:bank-start', createdAt: '', updatedAt: '', updatedBy: '', deleted: false, scope: 'personal', account: 'bank', ym: addMonths(cur, -1), balance: 0,
    }],
  };
  const run = (months: number) => forecast({ today: input.today, data, settings: input.settings, months, whatIfExtra: input.whatIfExtra });
  let r = run(NEAR);
  const live = input.data.budgetDebts.filter((d) => !d.deleted);
  if (live.some((d) => r.debtFree[d.id] === undefined)) r = run(FAR);
  return Object.fromEntries(live.map((d) => [d.id, { ...(r.debtFree[d.id] !== undefined && { debtFreeYm: r.debtFree[d.id] }), totalInterest: r.interestByDebt[d.id] ?? 0 }]));
}
