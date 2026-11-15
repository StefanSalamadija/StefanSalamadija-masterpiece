/* Test helpers: budget records with their record fields filled in. Used by the budget tests only. */
import type { BudgetData } from '../budget/forecast';
import type { MonthPlan } from '../budget/targets';
import type {
  BaseRecord, BudgetAccount, BudgetAsset, BudgetCategory, BudgetCorrection, BudgetDebt, BudgetEntry, BudgetFund, BudgetFundMove, BudgetMonth,
  BudgetRecurring, BudgetSettings,
} from '../domain/types';

let counter = 0;

function base(id?: string, createdAt?: string): Omit<BaseRecord, 'scope'> & { scope: 'personal' } {
  counter += 1;
  const stamp = createdAt ?? `2026-01-01T00:00:${String(counter % 60).padStart(2, '0')}.${String(counter).padStart(3, '0').slice(-3)}Z`;
  return { id: id ?? `rec-${counter}`, createdAt: stamp, updatedAt: stamp, updatedBy: 'test', deleted: false, scope: 'personal' };
}

type Fields<T> = Partial<Omit<T, keyof BaseRecord>> & Partial<BaseRecord>;

export function month(ym: string, fields: Fields<BudgetMonth> = {}): BudgetMonth {
  return { ...base(fields.id), ym, potTargets: {}, categoryTargets: {}, ...fields } as BudgetMonth;
}

/** A month's plan as `effectiveMonth` gives it. */
export function plan(ym: string, fields: Partial<MonthPlan> = {}): MonthPlan {
  return { ym, potTargets: {}, categoryTargets: {}, ...fields };
}

export function category(id: string, pot: BudgetCategory['pot'], fields: Fields<BudgetCategory> = {}): BudgetCategory {
  return { ...base(id), pot, name: id, order: 0, hidden: false, ...fields } as BudgetCategory;
}

export function entry(date: string, amount: number, fields: Fields<BudgetEntry> = {}): BudgetEntry {
  return { ...base(fields.id), kind: 'expense', date, amount, status: 'actual', ...fields } as BudgetEntry;
}

export function fund(fields: Fields<BudgetFund> & { amount: number; dueYm: string }): BudgetFund {
  return { ...base(fields.id ?? 'fund-1', fields.createdAt), name: 'Car registration', startBalance: 0, ...fields } as BudgetFund;
}

/** A fund record; within a month, records are ordered by `createdAt`, so `seq` orders them. */
export function move(fundId: string, ym: string, kind: BudgetFundMove['kind'], amount: number, fields: Fields<BudgetFundMove> & { seq?: number } = {}): BudgetFundMove {
  const { seq, ...rest } = fields;
  const createdAt = `${ym}-01T00:00:${String(seq ?? 0).padStart(2, '0')}.000Z`;
  return { ...base(rest.id, createdAt), fundId, ym, kind, amount, ...rest } as BudgetFundMove;
}

export function recurring(fields: Fields<BudgetRecurring> & { amount: number; startYm: string }): BudgetRecurring {
  return { ...base(fields.id ?? 'rec-tpl'), name: 'Loan instalment', day: 5, ...fields } as BudgetRecurring;
}

export function debt(fields: Fields<BudgetDebt> & { startBalance: number; startYm: string }): BudgetDebt {
  return { ...base(fields.id ?? 'debt-1'), name: 'Car loan', yearlyRatePct: 0, instalment: 0, ...fields } as BudgetDebt;
}

export function asset(id: string, fields: Fields<BudgetAsset> = {}): BudgetAsset {
  return { ...base(id), name: id, includeInNetWorth: true, ...fields } as BudgetAsset;
}

export function correction(account: BudgetAccount, ym: string, balance: number, fields: Fields<BudgetCorrection> = {}): BudgetCorrection {
  return { ...base(fields.id, fields.createdAt), account, ym, balance, ...fields } as BudgetCorrection;
}

/** Budget settings with the defaults of a new budget (see `ensureBudgetSetup`), and a rotation. */
export function settings(fields: Omit<Fields<BudgetSettings>, 'rotation'> & { rotation?: Partial<BudgetSettings['rotation']> } = {}): BudgetSettings {
  const { rotation, ...rest } = fields;
  return {
    ...base('budget-settings'), key: 'budget',
    rotation: { salaryFrom: [], periods: [], patternOn: 8, patternOff: 4, paidNextMonth: false, paidAtHomePct: 0, ...rotation },
    assumptions: { withdrawalRatePct: 4, emergencyMonths: 6, fundReminderDays: 30 },
    favourites: [],
    forecastMethod: { needs: 'targets', savings: 'targets', wants: 'targets', debts: 'targets', emergency: 'targets' },
    horizon: 24,
    ...rest,
  } as BudgetSettings;
}

/** Every budget table, empty unless given. */
export function budgetData(fields: Partial<BudgetData> = {}): BudgetData {
  return {
    budgetCategories: [], budgetEntries: [], budgetMonths: [], budgetRecurring: [], budgetFunds: [], budgetFundMoves: [], budgetDebts: [],
    budgetGoals: [], budgetAssets: [], budgetCorrections: [], budgetScenarios: [], ...fields,
  };
}
