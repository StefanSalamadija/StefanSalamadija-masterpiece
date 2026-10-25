// Renders public/icon.svg to the PNG icons referenced by the PWA manifest.
// Run once with `node scripts/make-icons.mjs` and commit the PNGs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const publicDir = new URL('../public/', import.meta.url);
const svg = readFileSync(new URL('icon.svg', publicDir));
const svgUri = `data:image/svg+xml;base64,${svg.toString('base64')}`;
const NAVY = '#0b3d5c';

// `padding` is the fraction of the canvas left empty on each side.
// `background` fills the whole canvas (maskable icons must be full-bleed).
const icons = [
  { file: 'icon-192.png', size: 192, padding: 0, background: 'transparent' },
  { file: 'icon-512.png', size: 512, padding: 0, background: 'transparent' },
  { file: 'icon-maskable-512.png', size: 512, padding: 0.2, background: NAVY },
];

const browser = await chromium.launch();
try {
  for (const { file, size, padding, background } of icons) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const inner = Math.round(size * (1 - 2 * padding));
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;width:${size}px;height:${size}px;background:${background};display:grid;place-items:center;overflow:hidden}img{width:${inner}px;height:${inner}px;display:block}</style><img src="${svgUri}">`,
    );
    await page.evaluate(() => document.querySelector('img').decode());
    await page.screenshot({
      path: fileURLToPath(new URL(file, publicDir)),
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    await page.close();
    console.log(`wrote public/${file} (${size}x${size})`);
  }
} finally {
  await browser.close();
}
