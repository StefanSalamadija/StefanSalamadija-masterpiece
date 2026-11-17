import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { freshApp, setTheme, setupShip } from './helpers';
import type { ThemeLabel } from './helpers';

// Screenshots of the main screens at 360 px in every theme, for the reviewers. They are written to SCREENSHOT_DIR (the
// session scratchpad) and never committed; without SCREENSHOT_DIR the spec is skipped. The data is made up.
//
//   SCREENSHOT_DIR=/path/to/shots npx playwright test e2e/screenshots.spec.ts --project=android --trace off

declare const process: { env: Record<string, string | undefined> };
const DIR = process.env.SCREENSHOT_DIR;

/** The screens captured, as `<name>-<theme>.png`. Later tasks add theirs here. */
export const SCREENS: { name: string; path: string }[] = [
  { name: 'home', path: '/' },
  { name: 'particulars', path: '/ship/particulars' },
  { name: 'crew', path: '/ship/crew' },
  { name: 'crew-new', path: '/ship/crew/new' },
  { name: 'certificates', path: '/ship/certificates' },
  { name: 'reliefs', path: '/ship/reliefs' },
  { name: 'expiring', path: '/ship/expiring' },
  { name: 'voyage', path: '/ship/voyage' },
  { name: 'time', path: '/ship/time' },
  { name: 'survey', path: '/ship/survey' },
  { name: 'forms', path: '/forms' },
  { name: 'tools', path: '/tools' },
  { name: 'library', path: '/library' },
  { name: 'budget', path: '/budget' },
  { name: 'profiles', path: '/profiles' },
  { name: 'settings', path: '/settings' },
];

const THEMES: { label: ThemeLabel; id: string }[] = [
  { label: 'Day', id: 'day' },
  { label: 'Dark', id: 'dark' },
  { label: 'Night red', id: 'red' },
  { label: 'High contrast', id: 'contrast' },
];

test.skip(!DIR, 'Set SCREENSHOT_DIR to take the screenshots.');
test.use({ viewport: { width: 360, height: 780 } });

/**
 * A made-up ship on 2026-11-17 (ship's time UTC+03:00): one crew member whose passport ran out on 10 Nov, a certificate
 * due on 1 Dec (in 14 days), and a voyage with a next port and its ETA.
 */
async function madeUpShip(page: Page): Promise<void> {
  await freshApp(page, { time: '2026-11-17T09:00:00Z' });
  await setupShip(page);

  await page.goto('./#/ship/crew/new');
  await page.getByLabel('Surname').fill('EXAMPLE');
  await page.getByLabel('Given names').fill('R.');
  await page.getByLabel('Rank').selectOption({ label: 'Master' });
  await page.getByLabel('Date of birth').fill('1980-03-14');
  await page.getByLabel('Passport expiry').fill('2026-11-10');
  await page.getByLabel("Seaman's book expiry").fill('2030-01-01');
  await page.getByLabel('Sign-on date').fill('2026-08-01');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew$/);

  await page.goto('./#/ship/certificates/new');
  await page.getByLabel('Certificate', { exact: true }).selectOption({ label: 'International Load Line' });
  await page.getByLabel('Number').fill('LL-0001');
  await page.getByLabel('Expiry date').fill('2026-12-01');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/certificates$/);

  await page.goto('./#/ship/voyage');
  await page.getByLabel('Voyage no.').fill('V-112');
  await page.getByLabel('Next port', { exact: true }).fill('Example Harbour');
  await page.getByLabel('ETA (local)').fill('2026-11-19T14:00');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
}

for (const theme of THEMES) {
  test(`main screens in ${theme.label}`, async ({ page }) => {
    test.setTimeout(120_000);
    await madeUpShip(page);
    await setTheme(page, theme.label);
    for (const screen of SCREENS) {
      await page.goto(`./#${screen.path}`);
      await expect(page.getByRole('heading').first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.screenshot({ path: `${DIR}/${screen.name}-${theme.id}.png`, fullPage: true });
    }
  });
}
