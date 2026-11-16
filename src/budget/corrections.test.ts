import { describe, expect, it } from 'vitest';
import { correction } from '../test/budgetRecords';
import { correctionChanges } from './corrections';

describe('correctionChanges', () => {
  it('makes a correction for each account given, at the month', () => {
    expect(correctionChanges([], '2026-10', { bank: 250000, 'debt:d1': 500000 })).toEqual({
      create: [{ account: 'bank', ym: '2026-10', balance: 250000 }, { account: 'debt:d1', ym: '2026-10', balance: 500000 }],
      update: [],
    });
  });

  it('changes the one that counts in that month instead of adding another, and leaves an unchanged one alone', () => {
    const older = correction('bank', '2026-10', 1000, { id: 'a', updatedAt: '2026-10-01T00:00:00.000Z' });
    const counts = correction('bank', '2026-10', 2000, { id: 'b', updatedAt: '2026-10-02T00:00:00.000Z' });
    const elsewhere = correction('investments', '2026-09', 3000, { id: 'c' });
    const same = correction('emergency', '2026-10', 4000, { id: 'd' });
    expect(correctionChanges([older, counts, elsewhere, same], '2026-10', { bank: 5000, investments: 3000, emergency: 4000 })).toEqual({
      create: [{ account: 'investments', ym: '2026-10', balance: 3000 }],
      update: [{ id: 'b', balance: 5000 }],
    });
  });

  it('ignores deleted corrections', () => {
    const gone = correction('bank', '2026-10', 1000, { id: 'a', deleted: true });
    expect(correctionChanges([gone], '2026-10', { bank: 1000 }).create).toHaveLength(1);
  });
});
