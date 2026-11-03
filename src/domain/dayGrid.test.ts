import { describe, expect, it } from 'vitest';
import { todayRowIndex } from './dayGrid';

describe('todayRowIndex', () => {
  it('is the day minus one, or -1 when the grid has no such row', () => {
    expect(todayRowIndex({ capacity: 31 }, '2026-10-28')).toBe(27);
    expect(todayRowIndex({ capacity: 28 }, '2026-10-30')).toBe(-1);
    expect(todayRowIndex({ capacity: 31 }, 'nonsense')).toBe(-1);
  });
  it('matches row labels by their number', () => {
    expect(todayRowIndex({ capacity: 3, rowLabels: ['01', '02', '03'] }, '2026-10-03')).toBe(2);
    expect(todayRowIndex({ capacity: 2, rowLabels: ['Mon', 'Tue'] }, '2026-10-02')).toBe(-1);
  });
});
