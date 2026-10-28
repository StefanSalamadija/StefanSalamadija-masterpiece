import { describe, expect, it } from 'vitest';
import { formatDate } from './format';
import { formatHintOf, isSignatureLabel, normaliseLabel } from './labels';

describe('normaliseLabel', () => {
  it('lower-cases and drops the colon and the surrounding spaces', () => {
    expect(normaliseLabel(' Vessel: ')).toBe('vessel');
  });

  it('strips the colon, brackets, asterisk and full stop, and keeps the words and the slash', () => {
    expect(normaliseLabel('Date of submission (dd/MMM/yyyy):')).toBe('date of submission dd/mmm/yyyy');
    expect(normaliseLabel('Year / Week No.')).toBe('year / week no');
    expect(normaliseLabel('Name *')).toBe('name');
  });

  it('collapses runs of spaces, tabs, line breaks and non-breaking spaces to one space', () => {
    expect(normaliseLabel('  Time\u00a0\u00a0IN \t\n Local ')).toBe('time in local');
  });

  it('keeps words apart when the stripped character was the only thing between them', () => {
    expect(normaliseLabel('Signature:(Person in charge)')).toBe(normaliseLabel('Signature (Person in charge)'));
    expect(normaliseLabel('Signature:(Person in charge)')).toBe('signature person in charge');
  });

  it('gives the same answer for the same label written with different case, so a label can be matched', () => {
    expect(normaliseLabel('VESSEL NAME:')).toBe(normaliseLabel('Vessel name'));
  });

  it('gives an empty text for text with nothing in it', () => {
    expect(normaliseLabel('')).toBe('');
    expect(normaliseLabel(' : ( ) * . ')).toBe('');
  });
});

describe('isSignatureLabel', () => {
  it('is true for the whole words signature, signed, sign and stamp, in any case', () => {
    for (const label of ['Signature:(Person in charge)', 'Signature', 'SIGNED', 'Signed by', 'sign', 'Stamp', "Master's stamp", 'Sign / Date', 'Sign-off']) {
      expect(isSignatureLabel(label), label).toBe(true);
    }
  });

  it('is false when those letters are only part of another word', () => {
    for (const label of ['Designated', 'Signal', 'Assigned', 'Resigned', 'Stamped', 'Stampede', 'Consignee']) {
      expect(isSignatureLabel(label), label).toBe(false);
    }
  });

  it('is false for labels with none of the words', () => {
    for (const label of ['', 'Vessel', 'Name / Rank', 'Date']) expect(isSignatureLabel(label), label).toBe(false);
  });
});

describe('formatHintOf', () => {
  it('finds the hint in a label and gives it as it was written', () => {
    expect(formatHintOf('Date of submission (dd/MMM/yyyy):')).toBe('dd/MMM/yyyy');
    expect(formatHintOf('Date (DD.MM.YYYY)')).toBe('DD.MM.YYYY');
    expect(formatHintOf('Date dd.mm.yyyy')).toBe('dd.mm.yyyy');
    expect(formatHintOf('Date: YYYY-MM-DD')).toBe('YYYY-MM-DD');
  });

  it('finds the other day, month and year patterns that formatDate formats', () => {
    expect(formatHintOf('Date (dd-mmm-yy)')).toBe('dd-mmm-yy');
    expect(formatHintOf('Date (DD/MM/YYYY)')).toBe('DD/MM/YYYY');
    expect(formatHintOf('Date (d MMMM yyyy)')).toBe('d MMMM yyyy');
    expect(formatHintOf('Date (MM/DD/YYYY)')).toBe('MM/DD/YYYY');
  });

  it('finds the 24:00 UTC hint, brackets included, as it was written', () => {
    expect(formatHintOf('Time (24:00 UTC)')).toBe('(24:00 UTC)');
    expect(formatHintOf('Time ( 24:00 utc ):')).toBe('( 24:00 utc )');
  });

  it('gives the first hint when a label holds both', () => {
    expect(formatHintOf('Date (dd/MMM/yyyy) (24:00 UTC)')).toBe('dd/MMM/yyyy');
    expect(formatHintOf('(24:00 UTC) Date dd/MMM/yyyy')).toBe('(24:00 UTC)');
  });

  it('does not give a year of 3 digits, or any hint that formatDate cannot format', () => {
    expect(formatHintOf('Date (dd/mmm/yyy)')).toBeUndefined();
    expect(formatHintOf('Date (yyy-mm-dd)')).toBeUndefined();
    expect(formatHintOf('Date (dd/mmm/yyyyy)')).toBeUndefined();
  });

  it('gives undefined when there is no hint', () => {
    for (const label of ['', 'Vessel', 'Date', 'Time', 'Length (mm)', 'Month / Year (MM/YYYY)', 'Time (24:00)', 'and my day']) {
      expect(formatHintOf(label), label).toBeUndefined();
    }
  });

  it('does not take a hint out of the middle of a word', () => {
    expect(formatHintOf('Xdd/MMM/yyyy')).toBeUndefined();
    expect(formatHintOf('dd/MMM/yyyyx')).toBeUndefined();
  });

  it('gives hints that formatDate can use', () => {
    const labels: [string, string][] = [
      ['Date of submission (dd/MMM/yyyy):', '28/Oct/2026'],
      ['Date (DD.MM.YYYY)', '28.10.2026'],
      ['Date dd.mm.yyyy', '28.10.2026'],
      ['Date (YYYY-MM-DD)', '2026-10-28'],
    ];
    for (const [label, expected] of labels) expect(formatDate('2026-10-28', formatHintOf(label)), label).toBe(expected);
  });
});
