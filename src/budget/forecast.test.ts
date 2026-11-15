import { describe, expect, it } from 'vitest';
import type { BudgetMonth, BudgetSettings, ForecastMethod, PotId } from '../domain/types';
import { budgetData, category, correction, debt, entry, fund, month, recurring, settings } from '../test/budgetRecords';
import { forecast } from './forecast';
import type { BudgetData, ForecastResult } from './forecast';
import { SAVINGS_GOALS_CATEGORY_ID } from './ledger';
import { addMonths } from './months';
import type { ScenarioChange } from './scenarioTypes';

const TODAY = '2026-11-15';
const CATEGORIES = [
  category('cat-groc', 'needs'), category('cat-rent', 'needs'), category('cat-reg', 'needs'), category('cat-fun', 'wants'),
  category('cat-etf', 'savings'), category(SAVINGS_GOALS_CATEGORY_ID, 'savings'), category('cat-em', 'emergency'), category('cat-loan', 'debts'),
];
/** Onboard May–December 2026, so home January–April 2027 and onboard May–December 2027 (8 on / 4 off). */
const ROTATION = { salaryFrom: [{ ym: '2026-01', amount: 300000 }], periods: [{ signOn: '2026-05-01', signOff: '2026-12-31' }] };
const needs200 = (fields: Partial<BudgetMonth> = {}) =>
  month('2026-11', { potTargets: { needs: { fromOn: { kind: 'amount', value: 200000 } } }, ...fields });

function run(data: Partial<BudgetData> = {}, s: Partial<BudgetSettings> = {}, overrides?: ScenarioChange[], months?: number): ForecastResult {
  return forecast({
    today: TODAY,
    data: budgetData({ budgetCategories: CATEGORIES, budgetCorrections: [correction('bank', '2026-10', 500000)], budgetMonths: [needs200()], ...data }),
    settings: settings({ rotation: ROTATION, horizon: 12, ...s }),
    overrides,
    months,
  });
}

describe('forecast: the bank start', () => {
  it('needs a bank start: no months without one', () => {
    const r = run({ budgetCorrections: [correction('investments', '2026-10', 100)] });
    expect(r).toMatchObject({ needsBankStart: true, months: [], warnings: [], totalInterest: 0 });
    expect(r.lowest).toBeUndefined();
  });

  it('runs from the current month to the horizon', () => {
    const r = run();
    expect(r.needsBankStart).toBe(false);
    expect(r.months.map((m) => m.ym)).toEqual(Array.from({ length: 12 }, (_, i) => addMonths('2026-11', i)));
    expect(run({}, {}, undefined, 60).months).toHaveLength(60);
  });
});

describe('forecast: a home leave', () => {
  const r = run();
  it('drops the bank in the home months', () => {
    expect(r.months.slice(0, 7).map((m) => [m.ym, m.status, m.income, m.spending, m.bank])).toEqual([
      ['2026-11', 'onboard', 300000, 200000, 600000],
      ['2026-12', 'onboard', 300000, 200000, 700000],
      ['2027-01', 'home', 0, 200000, 500000],
      ['2027-02', 'home', 0, 200000, 300000],
      ['2027-03', 'home', 0, 200000, 100000],
      ['2027-04', 'home', 0, 200000, -100000],
      ['2027-05', 'onboard', 300000, 200000, 0],
    ]);
  });

  it('warns below the buffer (a month of Needs by default) and when the bank goes negative', () => {
    expect(r.buffer).toBe(200000);
    expect(r.warnings.filter((w) => w.kind === 'belowBuffer').map((w) => w.ym)).toEqual(['2027-03', '2027-04', '2027-05', '2027-06']);
    expect(r.warnings.filter((w) => w.kind === 'negativeBank').map((w) => w.ym)).toEqual(['2027-04']);
    expect(r.lowest).toEqual({ ym: '2027-04', freeToSpend: -100000, status: 'home' });
  });

  it('uses the buffer the user set', () => {
    const own = run({}, { bufferCents: 50000 });
    expect(own.buffer).toBe(50000);
    expect(own.warnings.filter((w) => w.kind === 'belowBuffer').map((w) => w.ym)).toEqual(['2027-04', '2027-05']);
  });
});

describe('forecast: the pay rule in the forecast', () => {
  it('lets an actual salary entry in the current month replace the rule', () => {
    const r = run({ budgetEntries: [entry('2026-11-10', 280000, { kind: 'income', incomeSource: 'salary' })] });
    expect(r.months[0]).toMatchObject({ income: 280000, bank: 580000 });
    expect(r.months[1].income).toBe(300000);
  });

  it('adds other planned income, but no planned salary on top of the rule', () => {
    const r = run({ budgetEntries: [
      entry('2026-12-20', 15000, { kind: 'income', incomeSource: 'property', status: 'planned' }),
      entry('2026-12-25', 300000, { kind: 'income', incomeSource: 'salary', status: 'planned' }),
    ] });
    expect(r.months[1].income).toBe(315000);
  });

  it('blends actual and planned other income: an actual rent received replaces its template', () => {
    const r = run({
      budgetRecurring: [recurring({ id: 'tpl-let', amount: 50000, startYm: '2026-01', incomeSource: 'property', categoryId: undefined })],
      budgetEntries: [entry('2026-11-03', 50000, { kind: 'income', incomeSource: 'property', recurringId: 'tpl-let' })],
    });
    expect(r.months[0].income).toBe(350000);
    expect(r.months[1].income).toBe(350000);
  });

  it('shifts the salary a month with "paid next month"', () => {
    const r = run({}, { rotation: { ...ROTATION, paidNextMonth: true, patternOn: 8, patternOff: 4, paidAtHomePct: 0 } as BudgetSettings['rotation'] });
    expect(r.months.slice(0, 4).map((m) => m.income)).toEqual([300000, 300000, 300000, 0]);
    expect(r.months[6].income).toBe(0); // May 2027 is paid in June
    expect(r.months[7].income).toBe(300000);
  });
});

describe('forecast: the current month counts nothing twice', () => {
  const rent = recurring({ id: 'tpl-rent', amount: 80000, startYm: '2026-01', categoryId: 'cat-rent', name: 'Rent' });
  it('counts a confirmed template once, and actual spending against the plan', () => {
    const r = run({ budgetRecurring: [rent], budgetEntries: [
      entry('2026-11-05', 80000, { categoryId: 'cat-rent', recurringId: 'tpl-rent' }),
      entry('2026-11-06', 50000, { categoryId: 'cat-groc' }),
    ] });
    expect(r.months[0]).toMatchObject({ spending: 200000, bank: 600000 });
  });

  it('counts the actual spending when it is over the plan', () => {
    const r = run({ budgetRecurring: [rent], budgetEntries: [
      entry('2026-11-05', 80000, { categoryId: 'cat-rent', recurringId: 'tpl-rent' }),
      entry('2026-11-06', 250000, { categoryId: 'cat-groc' }),
    ] });
    expect(r.months[0]).toMatchObject({ spending: 330000, bank: 470000 });
  });

  it('starts from a bank correction made this month, which already holds this month\'s actual entries', () => {
    const r = run({
      budgetCorrections: [correction('bank', '2026-11', 700000)],
      budgetEntries: [entry('2026-11-06', 50000, { categoryId: 'cat-groc' })],
    });
    // 700000 already after the 50000 spent; the rest of the month: + salary 300000 − (200000 − 50000).
    expect(r.months[0].bank).toBe(850000);
    expect(r.months[1].bank).toBe(950000);
  });

  it('leaves out a template whose planned entry the user removed this month', () => {
    const r = run({ budgetRecurring: [rent], budgetMonths: [], budgetEntries: [
      entry('2026-11-05', 80000, { categoryId: 'cat-rent', recurringId: 'tpl-rent', status: 'planned', deleted: true }),
    ] });
    expect(r.months[0].spending).toBe(0);
    expect(r.months[1].spending).toBe(80000);
  });
});

describe('forecast: the targets method', () => {
  it('never goes below zero, and never below what the templates already take', () => {
    const r = run({
      budgetMonths: [month('2026-11', {
        potTargets: { needs: { fromOn: { kind: 'amount', value: 50000 } } }, categoryTargets: { 'cat-rent': { fromOn: 30000 } },
      })],
      budgetRecurring: [recurring({ id: 'tpl-rent', amount: 80000, startYm: '2026-01', categoryId: 'cat-rent' })],
    });
    expect(r.months.every((m) => m.spending === 80000)).toBe(true);
  });

  it('forecasts a category target less its templates, and the pot target covers the categories without one', () => {
    const r = run({
      budgetMonths: [month('2026-11', {
        potTargets: { needs: { fromOn: { kind: 'amount', value: 200000 } } }, categoryTargets: { 'cat-groc': { fromOn: 60000 } },
      })],
      budgetRecurring: [
        recurring({ id: 'tpl-g', amount: 10000, startYm: '2026-01', categoryId: 'cat-groc' }),
        recurring({ id: 'tpl-rent', amount: 80000, startYm: '2026-01', categoryId: 'cat-rent' }),
      ],
    });
    // groceries: 60000 (10000 of it the template); rent 80000 + the rest of the pot: 200000 − 60000 − 80000 = 60000.
    expect(r.months[1].spending).toBe(200000);
  });

  it('works a % target out from the month\'s planned income', () => {
    const r = run({ budgetMonths: [month('2026-11', {
      plannedIncome: { fromOn: 400000 }, potTargets: { needs: { fromOn: { kind: 'pct', value: 25 } } },
    })] });
    expect(r.months[3].spending).toBe(100000);
  });

  it('takes a target set from a later month on', () => {
    const r = run({ budgetMonths: [needs200(), month('2027-02', { potTargets: { needs: { fromOn: { kind: 'amount', value: 150000 } } } })] });
    expect(r.months.slice(2, 5).map((m) => m.spending)).toEqual([200000, 150000, 150000]);
  });
});

describe('forecast: the average and fixed methods', () => {
  const history = [
    ...['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].flatMap((ym) => [
      entry(`${ym}-10`, 60000, { categoryId: 'cat-groc' }),
      entry(`${ym}-05`, 80000, { categoryId: 'cat-rent', recurringId: 'tpl-rent' }),
    ]),
    entry('2026-04-10', 999900, { categoryId: 'cat-groc' }),
    entry('2026-10-20', 500000, { categoryId: 'cat-groc', oneOff: true }),
  ];
  const methods = (m: Partial<Record<PotId, ForecastMethod>>) =>
    ({ needs: 'targets', savings: 'targets', wants: 'targets', debts: 'targets', emergency: 'targets', ...m }) as Record<PotId, ForecastMethod>;

  it('averages the last 6 tracked months, without one-offs and without what templates pay', () => {
    const r = run({ budgetEntries: history, budgetRecurring: [recurring({ id: 'tpl-rent', amount: 80000, startYm: '2026-01', categoryId: 'cat-rent' })] },
      { forecastMethod: methods({ needs: 'average' }) });
    expect(r.months.slice(0, 3).map((m) => m.spending)).toEqual([140000, 140000, 140000]);
  });

  it('spends a fixed amount a month', () => {
    const r = run({}, { forecastMethod: methods({ wants: 'fixed' }), fixedSpend: { wants: 40000 } });
    expect(r.months[1].spending).toBe(240000);
  });
});

describe('forecast: transfers, funds and debts', () => {
  const savings = (value: number) => month('2026-11', { potTargets: {
    needs: { fromOn: { kind: 'amount', value: 200000 } }, savings: { fromOn: { kind: 'amount', value } },
  } });

  it('moves investment contributions out of the bank into investments, net worth unchanged by them', () => {
    const r = run({ budgetMonths: [savings(50000)], budgetCorrections: [correction('bank', '2026-10', 500000), correction('investments', '2026-10', 1000000)] });
    expect(r.months[0]).toMatchObject({ spending: 250000, bank: 550000, investments: 1050000, contribution: 50000, netWorth: 1600000 });
    expect(r.startInvestments).toBe(1000000);
  });

  it('grows investments monthly at the expected return', () => {
    const r = run({ budgetMonths: [savings(50000)], budgetCorrections: [correction('bank', '2026-10', 500000), correction('investments', '2026-10', 1000000)] },
      { assumptions: { withdrawalRatePct: 4, emergencyMonths: 6, fundReminderDays: 30, yearlyReturnPct: 6 } });
    const g = 1.06 ** (1 / 12);
    const nov = Math.round(1000000 * g) + 50000;
    expect(r.months[0].investments).toBe(nov);
    expect(r.months[1].investments).toBe(Math.round(nov * g) + 50000);
  });

  it('keeps savings-goal money in the bank', () => {
    const r = run({ budgetEntries: [entry('2026-11-02', 10000, { categoryId: SAVINGS_GOALS_CATEGORY_ID })] });
    expect(r.months[0]).toMatchObject({ spending: 200000, bank: 600000 });
  });

  it('leaves the part of the savings target meant for goals in the bank', () => {
    const r = run({ budgetMonths: [month('2026-11', {
      potTargets: { needs: { fromOn: { kind: 'amount', value: 200000 } }, savings: { fromOn: { kind: 'amount', value: 50000 } } },
      categoryTargets: { [SAVINGS_GOALS_CATEGORY_ID]: { fromOn: 20000 } },
    })] });
    expect(r.months[0]).toMatchObject({ contribution: 30000, spending: 230000 });
  });

  it('earmarks fund set-asides inside the bank, and the bill leaves the bank when due', () => {
    const r = run({ budgetFunds: [fund({ amount: 120000, dueYm: '2027-04', categoryId: 'cat-reg', createdAt: '2026-10-01T00:00:00.000Z' })] });
    // 6 months to April: 20000 a month, counted against the Needs target.
    expect(r.months[0]).toMatchObject({ spending: 180000, bank: 620000, freeToSpend: 600000, funds: 20000 });
    expect(r.months[4]).toMatchObject({ ym: '2027-03', funds: 100000 });
    expect(r.months[5]).toMatchObject({ ym: '2027-04', spending: 300000, funds: 0 });
    expect(r.months[6]).toMatchObject({ spending: 200000, funds: 0 });
  });

  it('pays a debt off, with interest each month, and stops its template', () => {
    const r = run({
      budgetDebts: [debt({ startBalance: 100000, startYm: '2026-11', yearlyRatePct: 12 })],
      budgetRecurring: [recurring({ id: 'tpl-loan', amount: 30000, startYm: '2026-11', categoryId: 'cat-loan', untilDebtId: 'debt-1' })],
    });
    expect(r.months.slice(0, 5).map((m) => m.debts)).toEqual([71000, 41710, 12127, 0, 0]);
    expect(r.months.slice(0, 5).map((m) => m.spending)).toEqual([230000, 230000, 230000, 212248, 200000]);
    expect(r.debtFree).toEqual({ 'debt-1': '2027-02' });
    expect(r.totalInterest).toBe(2248);
    expect(r.months[0].netWorth).toBe(r.months[0].bank - 71000);
  });

  it('leaves a debt that is never paid off without a debt-free month', () => {
    const r = run({ budgetDebts: [debt({ startBalance: 100000, startYm: '2026-11', yearlyRatePct: 0 })] });
    expect(r.debtFree).toEqual({ 'debt-1': undefined });
  });
});

describe('forecast: overrides (scenarios)', () => {
  it('a one-off purchase lowers the bank from its month on', () => {
    const base = run();
    const car = run({}, {}, [{ kind: 'oneOff', ym: '2027-05', amount: 1800000, label: 'Car' }]);
    expect(car.months[5].bank).toBe(base.months[5].bank);
    expect(car.months[6].bank).toBe(base.months[6].bank - 1800000);
    expect(car.months[11].bank).toBe(base.months[11].bank - 1800000);
  });

  it('a salary change and a longer contract change the income', () => {
    const r = run({}, {}, [{ kind: 'salary', fromYm: '2026-12', amount: 400000 }, { kind: 'rotation', patternOn: 10, patternOff: 2 }]);
    expect(r.months[0].income).toBe(300000);
    expect(r.months[1].income).toBe(400000);
    expect(r.months.slice(2, 4).map((m) => m.status)).toEqual(['home', 'home']);
    expect(r.months[4].status).toBe('onboard');
  });

  it('an extra debt payment lowers the bank and the debt', () => {
    const data = { budgetDebts: [debt({ startBalance: 100000, startYm: '2026-11', yearlyRatePct: 0 })] };
    const r = run(data, {}, [{ kind: 'extraDebt', debtId: 'debt-1', monthly: 10000, lumpYm: '2026-12', lump: 50000 }]);
    expect(r.months.slice(0, 5).map((m) => m.debts)).toEqual([90000, 30000, 20000, 10000, 0]);
    expect(r.debtFree['debt-1']).toBe('2027-03');
    expect(r.months[1].spending).toBe(260000);
  });

  it('an investment contribution from a month on, and a pot target change', () => {
    const r = run({ budgetCorrections: [correction('bank', '2026-10', 500000), correction('investments', '2026-10', 0)] }, {}, [
      { kind: 'investment', fromYm: '2027-01', monthly: 25000 },
      { kind: 'potTarget', pot: 'needs', fromYm: '2027-02', amount: 150000 },
    ]);
    expect(r.months.slice(0, 4).map((m) => m.contribution)).toEqual([0, 0, 25000, 25000]);
    expect(r.months.slice(0, 4).map((m) => m.spending)).toEqual([200000, 200000, 225000, 175000]);
    expect(r.months[3].investments).toBe(50000);
  });

  it('an investment contribution replaces the savings templates, not adds to them', () => {
    const r = run({ budgetRecurring: [recurring({ id: 'tpl-etf', amount: 10000, startYm: '2026-01', categoryId: 'cat-etf' })] }, {},
      [{ kind: 'investment', fromYm: '2027-01', monthly: 25000 }]);
    expect(r.months.slice(0, 4).map((m) => m.contribution)).toEqual([10000, 10000, 25000, 25000]);
  });

  it('rates change the return the investments grow by', () => {
    const r = run({ budgetCorrections: [correction('bank', '2026-10', 500000), correction('investments', '2026-10', 1000000)] }, {},
      [{ kind: 'rates', yearlyReturnPct: 12 }]);
    expect(r.months[0].investments).toBe(Math.round(1000000 * 1.12 ** (1 / 12)));
    expect(r.assumptions.yearlyReturnPct).toBe(12);
  });
});

/** A small seeded PRNG (mulberry32), so that the random plans are the same on every run. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPlan(seed: number): { data: BudgetData; s: BudgetSettings; overrides: ScenarioChange[] } {
  const rnd = prng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
  const cats = CATEGORIES.map((c) => c.id);
  const pots: PotId[] = ['needs', 'savings', 'wants', 'debts', 'emergency'];
  const methods: ForecastMethod[] = ['targets', 'average', 'fixed'];
  const ym = (from: number, to: number) => addMonths('2026-11', int(from, to));
  const day = () => String(int(1, 28)).padStart(2, '0');

  const entries = Array.from({ length: int(0, 40) }, () => entry(`${ym(-8, 3)}-${day()}`, int(1, 300000), rnd() < 0.2
    ? { kind: 'income', incomeSource: pick(['salary', 'property', 'other'] as const), status: rnd() < 0.3 ? 'planned' : 'actual' }
    : { categoryId: pick(cats), status: rnd() < 0.2 ? 'planned' : 'actual', oneOff: rnd() < 0.1, ...(rnd() < 0.2 && { debtId: 'debt-1' }) }));
  const debts = Array.from({ length: int(0, 2) }, (_, i) => debt({ id: `debt-${i + 1}`, startBalance: int(0, 2000000), startYm: ym(-12, 6), yearlyRatePct: int(0, 1500) / 100 }));
  const recurringT = Array.from({ length: int(0, 5) }, (_, i) => recurring({
    id: `tpl-${i}`, amount: int(1, 150000), startYm: ym(-6, 6), ...(rnd() < 0.3 && { endYm: ym(0, 20) }),
    ...(rnd() < 0.2 ? { incomeSource: 'property', categoryId: undefined } : { categoryId: pick(cats) }),
    ...(debts.length > 0 && rnd() < 0.3 && { untilDebtId: pick(debts).id }),
  }));
  const funds = Array.from({ length: int(0, 3) }, (_, i) => fund({
    id: `fund-${i}`, amount: int(1000, 300000), dueYm: ym(-3, 18), categoryId: pick(cats), startBalance: int(0, 50000),
    ...(rnd() < 0.5 && { repeatMonths: pick([6, 12]) }), createdAt: '2026-01-01T00:00:00.000Z',
  }));
  const potTargets: BudgetMonth['potTargets'] = {};
  for (const p of pots) if (rnd() < 0.7) potTargets[p] = { fromOn: rnd() < 0.5 ? { kind: 'amount', value: int(0, 250000) } : { kind: 'pct', value: int(0, 4000) / 100 } };
  const categoryTargets: BudgetMonth['categoryTargets'] = {};
  for (const c of cats) if (rnd() < 0.4) categoryTargets[c] = { fromOn: int(0, 100000) };
  const months = [month(ym(-3, 0), { plannedIncome: { fromOn: int(0, 600000) }, potTargets, categoryTargets })];
  if (rnd() < 0.5) months.push(month(ym(1, 10), { categoryTargets: { [pick(cats)]: { thisOnly: int(0, 90000) } }, potTargets: {} }));
  const corrections = [correction('bank', ym(-6, 0), int(-500000, 3000000))];
  if (rnd() < 0.5) corrections.push(correction('investments', ym(-6, 0), int(0, 5000000)));
  if (rnd() < 0.3) corrections.push(correction('emergency', ym(-6, 0), int(0, 1000000)));

  const signOn = `${ym(-10, 2)}-${day()}`;
  const s = settings({
    rotation: { salaryFrom: [{ ym: '2020-01', amount: int(100000, 900000) }, { ym: ym(0, 20), amount: int(100000, 900000) }],
      periods: [{ signOn, signOff: `${addMonths(signOn.slice(0, 7), int(0, 9))}-${day()}` }], patternOn: int(0, 10), patternOff: int(0, 6),
      paidNextMonth: rnd() < 0.3, paidAtHomePct: rnd() < 0.3 ? int(0, 3000) / 100 : 0 },
    forecastMethod: Object.fromEntries(pots.map((p) => [p, pick(methods)])) as Record<PotId, ForecastMethod>,
    fixedSpend: Object.fromEntries(pots.map((p) => [p, int(0, 100000)])),
    horizon: pick([12, 24, 36, 60] as const),
    assumptions: { withdrawalRatePct: 4, emergencyMonths: 6, fundReminderDays: 30, ...(rnd() < 0.7 && { yearlyReturnPct: int(-500, 1200) / 100 }) },
  });
  const overrides: ScenarioChange[] = [];
  if (rnd() < 0.3) overrides.push({ kind: 'oneOff', ym: ym(0, 20), amount: int(1, 2000000), label: 'x', ...(rnd() < 0.5 && { pot: pick(pots) }), income: rnd() < 0.2 });
  if (rnd() < 0.2 && debts.length > 0) overrides.push({ kind: 'extraDebt', debtId: debts[0].id, monthly: int(0, 50000), lumpYm: ym(0, 12), lump: int(0, 500000) });
  if (rnd() < 0.2) overrides.push({ kind: 'investment', fromYm: ym(0, 12), monthly: int(0, 100000) });
  if (rnd() < 0.2) overrides.push({ kind: 'potTarget', pot: pick(pots), fromYm: ym(0, 12), amount: int(0, 200000) });
  if (rnd() < 0.2) overrides.push({ kind: 'salary', fromYm: ym(0, 12), amount: int(0, 900000) });
  if (rnd() < 0.2) overrides.push({ kind: 'rotation', patternOn: int(1, 10), patternOff: int(0, 6) });
  return {
    data: budgetData({ budgetCategories: CATEGORIES, budgetEntries: entries, budgetDebts: debts, budgetRecurring: recurringT, budgetFunds: funds,
      budgetMonths: months, budgetCorrections: corrections }),
    s, overrides,
  };
}

describe('forecast: properties over 100 random plans', () => {
  it('keeps every amount in whole cents, and bank(m) = bank(m − 1) + income − spending exactly', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const { data, s, overrides } = randomPlan(seed);
      const r = forecast({ today: TODAY, data, settings: s, overrides });
      expect(r.months.length, `seed ${seed}`).toBe(s.horizon);
      expect(Number.isInteger(r.totalInterest) && Number.isInteger(r.buffer) && Number.isInteger(r.startInvestments), `seed ${seed}`).toBe(true);
      r.months.forEach((m, i) => {
        for (const [field, value] of Object.entries(m)) {
          if (field !== 'ym' && field !== 'status') expect(Number.isInteger(value), `seed ${seed} ${m.ym} ${field}=${value}`).toBe(true);
        }
        if (i > 0) expect(m.bank, `seed ${seed} ${m.ym}`).toBe(r.months[i - 1].bank + m.income - m.spending);
        expect(m.freeToSpend, `seed ${seed} ${m.ym}`).toBe(m.bank - m.funds);
        expect(m.spending, `seed ${seed} ${m.ym}`).toBeGreaterThanOrEqual(0);
      });
    }
  });
});

describe('forecast: speed', () => {
  it('runs 60 months 5 times (the base and 4 scenarios) in under 100 ms', () => {
    const { data, s } = randomPlan(7);
    // Two years of history, about 1,000 entries, and a year of plan edits.
    const historyEntries = Array.from({ length: 24 * 42 }, (_, n) =>
      entry(`${addMonths('2024-11', Math.floor(n / 42))}-${String((n % 28) + 1).padStart(2, '0')}`, 1000 + ((n * 7919) % 90000), { categoryId: CATEGORIES[n % CATEGORIES.length].id }));
    const planEdits = Array.from({ length: 12 }, (_, n) => month(addMonths('2026-01', n), { categoryTargets: { 'cat-groc': { fromOn: 50000 + n * 100 } } }));
    const big = budgetData({ ...data, budgetEntries: [...data.budgetEntries, ...historyEntries], budgetMonths: [...data.budgetMonths, ...planEdits] });
    const scenarios: ScenarioChange[][] = [[], [{ kind: 'oneOff', ym: '2027-05', amount: 1800000, label: 'Car' }],
      [{ kind: 'rotation', patternOn: 10, patternOff: 2 }], [{ kind: 'investment', fromYm: '2027-01', monthly: 50000 }],
      [{ kind: 'salary', fromYm: '2027-01', amount: 450000 }]];
    const started = performance.now();
    for (const overrides of scenarios) expect(forecast({ today: TODAY, data: big, settings: { ...s, horizon: 60 }, overrides }).months).toHaveLength(60);
    const ms = performance.now() - started;
    console.log(`forecast: 60 months × 5 runs in ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(100);
  });
});
