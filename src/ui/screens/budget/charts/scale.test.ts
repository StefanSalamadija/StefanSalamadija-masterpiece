import { describe, expect, it } from 'vitest';
import { compactMoney, linePath, niceTicks, scaleLinear, shortMonth, tickIndexes } from './scale';

describe('niceTicks', () => {
  it('rounds the domain out to round steps', () => {
    expect(niceTicks(130, 970, 4)).toEqual({ min: 0, max: 1000, ticks: [0, 250, 500, 750, 1000] });
    expect(niceTicks(-1234, 5678, 4)).toEqual({ min: -2000, max: 6000, ticks: [-2000, 0, 2000, 4000, 6000] });
  });

  it('can take zero in, for bars', () => {
    expect(niceTicks(500, 800, 3)).toEqual({ min: 500, max: 800, ticks: [500, 600, 700, 800] });
    expect(niceTicks(500, 800, 3, { zero: true })).toEqual({ min: 0, max: 1000, ticks: [0, 500, 1000] });
  });

  it('gives a flat or empty series a range around it', () => {
    expect(niceTicks(0, 0, 4)).toEqual({ min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] });
    expect(niceTicks(300, 300, 2)).toEqual({ min: 0, max: 400, ticks: [0, 200, 400] });
  });
});

describe('scaleLinear', () => {
  it('maps the domain onto the range, upside down for a y axis', () => {
    const y = scaleLinear([0, 100], [200, 0]);
    expect([y(0), y(50), y(100)]).toEqual([200, 100, 0]);
  });

  it('maps a single value to the middle', () => {
    expect(scaleLinear([5, 5], [0, 10])(5)).toBe(5);
  });
});

describe('linePath', () => {
  it('draws through the points, rounded to a tenth', () => {
    expect(linePath([[0, 10], [10.04, 5.55], [20, 0]])).toBe('M0 10L10 5.6L20 0');
    expect(linePath([])).toBe('');
  });
});

describe('tickIndexes', () => {
  it('spreads at most n labels from the first to the last', () => {
    expect(tickIndexes(24, 4)).toEqual([0, 8, 16, 23]);
    expect(tickIndexes(3, 6)).toEqual([0, 1, 2]);
    expect(tickIndexes(1, 4)).toEqual([0]);
    expect(tickIndexes(0, 4)).toEqual([]);
  });
});

describe('compactMoney', () => {
  it('writes axis amounts short', () => {
    expect(compactMoney(0)).toBe('€0');
    expect(compactMoney(50000)).toBe('€500');
    expect(compactMoney(123456)).toBe('€1.2k');
    expect(compactMoney(1800000)).toBe('€18k');
    expect(compactMoney(150000000)).toBe('€1.5M');
    expect(compactMoney(-350000)).toBe('−€3.5k');
  });
});

describe('shortMonth', () => {
  it('writes a month short', () => {
    expect(shortMonth('2026-10')).toBe('Oct 26');
  });
});
