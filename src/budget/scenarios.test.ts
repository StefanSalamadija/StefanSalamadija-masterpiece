import { describe, expect, it } from 'vitest';
import type { BaseRecord, BudgetScenario, BudgetSettings } from '../domain/types';
import { budgetData, category, correction, debt, entry, month, recurring, settings } from '../test/budgetRecords';
import { forecast } from './forecast';
import type { BudgetData, ForecastResult } from './forecast';
import { freedom } from './freedom';
import { SAVINGS_GOALS_CATEGORY_ID } from './ledger';
import { addMonths } from './months';
import { applyToPlan, compareScenarios } from './scenarios';
import type { CompareRow, PlanWrite } from './scenarios';
import type { ScenarioChange } from './scenarioTypes';

const TODAY = '2026-11-15';
const CATEGORIES = [
  category('cat-rent', 'needs', { name: 'Rent / mortgage', order: 0 }), category('cat-groc', 'needs', { name: 'Groceries', order: 1 }),
  category('cat-other-needs', 'needs', { name: 'Other needs', order: 2 }),
  category('cat-fun', 'wants', { name: 'Shopping', order: 3 }), category('cat-other-wants', 'wants', { name: 'Other wants', order: 4 }),
  category(SAVINGS_GOALS_CATEGORY_ID, 'savings', { name: 'Savings goals', order: 5 }), category('cat-etf', 'savings', { name: 'Index funds', order: 6 }),
  category('cat-em', 'emergency', { name: 'Emergency fund', order: 7 }),
  category('cat-loan', 'debts', { name: 'Loan instalment', order: 8 }), category('cat-extra', 'debts', { name: 'Extra loan payment', order: 9 }),
];
const ROTATION = { salaryFrom: [{ ym: '2026-01', amount: 300000 }], periods: [{ signOn: '2026-05-01', signOff: '2026-12-31' }] };
const LOAN = debt({ id: 'debt-1', name: 'Car loan', startBalance: 1000000, startYm: '2026-01', yearlyRatePct: 6, instalment: 20000 });
const NEEDS = month('2026-11', { id: 'm-2026-11', potTargets: { needs: { fromOn: { kind: 'amount', value: 200000 } } } });
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;

function data(fields: Partial<BudgetData> = {}): BudgetData {
  return budgetData({
    budgetCategories: CATEGORIES,
    budgetCorrections: [correction('bank', '2026-10', 500000), correction('investments', '2026-10', 1000000), correction('debt:debt-1', '2026-10', 1000000)],
    budgetMonths: [NEEDS],
    budgetDebts: [LOAN],
    ...fields,
  });
}
const ASSUMPTIONS = { withdrawalRatePct: 4, emergencyMonths: 6, fundReminderDays: 30, yearlyReturnPct: 5, inflationPct: 2 };
const SETTINGS = settings({ rotation: ROTATION, horizon: 24, assumptions: ASSUMPTIONS });
const SPENDING = 60000;
const input = (d: BudgetData = data(), s: BudgetSettings = SETTINGS) => ({ today: TODAY, data: d, settings: s, yearlySpending: SPENDING });

let n = 0;
function scenario(name: string, changes: ScenarioChange[]): BudgetScenario {
  n += 1;
  return { id: `sc-${n}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'test', deleted: false, scope: 'personal', name, changes };
}
const CAR: ScenarioChange = { kind: 'oneOff', ym: '2027-05', amount: 1800000, label: 'Car', pot: 'needs' };

/** Carries the writes out on a copy of the data and settings, as the db layer would (written apart from `planWith`). */
function perform(d: BudgetData, s: BudgetSettings, writes: PlanWrite[]): { data: BudgetData; settings: BudgetSettings } {
  const out: BudgetData = {
    ...d, budgetMonths: [...d.budgetMonths], budgetRecurring: [...d.budgetRecurring], budgetEntries: [...d.budgetEntries], budgetDebts: [...d.budgetDebts],
  };
  let st = s;
  let id = 0;
  const stamp = (): BaseRecord => {
    id += 1;
    return { id: `db-${id}`, createdAt: '2026-11-15T10:00:00.000Z', updatedAt: '2026-11-15T10:00:00.000Z', updatedBy: 'device', deleted: false, scope: 'personal' };
  };
  for (const w of writes) {
    if (w.table === 'budgetSettings') st = { ...st, ...w.patch };
    else if (w.op === 'create') (out[w.table] as unknown[]).push({ ...w.fields, ...stamp(), ...('id' in w && w.id !== undefined && { id: w.id }) });
    else {
      const list = out[w.table] as { id: string; deleted: boolean }[];
      const at = list.findIndex((r) => r.id === w.id);
      expect(at, `${w.table} ${w.id}`).toBeGreaterThanOrEqual(0);
      list[at] = w.op === 'delete' ? { ...list[at], deleted: true } : { ...list[at], ...w.patch };
    }
  }
  return { data: out, settings: st };
}

/**
 * Compares a scenario, applies it to the plan, and checks that the plan after Apply forecasts exactly the scenario's
 * Compare row. Returns the row, and the forecasts of the plan before and after Apply.
 */
function roundTrip(d: BudgetData, s: BudgetSettings, changes: ScenarioChange[]): { row: CompareRow; applied: ForecastResult; base: ForecastResult } {
  const sc = scenario('What if', changes);
  const [, row] = compareScenarios(input(d, s), [sc]);
  const after = perform(d, s, applyToPlan(d, s, sc, TODAY).writes);
  const [afterRow] = compareScenarios(input(after.data, after.settings), []);
  expect({ ...afterRow, name: 'What if' }).toEqual(row);
  return { row, applied: forecast({ today: TODAY, ...after, months: 120 }), base: forecast({ today: TODAY, data: d, settings: s, months: 120 }) };
}
const from = (r: ForecastResult, ym: string, count: number) => r.months.filter((m) => m.ym >= ym).slice(0, count);
/** What the month paid its debts (no emergency fund moves in these plans). */
const debtPaid = (m: ForecastResult['months'][number]) => m.transfers - m.contribution;

describe('compareScenarios', () => {
  it('puts the base plan first, then each scenario in order', () => {
    const rows = compareScenarios(input(), [scenario('Car', [CAR]), scenario('Longer contract', [{ kind: 'rotation', patternOn: 10, patternOff: 2 }])]);
    expect(rows.map((r) => r.name)).toEqual(['Base plan', 'Car', 'Longer contract']);
  });

  it('a "Car €18,000 May 2027" one-off lowers the bank from that month on', () => {
    const [b, car] = compareScenarios(input(), [scenario('Car', [CAR])]);
    const at = (row: CompareRow, ym: string) => row.series.find((m) => m.ym === ym)!;
    expect(at(car, '2027-04').bank).toBe(at(b, '2027-04').bank);
    expect(at(car, '2027-05').bank).toBe(at(b, '2027-05').bank - 1800000);
    expect(at(car, '2030-05').bank).toBe(at(b, '2030-05').bank - 1800000);
    expect(car.netWorth5y).toBe(b.netWorth5y - 1800000);
  });

  it('an extra debt payment brings the debt-free date earlier and lowers the total interest', () => {
    const [b, extra] = compareScenarios(input(), [scenario('Extra', [{ kind: 'extraDebt', debtId: 'debt-1', monthly: 20000, lumpYm: '2027-01', lump: 200000 }])]);
    expect(b.debtFree).toBeDefined();
    expect(extra.debtFree! < b.debtFree!).toBe(true);
    expect(extra.totalInterest).toBeLessThan(b.totalInterest);
  });

  it('a salary change and a longer contract change the income', () => {
    const { applied } = roundTrip(data(), SETTINGS, [{ kind: 'salary', fromYm: '2026-12', amount: 400000 }, { kind: 'rotation', patternOn: 10, patternOff: 2 }]);
    expect(applied.months.slice(0, 2).map((m) => m.income)).toEqual([300000, 400000]);
    expect(applied.months.slice(2, 5).map((m) => m.status)).toEqual(['home', 'home', 'onboard']);
  });

  it('rates change the return the investments grow by', () => {
    const { applied } = roundTrip(data(), SETTINGS, [{ kind: 'rates', yearlyReturnPct: 12 }]);
    expect(applied.months[0].investments).toBe(Math.round(1000000 * 1.12 ** (1 / 12)));
    expect(applied.assumptions.yearlyReturnPct).toBe(12);
  });

  it('looks 10 years ahead: net worth after 1, 5 and 10 years, and the lowest bank month', () => {
    const [b] = compareScenarios(input(), []);
    const r = forecast({ today: TODAY, data: data(), settings: SETTINGS, months: 120 });
    expect(b.series).toHaveLength(120);
    expect(b.netWorth1y).toBe(r.months[11].netWorth);
    expect(b.netWorth5y).toBe(r.months[59].netWorth);
    expect(b.netWorth10y).toBe(r.months[119].netWorth);
    expect(b.totalInterest).toBe(r.totalInterest);
    const lowest = r.months.reduce((lo, m) => (m.bank < lo.bank ? m : lo));
    expect(b.lowest).toEqual({ ym: lowest.ym, amount: lowest.bank });
  });

  it('gives the freedom date at each plan\'s rates, from the yearly spending it is given', () => {
    const rows = compareScenarios(input(), [scenario('Better return', [{ kind: 'rates', yearlyReturnPct: 9 }])]);
    const r = forecast({ today: TODAY, data: data(), settings: SETTINGS, months: 120 });
    const f = freedom({ forecast: r, yearlySpending: SPENDING, assumptions: r.assumptions, today: TODAY });
    expect(f.status === 'ok' && f.ym).toBeTruthy();
    expect(rows[0].freedom).toBe(f.status === 'ok' ? f.ym : undefined);
    expect(rows[1].freedom! < rows[0].freedom!).toBe(true);
    // Without an expected return there is no freedom date.
    const { yearlyReturnPct: _r, ...noReturn } = ASSUMPTIONS;
    expect(compareScenarios(input(data(), { ...SETTINGS, assumptions: noReturn }), [])[0].freedom).toBeUndefined();
  });

  it('has no debt-free date while a debt is not paid off within the 10 years', () => {
    const slow = debt({ id: 'debt-2', name: 'Mortgage', startBalance: 50000000, startYm: '2026-01', yearlyRatePct: 3, instalment: 100000 });
    const [b] = compareScenarios(input(data({ budgetDebts: [LOAN, slow] })), []);
    expect(b.debtFree).toBeUndefined();
  });

  it('changes nothing stored', () => {
    const d = data();
    const before = JSON.stringify(d);
    compareScenarios(input(d), [scenario('All', [CAR, { kind: 'potTarget', pot: 'needs', fromYm: '2027-01', amount: 1 }, { kind: 'extraDebt', debtId: 'debt-1', monthly: 5000 }])]);
    expect(JSON.stringify(d)).toBe(before);
  });

  it('compares the base and 4 scenarios quickly', () => {
    const history = Array.from({ length: 24 * 40 }, (_, k) =>
      entry(`${addMonths('2024-11', Math.floor(k / 40))}-${String((k % 28) + 1).padStart(2, '0')}`, 1000 + ((k * 7919) % 90000), { categoryId: CATEGORIES[k % CATEGORIES.length].id }));
    const d = data({ budgetEntries: history });
    const scenarios = [scenario('Car', [CAR]), scenario('Contract', [{ kind: 'rotation', patternOn: 10, patternOff: 2 }]),
      scenario('Invest', [{ kind: 'investment', fromYm: '2027-01', monthly: 50000 }]), scenario('Pay off', [{ kind: 'extraDebt', debtId: 'debt-1', monthly: 20000 }])];
    compareScenarios(input(d), scenarios);
    const started = performance.now();
    compareScenarios(input(d), scenarios);
    const ms = performance.now() - started;
    console.log(`compareScenarios: base + 4 scenarios × 120 months in ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(250);
  });
});

describe('applyToPlan: what it writes', () => {
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
    const { writes, summary } = applyToPlan(data(), SETTINGS, s, TODAY);
    expect(writes).toEqual([
      { op: 'update', table: 'budgetMonths', id: 'm-2026-11', patch: { potTargets: { needs: { fromOn: { kind: 'amount', value: 180000 } } }, categoryTargets: {} } },
      { op: 'create', table: 'budgetMonths', fields: { ym: '2027-02', categoryTargets: {}, potTargets: {
        wants: { fromOn: { kind: 'amount', value: 50000 } }, emergency: { fromOn: { kind: 'amount', value: 10000 } } } } },
    ]);
    expect(summary).toEqual([
      'Needs target: €1,800.00 a month from November 2026 on',
      'Wants target: €500.00 a month from February 2027 on',
      'Emergency fund target: €100.00 a month from February 2027 on',
    ]);
  });

  it('clears the pot\'s category targets and later edits, and plans the pot by its targets', () => {
    const months = [
      month('2026-11', { id: 'm-1', potTargets: { needs: { fromOn: { kind: 'amount', value: 200000 } } }, categoryTargets: { 'cat-rent': { fromOn: 100000 }, 'cat-fun': { fromOn: 20000 } } }),
      month('2027-03', { id: 'm-2', categoryTargets: { 'cat-groc': { thisOnly: 70000 } } }),
      month('2027-06', { id: 'm-3', potTargets: { needs: { fromOn: { kind: 'amount', value: 250000 } }, wants: { fromOn: { kind: 'amount', value: 9000 } } } }),
    ];
    const history = ['2026-08', '2026-09', '2026-10'].map((ym) => entry(`${ym}-05`, 90000, { categoryId: 'cat-rent' }));
    const s = scenario('Cut', [{ kind: 'potTarget', pot: 'needs', fromYm: '2027-01', amount: 150000 }]);
    const { writes, summary } = applyToPlan(data({ budgetMonths: months, budgetEntries: history }), { ...SETTINGS, forecastMethod: { ...SETTINGS.forecastMethod, needs: 'average' } }, s, TODAY);
    expect(writes).toEqual([
      { op: 'update', table: 'budgetSettings', id: SETTINGS.id, patch: { forecastMethod: { ...SETTINGS.forecastMethod, needs: 'targets' } } },
      // November and December keep what the average planned (€900 of rent a month), now as a target.
      { op: 'update', table: 'budgetMonths', id: 'm-1', patch: { potTargets: { needs: { fromOn: { kind: 'amount', value: 90000 } } },
        categoryTargets: { 'cat-rent': { fromOn: null }, 'cat-fun': { fromOn: 20000 } } } },
      { op: 'update', table: 'budgetMonths', id: 'm-2', patch: { potTargets: {}, categoryTargets: {} } },
      { op: 'update', table: 'budgetMonths', id: 'm-3', patch: { potTargets: { wants: { fromOn: { kind: 'amount', value: 9000 } } }, categoryTargets: {} } },
      { op: 'create', table: 'budgetMonths', fields: { ym: '2027-01', potTargets: { needs: { fromOn: { kind: 'amount', value: 150000 } } }, categoryTargets: {} } },
    ]);
    expect(summary).toEqual([
      'Needs target: €1,500.00 a month from January 2027 on',
      'Needs: category targets removed from November 2026 on (Rent / mortgage)',
      'Needs: later target changes removed (March 2027, June 2027)',
      'Needs: planned by its targets in every month (was the average of past months)',
      'Needs: €900.00 a month until December 2026, what the average of past months planned',
    ]);
  });

  it('changes the investment templates and the Savings target from a month on', () => {
    const tpl = recurring({ id: 'tpl-etf', name: 'ETF', amount: 10000, startYm: '2026-01', categoryId: 'cat-etf', day: 3 });
    const later = recurring({ id: 'tpl-later', name: 'Pension', amount: 5000, startYm: '2027-06', categoryId: 'cat-etf' });
    const goal = recurring({ id: 'tpl-goal', name: 'Holiday', amount: 5000, startYm: '2026-01', categoryId: SAVINGS_GOALS_CATEGORY_ID });
    const done = recurring({ id: 'tpl-done', name: 'Old', amount: 5000, startYm: '2025-01', endYm: '2026-06', categoryId: 'cat-etf' });
    const s = scenario('Invest', [{ kind: 'investment', fromYm: '2027-01', monthly: 25000 }]);
    const { writes, summary } = applyToPlan(data({ budgetRecurring: [tpl, later, goal, done] }), SETTINGS, s, TODAY);
    expect(writes).toEqual([
      { op: 'create', table: 'budgetMonths', fields: { ym: '2027-01', categoryTargets: {}, potTargets: { savings: { fromOn: { kind: 'amount', value: 25000 } } } } },
      { op: 'update', table: 'budgetRecurring', id: 'tpl-etf', patch: { endYm: '2026-12' } },
      { op: 'delete', table: 'budgetRecurring', id: 'tpl-later' },
      { op: 'create', table: 'budgetRecurring', fields: { name: 'ETF', amount: 25000, categoryId: 'cat-etf', day: 3, startYm: '2027-01' } },
    ]);
    expect(summary).toEqual([
      'Investments: €250.00 a month from January 2027 on (replacing ETF, Pension)',
      'Savings & investments target: €250.00 a month from January 2027 on',
    ]);
  });

  it('creates an investment template when there is none', () => {
    const { writes, summary } = applyToPlan(data(), SETTINGS, scenario('I', [{ kind: 'investment', fromYm: '2027-01', monthly: 25000 }]), TODAY);
    expect(writes).toContainEqual({ op: 'create', table: 'budgetRecurring',
      fields: { name: 'Investment contribution', amount: 25000, categoryId: 'cat-etf', day: 1, startYm: '2027-01' } });
    expect(summary[0]).toBe('Investments: €250.00 a month from January 2027 on');
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

  it('stores a monthly extra on the debt, from now until it is paid off, and makes the lump sum a planned payment', () => {
    const s = scenario('Pay off', [{ kind: 'extraDebt', debtId: 'debt-1', monthly: 10000, lumpYm: '2027-01', lump: 200000 }]);
    const { writes, summary } = applyToPlan(data(), SETTINGS, s, TODAY);
    const [, row] = compareScenarios(input(), [s]);
    expect(writes).toEqual([
      { op: 'create', table: 'budgetEntries', id: `scenario:${s.id}:0:2027-01`,
        fields: { kind: 'expense', date: '2027-01-01', amount: 200000, categoryId: 'cat-extra', debtId: 'debt-1', note: 'Extra payment: Car loan', status: 'planned', oneOff: true } },
      { op: 'update', table: 'budgetDebts', id: 'debt-1', patch: { extraMonthly: 10000, extraFromYm: '2026-11' } },
    ]);
    expect(summary).toEqual([
      `Car loan: extra €100.00 a month from November 2026 until it is paid off in ${monthName(row.debtFree!)}`,
      'Car loan: extra payment of €2,000.00 in January 2027',
    ]);
  });

  it('adds a monthly extra to the one the debt already has', () => {
    const d = data({ budgetDebts: [{ ...LOAN, extraMonthly: 5000, extraFromYm: '2026-01' }] });
    const { writes } = applyToPlan(d, SETTINGS, scenario('More', [{ kind: 'extraDebt', debtId: 'debt-1', monthly: 10000 }]), TODAY);
    expect(writes).toEqual([{ op: 'update', table: 'budgetDebts', id: 'debt-1', patch: { extraMonthly: 15000, extraFromYm: '2026-01' } }]);
    roundTrip(d, SETTINGS, [{ kind: 'extraDebt', debtId: 'debt-1', monthly: 10000 }]);
  });

  it('leaves out an extra payment to a debt that no longer exists', () => {
    const { writes, summary } = applyToPlan(data(), SETTINGS, scenario('E', [{ kind: 'extraDebt', debtId: 'gone', monthly: 10000 }]), TODAY);
    expect(writes).toEqual([]);
    expect(summary).toEqual(['Extra debt payment: the debt no longer exists, left out']);
  });

  it('leaves out an extra payment to a debt already paid off', () => {
    const paid = data({ budgetCorrections: [correction('bank', '2026-10', 500000), correction('debt:debt-1', '2026-10', 0)] });
    const { writes, summary } = applyToPlan(paid, SETTINGS, scenario('E', [{ kind: 'extraDebt', debtId: 'debt-1', monthly: 10000 }]), TODAY);
    expect(writes).toEqual([]);
    expect(summary).toEqual(['Car loan: extra €100.00 a month left out, the debt is paid off before it starts']);
  });
});

describe('applyToPlan: the plan after Apply is what Compare showed', () => {
  it('a scenario with every kind of change', () => {
    const changes: ScenarioChange[] = [
      { kind: 'rotation', patternOn: 9, patternOff: 3 }, { kind: 'salary', fromYm: '2027-02', amount: 330000 }, { kind: 'rates', yearlyReturnPct: 6 },
      { kind: 'potTarget', pot: 'needs', fromYm: '2027-03', amount: 170000 }, { kind: 'investment', fromYm: '2027-01', monthly: 25000 },
      CAR, { kind: 'oneOff', ym: '2027-08', amount: 150000, income: true, label: 'Bonus' },
      { kind: 'extraDebt', debtId: 'debt-1', monthly: 15000, lumpYm: '2027-06', lump: 100000 },
    ];
    roundTrip(data({ budgetRecurring: [recurring({ id: 'tpl-etf', name: 'ETF', amount: 10000, startYm: '2026-01', categoryId: 'cat-etf' })] }), SETTINGS, changes);
  });

  it('an investment change with a Savings target and a category target: Savings contributes exactly the new amount', () => {
    const months = [month('2026-11', { id: 'm-1', potTargets: { needs: { fromOn: { kind: 'amount', value: 200000 } }, savings: { fromOn: { kind: 'amount', value: 50000 } } },
      categoryTargets: { 'cat-etf': { fromOn: 30000 } } })];
    const d = data({ budgetMonths: months, budgetRecurring: [recurring({ id: 'tpl-etf', name: 'ETF', amount: 10000, startYm: '2026-01', categoryId: 'cat-etf' })] });
    const { applied, base } = roundTrip(d, SETTINGS, [{ kind: 'investment', fromYm: '2027-01', monthly: 25000 }]);
    expect(base.months.slice(0, 4).map((m) => m.contribution)).toEqual([50000, 50000, 50000, 50000]);
    expect(applied.months.slice(0, 4).map((m) => m.contribution)).toEqual([50000, 50000, 25000, 25000]);
    expect(from(applied, '2027-01', 24).every((m) => m.contribution === 25000)).toBe(true);
  });

  it('an investment change keeps a planned Savings entry made by hand', () => {
    const d = data({ budgetEntries: [entry('2027-02-10', 7000, { categoryId: 'cat-etf', status: 'planned' })] });
    const { applied } = roundTrip(d, SETTINGS, [{ kind: 'investment', fromYm: '2027-01', monthly: 25000 }]);
    expect(applied.months.slice(2, 5).map((m) => m.contribution)).toEqual([25000, 32000, 25000]);
  });

  it('an investment change with Savings planned by a fixed amount', () => {
    const s = { ...SETTINGS, forecastMethod: { ...SETTINGS.forecastMethod, savings: 'fixed' as const }, fixedSpend: { savings: 40000 } };
    const { applied, base } = roundTrip(data(), s, [{ kind: 'investment', fromYm: '2027-01', monthly: 25000 }]);
    expect(base.months.slice(0, 2).map((m) => m.contribution)).toEqual([40000, 40000]);
    expect(applied.months.slice(0, 2)).toEqual(base.months.slice(0, 2));
    expect(from(applied, '2027-01', 12).every((m) => m.contribution === 25000)).toBe(true);
  });

  it('a pot target below its category targets: the pot is planned at the new amount', () => {
    const months = [month('2026-11', { id: 'm-1', potTargets: { needs: { fromOn: { kind: 'amount', value: 200000 } } },
      categoryTargets: { 'cat-rent': { fromOn: 100000 }, 'cat-groc': { fromOn: 60000 } } })];
    const { applied, base } = roundTrip(data({ budgetMonths: months }), SETTINGS, [{ kind: 'potTarget', pot: 'needs', fromYm: '2027-01', amount: 150000 }]);
    expect(base.months.slice(0, 4).map((m) => m.needs)).toEqual([200000, 200000, 200000, 200000]);
    expect(applied.months.slice(0, 4).map((m) => m.needs)).toEqual([200000, 200000, 150000, 150000]);
  });

  it('a pot target with later months\' own edits: the new amount holds for every later month', () => {
    const months = [NEEDS, month('2027-06', { id: 'm-6', potTargets: { needs: { fromOn: { kind: 'amount', value: 250000 } } } }),
      month('2027-09', { id: 'm-9', categoryTargets: { 'cat-groc': { fromOn: 190000 } } })];
    const { applied } = roundTrip(data({ budgetMonths: months }), SETTINGS, [{ kind: 'potTarget', pot: 'needs', fromYm: '2027-01', amount: 180000 }]);
    expect(from(applied, '2027-01', 36).every((m) => m.needs === 180000)).toBe(true);
  });

  it('a pot target on a pot planned by the average', () => {
    const history = ['2026-08', '2026-09', '2026-10'].map((ym) => entry(`${ym}-05`, 90000, { categoryId: 'cat-fun' }));
    const s = { ...SETTINGS, forecastMethod: { ...SETTINGS.forecastMethod, wants: 'average' as const } };
    const wants = (m: ForecastResult['months'][number]) => m.spending - m.needs - m.transfers;
    const { applied, base } = roundTrip(data({ budgetEntries: history }), s, [{ kind: 'potTarget', pot: 'wants', fromYm: '2027-01', amount: 50000 }]);
    expect(base.months.slice(0, 4).map(wants)).toEqual([90000, 90000, 90000, 90000]);
    // Before its month the scenario changes nothing.
    expect(applied.months.slice(0, 2)).toEqual(base.months.slice(0, 2));
    expect(from(applied, '2027-01', 12).every((m) => wants(m) === 50000)).toBe(true);
  });

  it('a pot target on a pot planned by a fixed amount', () => {
    // The stored Needs target (€2,000) is not what the fixed amount (€1,200) planned before the change.
    const s = { ...SETTINGS, forecastMethod: { ...SETTINGS.forecastMethod, needs: 'fixed' as const }, fixedSpend: { needs: 120000 } };
    const { applied, base } = roundTrip(data(), s, [{ kind: 'potTarget', pot: 'needs', fromYm: '2027-03', amount: 150000 }]);
    expect(base.months.slice(0, 4).map((m) => m.needs)).toEqual([120000, 120000, 120000, 120000]);
    expect(applied.months.slice(0, 4)).toEqual(base.months.slice(0, 4));
    expect(from(applied, '2027-03', 12).every((m) => m.needs === 150000)).toBe(true);
  });

  it('a pot target on a fixed pot with templates, a fund and spending this month: the months before it are unchanged', () => {
    const tpl = recurring({ id: 'tpl-gym', name: 'Gym', amount: 4000, startYm: '2026-01', endYm: '2026-12', categoryId: 'cat-fun' });
    const spent = entry('2026-11-03', 70000, { categoryId: 'cat-fun' });
    const s = { ...SETTINGS, forecastMethod: { ...SETTINGS.forecastMethod, wants: 'fixed' as const }, fixedSpend: { wants: 30000 } };
    const { applied, base, row } = roundTrip(data({ budgetRecurring: [tpl], budgetEntries: [spent] }), s, [{ kind: 'potTarget', pot: 'wants', fromYm: '2027-04', amount: 20000 }]);
    expect(applied.months.slice(0, 5)).toEqual(base.months.slice(0, 5));
    expect(from(applied, '2027-04', 6).every((m) => m.pots.wants === 20000)).toBe(true);
    expect(row.series.slice(0, 5).map((m) => m.bank)).toEqual(base.months.slice(0, 5).map((m) => m.bank));
  });

  it('an extra debt payment with a Debts target pays the instalment and the extra', () => {
    const months = [month('2026-11', { id: 'm-1', potTargets: { needs: { fromOn: { kind: 'amount', value: 200000 } }, debts: { fromOn: { kind: 'amount', value: 50000 } } } })];
    const { applied, base } = roundTrip(data({ budgetMonths: months }), SETTINGS, [{ kind: 'extraDebt', debtId: 'debt-1', monthly: 10000 }]);
    expect(base.months.slice(0, 6).map(debtPaid)).toEqual([50000, 50000, 50000, 50000, 50000, 50000]);
    expect(applied.months.slice(0, 6).map(debtPaid)).toEqual([60000, 60000, 60000, 60000, 60000, 60000]);
  });

  it('an extra debt payment with a Debts category target', () => {
    const months = [month('2026-11', { id: 'm-1', potTargets: { needs: { fromOn: { kind: 'amount', value: 200000 } } }, categoryTargets: { 'cat-loan': { fromOn: 30000 } } })];
    const { applied, base } = roundTrip(data({ budgetMonths: months }), SETTINGS, [{ kind: 'extraDebt', debtId: 'debt-1', monthly: 10000 }]);
    expect(base.months.slice(0, 6).map(debtPaid)).toEqual([30000, 30000, 30000, 30000, 30000, 30000]);
    expect(applied.months.slice(0, 6).map(debtPaid)).toEqual([40000, 40000, 40000, 40000, 40000, 40000]);
  });

  it('an extra debt payment with the Debts pot planned by a fixed amount', () => {
    const s = { ...SETTINGS, forecastMethod: { ...SETTINGS.forecastMethod, debts: 'fixed' as const }, fixedSpend: { debts: 50000 } };
    const { applied, base } = roundTrip(data(), s, [{ kind: 'extraDebt', debtId: 'debt-1', monthly: 10000 }]);
    expect(base.months.slice(0, 6).map(debtPaid)).toEqual([50000, 50000, 50000, 50000, 50000, 50000]);
    expect(applied.months.slice(0, 6).map(debtPaid)).toEqual([60000, 60000, 60000, 60000, 60000, 60000]);
  });

  it('an extra debt payment with the Debts pot planned by the average', () => {
    const history = ['2026-08', '2026-09', '2026-10'].map((ym) => entry(`${ym}-05`, 20000, { categoryId: 'cat-loan', debtId: 'debt-1' }));
    const s = { ...SETTINGS, forecastMethod: { ...SETTINGS.forecastMethod, debts: 'average' as const } };
    const { applied, base } = roundTrip(data({ budgetEntries: history }), s, [{ kind: 'extraDebt', debtId: 'debt-1', monthly: 10000 }]);
    expect(applied.months.slice(0, 6).map(debtPaid)).toEqual(base.months.slice(0, 6).map((m) => debtPaid(m) + 10000));
  });

  it('an extra debt payment alongside a template that pays the debt', () => {
    const tpl = recurring({ id: 'tpl-loan', amount: 25000, startYm: '2026-01', categoryId: 'cat-loan', untilDebtId: 'debt-1' });
    const { applied, base } = roundTrip(data({ budgetRecurring: [tpl] }), SETTINGS, [{ kind: 'extraDebt', debtId: 'debt-1', monthly: 10000 }]);
    expect(base.months.slice(0, 6).map(debtPaid)).toEqual([25000, 25000, 25000, 25000, 25000, 25000]);
    expect(applied.months.slice(0, 6).map(debtPaid)).toEqual([35000, 35000, 35000, 35000, 35000, 35000]);
    // A template that ends, and another that starts later: the instalment is never lost nor paid twice.
    const later = recurring({ id: 'tpl-later', amount: 30000, startYm: '2027-04', categoryId: 'cat-loan', untilDebtId: 'debt-1' });
    const r = roundTrip(data({ budgetRecurring: [{ ...tpl, endYm: '2027-01' }, later] }), SETTINGS, [{ kind: 'extraDebt', debtId: 'debt-1', monthly: 10000 }]);
    expect(r.base.months.slice(0, 8).map(debtPaid)).toEqual([25000, 25000, 25000, 20000, 20000, 30000, 30000, 30000]);
    expect(r.applied.months.slice(0, 8).map(debtPaid)).toEqual(r.base.months.slice(0, 8).map((m) => debtPaid(m) + 10000));
  });
});
