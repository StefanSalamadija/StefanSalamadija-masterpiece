import { afterEach, describe, expect, it, vi } from 'vitest';
import indexHtml from '../../index.html?raw';
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

/** Runs the inline script of index.html against a stub page whose theme mirror holds `stored`. */
function runFirstPaint(stored: string | null, opts: { storageThrows?: boolean } = {}) {
  const script = indexHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
  const meta = { content: '#0B2545', setAttribute(name: string, value: string) { if (name === 'content') meta.content = value; } };
  const documentElement = { dataset: {} as Record<string, string> };
  const document = {
    documentElement,
    querySelector: (selector: string) => (/^meta\[name=["']?theme-color["']?\]$/.test(selector) ? meta : null),
  };
  const localStorage = {
    getItem(key: string) {
      if (opts.storageThrows) throw new Error('blocked');
      return key === THEME_STORAGE_KEY ? stored : null;
    },
  };
  new Function('document', 'localStorage', script)(document, localStorage);
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
