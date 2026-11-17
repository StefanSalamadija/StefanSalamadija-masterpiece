import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** A new browser profile (so no data), with the clock fixed to `opts.time` (default 2026-10-25T09:00Z) but still running. */
export async function freshApp(page: Page, opts: { time?: string } = {}): Promise<void> {
  await page.clock.install({ time: opts.time ?? '2026-10-25T09:00:00Z' });
  await page.goto('./');
}

/**
 * Answers the protect step with `Skip for now`, if it is on screen, and waits for the app behind it. The step is offered
 * whenever a ship exists, no passcode is set and it has not been answered: after the first ship is made and after a backup is
 * restored onto an empty device. After `Create ship` or `Apply import` the app shows either the protect step (heading
 * `Protect Masterpiece`, which covers the whole screen) or the header (banner), never both; this waits for whichever comes.
 * `ship`, if given, is the name the header must then show.
 */
export async function skipProtectStep(page: Page, ship?: string): Promise<void> {
  const protect = page.getByRole('heading', { name: 'Protect Masterpiece' });
  const header = page.getByRole('banner');
  await expect(protect.or(header)).toBeVisible();
  if (await protect.isVisible()) await page.getByRole('button', { name: 'Skip for now' }).click();
  await (ship === undefined ? expect(header).toBeVisible() : expect(header).toContainText(ship));
}

/**
 * Creates the first ship from the welcome screen. `offset` is the label of the ship's-time option, such as `UTC+03:00`.
 * With `skipLock` (the default) the protect step that follows is answered with `Skip for now` (see `skipProtectStep`) and the
 * helper waits for the header to show the ship. With `skipLock: false` it returns as soon as the protect step or the header
 * is on screen, so a test of the protect step finds it still there.
 */
export async function setupShip(
  page: Page, name = 'MV OCEAN STAR', offset = 'UTC+03:00', opts: { skipLock?: boolean } = {},
): Promise<void> {
  const { skipLock = true } = opts;
  await page.getByRole('button', { name: 'Create your first ship' }).click();
  await page.getByLabel('Ship name').fill(name);
  await page.getByLabel("Ship's time (UTC offset)").selectOption({ label: offset });
  await page.getByRole('button', { name: 'Create ship' }).click();
  if (skipLock) return skipProtectStep(page, name);
  // Never both at once: the protect step is a full screen of its own, with no header behind it.
  await expect(page.getByRole('heading', { name: 'Protect Masterpiece' }).or(page.getByRole('banner'))).toBeVisible();
}

/** At phone width (360 px) the page must not scroll sideways. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await page.setViewportSize({ width: 360, height: 740 });
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(360);
}

type TestHooks = { restoreWrites?: () => void; releaseWrites?: () => void };

/** From now on every write fails the way a full disk does, until `allowWrites`. */
export function failWrites(page: Page): Promise<void> {
  return page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as TestHooks).restoreWrites = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = () => {
      throw new DOMException('The disk is full.', 'QuotaExceededError');
    };
  });
}

export function allowWrites(page: Page): Promise<void> {
  return page.evaluate(() => (window as unknown as TestHooks).restoreWrites?.());
}

/** A second connection keeps a write transaction on the ship tables open, so the app's own writes have to wait for `releaseWrites`. */
export function holdWrites(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((started, failed) => {
        let hold = true;
        (window as unknown as TestHooks).releaseWrites = () => {
          hold = false;
        };
        const open = indexedDB.open('masterpiece');
        open.onerror = () => failed(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['ships', 'clockChanges', 'settings'], 'readwrite');
          tx.oncomplete = () => db.close();
          const store = tx.objectStore('settings');
          const keepOpen = (): void => {
            if (hold) store.get('device').onsuccess = keepOpen;
          };
          store.get('device').onsuccess = () => {
            started();
            keepOpen();
          };
        };
      }),
  );
}

export function releaseWrites(page: Page): Promise<void> {
  return page.evaluate(() => (window as unknown as TestHooks).releaseWrites?.());
}

export type ThemeLabel = 'Day' | 'Dark' | 'Night red' | 'High contrast';

/** Picks `theme` in the Theme select of Settings (the app opens Settings for it) and waits for it to be on <html>. */
export async function setTheme(page: Page, theme: ThemeLabel): Promise<void> {
  const values: Record<ThemeLabel, string> = { Day: 'day', Dark: 'dark', 'Night red': 'red', 'High contrast': 'contrast' };
  await page.goto('./#/settings');
  await page.getByLabel('Theme', { exact: true }).selectOption({ label: theme });
  await expect(page.locator('html')).toHaveAttribute('data-theme', values[theme]);
}

/**
 * Fails when anything on the page is drawn in a colour that is neither near black nor red (spec §5: nothing bright, white
 * or blue in Night red). It reads, for <html>, <body> and every element under them, each computed colour CSS can set, and
 * skips only fully transparent ones. Every image and canvas must also be filtered (`--media-filter`).
 */
export async function expectRedOnly(page: Page): Promise<void> {
  const problems = await page.evaluate(() => {
    const PROPS = ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
      'outline-color', 'fill', 'stroke', 'caret-color', 'accent-color', 'text-decoration-color'];
    const isRedOrBlack = (r: number, g: number, b: number): boolean =>
      (r <= 0x20 && g <= 0x20 && b <= 0x20) || (g <= 0.45 * r && b <= 0.45 * r);
    /** [r, g, b, alpha] in 0–255 (alpha 0–1), or undefined for a value that is not a colour (none, auto, url). */
    const parse = (value: string): number[] | undefined => {
      let m = /^rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)(?:,? \/? ?([\d.]+))?\)$/.exec(value);
      if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
      m = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)$/.exec(value);
      if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, m[4] === undefined ? 1 : Number(m[4])];
      return undefined;
    };
    const describe = (el: Element): string => {
      const id = el.id ? `#${el.id}` : '';
      const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
      return `${el.tagName.toLowerCase()}${id}${cls}`;
    };
    const found: string[] = [];
    const elements = [document.documentElement, ...document.documentElement.querySelectorAll('*')];
    for (const el of elements) {
      const style = getComputedStyle(el);
      for (const prop of PROPS) {
        const value = style.getPropertyValue(prop);
        if (value === 'transparent' || value === 'none' || value === 'auto' || value === 'currentcolor') continue;
        const rgba = parse(value);
        if (!rgba) {
          if (/^(rgb|color|hsl|lab|lch|oklab|oklch|#)/.test(value)) found.push(`${describe(el)} ${prop}: ${value} (unparsed)`);
          continue;
        }
        const [r, g, b, a] = rgba;
        if (a === 0) continue;
        if (!isRedOrBlack(r, g, b)) found.push(`${describe(el)} ${prop}: ${value}`);
      }
      if ((el.tagName === 'IMG' || el.tagName === 'CANVAS') && style.filter === 'none') found.push(`${describe(el)} is not filtered`);
    }
    return [...new Set(found)];
  });
  expect(problems, 'colours that are not red or black in Night red').toEqual([]);
}
