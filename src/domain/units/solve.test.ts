import { describe, expect, it } from 'vitest';
import type { ClockChange } from '../types';
import { etaOf, formatDuration, parseDuration, solveSdt, solveVolumeMass } from './solve';

function change(id: string, effectiveAt: string, toOffsetMinutes: number, deleted = false): ClockChange {
  return { id, shipId: 's', effectiveAt, toOffsetMinutes, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', deleted } as ClockChange;
}

describe('speed, distance, time', () => {
  it('reads durations', () => {
    expect(parseDuration('28:30')).toBe(28.5);
    expect(parseDuration('1d 4h 30m')).toBe(28.5);
    expect(parseDuration('28,5')).toBe(28.5);
    expect(parseDuration('45m')).toBe(0.75);
    expect(parseDuration('2:60')).toBe('invalid');
    expect(parseDuration('0')).toBe('invalid');
    expect(parseDuration('abc')).toBe('invalid');
    expect(parseDuration(' ')).toBeUndefined();
  });
  it('formats durations to the minute', () => {
    expect(formatDuration(28.5)).toBe('28:30 (1 d 4 h 30 min)');
    expect(formatDuration(2.25)).toBe('2:15');
    expect(formatDuration(9.99999)).toBe('10:00');
  });
  it('solves the third value', () => {
    expect(solveSdt({ speedKn: 12, hours: 10 }, 'distance')).toBe(120);
    expect(solveSdt({ distanceNm: 120, hours: 10 }, 'speed')).toBe(12);
    expect(solveSdt({ distanceNm: 120, speedKn: 12 }, 'time')).toBe(10);
    expect(solveSdt({ speedKn: 0, distanceNm: 120 }, 'time')).toBe('invalid');
    expect(solveSdt({ distanceNm: 120 }, 'time')).toBe('invalid');
  });
  it('gives the ETA with the offset in force at arrival', () => {
    const changes = [
      change('a', '2026-11-01T00:00:00.000Z', 180),
      change('b', '2026-11-16T00:00:00.000Z', 120),
      change('c', '2026-11-15T12:00:00.000Z', 60, true),
    ];
    const eta = etaOf(new Date('2026-11-15T00:00:00Z'), 30, changes);
    expect(eta.utc).toBe('2026-11-16T06:00');
    expect(eta.offsetMinutes).toBe(120);
    expect(eta.shipLocal).toBe('2026-11-16T08:00');
    expect(eta.changesBefore.map((c) => c.id)).toEqual(['b']);
  });
});

describe('volume and mass', () => {
  it('solves any one of the three', () => {
    expect(solveVolumeMass({ volumeM3: 100, densityKgM3: 991 }, 'mass')).toBe(99100);
    expect(solveVolumeMass({ massKg: 99100, densityKgM3: 991 }, 'volume')).toBeCloseTo(100, 9);
    expect(solveVolumeMass({ massKg: 99100, volumeM3: 100 }, 'density')).toBeCloseTo(991, 9);
    expect(solveVolumeMass({ volumeM3: 100, densityKgM3: 0 }, 'mass')).toBe('invalid');
  });
});
