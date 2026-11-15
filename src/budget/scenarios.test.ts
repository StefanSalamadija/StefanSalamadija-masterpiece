import { describe, expect, it } from 'vitest';
import type { BaseRecord, BudgetScenario, BudgetSettings } from '../domain/types';
import { budgetData, category, correction, debt, month, recurring, settings } from '../test/budgetRecords';
import { forecast } from './forecast';
import type { BudgetData, ForecastInput } from './forecast';
import { freedom } from './freedom';
import { SAVINGS_GOALS_CATEGORY_ID } from './ledger';
import { applyToPlan, compareScenarios } from './scenarios';
import type { PlanWrite } from './scenarios';
import type { ScenarioChange } from './scenarioTypes';

const TODAY = '2026-11-15';
const CATEGORIES = [
  category('cat-rent', 'needs', { name: 'Rent / mortgage', order: 0 }), category('cat-other-needs', 'needs', { name: 'Other needs', order: 1 }),
  category('cat-fun', 'wants', { name: 'Shopping', order: 2 }), category('cat-other-wants', 'wants', { name: 'Other wants', order: 3 }),
  category(SAVINGS_GOALS_CATEGORY_ID, 'savings', { name: 'Savings goals', order: 4 }), category('cat-etf', 'savings', { name: 'Index funds', order: 5 }),
  category('cat-em', 'emergency', { name: 'Emergency fund', order: 6 }),
  category('cat-loan', 'debts', { name: 'Loan instalment', order: 7 }), category('cat-extra', 'debts', { name: 'Extra loan payment', order: 8 }),
];
const ROTATION = { salaryFrom: [{ ym: '2026-01', amount: 300000 }], periods: [{ signOn: '2026-05-01', signOff: '2026-12-31' }] };
const LOAN = debt({ id: 'debt-1', name: 'Car loan', startBalance: 1000000, startYm: '2026-01', yearlyRatePct: 6, instalment: 20000 });

function data(fields: Partial<BudgetData> = {}): BudgetData {
  return budgetData({
    budgetCategories: CATEGORIES,
    budgetCorrections: [correction('bank', '2026-10', 500000), correction('investments', '2026-10', 1000000), correction('debt:debt-1', '2026-10', 1000000)],
    budgetMonths: [month('2026-11', { potTargets: { needs: { fromOn: { kind: 'amount', value: 200000 } } } })],
    budgetDebts: [LOAN],
    ...fields,
  });
}
const SETTINGS = settings({ rotation: ROTATION, horizon: 24, assumptions: { withdrawalRatePct: 4, emergencyMonths: 6, fundReminderDays: 30, yearlyReturnPct: 5, inflationPct: 2 } });
const base = (fields: Partial<BudgetData> = {}, s: BudgetSettings = SETTINGS): ForecastInput => ({ today: TODAY, data: data(fields), settings: s });

let n = 0;
function scenario(name: string, changes: ScenarioChange[]): BudgetScenario {
  n += 1;
  return { id: `sc-${n}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'test', deleted: false, scope: 'personal', name, changes };
}
const CAR: ScenarioChange = { kind: 'oneOff', ym: '2027-05', amount: 1800000, label: 'Car', pot: 'needs' };

describe('compareScenarios', () => {
  it('puts the base plan first, then each scenario in order', () => {
    const rows = compareScenarios(base(), [scenario('Car', [CAR]), scenario('Longer contract', [{ kind: 'rotation', patternOn: 10, patternOff: 2 }])]);
    expect(rows.map((r) => r.name)).toEqual(['Base plan', 'Car', 'Longer contract']);
  });

  it('a "Car €18,000 May 2027" one-off lowers the bank from that month on', () => {
    const [b, car] = compareScenarios(base(), [scenario('Car', [CAR])]);
    const at = (rows: typeof b, ym: string) => rows.series.find((m) => m.ym === ym)!;
    expect(at(car, '2027-04').bank).toBe(at(b, '2027-04').bank);
    expect(at(car, '2027-05').bank).toBe(at(b, '2027-05').bank - 1800000);
    expect(at(car, '2030-05').bank).toBe(at(b, '2030-05').bank - 1800000);
    expect(car.netWorth5y).toBe(b.netWorth5y - 1800000);
  });

  it('an extra debt payment brings the debt-free date earlier and lowers the total interest', () => {
    const [b, extra] = compareScenarios(base(), [scenario('Extra', [{ kind: 'extraDebt', debtId: 'debt-1', monthly: 20000, lumpYm: '2027-01', lump: 200000 }])]);
    expect(b.debtFree).toBeDefined();
    expect(extra.debtFree).toBeDefined();
    expect(extra.debtFree! < b.debtFree!).toBe(true);
    expect(extra.totalInterest).toBeLessThan(b.totalInterest);
  });

  it('looks 10 years ahead: net worth after 1, 5 and 10 years, and the lowest bank month', () => {
    const [b] = compareScenarios(base(), []);
    const r = forecast({ ...base(), months: 120 });
    expect(b.series).toHaveLength(120);
    expect(b.netWorth1y).toBe(r.months[11].netWorth);
    expect(b.netWorth5y).toBe(r.months[59].netWorth);
    expect(b.netWorth10y).toBe(r.months[119].netWorth);
    expect(b.totalInterest).toBe(r.totalInterest);
    const lowest = r.months.reduce((lo, m) => (m.bank < lo.bank ? m : lo));
    expect(b.lowest).toEqual({ ym: lowest.ym, amount: lowest.bank });
  });

  it('gives the freedom date at each plan\'s rates when yearly spending is given', () => {
    const rows = compareScenarios(base(), [scenario('Better return', [{ kind: 'rates', yearlyReturnPct: 9 }])], { yearlySpending: 60000 });
    const r = forecast({ ...base(), months: 120 });
    const f = freedom({ forecast: r, yearlySpending: 60000, assumptions: r.assumptions, today: TODAY });
    expect(f.status).toBe('ok');
    expect(f.status === 'ok' && f.ym).toBeTruthy();
    expect(rows[0].freedom).toBe(f.status === 'ok' ? f.ym : undefined);
    expect(rows[1].freedom! < rows[0].freedom!).toBe(true);
    expect(compareScenarios(base(), [])[0].freedom).toBeUndefined();
  });

  it('has no debt-free date while a debt is not paid off within the 10 years', () => {
    const slow = debt({ id: 'debt-2', name: 'Mortgage', startBalance: 50000000, startYm: '2026-01', yearlyRatePct: 3, instalment: 100000 });
    const [b] = compareScenarios(base({ budgetDebts: [LOAN, slow] }), []);
    expect(b.debtFree).toBeUndefined();
  });
});

/** Carries the writes out on a copy of the data and settings, as the db layer would. */
function perform(d: BudgetData, s: BudgetSettings, writes: PlanWrite[]): { data: BudgetData; settings: BudgetSettings } {
  const out: BudgetData = { ...d, budgetMonths: [...d.budgetMonths], budgetRecurring: [...d.budgetRecurring], budgetEntries: [...d.budgetEntries] };
  let st = s;
  let id = 0;
  const stamp = (): BaseRecord => {
    id += 1;
    return { id: `new-${id}`, createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z', updatedBy: 'test', deleted: false, scope: 'personal' };
  };
  for (const w of writes) {
    if (w.table === 'budgetSettings') st = { ...st, ...w.patch };
    else if (w.op === 'create') (out[w.table] as unknown[]).push({ ...w.fields, ...stamp() });
    else {
      const list = out[w.table] as { id: string; deleted: boolean }[];
      const at = list.findIndex((r) => r.id === w.id);
      list[at] = w.op === 'delete' ? { ...list[at], deleted: true } : { ...list[at], ...w.patch };
    }
  }
  return { data: out, settings: st };
}

describe('applyToPlan', () => {
  it('writes rotation, salary and rates into one settings change', () => {
    const s = scenario('Plan', [
      { kind: 'rotation', periods: [{ signOn: '2027-03-01', signOff: '2027-12-31' }], patternOn: 10, patternOff: 2 },
      { kind: 'salary', fromYm: '2027-01', amount: 350000 },
      { kind: 'rates', yearlyReturnPct: 7, withdrawalRatePct: 3.5 },
    ]);
    const { writes, summary } = applyToPlan(data(), SETTINGS, s, TODAY);
    expect(writes).toEqual([{
      op: 'update', table: 'budgetSettings', id: SETTINGS.id,
      patch: {
        rotation: { ...SETTINGS.rotation, periods: [{ signOn: '2027-03-01', signOff: '2027-12-31' }], patternOn: 10, patternOff: 2,
          salaryFrom: [{ ym: '2026-01', amount: 300000 }, { ym: '2027-01', amount: 350000 }] },
        assumptions: { ...SETTINGS.assumptions, yearlyReturnPct: 7, withdrawalRatePct: 3.5 },
      },
    }]);
    expect(summary).toEqual([
      'Rotation: 1 contract period, then 10 months on and 2 off',
      'Salary: €3,500.00 a month from January 2027 on',
      'Assumptions: expected return 7%, withdrawal rate 3.5%',
    ]);
  });

  it('replaces the salary of the same month', () => {
    const { writes } = applyToPlan(data(), SETTINGS, scenario('S', [{ kind: 'salary', fromYm: '2026-01', amount: 320000 }]), TODAY);
    expect(writes[0]).toMatchObject({ patch: { rotation: { salaryFrom: [{ ym: '2026-01', amount: 320000 }] } } });
  });

  it('sets a pot target from its month on, through the plan\'s own setters', () => {
    const s = scenario('Targets', [
      { kind: 'potTarget', pot: 'needs', fromYm: '2026-11', amount: 180000 },
      { kind: 'potTarget', pot: 'wants', fromYm: '2027-02', amount: 50000 },
      { kind: 'potTarget', pot: 'emergency', fromYm: '2027-02', amount: 10000 },
    ]);
    const d = data();
    const { writes, summary } = applyToPlan(d, SETTINGS, s, TODAY);
    expect(writes).toEqual([
      { op: 'update', table: 'budgetMonths', id: d.budgetMonths[0].id, patch: { potTargets: { needs: { fromOn: { kind: 'amount', value: 180000 } } } } },
      { op: 'create', table: 'budgetMonths', fields: { ym: '2027-02', categoryTargets: {}, potTargets: {
        wants: { fromOn: { kind: 'amount', value: 50000 } }, emergency: { fromOn: { kind: 'amount', value: 10000 } } } } },
    ]);
    expect(summary).toEqual([
      'Needs target: €1,800.00 a month from November 2026 on',
      'Wants target: €500.00 a month from February 2027 on',
      'Emergency fund target: €100.00 a month from February 2027 on',
    ]);
  });

  it('changes the investment templates from a month on', () => {
    const tpl = recurring({ id: 'tpl-etf', name: 'ETF', amount: 10000, startYm: '2026-01', categoryId: 'cat-etf', day: 3 });
    const later = recurring({ id: 'tpl-later', name: 'Pension', amount: 5000, startYm: '2027-06', categoryId: 'cat-etf' });
    const goal = recurring({ id: 'tpl-goal', name: 'Holiday', amount: 5000, startYm: '2026-01', categoryId: SAVINGS_GOALS_CATEGORY_ID });
    const done = recurring({ id: 'tpl-done', name: 'Old', amount: 5000, startYm: '2025-01', endYm: '2026-06', categoryId: 'cat-etf' });
    const s = scenario('Invest', [{ kind: 'investment', fromYm: '2027-01', monthly: 25000 }]);
    const { writes, summary } = applyToPlan(data({ budgetRecurring: [tpl, later, goal, done] }), SETTINGS, s, TODAY);
    expect(writes).toEqual([
      { op: 'update', table: 'budgetRecurring', id: 'tpl-etf', patch: { endYm: '2026-12' } },
      { op: 'delete', table: 'budgetRecurring', id: 'tpl-later' },
      { op: 'create', table: 'budgetRecurring', fields: { name: 'ETF', amount: 25000, categoryId: 'cat-etf', day: 3, startYm: '2027-01' } },
    ]);
    expect(summary).toEqual(['Investments: €250.00 a month from January 2027 on (replacing ETF, Pension)']);
  });

  it('creates an investment template when there is none', () => {
    const { writes, summary } = applyToPlan(data(), SETTINGS, scenario('I', [{ kind: 'investment', fromYm: '2027-01', monthly: 25000 }]), TODAY);
    expect(writes).toEqual([{ op: 'create', table: 'budgetRecurring',
      fields: { name: 'Investment contribution', amount: 25000, categoryId: 'cat-etf', day: 1, startYm: '2027-01' } }]);
    expect(summary).toEqual(['Investments: €250.00 a month from January 2027 on']);
  });

  it('makes one-off items planned entries to confirm in their months', () => {
    const s = scenario('Big year', [CAR, { kind: 'oneOff', ym: '2027-03', amount: 200000, income: true, label: 'Bonus' },
      { kind: 'oneOff', ym: '2027-04', amount: 30000, label: 'Sofa' }]);
    const { writes, summary } = applyToPlan(data(), SETTINGS, s, TODAY);
    expect(writes).toEqual([
      { op: 'create', table: 'budgetEntries', fields: { kind: 'expense', date: '2027-05-01', amount: 1800000, categoryId: 'cat-other-needs', note: 'Car', status: 'planned', oneOff: true } },
      { op: 'create', table: 'budgetEntries', fields: { kind: 'income', date: '2027-03-01', amount: 200000, incomeSource: 'other', note: 'Bonus', status: 'planned', oneOff: true } },
      { op: 'create', table: 'budgetEntries', fields: { kind: 'expense', date: '2027-04-01', amount: 30000, note: 'Sofa', status: 'planned', oneOff: true } },
    ]);
    expect(summary).toEqual([
      'Planned purchase in May 2027: Car, €18,000.00',
      'Planned income in March 2027: Bonus, €2,000.00',
      'Planned purchase in April 2027: Sofa, €300.00',
    ]);
  });

  it('makes an extra debt payment a monthly template (with the instalment it would stop) and a planned lump sum', () => {
    const s = scenario('Pay off', [{ kind: 'extraDebt', debtId: 'debt-1', monthly: 10000, lumpYm: '2027-01', lump: 200000 }]);
    const { writes, summary } = applyToPlan(data(), SETTINGS, s, TODAY);
    expect(writes).toEqual([
      { op: 'create', table: 'budgetRecurring', fields: { name: 'Car loan instalment + extra', amount: 30000, categoryId: 'cat-extra', day: 1, startYm: '2026-11', untilDebtId: 'debt-1' } },
      { op: 'create', table: 'budgetEntries', fields: { kind: 'expense', date: '2027-01-01', amount: 200000, categoryId: 'cat-extra', debtId: 'debt-1', note: 'Extra payment: Car loan', status: 'planned', oneOff: true } },
    ]);
    expect(summary).toEqual([
      'Car loan: extra €100.00 a month from November 2026 on (one template with its €200.00 instalment, €300.00 a month)',
      'Car loan: extra payment of €2,000.00 in January 2027',
    ]);
  });

  it('adds only the extra when a template already pays the debt', () => {
    const tpl = recurring({ id: 'tpl-loan', amount: 25000, startYm: '2026-01', categoryId: 'cat-loan', untilDebtId: 'debt-1' });
    const { writes, summary } = applyToPlan(data({ budgetRecurring: [tpl] }), SETTINGS, scenario('E', [{ kind: 'extraDebt', debtId: 'debt-1', monthly: 10000 }]), TODAY);
    expect(writes).toEqual([
      { op: 'create', table: 'budgetRecurring', fields: { name: 'Car loan extra payment', amount: 10000, categoryId: 'cat-extra', day: 1, startYm: '2026-11', untilDebtId: 'debt-1' } },
    ]);
    expect(summary).toEqual(['Car loan: extra €100.00 a month from November 2026 on']);
  });

  it('leaves out an extra payment to a debt that no longer exists', () => {
    const { writes, summary } = applyToPlan(data(), SETTINGS, scenario('E', [{ kind: 'extraDebt', debtId: 'gone', monthly: 10000 }]), TODAY);
    expect(writes).toEqual([]);
    expect(summary).toEqual(['Extra debt payment: the debt no longer exists, left out']);
  });

  it('once applied, the base plan forecasts what the scenario did', () => {
    const changes: ScenarioChange[] = [
      { kind: 'rotation', patternOn: 9, patternOff: 3 },
      { kind: 'salary', fromYm: '2027-02', amount: 330000 },
      { kind: 'rates', yearlyReturnPct: 6 },
      { kind: 'potTarget', pot: 'needs', fromYm: '2027-03', amount: 170000 },
      { kind: 'investment', fromYm: '2027-01', monthly: 25000 },
      CAR,
      { kind: 'oneOff', ym: '2027-08', amount: 150000, income: true, label: 'Bonus' },
      { kind: 'extraDebt', debtId: 'debt-1', monthly: 15000, lumpYm: '2027-06', lump: 100000 },
    ];
    const d = data({ budgetRecurring: [recurring({ id: 'tpl-etf', name: 'ETF', amount: 10000, startYm: '2026-01', categoryId: 'cat-etf' })] });
    const scenarioRun = forecast({ today: TODAY, data: d, settings: SETTINGS, overrides: changes, months: 60 });
    const applied = perform(d, SETTINGS, applyToPlan(d, SETTINGS, scenario('All', changes), TODAY).writes);
    const appliedRun = forecast({ today: TODAY, data: applied.data, settings: applied.settings, months: 60 });
    const pick = (r: typeof scenarioRun) => r.months.map((m) => [m.ym, m.income, m.spending, m.bank, m.investments, m.debts]);
    expect(pick(appliedRun)).toEqual(pick(scenarioRun));
    expect(appliedRun.totalInterest).toBe(scenarioRun.totalInterest);
  });
});
