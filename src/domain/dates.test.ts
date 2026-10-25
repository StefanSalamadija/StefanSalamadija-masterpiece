import { describe, expect, it } from 'vitest';
import { addDays, addMonths, isValidIsoDate, isValidLocalDateTime } from './dates';

describe('isValidIsoDate', () => {
  it('accepts real calendar dates', () => {
    expect(isValidIsoDate('2026-10-25')).toBe(true);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
  });

  it('rejects dates that do not exist', () => {
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2027-02-29')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-00-10')).toBe(false);
    expect(isValidIsoDate('2026-04-31')).toBe(false);
  });

  it('rejects anything that is not exactly YYYY-MM-DD', () => {
    for (const bad of ['', '2026-1-5', '25.10.2026', '2026-10-25T00:00', ' 2026-10-25', 'abcd-ef-gh']) {
      expect(isValidIsoDate(bad)).toBe(false);
    }
  });
});

describe('isValidLocalDateTime', () => {
  it('accepts a real date with a real time, as YYYY-MM-DDTHH:mm', () => {
    expect(isValidLocalDateTime('2026-10-25T09:00')).toBe(true);
    expect(isValidLocalDateTime('2028-02-29T00:00')).toBe(true);
    expect(isValidLocalDateTime('2026-12-31T23:59')).toBe(true);
  });
  it('rejects a date that does not exist or a time that does not', () => {
    for (const bad of ['2026-02-30T10:00', '2026-13-01T10:00', '2026-10-25T24:00', '2026-10-25T10:60', '2026-10-25T99:99']) {
      expect(isValidLocalDateTime(bad)).toBe(false);
    }
  });
  it('rejects anything that is not exactly that shape', () => {
    for (const bad of ['', '2026-10-25', '2026-10-25 09:00', '2026-10-25T9:00', '2026-10-25T09:00:00', '2026-10-25T09:00Z', ' 2026-10-25T09:00']) {
      expect(isValidLocalDateTime(bad)).toBe(false);
    }
  });
});

describe('addMonths', () => {
  it('clamps to the end of a shorter month', () => {
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29');
  });

  it('keeps the day when it exists', () => {
    expect(addMonths('2026-01-15', 6)).toBe('2026-07-15');
    expect(addMonths('2026-10-25', 6)).toBe('2027-04-25');
  });

  it('handles zero and negative offsets and year rollover', () => {
    expect(addMonths('2026-10-25', 0)).toBe('2026-10-25');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', -2)).toBe('2025-11-30');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
  });
});

describe('addDays', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-10-25', 90)).toBe('2027-01-23');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('subtracts with a negative count', () => {
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });
});
