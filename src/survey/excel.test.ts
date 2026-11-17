import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HydroRow } from '../domain/types';
import { excelRound, setLookupCompare, vlookupApprox } from './excel';
import type { LookupCompare } from './excel';

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

/*
 * The VLOOKUP compare rule is pending confirmation in Excel (see excel.ts). These cases tell the two rules apart: y
 * worked out in binary just below a row's draft.
 */
describe.each<[LookupCompare, 'low' | 'high']>([['decimal15', 'high'], ['binary', 'low']])('vlookupApprox with the %s compare', (rule, answer) => {
  let previous: LookupCompare;
  beforeEach(() => { previous = setLookupCompare(rule); });
  afterEach(() => { setLookupCompare(previous); });

  it(`takes 0.7 + 0.1 (= ${0.7 + 0.1}) to the ${answer} row of {0.7; 0.8}`, () => {
    expect(0.7 + 0.1).toBeLessThan(0.8);
    const pair = [row(0.7), row(0.8)];
    expect(vlookupApprox(pair, 0.7, 0.7 + 0.1)).toBe(answer === 'high' ? pair[1] : pair[0]);
  });

  it(`takes 4.965 + 0.1 to the ${answer} row of {5; 5.065}`, () => {
    const pair = [row(5), row(5.065)];
    expect(vlookupApprox(pair, 5, 4.965 + 0.1)).toBe(answer === 'high' ? pair[1] : pair[0]);
  });

  it('agrees with the other rule where y is not near a row', () => {
    expect(vlookupApprox(rows, 1, 1.1 + 0.1)).toBe(rows[2]); // 1.2000000000000002: above the row in binary too
    expect(vlookupApprox(rows, 1, 1.25)).toBe(rows[2]);
  });
});
