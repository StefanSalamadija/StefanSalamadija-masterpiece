import { describe, expect, it } from 'vitest';
import { parseDecimal } from './numbers';

describe('parseDecimal', () => {
  it('reads a plain number, with a dot or a comma as the decimal separator', () => {
    expect(parseDecimal('229')).toBe(229);
    expect(parseDecimal('229.5')).toBe(229.5);
    expect(parseDecimal('229,5')).toBe(229.5);
    expect(parseDecimal('0.25')).toBe(0.25);
    expect(parseDecimal('007')).toBe(7);
  });

  it('ignores whitespace around the number', () => {
    expect(parseDecimal(' 32 ')).toBe(32);
    expect(parseDecimal('\t32500.5\n')).toBe(32500.5);
  });

  it('has no value for an empty entry', () => {
    expect(parseDecimal('')).toBeUndefined();
    expect(parseDecimal('   ')).toBeUndefined();
  });

  it('rejects anything that is not digits with at most one separator', () => {
    for (const text of ['2e', '2e3', '1e-5', 'abc', '12 5', '1,000.5', '1.000,5', '1.2.3', '1,2,3', '1.,5', '--5', '+5', '5%', '٣']) {
      expect(parseDecimal(text), text).toBe('invalid');
    }
  });

  it('needs digits on both sides of the separator, so a bare .5 or 5. is rejected', () => {
    expect(parseDecimal('.5')).toBe('invalid');
    expect(parseDecimal(',5')).toBe('invalid');
    expect(parseDecimal('5.')).toBe('invalid');
    expect(parseDecimal('5,')).toBe('invalid');
    expect(parseDecimal('.')).toBe('invalid');
  });

  it('reads a single comma as the decimal separator, so 1,000 is one', () => {
    expect(parseDecimal('1,000')).toBe(1);
  });

  it('rejects a sign unless the caller allows a minus', () => {
    expect(parseDecimal('-5')).toBe('invalid');
    expect(parseDecimal('-5.5')).toBe('invalid');
    expect(parseDecimal('-5', { signed: true })).toBe(-5);
    expect(parseDecimal('-5,5', { signed: true })).toBe(-5.5);
    expect(parseDecimal(' -0.5 ', { signed: true })).toBe(-0.5);
    expect(parseDecimal('5', { signed: true })).toBe(5);
    expect(parseDecimal('', { signed: true })).toBeUndefined();
  });

  it('still rejects a lone minus, a plus, a minus after the digits and a space after the minus when signed', () => {
    for (const text of ['-', '+5', '5-', '- 5', '--5', '-.5', '-5.']) {
      expect(parseDecimal(text, { signed: true }), text).toBe('invalid');
    }
  });

  it('rejects a number too large to be a number', () => {
    expect(parseDecimal('9'.repeat(400))).toBe('invalid');
  });
});
