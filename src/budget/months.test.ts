import { describe, expect, it } from 'vitest';
import { addMonths, monthLabel, monthsBetween, ymOf } from './months';

describe('months', () => {
  it('adds months across a year end, forwards and back', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-11', 0)).toBe('2026-11');
    expect(addMonths('2027-02', -3)).toBe('2026-11');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-01', 24)).toBe('2028-01');
  });

  it('counts the months from one to another', () => {
    expect(monthsBetween('2026-11', '2027-02')).toBe(3);
    expect(monthsBetween('2027-02', '2026-11')).toBe(-3);
    expect(monthsBetween('2026-11', '2026-11')).toBe(0);
  });

  it('gives the month of a date', () => {
    expect(ymOf('2026-11-15')).toBe('2026-11');
    expect(ymOf('2026-11-15T09:00')).toBe('2026-11');
  });

  it('refuses text that is not a month or a date', () => {
    expect(() => addMonths('2026-13', 1)).toThrow();
    expect(() => monthsBetween('Nov', '2026-11')).toThrow();
    expect(() => ymOf('15.11.2026')).toThrow();
  });
});

describe('monthLabel', () => {
  it('names a month in full', () => {
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(monthLabel('2027-01')).toBe('January 2027');
  });
});
