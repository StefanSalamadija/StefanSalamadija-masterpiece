import { describe, expect, it } from 'vitest';
import { addDays, addMonths, formatDisplayDate, formatUtcMinute, isValidIsoDate, isValidLocalDateTime } from './dates';

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

describe('formatUtcMinute', () => {
  it('writes an instant as its UTC date and time to the minute', () => {
    expect(formatUtcMinute('2026-10-25T09:05:59.123Z')).toBe('2026-10-25 09:05 UTC');
    expect(formatUtcMinute('2026-01-02T00:00:00.000Z')).toBe('2026-01-02 00:00 UTC');
  });

  it('converts an instant given with another offset to UTC', () => {
    expect(formatUtcMinute('2026-10-25T23:30:00+03:00')).toBe('2026-10-25 20:30 UTC');
  });

  it('is undefined for text that is not an instant, so that a damaged file cannot make the screen throw', () => {
    for (const bad of ['', 'soon', 'not a date at all', '2026-13-45T99:99:99Z']) expect(formatUtcMinute(bad)).toBeUndefined();
  });

  it('is undefined for a year that has no four-digit form', () => {
    expect(formatUtcMinute('+275760-09-13T00:00:00.000Z')).toBeUndefined();
  });
});

describe('formatDisplayDate', () => {
  it('writes a date as DD-MMM-YYYY with the month in capitals', () => {
    expect(formatDisplayDate('1985-01-05')).toBe('05-JAN-1985');
    expect(formatDisplayDate('2026-10-25')).toBe('25-OCT-2026');
    expect(formatDisplayDate('2028-02-29')).toBe('29-FEB-2028');
  });

  it('names every month', () => {
    const months = Array.from({ length: 12 }, (_, i) => formatDisplayDate(`2026-${String(i + 1).padStart(2, '0')}-01`).slice(3, 6));
    expect(months).toEqual(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']);
  });

  it('leaves an empty date empty', () => {
    expect(formatDisplayDate('')).toBe('');
  });

  it('gives back text that is not a real date as it is, so a damaged record is shown and never made up', () => {
    expect(formatDisplayDate('05.01.1985')).toBe('05.01.1985');
    expect(formatDisplayDate('2026-02-30')).toBe('2026-02-30');
    expect(formatDisplayDate('soon')).toBe('soon');
  });
});
