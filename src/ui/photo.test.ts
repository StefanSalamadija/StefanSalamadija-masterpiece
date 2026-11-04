import { describe, expect, it } from 'vitest';
import { fitWithin } from './photo';

describe('fitWithin', () => {
  it('scales the longest side down to the limit and keeps the proportions', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(3001, 2000, 1600)).toEqual({ width: 1600, height: 1066 });
  });

  it('leaves a small picture as it is', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 1600, 1600)).toEqual({ width: 1600, height: 1600 });
    expect(fitWithin(10, 10, 1600)).toEqual({ width: 10, height: 10 });
  });

  it('never gives a side of less than one pixel', () => {
    expect(fitWithin(20000, 2, 1600)).toEqual({ width: 1600, height: 1 });
  });
});
