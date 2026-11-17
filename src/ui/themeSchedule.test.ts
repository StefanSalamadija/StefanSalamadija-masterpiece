import { describe, expect, it } from 'vitest';
import {
  effectiveTheme, inNightWindow, nextBoundary, NIGHT_TIMES, nightMirror, overrideActive, themeButtonLabel, themeTap,
} from './themeSchedule';
import type { ThemeSettings } from './themeSchedule';

const base = (over: Partial<ThemeSettings> = {}): ThemeSettings => ({
  theme: 'day', nightAuto: false, nightFrom: '18:00', nightTo: '06:00', ...over,
});
const auto = (over: Partial<ThemeSettings> = {}): ThemeSettings => base({ nightAuto: true, ...over });

describe('inNightWindow', () => {
  it.each([
    ['17:59', false], ['18:00', true], ['23:59', true], ['00:00', true], ['05:59', true], ['06:00', false],
  ])('18:00–06:00 (across midnight): %s is %s', (hhmm, inside) => {
    expect(inNightWindow(hhmm, '18:00', '06:00')).toBe(inside);
  });

  it.each([['12:00', true], ['18:00', false], ['06:00', true], ['05:59', false]])('06:00–18:00: %s is %s', (hhmm, inside) => {
    expect(inNightWindow(hhmm, '06:00', '18:00')).toBe(inside);
  });

  it('is never inside when From equals To', () => {
    expect(inNightWindow('12:00', '09:00', '09:00')).toBe(false);
    expect(inNightWindow('09:00', '09:00', '09:00')).toBe(false);
  });
});

describe('nextBoundary', () => {
  it.each([
    ['2026-11-17T05:59', '2026-11-17T06:00'],
    ['2026-11-17T06:00', '2026-11-17T18:00'],
    ['2026-11-17T12:00', '2026-11-17T18:00'],
    ['2026-11-17T18:00', '2026-11-18T06:00'],
    ['2026-11-17T23:30', '2026-11-18T06:00'],
    ['2026-12-31T19:00', '2027-01-01T06:00'],
  ])('18:00–06:00 from %s is %s', (now, next) => {
    expect(nextBoundary(now, '18:00', '06:00')).toBe(next);
  });

  it('works for a window that does not cross midnight', () => {
    expect(nextBoundary('2026-11-17T05:00', '06:00', '18:00')).toBe('2026-11-17T06:00');
    expect(nextBoundary('2026-11-17T19:00', '06:00', '18:00')).toBe('2026-11-18T06:00');
  });

  it('is undefined when From equals To', () => {
    expect(nextBoundary('2026-11-17T05:59', '09:00', '09:00')).toBeUndefined();
  });
});

describe('effectiveTheme', () => {
  it('is the base theme at any time when automatic night is off', () => {
    for (const now of ['2026-11-17T12:00', '2026-11-17T20:00', '2026-11-17T03:00']) {
      expect(effectiveTheme(base({ theme: 'dark' }), now)).toBe('dark');
    }
  });

  it('is Night red inside the window and the base theme outside it, when automatic night is on', () => {
    expect(effectiveTheme(auto({ theme: 'contrast' }), '2026-11-17T20:00')).toBe('red');
    expect(effectiveTheme(auto({ theme: 'contrast' }), '2026-11-17T03:00')).toBe('red');
    expect(effectiveTheme(auto({ theme: 'contrast' }), '2026-11-17T12:00')).toBe('contrast');
  });

  it('takes an override whose end is still ahead', () => {
    const s = auto({ themeOverride: { theme: 'dark', until: '2026-11-17T06:00' } });
    expect(overrideActive(s, '2026-11-17T05:59')).toBe(true);
    expect(effectiveTheme(s, '2026-11-17T05:59')).toBe('dark');
  });

  it('ignores an override at or past its end', () => {
    const s = auto({ themeOverride: { theme: 'dark', until: '2026-11-17T06:00' } });
    expect(overrideActive(s, '2026-11-17T06:00')).toBe(false);
    expect(effectiveTheme(s, '2026-11-17T06:00')).toBe('day');
    expect(effectiveTheme(s, '2026-11-17T07:00')).toBe('day');
  });

  it('ignores an override when automatic night is off', () => {
    const s = base({ themeOverride: { theme: 'dark', until: '2026-11-17T06:00' } });
    expect(overrideActive(s, '2026-11-17T05:00')).toBe(false);
    expect(effectiveTheme(s, '2026-11-17T05:00')).toBe('day');
  });

  it('follows a clock change, since ship-local times are compared as they are', () => {
    const s = auto({ themeOverride: { theme: 'contrast', until: '2026-11-17T06:00' } });
    expect(effectiveTheme(s, '2026-11-17T05:30')).toBe('contrast');
    // The clocks go forward an hour: ship's time jumps from 05:30 to 06:30, past the end of the override.
    expect(overrideActive(s, '2026-11-17T06:30')).toBe(false);
    expect(effectiveTheme(s, '2026-11-17T06:30')).toBe('day');
    // And back an hour, once the expired override is cleared: 05:30 is inside the window again.
    expect(effectiveTheme(auto(), '2026-11-17T05:30')).toBe('red');
  });
});

describe('themeTap', () => {
  it('changes the base theme when automatic night is off', () => {
    expect(themeTap(base({ theme: 'day' }), '2026-11-17T05:59')).toEqual({ theme: 'dark' });
    expect(themeTap(base({ theme: 'contrast' }), '2026-11-17T05:59')).toEqual({ theme: 'day' });
  });

  it('sets an override from the theme showing until the next boundary, when automatic night is on', () => {
    expect(themeTap(auto(), '2026-11-17T05:59')).toEqual({ themeOverride: { theme: 'contrast', until: '2026-11-17T06:00' } });
    expect(themeTap(auto(), '2026-11-17T12:00')).toEqual({ themeOverride: { theme: 'dark', until: '2026-11-17T18:00' } });
  });

  it('moves an active override on to the next theme', () => {
    const s = auto({ themeOverride: { theme: 'contrast', until: '2026-11-17T06:00' } });
    expect(themeTap(s, '2026-11-17T05:59')).toEqual({ themeOverride: { theme: 'day', until: '2026-11-17T06:00' } });
  });

  it('changes the base theme when there is no next boundary (From equals To)', () => {
    expect(themeTap(auto({ nightFrom: '09:00', nightTo: '09:00' }), '2026-11-17T05:59')).toEqual({ theme: 'dark' });
  });
});

describe('themeButtonLabel', () => {
  it('names the base theme when automatic night is off', () => {
    expect(themeButtonLabel(base(), '2026-11-17T20:00')).toBe('Theme: Day');
  });

  it('names the theme showing and says it is automatic, when automatic night is on', () => {
    expect(themeButtonLabel(auto(), '2026-11-17T20:00')).toBe('Theme: Night red, automatic');
    expect(themeButtonLabel(auto(), '2026-11-17T12:00')).toBe('Theme: Day, automatic');
  });

  it('names the override and when it ends, while one is active', () => {
    const s = auto({ themeOverride: { theme: 'dark', until: '2026-11-17T06:00' } });
    expect(themeButtonLabel(s, '2026-11-17T05:00')).toBe('Theme: Dark, until 06:00');
    expect(themeButtonLabel(s, '2026-11-17T06:00')).toBe('Theme: Day, automatic');
  });
});

describe('nightMirror', () => {
  it('is null when automatic night is off', () => {
    expect(nightMirror(base({ themeOverride: { theme: 'dark', until: '2026-11-17T06:00' } }), 180)).toBeNull();
  });

  it('holds the window and the offset, and the override when there is one, as JSON', () => {
    expect(JSON.parse(nightMirror(auto(), 180) ?? '')).toEqual({ from: '18:00', to: '06:00', offset: 180 });
    const s = auto({ nightFrom: '20:15', nightTo: '05:45', themeOverride: { theme: 'contrast', until: '2026-11-18T05:45' } });
    expect(JSON.parse(nightMirror(s, -330) ?? '')).toEqual({
      from: '20:15', to: '05:45', offset: -330, override: 'contrast', until: '2026-11-18T05:45',
    });
  });
});

describe('NIGHT_TIMES', () => {
  it('lists every quarter hour of the day, in order', () => {
    expect(NIGHT_TIMES).toHaveLength(96);
    expect(NIGHT_TIMES.slice(0, 5)).toEqual(['00:00', '00:15', '00:30', '00:45', '01:00']);
    expect(NIGHT_TIMES.at(-1)).toBe('23:45');
    expect(NIGHT_TIMES).toContain('18:00');
    expect(NIGHT_TIMES).toContain('06:00');
    expect([...NIGHT_TIMES].sort()).toEqual(NIGHT_TIMES);
  });
});
