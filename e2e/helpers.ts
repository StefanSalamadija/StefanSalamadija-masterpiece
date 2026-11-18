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

/** Opens a section of the ship (`Crew`, `Draft survey`, …): the Ship tab of the bottom bar, then that tile of the hub. */
export async function openShipSection(page: Page, name: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Ship', exact: true }).click();
  await page.getByRole('navigation', { name: 'Ship sections', exact: true }).getByRole('link', { name, exact: true }).click();
}

/** Opens a row of More (`Profiles`, `Settings`, …): the More tab of the bottom bar, then that row. */
export async function openMore(page: Page, name: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'More', exact: true }).click();
  await page.getByRole('navigation', { name: 'More', exact: true }).getByRole('link', { name, exact: true }).click();
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
 * or blue in Night red). Two checks:
 * - Styles. For <html> and every element under it, and for its ::before, ::after, ::marker and ::placeholder, it reads every
 *   computed colour CSS can set: colours, borders, outline, fill, stroke, caret, accent, text decoration, SVG stop, flood
 *   and lighting colours, and the colours inside box-shadow, text-shadow and background-image (gradients). Only fully
 *   transparent ones are skipped. Every image and canvas must also be filtered (`--media-filter`).
 * - Pixels. A full-page screenshot, for what styles cannot reach (native controls such as the date-segment highlight and
 *   the checkbox tick): no pixel may have green or blue above about half its red, beyond a small tolerance for smoothing.
 */
export async function expectRedOnly(page: Page): Promise<void> {
  const problems = await page.evaluate(() => {
    const PROPS = ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
      'outline-color', 'fill', 'stroke', 'caret-color', 'accent-color', 'text-decoration-color', 'stop-color', 'flood-color',
      'lighting-color', 'column-rule-color', 'text-emphasis-color', '-webkit-text-fill-color', '-webkit-text-stroke-color',
      'box-shadow', 'text-shadow', 'background-image'];
    const PSEUDOS = ['', '::before', '::after', '::marker', '::placeholder'];
    const isRedOrBlack = (r: number, g: number, b: number): boolean =>
      (r <= 0x20 && g <= 0x20 && b <= 0x20) || (g <= 0.45 * r && b <= 0.45 * r);
    /** Every colour written in a computed value, as [r, g, b, alpha] (0–255, alpha 0–1). */
    const colours = (value: string): { text: string; rgba: number[] }[] => {
      const found: { text: string; rgba: number[] }[] = [];
      for (const m of value.matchAll(/rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)(?:,? \/? ?([\d.]+))?\)/g)) {
        found.push({ text: m[0], rgba: [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] });
      }
      for (const m of value.matchAll(/color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)/g)) {
        found.push({ text: m[0], rgba: [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, m[4] === undefined ? 1 : Number(m[4])] });
      }
      return found;
    };
    const describe = (el: Element, pseudo: string): string => {
      const id = el.id ? `#${el.id}` : '';
      const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
      return `${el.tagName.toLowerCase()}${id}${cls}${pseudo}`;
    };
    const found: string[] = [];
    const elements = [document.documentElement, ...document.documentElement.querySelectorAll('*')];
    for (const el of elements) {
      for (const pseudo of PSEUDOS) {
        if (pseudo === '::placeholder' && !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) continue;
        if (pseudo === '::marker' && getComputedStyle(el).display !== 'list-item') continue;
        const style = getComputedStyle(el, pseudo || null);
        if ((pseudo === '::before' || pseudo === '::after') && (style.content === 'none' || style.content === 'normal')) continue;
        for (const prop of PROPS) {
          // These three paint only on their own SVG elements (their initial values elsewhere draw nothing).
          if (prop === 'lighting-color' && !/^fe(Diffuse|Specular)Lighting$/.test(el.tagName)) continue;
          if (prop === 'flood-color' && !/^fe(Flood|DropShadow)$/.test(el.tagName)) continue;
          if (prop === 'stop-color' && el.tagName !== 'stop') continue;
          const value = style.getPropertyValue(prop);
          if (!value || value === 'none') continue;
          const parsed = colours(value);
          if (parsed.length === 0 && /\b(hsla?|lab|lch|oklab|oklch)\(|#[0-9a-f]{3}/i.test(value)) found.push(`${describe(el, pseudo)} ${prop}: ${value} (unparsed)`);
          for (const { text, rgba: [r, g, b, a] } of parsed) {
            if (a !== 0 && !isRedOrBlack(r, g, b)) found.push(`${describe(el, pseudo)} ${prop}: ${text}`);
          }
        }
      }
      if ((el.tagName === 'IMG' || el.tagName === 'CANVAS') && getComputedStyle(el).filter === 'none') found.push(`${describe(el, '')} is not filtered`);
    }
    return [...new Set(found)];
  });
  expect(problems, 'colours that are not red or black in Night red').toEqual([]);

  const shot = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
  const pixels = await page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const TOLERANCE = 12; // smoothing at the edge of red on black
    let count = 0;
    const examples: string[] = [];
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (g > 0.5 * r + TOLERANCE || b > 0.5 * r + TOLERANCE) {
        count += 1;
        const at = i / 4;
        if (examples.length < 5) examples.push(`(${at % canvas.width}, ${Math.floor(at / canvas.width)}) rgb(${r}, ${g}, ${b})`);
      }
    }
    return { count, examples };
  }, `data:image/png;base64,${shot.toString('base64')}`);
  expect(pixels, 'pixels that are not red or black in Night red').toEqual({ count: 0, examples: [] });
}
