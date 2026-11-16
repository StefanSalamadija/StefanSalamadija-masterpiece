import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney } from './money';

describe('parseMoney', () => {
  it.each([
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['12,5', 1250],
    [' 7 ', 700],
    ['€12', 1200],
    ['0,05', 5],
    ['1.234', 123400],
    ['12.345,6', 1234560],
    ['1234,56', 123456],
    ['1234.56', 123456],
    ['1.234.567', 123456700],
    ['1,234,567.89', 123456789],
    ['12 €', 1200],
  ])('reads %j as %d cents', (text, cents) => {
    expect(parseMoney(text)).toBe(cents);
  });

  it('refuses a negative amount unless one is allowed', () => {
    expect(parseMoney('-5')).toBe('invalid');
    expect(parseMoney('-5', { negative: true })).toBe(-500);
    expect(parseMoney('−€5,20', { negative: true })).toBe(-520);
  });

  it.each(['abc', '1.2.3', '1.2345', '1,234.567', '12,', '1,23,4', '1.234,5,6', '€', '1 2', '--5'])('refuses %j', (text) => {
    expect(parseMoney(text, { negative: true })).toBe('invalid');
  });

  it('gives nothing for an empty field', () => {
    expect(parseMoney('')).toBeUndefined();
    expect(parseMoney('   ')).toBeUndefined();
  });

  it('always gives whole cents', () => {
    for (const text of ['0,1', '19,99', '1.234,56', '0.07']) expect(Number.isInteger(parseMoney(text))).toBe(true);
  });
});

describe('formatMoney', () => {
  it.each([
    [123456, '€1,234.56'],
    [-500, '−€5.00'],
    [0, '€0.00'],
    [5, '€0.05'],
    [123456789, '€1,234,567.89'],
  ])('shows %d cents as %s', (cents, text) => {
    expect(formatMoney(cents)).toBe(text);
  });

  it('reads back what it shows', () => {
    for (const cents of [0, 5, 1250, 123456, 123456789]) expect(parseMoney(formatMoney(cents))).toBe(cents);
    expect(parseMoney(formatMoney(-500), { negative: true })).toBe(-500);
  });
});
