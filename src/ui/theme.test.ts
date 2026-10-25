import { describe, expect, it } from 'vitest';
import indexHtml from '../../index.html?raw';
import { logoMode, nextTheme, THEME_LABELS, THEME_STORAGE_KEY } from './theme';

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

describe('the theme mirror read by index.html', () => {
  it('uses the same key and accepts exactly the three themes', () => {
    expect(THEME_STORAGE_KEY).toBe('mp-theme');
    const script = indexHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
    expect(script).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
    for (const theme of Object.keys(THEME_LABELS)) expect(script).toContain(`'${theme}'`);
    expect(indexHtml.indexOf('<script>')).toBeLessThan(indexHtml.indexOf('type="module"'));
  });
});
