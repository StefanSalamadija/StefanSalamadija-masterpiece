import { describe, expect, it } from 'vitest';
import { convertFrom } from './convert';
import { formatFeetInches, parseFeetInches } from './feetInches';

describe('feet and inches', () => {
  it('parses the usual ways of writing a draft', () => {
    expect(parseFeetInches(`32' 6.5"`)).toBeCloseTo((32 * 12 + 6.5) * 0.0254, 12);
    expect(parseFeetInches(`32'6"`)).toBeCloseTo((32 * 12 + 6) * 0.0254, 12);
    expect(parseFeetInches('32 6,5')).toBeCloseTo((32 * 12 + 6.5) * 0.0254, 12);
    expect(parseFeetInches(`32'`)).toBeCloseTo(32 * 12 * 0.0254, 12);
    expect(parseFeetInches('32')).toBeCloseTo(32 * 12 * 0.0254, 12);
    expect(parseFeetInches(`0' 11¾"`)).toBeCloseTo(11.75 * 0.0254, 12);
    expect(parseFeetInches(`32' 6¼"`)).toBeCloseTo((32 * 12 + 6.25) * 0.0254, 12);
  });
  it('reads a lone number with an inch mark as inches (review I1)', () => {
    expect(parseFeetInches(`6¼"`)).toBeCloseTo(6.25 * 0.0254, 12);
    expect(parseFeetInches(`326"`)).toBeCloseTo(326 * 0.0254, 12);
    expect(parseFeetInches('¾')).toBeCloseTo(0.75 * 0.0254, 12);
  });
  it('refuses inches of 12 or more and junk', () => {
    expect(parseFeetInches(`5' 12"`)).toBe('invalid');
    expect(parseFeetInches('abc')).toBe('invalid');
    expect(parseFeetInches('-1')).toBe('invalid');
    expect(parseFeetInches('')).toBeUndefined();
  });
  it('formats to the nearest quarter inch, carrying into feet', () => {
    expect(formatFeetInches((32 * 12 + 6.25) * 0.0254)).toBe(`32' 6¼"`);
    expect(formatFeetInches(0.30475)).toBe(`1' 0"`);
    expect(formatFeetInches(parseFeetInches(`41' 0¼"`) as number)).toBe(`41' 0¼"`);
    expect(formatFeetInches(0)).toBe(`0' 0"`);
  });
  it('is wired into the length converter', () => {
    expect(convertFrom('m', '12.5')).toMatchObject({ values: { ftin: `41' 0¼"` } });
    expect(convertFrom('ftin', `10' 0"`)).toMatchObject({ values: { m: '3.048' } });
    expect(convertFrom('ftin', `5' 12"`)).toEqual({ ok: false, message: 'Not a number' });
  });
});
