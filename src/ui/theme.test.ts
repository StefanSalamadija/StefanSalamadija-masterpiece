import { describe, expect, it } from 'vitest';
import { logoMode, nextTheme, THEME_LABELS } from './theme';

describe('nextTheme', () => {
  it('cycles day, night, high contrast, day', () => {
    expect(nextTheme('day')).toBe('night');
    expect(nextTheme('night')).toBe('contrast');
    expect(nextTheme('contrast')).toBe('day');
  });

  it('has a label for the theme button of each theme', () => {
    expect(THEME_LABELS).toEqual({ day: 'Day', night: 'Night', contrast: 'High contrast' });
  });
});

describe('logoMode', () => {
  it('uses the night logo only in the night theme', () => {
    expect(logoMode('day')).toBe('day');
    expect(logoMode('night')).toBe('night');
    expect(logoMode('contrast')).toBe('day');
  });
});
