import type { Theme } from '../domain/types';

/** Where the last-applied theme is mirrored in localStorage. index.html reads it before the app starts. */
export const THEME_STORAGE_KEY = 'mp-theme';

export const THEME_LABELS: Record<Theme, string> = {
  day: 'Day',
  night: 'Night',
  contrast: 'High contrast',
};

const ORDER: readonly Theme[] = ['day', 'night', 'contrast'];

/** The theme after `theme` when the header button is tapped: day, night, high contrast, and round again. */
export function nextTheme(theme: Theme): Theme {
  return ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
}

/**
 * Puts `theme` on `<html data-theme>`, where theme.css picks it up, and mirrors it into localStorage for the inline
 * script in index.html. The mirror is only a hint for the first paint: the setting in IndexedDB stays the truth.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked (private window, site data off): the next start just paints the default theme first.
  }
}

/** Which logo goes with a theme: the night one only in the night theme. */
export function logoMode(theme: Theme): 'day' | 'night' {
  return theme === 'night' ? 'night' : 'day';
}
