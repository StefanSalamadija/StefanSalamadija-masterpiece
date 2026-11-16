import { describe, expect, it } from 'vitest';
import { budgetData, category, entry, fund, month, move, recurring, settings } from '../test/budgetRecords';
import type { BudgetGoal } from '../domain/types';
import { budgetAlerts, fundsDue, itemsToConfirm } from './alerts';

const TODAY = '2026-10-25';
const categories = [category('food', 'needs'), category('fun', 'wants'), category('car', 'needs'), category('goal', 'savings')];
const goal = (fields: Partial<BudgetGoal>): BudgetGoal => ({
  id: 'goal-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'test', deleted: false, scope: 'personal',
  name: 'Holiday', amount: 120000, targetYm: '2027-03', categoryId: 'goal', ...fields,
});

describe('budgetAlerts', () => {
  it('says nothing for an empty budget', () => {
    expect(budgetAlerts({ data: budgetData({ budgetCategories: categories }), settings: settings(), today: TODAY })).toEqual([]);
  });

  it('counts items to confirm in this month and earlier ones, not in later months', () => {
    const data = budgetData({
      budgetCategories: categories,
      budgetEntries: [
        entry('2026-09-03', 3500, { status: 'planned', categoryId: 'food' }), entry('2026-10-03', 3500, { status: 'planned', categoryId: 'food' }),
        entry('2027-05-01', 1800000, { status: 'planned', categoryId: 'car' }), entry('2026-08-03', 3500, { status: 'planned', deleted: true }),
      ],
    });
    expect(itemsToConfirm(data, '2026-10')).toEqual({ earlier: 1, now: 1, firstYm: '2026-09' });
    expect(budgetAlerts({ data, settings: settings(), today: TODAY }))
      .toEqual([{ key: 'confirm', text: '2 items to confirm (1 in earlier months)', href: '#/budget/month/2026-09' }]);
  });

  it("counts this month's set-asides to confirm", () => {
    const f = fund({ amount: 60000, dueYm: '2027-03', repeatMonths: 12, categoryId: 'car' });
    expect(itemsToConfirm(budgetData({ budgetFunds: [f] }), '2026-10')).toEqual({ earlier: 0, now: 1, firstYm: '2026-10' });
    expect(itemsToConfirm(budgetData({ budgetFunds: [f], budgetFundMoves: [move(f.id, '2026-10', 'setaside', 10000)] }), '2026-10')).toEqual({ earlier: 0, now: 0 });
  });

  it('warns of a fund due within the reminder days, and once it is due, until it is paid', () => {
    const soon = fund({ id: 'f-soon', name: 'Insurance', amount: 30000, dueYm: '2026-11', startBalance: 30000 });
    const later = fund({ id: 'f-later', name: 'Tax', amount: 30000, dueYm: '2026-12', startBalance: 30000 });
    const paid = fund({ id: 'f-paid', name: 'Paid', amount: 30000, dueYm: '2026-10', startBalance: 30000 });
    const data = budgetData({ budgetFunds: [soon, later, paid], budgetFundMoves: [move('f-paid', '2026-10', 'paid', 30000)] });
    // 25 Oct → 1 Nov is 7 days; 1 Dec is 37.
    expect(fundsDue(data, TODAY, 30).map((f) => [f.name, f.daysLeft])).toEqual([['Insurance', 7]]);
    expect(fundsDue(data, TODAY, 60).map((f) => f.name)).toEqual(['Insurance', 'Tax']);
    expect(budgetAlerts({ data, settings: settings(), today: TODAY }))
      .toEqual([{ key: 'fund:f-soon', text: 'Insurance is due in November 2026', href: '#/budget/plan/funds' }]);
    expect(budgetAlerts({ data, settings: settings(), today: '2026-11-01' }).map((a) => a.text))
      .toEqual(['Insurance is due (November 2026)', 'Tax is due in December 2026']);
  });

  it('warns of a pot and a category over target, and of targets not adding up to 100%', () => {
    const data = budgetData({
      budgetCategories: categories,
      budgetMonths: [month('2026-10', {
        plannedIncome: { fromOn: 100000 }, potTargets: { needs: { fromOn: { kind: 'pct', value: 50 } }, wants: { fromOn: { kind: 'pct', value: 30 } } },
        categoryTargets: { fun: { fromOn: 10000 } },
      })],
      budgetEntries: [entry('2026-10-05', 60000, { categoryId: 'food' }), entry('2026-10-06', 12000, { categoryId: 'fun' })],
    });
    expect(budgetAlerts({ data, settings: settings(), today: TODAY })).toEqual([
      { key: 'pot:needs', text: 'Needs over target by €100.00', href: '#/budget/month/2026-10' },
      { key: 'cat:fun', text: 'fun over target by €20.00', href: '#/budget/month/2026-10' },
      { key: 'targets', text: 'Targets add up to 80% — adjust to 100%.', href: '#/budget/plan/targets' },
    ]);
  });

  it('warns of a goal behind plan, not of one the plan keeps up with', () => {
    const behind = budgetData({ budgetCategories: categories, budgetGoals: [goal({})] });
    expect(budgetAlerts({ data: behind, settings: settings(), today: TODAY }).map((a) => a.text)).toEqual(['Holiday is behind plan']);
    // October to March is 6 months: €200.00 a month keeps it on track.
    const kept = budgetData({ budgetCategories: categories, budgetGoals: [goal({})], budgetRecurring: [recurring({ amount: 20000, startYm: '2026-01', categoryId: 'goal' })] });
    expect(budgetAlerts({ data: kept, settings: settings(), today: TODAY })).toEqual([]);
  });
});
