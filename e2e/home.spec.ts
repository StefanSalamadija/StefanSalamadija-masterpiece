import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoHorizontalScroll, freshApp, setupShip } from './helpers';

// The clock is 2026-10-25T09:00Z and the ship is at UTC+03:00, so the ship's clock reads 12:00 and its today is
// 2026-10-25. Sealing a backup derives a key with 600,000 PBKDF2 rounds, which takes a moment: the wait that follows
// it is given more time than the default, and is always on what the page shows, never a fixed sleep.

const PASSWORD = 'lozinka-ćevapi';
const CRYPTO = { timeout: 20_000 };
const DAY_MS = 24 * 60 * 60 * 1000;
const PERSISTENCE_NOTICE = "This browser may clear Masterpiece's data when storage runs low. Install the app and export backups regularly.";

const alertsRegion = (page: Page) => page.getByRole('region', { name: 'Alerts' });
const alertItems = (page: Page) => alertsRegion(page).getByRole('listitem');
const noBackupYet = (page: Page) => page.getByText('No backup yet. Export one now.');

interface NewCertificate {
  /** The option of the select: a certificate of the catalogue, or `Other`. */
  certificate: string;
  /** The name typed for Other. */
  name?: string;
  expiryDate?: string;
  nextSurveyDue?: string;
}

/** Fills in the Add form and saves it, which leaves the browser on the register. */
async function addCertificate(page: Page, c: NewCertificate): Promise<void> {
  await page.goto('./#/ship/certificates/new');
  await page.getByLabel('Certificate', { exact: true }).selectOption({ label: c.certificate });
  if (c.name !== undefined) await page.getByLabel('Certificate name').fill(c.name);
  if (c.expiryDate) await page.getByLabel('Expiry date').fill(c.expiryDate);
  if (c.nextSurveyDue) await page.getByLabel('Next survey due').fill(c.nextSurveyDue);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/certificates$/);
}

interface NewMember {
  surname: string;
  givenNames?: string;
  passportExpiry?: string;
  signOn?: string;
}

/** Fills in the Add form and saves it, which leaves the browser on the crew list. */
async function addMember(page: Page, m: NewMember): Promise<void> {
  await page.goto('./#/ship/crew/new');
  await page.getByLabel('Surname').fill(m.surname);
  await page.getByLabel('Given names').fill(m.givenNames ?? 'Ivan');
  await page.getByLabel('Rank').selectOption({ label: 'Master' });
  await page.getByLabel('Date of birth').fill('1985-01-05');
  await page.getByLabel('Passport expiry').fill(m.passportExpiry ?? '2030-01-01');
  await page.getByLabel("Seaman's book expiry").fill('2030-01-01');
  await page.getByLabel('Sign-on date').fill(m.signOn ?? '2026-06-01');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew$/);
}

/** Schedules a clock change on the Ship's time screen and waits until the history lists it. */
async function scheduleChange(page: Page, when: string, offset: string): Promise<void> {
  await page.goto('./#/ship/time');
  await page.getByLabel("Change at (ship's time)").fill(when);
  await page.getByLabel('New offset').selectOption({ label: offset });
  await page.getByRole('button', { name: 'Schedule' }).click();
  await expect(page.getByRole('list', { name: 'History' }).getByRole('listitem').filter({ hasText: 'Scheduled' })).toContainText(offset);
}

test('home shows backup reminder and alerts', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await expect(noBackupYet(page)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Export full backup' })).toHaveAttribute('href', '#/settings');
  await addCertificate(page, { certificate: 'International Load Line', expiryDate: '2026-10-01' });
  await page.goto('./#/');
  await expect(alertsRegion(page).getByRole('link')).toContainText(['International Load Line']);
  // The status is in words too, so that a printout (which has no colour) carries it.
  await expect(alertItems(page)).toContainText(['Expired 2026-10-01']);
  await expect(alertItems(page).first().getByText('Overdue')).toBeVisible();
  await expect(alertsRegion(page).getByText('No alerts.')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test('a ship with nothing to warn about says so', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(alertsRegion(page).getByRole('heading', { name: 'Alerts' })).toBeVisible();
  await expect(alertsRegion(page).getByText('No alerts.')).toBeVisible();
  await expect(alertsRegion(page).getByRole('link')).toHaveCount(0);
  await expect(page.getByText(/^Clock change /)).toHaveCount(0);
  await expect(page.getByRole('link', { name: "Ship's data" })).toHaveAttribute('href', '#/ship/particulars');

  // A certificate that is far from its dates, and a crew member whose papers are good, are no alert either.
  await addCertificate(page, { certificate: 'International Load Line', expiryDate: '2030-01-01' });
  await addMember(page, { surname: 'PETROVIĆ' });
  await page.goto('./#/');
  await expect(alertsRegion(page).getByText('No alerts.')).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('an alert opens the certificate to edit', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addCertificate(page, { certificate: 'International Load Line', expiryDate: '2026-10-01' });
  await page.goto('./#/');
  await alertsRegion(page).getByRole('link', { name: /International Load Line/ }).click();
  await expect(page).toHaveURL(/#\/ship\/certificates\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Edit certificate' })).toBeVisible();
  await expect(page.getByLabel('Expiry date')).toHaveValue('2026-10-01');
});

test('crew and certificates are listed together, worst first, and only the crew onboard', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addCertificate(page, { certificate: 'International Load Line', expiryDate: '2026-10-01' });
  await addCertificate(page, { certificate: 'IOPP', expiryDate: '2030-01-01', nextSurveyDue: '2026-12-01' });
  await addMember(page, { surname: 'PETROVIĆ', passportExpiry: '2027-01-10' });
  await addMember(page, { surname: 'LATER', givenNames: 'Joins', passportExpiry: '2026-01-01', signOn: '2026-11-01' });
  await addMember(page, { surname: 'GONE', givenNames: 'Old', passportExpiry: '2026-01-01', signOn: '2026-01-01' });
  await page.getByRole('list', { name: 'Crew' }).getByRole('listitem').filter({ hasText: 'Old GONE' }).getByRole('button', { name: 'Sign off' }).click();
  await page.getByRole('dialog').getByLabel('Sign-off date').fill('2026-10-10');
  await page.getByRole('dialog').getByRole('button', { name: 'Sign off' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('./#/');
  // Red first; then the amber ones by date: the survey of 1 Dec before the passport of 10 Jan.
  await expect(alertItems(page)).toHaveCount(3);
  await expect(alertItems(page)).toContainText([
    'International Load Line',
    'IOPP',
    'Ivan PETROVIĆ',
  ]);
  await expect(alertItems(page).nth(0)).toContainText('Expired 2026-10-01');
  await expect(alertItems(page).nth(1)).toContainText('Survey due 2026-12-01');
  await expect(alertItems(page).nth(1)).toContainText('Due soon');
  await expect(alertItems(page).nth(2)).toContainText('Passport expires 2027-01-10');
  await expect(alertItems(page).nth(2)).toContainText('Expires soon');
  await expect(alertsRegion(page).getByText('GONE')).toHaveCount(0);   // signed off on 10 October
  await expect(alertsRegion(page).getByText('LATER')).toHaveCount(0);  // joins on 1 November
  await alertItems(page).nth(2).getByRole('link').click();
  await expect(page).toHaveURL(/#\/ship\/crew\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Edit crew member' })).toBeVisible();
  await expect(page.getByLabel('Passport expiry')).toHaveValue('2027-01-10');
});

test('the backup banner goes after a full backup, and comes back when the next one is due', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await expect(noBackupYet(page)).toBeVisible();

  await page.getByRole('link', { name: 'Export full backup' }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export full backup' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Backup password').fill(PASSWORD);
  await dialog.getByLabel('Repeat password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await download;
  await expect(page.getByText('Full backup exported.')).toBeVisible(CRYPTO);

  await page.goto('./#/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(noBackupYet(page)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Export full backup' })).toHaveCount(0);

  // The reminder is 7 days: after 8 the banner is back, and says how long it has been.
  await page.clock.fastForward(8 * DAY_MS);
  await expect(page.getByText('Last backup 8 days ago. Export a backup now.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Export full backup' })).toHaveAttribute('href', '#/settings');
});

test('home shows the next clock change, and drops it once it has happened', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await expect(page.getByText(/^Clock change /)).toHaveCount(0);
  await scheduleChange(page, '2026-10-26T02:00', 'UTC+05:00');
  // The Ship's time history lists the change at the same time.
  await expect(page.getByRole('list', { name: 'History' }).getByRole('listitem').filter({ hasText: 'Scheduled' })).toContainText('2026-10-26 02:00 → UTC+05:00');

  await page.goto('./#/');
  await expect(page.getByText('Clock change 26 Oct 02:00 → UTC+05:00')).toBeVisible();
  await expectNoHorizontalScroll(page);

  // 02:00 at +03:00 on the 26th is 23:00Z on the 25th.
  await page.clock.fastForward('16:00:00');
  await expect(page.getByTestId('ship-clock')).toContainText('(UTC+05:00)');
  await expect(page.getByText(/^Clock change /)).toHaveCount(0);
});

test('home tells a browser that may clear the data to export backups', async ({ page }) => {
  await page.addInitScript(() => {
    StorageManager.prototype.persist = () => Promise.resolve(false);
  });
  await freshApp(page); await setupShip(page);
  await expect(page.getByText(PERSISTENCE_NOTICE)).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('home says nothing about storage when the browser keeps the data', async ({ page }) => {
  await page.addInitScript(() => {
    StorageManager.prototype.persist = () => Promise.resolve(true);
  });
  await freshApp(page); await setupShip(page);
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(noBackupYet(page)).toBeVisible();                     // the page has loaded and the answer has come
  await expect(page.getByText(PERSISTENCE_NOTICE)).toHaveCount(0);
});

test('home fits a phone with everything on it at once', async ({ page }) => {
  await page.addInitScript(() => {
    StorageManager.prototype.persist = () => Promise.resolve(false);
  });
  await freshApp(page); await setupShip(page);
  await addCertificate(page, {
    certificate: 'Other', name: 'Supercalifragilisticexpialidocious-Certificate-Of-Extraordinary-Length-For-Narrow-Screens', expiryDate: '2026-10-01',
  });
  await addCertificate(page, { certificate: 'Other', name: 'A certificate with a name that runs over more than one line of a phone', nextSurveyDue: '2026-11-15' });
  await addMember(page, { surname: 'VAN DER BERG-PETROVIĆ-SCHMIDT', givenNames: 'Jean-Luc Alexander Maximilian', passportExpiry: '2026-12-01' });
  await scheduleChange(page, '2026-10-26T02:00', 'UTC-09:30');
  await page.goto('./#/');
  await expect(noBackupYet(page)).toBeVisible();
  await expect(page.getByText(PERSISTENCE_NOTICE)).toBeVisible();
  await expect(alertItems(page)).toHaveCount(3);
  await expect(page.getByText('Clock change 26 Oct 02:00 → UTC-09:30')).toBeVisible();
  await expectNoHorizontalScroll(page);
});
