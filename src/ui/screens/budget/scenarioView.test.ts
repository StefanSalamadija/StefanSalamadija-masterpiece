import { describe, expect, it } from 'vitest';
import { debt } from '../../../test/budgetRecords';
import { compareTable, describeChange } from './scenarioView';

describe('describeChange', () => {
  const debts = [debt({ id: 'd1', name: 'Car loan', startBalance: 100000, startYm: '2026-01' })];
  it('says each change in one line', () => {
    expect(describeChange({ kind: 'oneOff', ym: '2027-05', amount: 1800000, pot: 'wants', label: 'Car' }, debts)).toBe('Car: €18,000.00 in May 2027 (Wants)');
    expect(describeChange({ kind: 'oneOff', ym: '2027-03', amount: 200000, income: true, label: 'Bonus' }, debts)).toBe('Bonus: €2,000.00 in March 2027 (income)');
    expect(describeChange({ kind: 'investment', fromYm: '2027-05', monthly: 50000 }, debts)).toBe('Investments: €500.00 a month from May 2027 on');
    expect(describeChange({ kind: 'salary', fromYm: '2027-01', amount: 600000 }, debts)).toBe('Salary: €6,000.00 a month from January 2027 on');
    expect(describeChange({ kind: 'potTarget', pot: 'needs', fromYm: '2027-01', amount: 150000 }, debts)).toBe('Needs target: €1,500.00 a month from January 2027 on');
    expect(describeChange({ kind: 'extraDebt', debtId: 'd1', monthly: 5000, lumpYm: '2027-01', lump: 100000 }, debts)).toBe('Car loan: extra €50.00 a month, €1,000.00 in January 2027');
    expect(describeChange({ kind: 'rates', yearlyReturnPct: 5, inflationPct: 2.5 }, debts)).toBe('Rates: expected return 5%, inflation 2.5%');
    expect(describeChange({ kind: 'rotation', patternOn: 9, patternOff: 3, periods: [{ signOn: '2026-07-01', signOff: '2027-03-31' }] }, debts))
      .toBe('Rotation: 9 months on, 3 off; last contract 1 Jul 2026 – 31 Mar 2027');
  });
});

describe('compareTable', () => {
  it('puts each figure in a row, a plan in each column', () => {
    const row = { name: 'Base plan', lowest: { ym: '2027-06', amount: 100000 }, netWorth1y: 1, netWorth5y: 2, netWorth10y: 3, freedom: '2058-01', totalInterest: 0, series: [] };
    const table = compareTable([row, { ...row, name: 'Car', freedom: undefined }], { hasDebts: false, freedomKnown: true });
    expect(table.find((r) => r.label === 'Lowest bank')!.cells).toEqual(['€1,000.00 in June 2027', '€1,000.00 in June 2027']);
    expect(table.find((r) => r.label === 'Freedom date')!.cells).toEqual(['January 2058', 'Not within 60 years']);
    expect(table.find((r) => r.label === 'Debt-free')!.cells).toEqual(['No debts', 'No debts']);
  });
});
