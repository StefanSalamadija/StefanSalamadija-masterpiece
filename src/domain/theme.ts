import type { Theme } from './types';

/** Every theme, in the order the header button goes through them and the Settings select lists them. */
export const THEMES: readonly Theme[] = ['day', 'dark', 'red', 'contrast'];

/** A stored theme as a theme: the navy `night` of before piece 7 is now Dark, and anything unknown is Day. */
export function readTheme(value: unknown): Theme {
  if (value === 'night') return 'dark';
  return THEMES.includes(value as Theme) ? (value as Theme) : 'day';
}
