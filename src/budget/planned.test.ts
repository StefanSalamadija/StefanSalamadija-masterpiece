import { describe, expect, it } from 'vitest';
import type { BudgetDebt } from '../domain/types';
import { entry, fund, move, recurring } from '../test/budgetRecords';
import { plannedItemsFor } from './planned';

const none = { recurring: [], funds: [], fundMoves: [], existing: [], debts: [], debtBalances: {} };

describe('plannedItemsFor', () => {
  const loan = recurring({ id: 'loan-tpl', name: 'Loan instalment', amount: 45000, categoryId: 'loan', day: 5, startYm: '2026-01', untilDebtId: 'car-loan' });
  const etf = recurring({ id: 'etf-tpl', name: 'S&P 500', amount: 30000, categoryId: 'etf', day: 31, startYm: '2026-06', endYm: '2026-12' });
  const salary = recurring({ id: 'pay-tpl', name: 'Salary', amount: 380000, incomeSource: 'salary', day: 15, startYm: '2026-01' });
  const debt = { id: 'car-loan', startBalance: 500000 } as BudgetDebt;

  it('makes a planned entry to confirm for each template due in the month', () => {
    const { entries } = plannedItemsFor('2027-02', { ...none, recurring: [loan, salary], debts: [debt], debtBalances: { 'car-loan': 200000 } });
    expect(entries).toEqual([
      { kind: 'expense', date: '2027-02-05', amount: 45000, categoryId: 'loan', note: 'Loan instalment', status: 'planned', recurringId: 'loan-tpl' },
      { kind: 'income', date: '2027-02-15', amount: 380000, incomeSource: 'salary', note: 'Salary', status: 'planned', recurringId: 'pay-tpl' },
    ]);
  });

  it('puts a late day on the last day of a short month', () => {
    expect(plannedItemsFor('2026-11', { ...none, recurring: [etf] }).entries[0].date).toBe('2026-11-30');
    expect(plannedItemsFor('2028-02', { ...none, recurring: [{ ...etf, endYm: undefined }] }).entries[0].date).toBe('2028-02-29');
  });

  it('is idempotent: a template already made into an entry this month, even one since deleted, is skipped', () => {
    const first = plannedItemsFor('2026-11', { ...none, recurring: [salary, etf] });
    expect(first.entries).toHaveLength(2);
    const existing = [
      entry('2026-11-15', 380000, { kind: 'income', status: 'actual', recurringId: 'pay-tpl' }),
      entry('2026-11-30', 30000, { status: 'planned', recurringId: 'etf-tpl', deleted: true }),
      entry('2026-10-15', 380000, { kind: 'income', status: 'actual', recurringId: 'etf-tpl' }),
    ];
    expect(plannedItemsFor('2026-11', { ...none, recurring: [salary, etf], existing }).entries).toEqual([]);
  });

  it('stops at the end month and before the start month', () => {
    expect(plannedItemsFor('2026-12', { ...none, recurring: [etf] }).entries).toHaveLength(1);
    expect(plannedItemsFor('2027-01', { ...none, recurring: [etf] }).entries).toEqual([]);
    expect(plannedItemsFor('2026-05', { ...none, recurring: [etf] }).entries).toEqual([]);
  });

  it('stops once the debt it pays is paid off', () => {
    const at = (balance: number) => plannedItemsFor('2027-02', { ...none, recurring: [loan], debts: [debt], debtBalances: { 'car-loan': balance } });
    expect(at(1).entries).toHaveLength(1);
    expect(at(0).entries).toEqual([]);
    expect(at(-100).entries).toEqual([]);
  });

  it('leaves out deleted templates', () => {
    expect(plannedItemsFor('2026-11', { ...none, recurring: [{ ...salary, deleted: true }] }).entries).toEqual([]);
  });

  it('lists the set-aside each fund asks for, unless it was already put aside this month', () => {
    const car = fund({ id: 'car', amount: 60000, dueYm: '2027-03' });
    const full = fund({ id: 'full', amount: 1000, dueYm: '2027-03', startBalance: 1000 });
    const gone = fund({ id: 'gone', amount: 1000, dueYm: '2027-03', deleted: true });
    expect(plannedItemsFor('2026-11', { ...none, funds: [car, full, gone] }).setAsides).toEqual([{ fundId: 'car', amount: 12000 }]);
    const done = [move('car', '2026-11', 'setaside', 12000)];
    expect(plannedItemsFor('2026-11', { ...none, funds: [car], fundMoves: done }).setAsides).toEqual([]);
    // A set-aside that was undone is asked for again.
    const undone = [move('car', '2026-11', 'setaside', 12000, { deleted: true })];
    expect(plannedItemsFor('2026-11', { ...none, funds: [car], fundMoves: undone }).setAsides).toEqual([{ fundId: 'car', amount: 12000 }]);
  });
});
