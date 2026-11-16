import { describe, expect, it } from 'vitest';
import type { HydroRow } from '../domain/types';
import { excelRound, vlookupApprox } from './excel';

describe('excelRound: Excel ROUND, half away from zero, on the decimal value', () => {
  it.each([
    [2.0005, 3, 2.001], // binary 2.000499999…: Excel still rounds up
    [-1.2345, 3, -1.235], // negative tie: away from zero
    [1.2345, 3, 1.235],
    [1.0049999999999999, 2, 1.01], // the same double as 1.005
    [2.675, 2, 2.68],
    [-2.675, 2, -2.68],
    [0.5, 0, 1],
    [-0.5, 0, -1],
    [2.5, 0, 3],
    [1.23449, 3, 1.234],
    [-1.23449, 3, -1.234],
    [1234.5678, -2, 1200],
    [1250, -2, 1300],
    [0.00049, 3, 0],
    [0.0005, 3, 0.001],
    [10044.6579999, 3, 10044.658],
    [4175.857999999999, 3, 4175.858],
    [123456789.12345, 4, 123456789.1235],
  ])('ROUND(%s, %s) = %s', (x, digits, expected) => {
    expect(excelRound(x, digits)).toBe(expected);
  });

  it('never gives a negative zero', () => {
    expect(Object.is(excelRound(-0.0004, 3), 0)).toBe(true);
    expect(Object.is(excelRound(-0, 2), 0)).toBe(true);
  });

  it('keeps a value that already has fewer decimals', () => {
    expect(excelRound(6.3, 4)).toBe(6.3);
    expect(excelRound(-0.0176, 4)).toBe(-0.0176);
  });
});

const row = (draft: number): HydroRow => ({ draft, displacement: draft * 1000, tpc: 0, mtc: 0, lcbMid: 0, lcfMid: 0 });
const rows = [1, 1.1, 1.2, 1.3, 1.4, 1.45, 1.5, 1.6].map(row);

describe('vlookupApprox: the last row whose draft ≤ y, from the range start', () => {
  it('finds a row exactly on its draft', () => {
    expect(vlookupApprox(rows, 1, 1.2)).toBe(rows[2]);
  });

  it('takes the row below between rows', () => {
    expect(vlookupApprox(rows, 1, 1.25)).toBe(rows[2]);
    expect(vlookupApprox(rows, 1, 1.47)).toBe(rows[5]); // the irregular 1.45 row
  });

  it('matches a draft worked out in binary as the decimal value (1.1 + 0.1 is the 1.2 row)', () => {
    expect(1.1 + 0.1).not.toBe(1.2);
    expect(vlookupApprox(rows, 1, 1.1 + 0.1)).toBe(rows[2]);
    expect(vlookupApprox(rows, 1, 0.7 + 0.5)).toBe(rows[2]);
  });

  it('refuses a y below the range start, even with rows below it in the table', () => {
    expect(vlookupApprox(rows, 1.2, 1.19)).toBe('outOfRange');
    expect(vlookupApprox(rows, 1.2, 1.2)).toBe(rows[2]);
    expect(vlookupApprox(rows, 1, 0.99)).toBe('outOfRange');
  });

  it('finds the last row on its draft and refuses anything above it (Excel would return the last row)', () => {
    expect(vlookupApprox(rows, 1, 1.6)).toBe(rows[7]);
    expect(vlookupApprox(rows, 1, 1.6001)).toBe('outOfRange');
  });

  it('refuses a range start past the end of the table', () => {
    expect(vlookupApprox(rows, 2, 2)).toBe('outOfRange');
  });
});
