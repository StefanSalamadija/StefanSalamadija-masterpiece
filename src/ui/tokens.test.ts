import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import type { Theme } from '../domain/types';
import { BAR_BG, THEMES } from './theme';

// Read from disk: Vitest hands CSS imports over empty, `?raw` included.
const themeCss = new TextDecoder().decode(await fs.readFile(new URL('./theme.css', import.meta.url).pathname));

/** True for a colour that is near black (every channel at most 0x20) or red (green and blue at most 0.45 of red). */
function isRedOrBlack(hex: string): boolean {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`Not a #RRGGBB colour: ${hex}`);
  const [r, g, b] = m.slice(1).map((part) => parseInt(part, 16));
  if (r <= 0x20 && g <= 0x20 && b <= 0x20) return true;
  return g <= 0.45 * r && b <= 0.45 * r;
}

interface Rule { selectors: string[]; props: Map<string, string> }

function parseRules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  for (const [, selectorText, body] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const props = new Map<string, string>();
    for (const declaration of body.split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      props.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
    }
    rules.push({ selectors: selectorText.split(',').map((s) => s.trim().replace(/"/g, "'")), props });
  }
  return rules;
}

const rules = parseRules(themeCss);

/**
 * The token block of each theme: the first rule whose selectors are all `:root` or `:root[data-theme='x']`. Later rules on
 * the same selector (High contrast's heavier weights) are overrides of the scale tokens, not the theme's palette.
 */
function themeBlock(theme: Theme): Map<string, string> {
  const rule = rules.find((r) => r.selectors.includes(`:root[data-theme='${theme}']`)
    && r.selectors.every((s) => s === ':root' || /^:root\[data-theme='\w+'\]$/.test(s)));
  if (!rule) throw new Error(`No token block for ${theme}`);
  return new Map([...rule.props].filter(([name]) => name.startsWith('--')));
}

const blocks = Object.fromEntries(THEMES.map((theme) => [theme, themeBlock(theme)])) as Record<Theme, Map<string, string>>;

/** The spec §6 table as the brief copies it (hex rows only: color-mix and filter values are checked by kind below). */
const TABLE: Record<string, [day: string, dark: string, red: string, contrast: string]> = {
  '--surface-0': ['#FFFFFF', '#0B1622', '#000000', '#FFFFFF'],
  '--surface-1': ['#F3F6FA', '#12243A', '#120000', '#FFFFFF'],
  '--surface-2': ['#E8EEF5', '#18283A', '#1E0303', '#FFFFFF'],
  '--line': ['#D5DEE8', '#1E3550', '#3A0A0A', '#000000'],
  '--text': ['#0B1622', '#E6EDF5', '#E04A3A', '#000000'],
  '--text-muted': ['#4A6380', '#9FB3C8', '#D04030', '#000000'],
  '--bar-bg': ['#0B2545', '#0E1B2B', '#000000', '#000000'],
  '--bar-text': ['#FFFFFF', '#E6EDF5', '#E04A3A', '#FFFFFF'],
  '--bar-muted': ['#C9D6E5', '#9FB3C8', '#D04030', '#E6E6E6'],
  '--nav-bg': ['#FFFFFF', '#0E1B2B', '#000000', '#000000'],
  '--nav-text': ['#4A6380', '#9FB3C8', '#D04030', '#E6E6E6'],
  '--nav-active': ['#1D5FD1', '#5FD4CE', '#FF5A45', '#FFFFFF'],
  '--accent': ['#1D5FD1', '#5FD4CE', '#C8372A', '#000000'],
  '--on-accent': ['#FFFFFF', '#04211F', '#000000', '#FFFFFF'],
  '--ok': ['#1E7A46', '#5CCB8A', '#D04030', '#000000'],
  '--warn': ['#8A5A00', '#F2B33D', '#E04A3A', '#000000'],
  '--warn-bg': ['#FFF1D1', '#3A2A08', '#120000', '#FFFFFF'],
  '--danger': ['#B3261E', '#FF6B5E', '#FF5A45', '#C81E1E'],
  '--danger-bg': ['#FDE7E5', '#3D1210', '#4A0606', '#FFFFFF'],
  '--on-danger': ['#FFFFFF', '#1A0503', '#000000', '#FFFFFF'],
  '--focus': ['#1D5FD1', '#7AB8FF', '#FF5A45', '#000000'],
  '--mark-bg': ['#FFD54A', '#FFD54A', '#4A0606', '#FFD54A'],
  '--mark-text': ['#000000', '#000000', '#FF5A45', '#000000'],
  '--chart-1': ['#1D5FD1', '#4FB8D6', '#E04A3A', '#000000'],
  '--chart-2': ['#0F8B8D', '#5CCB8A', '#E04A3A', '#000000'],
  '--chart-3': ['#8A5A00', '#F2B33D', '#E04A3A', '#000000'],
  '--chart-4': ['#7B4FC9', '#B79CFF', '#E04A3A', '#000000'],
  '--chart-5': ['#5E6B7A', '#9FB3C8', '#E04A3A', '#000000'],
};

/** Rows whose values are not hex in every theme: the exact text where the brief gives it. */
const OTHER: Record<string, Partial<Record<Theme, string>>> = {
  '--ok-bg': { day: '#E3F4EA', dark: '#12301F', red: 'transparent', contrast: '#FFFFFF' },
  '--bar-line': { day: '#3B5878', red: '#3A0A0A', contrast: '#FFFFFF' },
  '--nav-pill': { day: '#E3ECFB', red: '#2A0505', contrast: 'transparent' },
  '--media-filter': { day: 'none', dark: 'none', contrast: 'none' },
  '--picker-filter': { day: 'none', dark: 'none', contrast: 'none' },
  '--shadow-2': { red: 'none', contrast: 'none' },
};

describe('the theme token blocks in theme.css', () => {
  it('all four define exactly the same custom properties', () => {
    const day = [...blocks.day.keys()].sort();
    for (const theme of THEMES) expect([...blocks[theme].keys()].sort(), theme).toEqual(day);
  });

  it('define every palette token of the brief', () => {
    for (const name of [...Object.keys(TABLE), ...Object.keys(OTHER)]) expect(blocks.day.has(name), name).toBe(true);
  });

  it('have the hex values of the table', () => {
    THEMES.forEach((theme, column) => {
      for (const [name, values] of Object.entries(TABLE)) {
        expect(blocks[theme].get(name)?.toUpperCase(), `${theme} ${name}`).toBe(values[column]);
      }
    });
  });

  it('have the other values of the brief', () => {
    for (const [name, values] of Object.entries(OTHER)) {
      for (const [theme, value] of Object.entries(values)) {
        const actual = blocks[theme as Theme].get(name) ?? '';
        expect(value.startsWith('#') ? actual.toUpperCase() : actual, `${theme} ${name}`).toBe(value);
      }
    }
    expect(blocks.dark.get('--bar-line')).toMatch(/^color-mix\(in srgb, var\(--bar-text\) 18%, transparent\)$/);
    expect(blocks.dark.get('--nav-pill')).toMatch(/^color-mix\(in srgb, #5fd4ce 18%, transparent\)$/i);
    expect(blocks.day.get('--shadow-2')).toBe('0 -2px 12px rgb(0 0 0 / 0.12)');
    expect(blocks.dark.get('--shadow-2')).toBe(blocks.day.get('--shadow-2'));
  });

  it('give the bars the colours the status bar uses', () => {
    for (const theme of THEMES) expect(blocks[theme].get('--bar-bg')?.toUpperCase()).toBe(BAR_BG[theme]);
  });

  it('filter media and the date-picker icon in Night red', () => {
    expect(blocks.red.get('--media-filter')).not.toBe('none');
    expect(blocks.red.get('--picker-filter')).not.toBe('none');
  });

  it('use only black and red in Night red', () => {
    for (const [name, value] of blocks.red) {
      for (const [hex] of value.matchAll(/#[0-9a-f]{6}\b/gi)) expect(isRedOrBlack(hex), `${name}: ${hex}`).toBe(true);
      for (const [, r, g, b] of value.matchAll(/rgb\((\d+) (\d+) (\d+)/g)) {
        const hex = `#${[r, g, b].map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`;
        expect(isRedOrBlack(hex), `${name}: ${value}`).toBe(true);
      }
      expect(value, name).not.toMatch(/#[0-9a-f]{3}\b|hsl|white|blue|green/i);
    }
  });
});

describe('the scale tokens on :root', () => {
  const root = new Map(rules.filter((r) => r.selectors.length === 1 && r.selectors[0] === ':root').flatMap((r) => [...r.props]));

  it('have the type scale of spec §6', () => {
    expect(Object.fromEntries(['display', 'figure', 'title', 'heading', 'body', 'label', 'caption']
      .map((step) => [step, `${root.get(`--fs-${step}`)}/${root.get(`--lh-${step}`)}`]))).toEqual({
      display: '36px/40px', figure: '28px/32px', title: '22px/28px', heading: '18px/24px', body: '16px/24px', label: '14px/20px', caption: '12px/16px',
    });
    expect([root.get('--fw-regular'), root.get('--fw-medium'), root.get('--fw-strong')]).toEqual(['400', '500', '600']);
  });

  it('have the spacing, radius and target scale', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => root.get(`--sp-${n}`))).toEqual(['4px', '8px', '12px', '16px', '24px', '32px', '48px']);
    expect(['sm', 'md', 'lg', 'pill'].map((r) => root.get(`--r-${r}`))).toEqual(['8px', '12px', '20px', '999px']);
    expect(root.get('--target')).toBe('48px');
  });

  it('are not redefined by a theme, except that High contrast raises the regular and medium weights to 600', () => {
    const scale = /^--(fs|lh|sp|r|fw|target)\b/;
    const themed = rules.filter((r) => r.selectors.some((s) => s.startsWith(':root[data-theme=')) && r.selectors.every((s) => s.startsWith(':root')));
    const overrides = themed.flatMap((r) => [...r.props].filter(([name]) => scale.test(name)).map(([name, value]) => `${r.selectors.join(',')} ${name}: ${value}`));
    expect(overrides).toEqual([":root[data-theme='contrast'] --fw-regular: 600", ":root[data-theme='contrast'] --fw-medium: 600"]);
  });
});

describe('isRedOrBlack', () => {
  it('accepts black and reds, and refuses white, blue, green and amber', () => {
    for (const hex of ['#000000', '#120000', '#1E0303', '#3A0A0A', '#E04A3A', '#FF5A45', '#C8372A', '#202020']) expect(isRedOrBlack(hex), hex).toBe(true);
    for (const hex of ['#FFFFFF', '#1D5FD1', '#5CCB8A', '#F2B33D', '#7AB8FF', '#212121']) expect(isRedOrBlack(hex), hex).toBe(false);
  });
});
