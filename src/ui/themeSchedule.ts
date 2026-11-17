import { addDays } from '../domain/dates';
import type { Settings, Theme } from '../domain/types';
import { nextTheme, THEME_LABELS } from './theme';

/**
 * Automatic night (spec §8, §12.5). Every time here is ship-local, written as `HH:MM` or `YYYY-MM-DDTHH:mm`, and compared
 * as text. So a clock change needs no special case: ship's time simply jumps, and whatever it jumps past is past.
 */
export type ThemeSettings = Pick<Settings, 'theme' | 'nightAuto' | 'nightFrom' | 'nightTo' | 'themeOverride'>;

/** Whether `hhmm` is inside the window from `from` (included) to `to` (left out), which may cross midnight. From equal to To is never. */
export function inNightWindow(hhmm: string, from: string, to: string): boolean {
  if (from < to) return hhmm >= from && hhmm < to;
  if (from > to) return hhmm >= from || hhmm < to;
  return false;
}

/** The next ship-local time after `shipNow` at which it goes into or out of the window; none when From equals To. */
export function nextBoundary(shipNow: string, from: string, to: string): string | undefined {
  if (from === to) return undefined;
  const date = shipNow.slice(0, 10);
  const time = shipNow.slice(11, 16);
  const [first, second] = from < to ? [from, to] : [to, from];
  if (time < first) return `${date}T${first}`;
  if (time < second) return `${date}T${second}`;
  return `${addDays(date, 1)}T${first}`;
}

/** Whether a theme chosen with the header button still holds: automatic night is on and its end has not come. */
export function overrideActive(s: ThemeSettings, shipNow: string): boolean {
  return s.nightAuto && s.themeOverride !== undefined && shipNow < s.themeOverride.until;
}

/** The theme to show: a held one while it holds, else Night red inside the window when automatic night is on, else the base theme. */
export function effectiveTheme(s: ThemeSettings, shipNow: string): Theme {
  if (overrideActive(s, shipNow)) return s.themeOverride!.theme;
  if (s.nightAuto && inNightWindow(shipNow.slice(11, 16), s.nightFrom, s.nightTo)) return 'red';
  return s.theme;
}

/**
 * What a tap on the header button writes. With automatic night off it changes the base theme, as it always has. With it
 * on, the theme after the one showing is held until the next switch; when there is no next switch (From equals To, so
 * automatic night never comes on) the tap changes the base theme.
 */
export function themeTap(s: ThemeSettings, shipNow: string): Partial<Settings> {
  if (!s.nightAuto) return { theme: nextTheme(s.theme) };
  const until = nextBoundary(shipNow, s.nightFrom, s.nightTo);
  if (until === undefined) return { theme: nextTheme(s.theme) };
  return { themeOverride: { theme: nextTheme(effectiveTheme(s, shipNow)), until } };
}

/** The header button's accessible name: the theme showing, and whether it is automatic or held until a time. */
export function themeButtonLabel(s: ThemeSettings, shipNow: string): string {
  if (!s.nightAuto) return `Theme: ${THEME_LABELS[s.theme]}`;
  if (overrideActive(s, shipNow)) return `Theme: ${THEME_LABELS[s.themeOverride!.theme]}, until ${s.themeOverride!.until.slice(11, 16)}`;
  return `Theme: ${THEME_LABELS[effectiveTheme(s, shipNow)]}, automatic`;
}

/**
 * What the first-paint script in index.html needs to work out the theme by itself (the `mp-night` mirror): the window,
 * the ship's offset from UTC in minutes, and the held theme with its end. Null when automatic night is off.
 */
export function nightMirror(s: ThemeSettings, offsetMinutes: number): string | null {
  if (!s.nightAuto) return null;
  const held = s.themeOverride ? { override: s.themeOverride.theme, until: s.themeOverride.until } : {};
  return JSON.stringify({ from: s.nightFrom, to: s.nightTo, offset: offsetMinutes, ...held });
}

/** The times the From and To lists offer: every quarter hour, 00:00 to 23:45. */
export const NIGHT_TIMES: readonly string[] = Array.from({ length: 96 }, (_, i) =>
  `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);
