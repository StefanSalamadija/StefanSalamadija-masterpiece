import { describe, expect, it } from 'vitest';
import { budgetMoneyOk, entryLinksOk } from './validate';

describe('entryLinksOk', () => {
  it('accepts an entry whose links are absent or text', () => {
    expect(entryLinksOk({})).toBe(true);
    expect(entryLinksOk({ categoryId: 'c', fundId: 'f', debtId: 'd', soldAssetId: 'a', recurringId: 'r' })).toBe(true);
    expect(entryLinksOk({ debtId: undefined })).toBe(true);
  });

  it('refuses a link that is not text', () => {
    for (const key of ['categoryId', 'fundId', 'debtId', 'soldAssetId', 'recurringId']) {
      expect(entryLinksOk({ [key]: 7 })).toBe(false);
      expect(entryLinksOk({ [key]: null })).toBe(false);
    }
  });
});

describe('budgetMoneyOk', () => {
  it("checks a debt's planned extra payment is whole cents", () => {
    expect(budgetMoneyOk({ instalment: 20000, extraSteps: [{ fromYm: '2026-11', monthly: 5000 }] })).toBe(true);
    expect(budgetMoneyOk({ instalment: 20000 })).toBe(true);
    expect(budgetMoneyOk({ extraSteps: [{ fromYm: '2026-11', monthly: 50.5 }] })).toBe(false);
    expect(budgetMoneyOk({ extraSteps: [{ fromYm: '2026-11', monthly: '5000' }] })).toBe(false);
    expect(budgetMoneyOk({ extraSteps: 5000 })).toBe(false);
  });

  it("checks the settings' own yearly spending is whole cents", () => {
    expect(budgetMoneyOk({ assumptions: { withdrawalRatePct: 4, yearlySpendingCents: 3000000 } })).toBe(true);
    expect(budgetMoneyOk({ assumptions: { withdrawalRatePct: 4 } })).toBe(true);
    expect(budgetMoneyOk({ assumptions: { withdrawalRatePct: 4, yearlySpendingCents: 30000.5 } })).toBe(false);
    expect(budgetMoneyOk({ assumptions: 4 })).toBe(false);
  });
});
