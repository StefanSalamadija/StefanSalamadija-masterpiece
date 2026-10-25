import type { Theme } from '../domain/types';

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

/** Puts `theme` on `<html data-theme>`, where theme.css picks it up. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/** Which logo goes with a theme: the night one only in the night theme. */
export function logoMode(theme: Theme): 'day' | 'night' {
  return theme === 'night' ? 'night' : 'day';
}
