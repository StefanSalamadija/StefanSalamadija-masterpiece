import { describe, expect, it } from 'vitest';
import { formatDate, parseDate } from './format';

describe('formatDate', () => {
  it('formats with the tokens of the hint', () => {
    expect(formatDate('2026-10-28', 'dd/MMM/yyyy')).toBe('28/Oct/2026');
    expect(formatDate('2026-10-28', 'DD.MM.YYYY')).toBe('28.10.2026');
    expect(formatDate('2026-10-28', 'dd.mm.yyyy')).toBe('28.10.2026');
    expect(formatDate('2026-10-28', 'YYYY-MM-DD')).toBe('2026-10-28');
    expect(formatDate('2026-10-28', 'd MMMM yy')).toBe('28 October 26');
  });

  it('gives the display date when there is no hint, or the hint is empty', () => {
    expect(formatDate('2026-10-28')).toBe('28-OCT-2026');
    expect(formatDate('2026-10-28', undefined)).toBe('28-OCT-2026');
    expect(formatDate('2026-10-28', '')).toBe('28-OCT-2026');
    expect(formatDate('2026-10-28', '  ')).toBe('28-OCT-2026');
  });

  it('gives the display date for a hint with no day, month or year token in it', () => {
    expect(formatDate('2026-10-28', '(24:00 UTC)')).toBe('28-OCT-2026');
    expect(formatDate('2026-10-28', 'UTC')).toBe('28-OCT-2026');
    expect(formatDate('2026-10-28', 'dddd')).toBe('28-OCT-2026');
    expect(formatDate('2026-10-28', 'yyy')).toBe('28-OCT-2026');
    expect(formatDate('not a date', '(24:00 UTC)')).toBe('not a date');
  });

  it('pads the day and the month for dd and MM, and not for d and M', () => {
    expect(formatDate('2026-03-05', 'dd/MM/yyyy')).toBe('05/03/2026');
    expect(formatDate('2026-03-05', 'd/M/yyyy')).toBe('5/3/2026');
    expect(formatDate('2026-03-05', 'DD.MM.YYYY')).toBe('05.03.2026');
    expect(formatDate('2026-03-05', 'D.M.YYYY')).toBe('5.3.2026');
    expect(formatDate('2026-03-05', 'dd.mm.yyyy')).toBe('05.03.2026');
    expect(formatDate('2026-03-05', 'd.m.yyyy')).toBe('5.3.2026');
  });

  it('writes the month as a name for MMM and MMMM, in any case, for every month', () => {
    const short = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const long = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    short.forEach((name, i) => {
      const iso = `2026-${String(i + 1).padStart(2, '0')}-01`;
      expect(formatDate(iso, 'MMM')).toBe(name);
      expect(formatDate(iso, 'mmm')).toBe(name);
      expect(formatDate(iso, 'MMMM')).toBe(long[i]);
    });
  });

  it('writes the year with 2 digits for yy and YY, and 4 for yyyy and YYYY, and pads a year before 1000', () => {
    expect(formatDate('2026-10-28', 'yy')).toBe('26');
    expect(formatDate('2026-10-28', 'YY')).toBe('26');
    expect(formatDate('2007-10-28', 'yy')).toBe('07');
    expect(formatDate('2026-10-28', 'YYYY')).toBe('2026');
    expect(formatDate('0999-10-28', 'yyyy')).toBe('0999');
  });

  it('keeps every other character as it is, and a letter run that is not a token', () => {
    expect(formatDate('2026-10-28', 'dd MMM yyyy "UTC"')).toBe('28 Oct 2026 "UTC"');
    expect(formatDate('2026-10-28', 'dd.MM.yyyy at 12:00')).toBe('28.10.2026 at 12:00');
    expect(formatDate('2026-10-28', '(dd/MMM/yyyy)')).toBe('(28/Oct/2026)');
    expect(formatDate('2026-10-28', 'dddd dd')).toBe('dddd 28');
    expect(formatDate('2026-10-28', 'yyy yy')).toBe('yyy 26');
    expect(formatDate('2026-10-28', 'MMMMM M')).toBe('MMMMM 10');
  });

  it('formats the first and last day of a month, and the 29th of February in a leap year', () => {
    expect(formatDate('2026-01-01', 'dd/MMM/yyyy')).toBe('01/Jan/2026');
    expect(formatDate('2026-12-31', 'dd/MMM/yyyy')).toBe('31/Dec/2026');
    expect(formatDate('2028-02-29', 'd MMMM yyyy')).toBe('29 February 2028');
  });

  it('gives text that is not a real date back as it is, with or without a hint', () => {
    for (const text of ['', 'tomorrow', '2026-13-01', '2026-02-30', '2027-02-29', '28/10/2026', '2026-1-1']) {
      expect(formatDate(text), text).toBe(text);
      expect(formatDate(text, 'dd/MMM/yyyy'), text).toBe(text);
    }
  });
});

describe('parseDate', () => {
  it('reads back what formatDate wrote, for each kind of hint', () => {
    const hints = ['dd/MMM/yyyy', 'DD.MM.YYYY', 'd/M/yyyy', 'd MMMM yy', 'yyyy-MM-dd', '(dd/MMM/yyyy)', 'dd.mm.yyyy', undefined, '', '(24:00 UTC)'];
    for (const iso of ['2026-10-28', '2026-01-01', '2026-03-05', '2028-02-29', '2026-12-31']) {
      for (const hint of hints) expect(parseDate(formatDate(iso, hint), hint), `${iso} ${hint}`).toBe(iso);
    }
  });

  it('gives undefined for text formatDate would not have written with that hint', () => {
    expect(parseDate('28/10/2026', 'dd/MMM/yyyy')).toBeUndefined();
    expect(parseDate('28/oct/2026', 'dd/MMM/yyyy')).toBeUndefined();
    expect(parseDate('31/Feb/2026', 'dd/MMM/yyyy')).toBeUndefined();
    expect(parseDate('5.3.2026', 'DD.MM.YYYY')).toBeUndefined();
    expect(parseDate('28-Oct-2026')).toBeUndefined();
    expect(parseDate('tomorrow', 'dd/MMM/yyyy')).toBeUndefined();
    expect(parseDate('', 'dd/MMM/yyyy')).toBeUndefined();
  });

  it('takes a 2-digit year to be in this century', () => {
    expect(parseDate('28/10/26', 'dd/MM/yy')).toBe('2026-10-28');
  });
});
