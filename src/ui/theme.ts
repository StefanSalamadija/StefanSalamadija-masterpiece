import type { Theme } from '../domain/types';
import { THEMES } from '../domain/theme';

// The theme list and the reading of a stored theme live in the domain, so the database code needs nothing from the UI.
export { THEMES, readTheme } from '../domain/theme';

/** Where the base theme is mirrored in localStorage. index.html reads it before the app starts. */
export const THEME_STORAGE_KEY = 'mp-theme';

/** Where what the first paint needs to know about automatic night is mirrored (Task 2 fills it). */
export const NIGHT_STORAGE_KEY = 'mp-night';

export const THEME_LABELS: Record<Theme, string> = {
  day: 'Day',
  dark: 'Dark',
  red: 'Night red',
  contrast: 'High contrast',
};

/**
 * The colour of each theme's bars (`--bar-bg` in theme.css), which the browser's status bar takes through
 * `meta[name=theme-color]`. The inline script in index.html holds the same four values.
 */
export const BAR_BG: Record<Theme, string> = {
  day: '#0B2545',
  dark: '#0E1B2B',
  red: '#000000',
  contrast: '#000000',
};

/** The theme after `theme` when the header button is tapped: Day, Dark, Night red, High contrast, and round again. */
export function nextTheme(theme: Theme): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
}

/** Puts `theme` on `<html data-theme>`, where theme.css picks it up, and its bar colour on the browser's status bar. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR_BG[theme]);
}

/**
 * Mirrors the base theme, and what automatic night needs (`night`, or null for nothing), into localStorage for the inline
 * script in index.html. The mirror is only a hint for the first paint: the settings in IndexedDB stay the truth.
 */
export function mirrorTheme(base: Theme, night: string | null): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, base);
    if (night === null) localStorage.removeItem(NIGHT_STORAGE_KEY);
    else localStorage.setItem(NIGHT_STORAGE_KEY, night);
  } catch {
    // Storage blocked (private window, site data off): the next start just paints the default theme first.
  }
}

/** Which logo goes with a theme: the night one in Dark, the one-colour red line logo in Night red, the day one otherwise. */
export function logoMode(theme: Theme): 'day' | 'night' | 'red' {
  if (theme === 'dark') return 'night';
  if (theme === 'red') return 'red';
  return 'day';
}
