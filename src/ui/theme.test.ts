import { afterEach, describe, expect, it, vi } from 'vitest';
import indexHtml from '../../index.html?raw';
import { toShipLocal } from '../domain/shipTime';
import { effectiveTheme, nightMirror } from './themeSchedule';
import type { ThemeSettings } from './themeSchedule';
import { applyTheme, BAR_BG, logoMode, mirrorTheme, NIGHT_STORAGE_KEY, nextTheme, readTheme, THEME_LABELS, THEME_STORAGE_KEY, THEMES } from './theme';

describe('THEMES', () => {
  it('lists every theme once, in the order of the header button, named as the Settings select shows them', () => {
    expect(THEMES).toEqual(['day', 'dark', 'red', 'contrast']);
    expect(THEMES.map((theme) => THEME_LABELS[theme])).toEqual(['Day', 'Dark', 'Night red', 'High contrast']);
    expect(new Set(THEMES)).toEqual(new Set(Object.keys(THEME_LABELS)));
  });
});

describe('nextTheme', () => {
  it('cycles day, dark, night red, high contrast, day', () => {
    expect(nextTheme('day')).toBe('dark');
    expect(nextTheme('dark')).toBe('red');
    expect(nextTheme('red')).toBe('contrast');
    expect(nextTheme('contrast')).toBe('day');
  });
});

describe('readTheme', () => {
  it('keeps the four themes, turns the old night theme into dark, and anything else into day', () => {
    for (const theme of THEMES) expect(readTheme(theme)).toBe(theme);
    expect(readTheme('night')).toBe('dark');
    expect(readTheme('purple')).toBe('day');
    expect(readTheme(undefined)).toBe('day');
    expect(readTheme(3)).toBe('day');
  });
});

describe('logoMode', () => {
  it('uses the night logo in Dark, the one-colour red logo in Night red and the day logo otherwise', () => {
    expect(logoMode('day')).toBe('day');
    expect(logoMode('dark')).toBe('night');
    expect(logoMode('red')).toBe('red');
    expect(logoMode('contrast')).toBe('day');
  });
});

describe('BAR_BG', () => {
  it('is the colour of the bars of each theme, for the browser status bar', () => {
    expect(BAR_BG).toEqual({ day: '#0B2545', dark: '#0E1B2B', red: '#000000', contrast: '#000000' });
    expect(BAR_BG.red).toBe('#000000');
  });
});

/**
 * Runs the inline script of index.html against a stub page whose localStorage holds `stored` (or, given a string or null,
 * only the theme mirror), with `Date.now()` at `nowMs`.
 */
function runFirstPaint(
  stored: string | null | Record<string, string>, opts: { storageThrows?: boolean; nowMs?: number } = {},
) {
  const script = indexHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
  const items: Record<string, string> = typeof stored === 'object' && stored !== null
    ? stored
    : stored === null ? {} : { [THEME_STORAGE_KEY]: stored };
  const meta = { content: '#0B2545', setAttribute(name: string, value: string) { if (name === 'content') meta.content = value; } };
  const documentElement = { dataset: {} as Record<string, string> };
  const document = {
    documentElement,
    querySelector: (selector: string) => (/^meta\[name=["']?theme-color["']?\]$/.test(selector) ? meta : null),
  };
  const localStorage = {
    getItem(key: string) {
      if (opts.storageThrows) throw new Error('blocked');
      return items[key] ?? null;
    },
  };
  const nowMs = opts.nowMs ?? Date.parse('2026-11-17T09:00:00Z');
  const FixedDate = class extends Date { static now() { return nowMs; } };
  new Function('document', 'localStorage', 'Date', script)(document, localStorage, FixedDate);
  return { theme: documentElement.dataset.theme, meta: meta.content };
}

describe('the first-paint script in index.html', () => {
  it('reads the mirror under the same key, finds the status-bar meta above it, and runs before the app', () => {
    expect(THEME_STORAGE_KEY).toBe('mp-theme');
    expect(NIGHT_STORAGE_KEY).toBe('mp-night');
    const script = indexHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
    expect(script).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
    expect(indexHtml.indexOf('name="theme-color"')).toBeLessThan(indexHtml.indexOf('<script>'));
    expect(indexHtml.indexOf('<script>')).toBeLessThan(indexHtml.indexOf('type="module"'));
  });

  it('paints each of the four themes, with the status bar in the colour of its bars', () => {
    for (const theme of THEMES) expect(runFirstPaint(theme)).toEqual({ theme, meta: BAR_BG[theme] });
  });

  it('paints the old night theme as dark', () => {
    expect(runFirstPaint('night')).toEqual({ theme: 'dark', meta: BAR_BG.dark });
  });

  it('leaves the page alone for an unknown or missing value, and when storage is blocked', () => {
    expect(runFirstPaint('purple')).toEqual({ theme: undefined, meta: '#0B2545' });
    expect(runFirstPaint(null)).toEqual({ theme: undefined, meta: '#0B2545' });
    expect(runFirstPaint('red', { storageThrows: true })).toEqual({ theme: undefined, meta: '#0B2545' });
  });

  it('stays under about 900 characters', () => {
    const script = indexHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
    expect(script.trim().length).toBeLessThanOrEqual(900);
  });
});

describe('the first-paint script and automatic night', () => {
  const settings = (over: Partial<ThemeSettings> = {}): ThemeSettings => ({
    theme: 'day', nightAuto: true, nightFrom: '18:00', nightTo: '06:00', ...over,
  });

  /** What the app mirrors for `s` at `offset`, as `AppState` writes it with `mirrorTheme`. */
  function mirrored(s: ThemeSettings, offset: number): Record<string, string> {
    const night = nightMirror(s, offset);
    return night === null ? { [THEME_STORAGE_KEY]: s.theme } : { [THEME_STORAGE_KEY]: s.theme, [NIGHT_STORAGE_KEY]: night };
  }

  // [what the row is, the stored settings, the ship's offset in minutes, the instant]
  const rows: [string, ThemeSettings, number, string][] = [
    ['auto off at night', settings({ nightAuto: false, theme: 'dark' }), 180, '2026-11-17T17:00:00Z'],
    ['inside the window, UTC+03:00', settings(), 180, '2026-11-17T15:00:00Z'],
    ['just before the window', settings(), 180, '2026-11-17T14:59:00Z'],
    ['inside the window after midnight', settings({ theme: 'contrast' }), 180, '2026-11-17T02:59:00Z'],
    ['at the end of the window', settings({ theme: 'contrast' }), 180, '2026-11-17T03:00:00Z'],
    ['a negative offset with a half hour', settings({ nightFrom: '20:15', nightTo: '05:45' }), -330, '2026-11-18T01:45:00Z'],
    ['across a date line offset', settings(), 840, '2026-11-17T04:30:00Z'],
    ['a window that does not cross midnight', settings({ nightFrom: '06:00', nightTo: '18:00' }), 0, '2026-11-17T12:00:00Z'],
    ['From equals To', settings({ nightFrom: '09:00', nightTo: '09:00', theme: 'dark' }), 0, '2026-11-17T09:00:00Z'],
    ['an override still ahead', settings({ themeOverride: { theme: 'contrast', until: '2026-11-18T06:00' } }), 180, '2026-11-17T20:00:00Z'],
    ['an override that has ended', settings({ themeOverride: { theme: 'contrast', until: '2026-11-17T06:00' } }), 180, '2026-11-17T03:00:00Z'],
    ['an override outside the window', settings({ themeOverride: { theme: 'dark', until: '2026-11-17T18:00' } }), 180, '2026-11-17T09:00:00Z'],
  ];

  it.each(rows)('paints what the app would for %s', (_name, s, offset, instant) => {
    const nowMs = Date.parse(instant);
    const expected = effectiveTheme(s, toShipLocal(new Date(nowMs), offset).dateTime);
    expect(runFirstPaint(mirrored(s, offset), { nowMs })).toEqual({ theme: expected, meta: BAR_BG[expected] });
  });

  it('paints the base theme when the night mirror is corrupt or has no offset', () => {
    const nowMs = Date.parse('2026-11-17T20:00:00Z');
    expect(runFirstPaint({ [THEME_STORAGE_KEY]: 'dark', [NIGHT_STORAGE_KEY]: '{not json' }, { nowMs }))
      .toEqual({ theme: 'dark', meta: BAR_BG.dark });
    expect(runFirstPaint({ [THEME_STORAGE_KEY]: 'dark', [NIGHT_STORAGE_KEY]: '{"from":"18:00","to":"06:00"}' }, { nowMs }))
      .toEqual({ theme: 'dark', meta: BAR_BG.dark });
    expect(runFirstPaint({ [THEME_STORAGE_KEY]: 'contrast', [NIGHT_STORAGE_KEY]: 'null' }, { nowMs }))
      .toEqual({ theme: 'contrast', meta: BAR_BG.contrast });
  });

  it('ignores an override that names no theme it knows', () => {
    const night = JSON.stringify({ from: '18:00', to: '06:00', offset: 0, override: 'purple', until: '2099-01-01T00:00' });
    expect(runFirstPaint({ [THEME_STORAGE_KEY]: 'dark', [NIGHT_STORAGE_KEY]: night }, { nowMs: Date.parse('2026-11-17T12:00:00Z') }))
      .toEqual({ theme: 'dark', meta: BAR_BG.dark });
  });

  it('paints the old night base theme as Dark outside the window, and Night red inside it', () => {
    const night = nightMirror(settings(), 0) ?? '';
    expect(runFirstPaint({ [THEME_STORAGE_KEY]: 'night', [NIGHT_STORAGE_KEY]: night }, { nowMs: Date.parse('2026-11-17T12:00:00Z') }))
      .toEqual({ theme: 'dark', meta: BAR_BG.dark });
    expect(runFirstPaint({ [THEME_STORAGE_KEY]: 'night', [NIGHT_STORAGE_KEY]: night }, { nowMs: Date.parse('2026-11-17T20:00:00Z') }))
      .toEqual({ theme: 'red', meta: BAR_BG.red });
  });

  it('leaves the page alone, and does not throw, when storage is blocked', () => {
    expect(() => runFirstPaint({}, { storageThrows: true })).not.toThrow();
    expect(runFirstPaint({}, { storageThrows: true })).toEqual({ theme: undefined, meta: '#0B2545' });
  });

  it('reads the night mirror under its key', () => {
    const script = indexHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
    expect(script).toContain(`'${NIGHT_STORAGE_KEY}'`);
  });
});

describe('applyTheme and mirrorTheme', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubPage(opts: { storageThrows?: boolean } = {}) {
    const meta = { content: '', setAttribute(name: string, value: string) { if (name === 'content') meta.content = value; } };
    const documentElement = { dataset: {} as Record<string, string> };
    const store = new Map<string, string>();
    vi.stubGlobal('document', { documentElement, querySelector: (selector: string) => (selector.includes('theme-color') ? meta : null) });
    vi.stubGlobal('localStorage', {
      setItem(key: string, value: string) { if (opts.storageThrows) throw new Error('blocked'); store.set(key, value); },
      removeItem(key: string) { if (opts.storageThrows) throw new Error('blocked'); store.delete(key); },
    });
    return { meta, documentElement, store };
  }

  it('puts the theme on <html> and the colour of its bars on the status bar', () => {
    const page = stubPage();
    applyTheme('red');
    expect(page.documentElement.dataset.theme).toBe('red');
    expect(page.meta.content).toBe('#000000');
    applyTheme('day');
    expect(page.meta.content).toBe('#0B2545');
  });

  it('mirrors the base theme, and removes the night mirror when there is none', () => {
    const page = stubPage();
    page.store.set(NIGHT_STORAGE_KEY, '{}');
    mirrorTheme('dark', null);
    expect(page.store.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(page.store.has(NIGHT_STORAGE_KEY)).toBe(false);
    mirrorTheme('day', '{"from":"18:00"}');
    expect(page.store.get(NIGHT_STORAGE_KEY)).toBe('{"from":"18:00"}');
  });

  it('does not throw when storage is blocked', () => {
    stubPage({ storageThrows: true });
    expect(() => mirrorTheme('red', null)).not.toThrow();
  });
});
