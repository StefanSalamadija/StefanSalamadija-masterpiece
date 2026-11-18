import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoHorizontalScroll, expectRedOnly, freshApp, setTheme, setupShip } from './helpers';

// Unless a test says otherwise, the clock is 2026-10-25T09:00Z and the ship is at UTC+03:00, so the ship's clock reads
// 12:00 and its today is 2026-10-25. The made-up ship of `madeUpShip` is on 2026-11-17 instead. Sealing a backup derives a
// key with 600,000 PBKDF2 rounds, which takes a moment: the wait that follows it is given more time than the default, and
// is always on what the page shows, never a fixed sleep. All the data is made up.

const PASSWORD = 'lozinka-ćevapi';
const CRYPTO = { timeout: 20_000 };
const DAY_MS = 24 * 60 * 60 * 1000;
const PERSISTENCE_NOTICE = "This browser may clear Masterpiece's data when storage runs low. Install the app and export backups regularly.";
const MINUS = '−';

const voyageCard = (page: Page) => page.getByRole('region', { name: 'Voyage', exact: true });
const dueRegion = (page: Page) => page.getByRole('region', { name: 'Due', exact: true });
const dueItems = (page: Page) => dueRegion(page).getByRole('listitem');
const noBackupYet = (page: Page) => page.getByText('No backup yet. Export one now.');
const tiles = (page: Page) => page.getByRole('navigation', { name: 'Quick actions' });
const hub = (page: Page) => page.getByRole('navigation', { name: 'Ship sections', exact: true });
const hubTile = (page: Page, name: string) => hub(page).getByRole('link', { name, exact: true });
const pill = (page: Page) => page.getByRole('banner').getByRole('button', { name: /MV / });

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
  rank?: string;
  passportExpiry?: string;
  seamansBookExpiry?: string;
  signOn?: string;
  contractMonths?: string;
}

/** Fills in the Add form and saves it, which leaves the browser on the crew list. */
async function addMember(page: Page, m: NewMember): Promise<void> {
  await page.goto('./#/ship/crew/new');
  await page.getByLabel('Surname').fill(m.surname);
  await page.getByLabel('Given names').fill(m.givenNames ?? 'Ivan');
  await page.getByLabel('Rank').selectOption({ label: m.rank ?? 'Master' });
  await page.getByLabel('Date of birth').fill('1985-01-05');
  await page.getByLabel('Passport expiry').fill(m.passportExpiry ?? '2030-01-01');
  await page.getByLabel("Seaman's book expiry").fill(m.seamansBookExpiry ?? '2030-01-01');
  await page.getByLabel('Sign-on date').fill(m.signOn ?? '2026-06-01');
  if (m.contractMonths !== undefined) await page.getByLabel('Contract length (months)').fill(m.contractMonths);
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

/**
 * MV OCEAN STAR on 2026-11-17 (09:00Z, 12:00 on board at UTC+03:00), made up:
 * - 2nd Officer R. EXAMPLE, whose passport ran out on 12 Nov (5 days ago);
 * - AB J. SAMPLE, whose contract ends on 8 Dec and whose seaman's book runs out on 20 Dec;
 * - the International Load Line certificate, which expires on 1 Dec (in 14 days);
 * - voyage V-112, Santos to Qingdao, ETA 19 Nov 14:00 at UTC+03:00 (2 d 2 h after 09:00Z).
 * That is four alerts: the passport (overdue), then the certificate, the contract and the book (due soon).
 */
async function madeUpShip(page: Page): Promise<void> {
  await freshApp(page, { time: '2026-11-17T09:00:00Z' });
  await setupShip(page);
  await addMember(page, { surname: 'EXAMPLE', givenNames: 'Robert', rank: '2nd Officer', passportExpiry: '2026-11-12', signOn: '2026-10-01' });
  await addMember(page, { surname: 'SAMPLE', givenNames: 'John', rank: 'AB', seamansBookExpiry: '2026-12-20', signOn: '2026-06-08', contractMonths: '6' });
  await addCertificate(page, { certificate: 'International Load Line', expiryDate: '2026-12-01' });
  await page.goto('./#/ship/voyage');
  await page.getByLabel('Voyage no.').fill('V-112');
  await page.getByLabel('Last port').fill('Santos');
  await page.getByLabel('Next port', { exact: true }).fill('Qingdao');
  await page.getByLabel('ETA (local)').fill('2026-11-19T14:00');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await page.goto('./#/');
}

/** Fills in all 16 particulars that the forms read (the ship's name is in already), and saves them. */
async function fillParticulars(page: Page): Promise<void> {
  await page.goto('./#/ship/particulars');
  const values: [string, string][] = [
    ['IMO number', '9074729'], ['Call sign', 'XXXX1'], ['MMSI', '247123456'], ['Flag', 'Utopia'], ['Port of registry', 'Example Port'],
    ['GT', '30000'], ['NT', '17000'], ['DWT (summer)', '52000'], ['LOA (m)', '190'], ['Beam (m)', '32.26'], ['Year built', '2012'],
    ['Owners', 'Example Owners Ltd'], ['Managers (ISM company)', 'Sample Ship Management'], ['P&I club', 'Example P&I Club'],
    ['Classification society', 'Example Class'],
  ];
  for (const [label, value] of values) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
}

test('the voyage card shows the voyage, the route, the countdown and the crew on board', async ({ page }) => {
  await madeUpShip(page);
  await expect(page.getByRole('heading', { name: 'Home' })).toBeAttached();
  const card = voyageCard(page);
  await expect(card).toContainText('Voyage V-112');
  await expect(card).toContainText('Santos → Qingdao');
  await expect(card).toContainText('ETA in');
  // 2 d 2 h less the seconds the clock has run since 09:00 (it runs on): whole minutes, rounded down.
  await expect(card.getByTestId('eta-countdown')).toHaveText('2 d 1 h');
  await expect(card).toContainText('19 Nov 14:00 LT');
  await expect(card).toContainText('On board');
  await expect(card.getByTestId('on-board')).toHaveText('2');
  await expect(card.getByRole('link', { name: 'Start voyage' })).toHaveCount(0);
  await expect(card).not.toContainText('Next clock change');
  await expectNoHorizontalScroll(page);
});

test('Due shows the three most urgent, the passport first, and See all', async ({ page }) => {
  await madeUpShip(page);
  await expect(dueRegion(page).getByRole('heading', { name: 'Due' })).toBeVisible();
  await expect(dueItems(page)).toHaveCount(3);
  await expect(dueItems(page)).toContainText(['Passport · 2nd Officer R. EXAMPLE', 'International Load Line', 'Contract end · AB J. SAMPLE']);
  const passport = dueItems(page).first();
  await expect(passport).toContainText('Expired 12 Nov');
  await expect(passport.locator('.status')).toHaveText('5 d over');
  await expect(passport.locator('.status')).toHaveAttribute('data-tone', 'danger');
  await expect(dueRegion(page).getByText("Seaman's book · AB J. SAMPLE")).toHaveCount(0);   // the fourth
  await expect(dueRegion(page).getByText('✓ Nothing due')).toHaveCount(0);

  const seeAll = dueRegion(page).getByRole('link', { name: 'See all 4' });
  await expect(seeAll).toHaveAttribute('href', '#/due');
  await seeAll.click();
  await expect(page).toHaveURL(/#\/due$/);
  await expect(page.getByRole('region', { name: 'Due soon' })).toContainText("Seaman's book · AB J. SAMPLE");
});

test('a ship certificate due soon is on Home, and opens the certificate', async ({ page }) => {
  await madeUpShip(page);
  const certificate = dueItems(page).filter({ hasText: 'International Load Line' });
  await expect(certificate).toContainText('Ship certificate · 1 Dec');
  await expect(certificate.locator('.status')).toHaveText('in 14 d');
  await expect(certificate.locator('.status')).toHaveAttribute('data-tone', 'warn');
  await certificate.getByRole('link').click();
  await expect(page).toHaveURL(/#\/ship\/certificates\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Edit certificate' })).toBeVisible();
  await expect(page.getByLabel('Expiry date')).toHaveValue('2026-12-01');
});

test('home shows backup reminder and an expired certificate as overdue', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await expect(noBackupYet(page)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Export full backup' })).toHaveAttribute('href', '#/settings');
  await addCertificate(page, { certificate: 'International Load Line', expiryDate: '2026-10-01' });
  await page.goto('./#/');
  await expect(dueRegion(page).getByRole('link')).toContainText(['International Load Line']);
  // The status is in words too, so that a printout (which has no colour) carries it.
  await expect(dueItems(page)).toContainText(['Ship certificate · 1 Oct']);
  await expect(dueItems(page).first().locator('.status')).toHaveText('24 d over');
  await expect(dueRegion(page).getByText('✓ Nothing due')).toHaveCount(0);
  await expect(dueRegion(page).getByRole('link', { name: 'See all 1' })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('an empty ship says No voyage, offers to start one, and has nothing due', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await expect(page.getByRole('heading', { name: 'Home' })).toBeAttached();
  await expect(voyageCard(page)).toContainText('No voyage');
  await expect(voyageCard(page).getByTestId('on-board')).toHaveText('0');
  await expect(voyageCard(page)).not.toContainText('ETA');
  await expect(voyageCard(page).getByRole('link', { name: 'Start voyage' })).toHaveAttribute('href', '#/ship/voyage');
  await expect(dueRegion(page).getByRole('heading', { name: 'Due' })).toBeVisible();
  await expect(dueRegion(page).getByText('✓ Nothing due')).toBeVisible();
  await expect(dueRegion(page).getByRole('link')).toHaveCount(0);           // no rows and no See all
  await expect(page.getByText(/Next clock change/)).toHaveCount(0);
  await expect(page.getByRole('link', { name: "Ship's data" })).toHaveCount(0);

  // A certificate that is far from its dates, and a crew member whose papers are good, are nothing due either.
  await addCertificate(page, { certificate: 'International Load Line', expiryDate: '2030-01-01' });
  await addMember(page, { surname: 'PETROVIĆ' });
  await page.goto('./#/');
  await expect(dueRegion(page).getByText('✓ Nothing due')).toBeVisible();
  await expect(voyageCard(page).getByTestId('on-board')).toHaveText('1');
  await expectNoHorizontalScroll(page);
  await voyageCard(page).getByRole('link', { name: 'Start voyage' }).click();
  await expect(page).toHaveURL(/#\/ship\/voyage$/);
});

test('a voyage with no number, ports or ETA says so in plain words', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/voyage');
  await page.getByRole('button', { name: 'Save' }).click();               // an empty voyage may be saved
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await page.goto('./#/');
  await expect(voyageCard(page)).toContainText('Voyage');
  await expect(voyageCard(page)).not.toContainText('No voyage');
  await expect(voyageCard(page)).toContainText('ETA not set');
  await expect(voyageCard(page)).not.toContainText('→');
  await expect(voyageCard(page)).not.toContainText(/NaN|undefined/);
  await page.goto('./#/ship');
  await expect(hubTile(page, 'Voyage')).toHaveAccessibleDescription('ETA not set');
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
  await expect(dueItems(page)).toHaveCount(3);
  await expect(dueItems(page)).toContainText(['International Load Line', 'IOPP', 'Passport · Master I. PETROVIĆ']);
  await expect(dueItems(page).nth(0)).toContainText('Ship certificate · 1 Oct');
  await expect(dueItems(page).nth(0).locator('.status')).toHaveText('24 d over');
  await expect(dueItems(page).nth(1)).toContainText('Survey · 1 Dec');
  await expect(dueItems(page).nth(1).locator('.status')).toHaveText('in 37 d');
  await expect(dueItems(page).nth(2)).toContainText('Expires 10 Jan 2027');
  await expect(dueItems(page).nth(2).locator('.status')).toHaveText('in 77 d');
  await expect(dueRegion(page).getByRole('link', { name: 'See all 3' })).toBeVisible();
  await expect(dueRegion(page).getByText('GONE')).toHaveCount(0);   // signed off on 10 October
  await expect(dueRegion(page).getByText('LATER')).toHaveCount(0);  // joins on 1 November
  await expect(voyageCard(page).getByTestId('on-board')).toHaveText('1');
  await dueItems(page).nth(2).getByRole('link').click();
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
  await expect(page.getByRole('heading', { name: 'Home' })).toBeAttached();
  await expect(dueRegion(page)).toBeVisible();
  await expect(noBackupYet(page)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Export full backup' })).toHaveCount(0);

  // The reminder is 7 days: after 8 the banner is back, and says how long it has been.
  await page.clock.fastForward(8 * DAY_MS);
  await expect(page.getByText('Last backup 8 days ago. Export a backup now.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Export full backup' })).toHaveAttribute('href', '#/settings');
});

test('Not now hides the backup banner until the app starts again', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await expect(noBackupYet(page)).toBeVisible();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(noBackupYet(page)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Export full backup' })).toHaveCount(0);
  // Away and back: still hidden.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Ship', exact: true }).click();
  await expect(hub(page)).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home', exact: true }).click();
  await expect(dueRegion(page)).toBeVisible();
  await expect(noBackupYet(page)).toHaveCount(0);
  // Nothing is kept: the next start shows it again.
  await page.reload();
  await expect(noBackupYet(page)).toBeVisible();
});

test('the card shows the next clock change, and drops it once it has happened', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await expect(page.getByText(/Next clock change/)).toHaveCount(0);
  await scheduleChange(page, '2026-10-26T02:00', 'UTC+05:00');
  // The Ship's time history lists the change at the same time.
  await expect(page.getByRole('list', { name: 'History' }).getByRole('listitem').filter({ hasText: 'Scheduled' })).toContainText('2026-10-26 02:00 → UTC+05:00');

  await page.goto('./#/');
  await expect(voyageCard(page)).toContainText('Next clock change: +2 h');
  await expectNoHorizontalScroll(page);
  await page.goto('./#/ship');
  await expect(hubTile(page, "Ship's time")).toHaveAccessibleDescription('UTC+03:00 · +2 h on 26 Oct');
  await page.goto('./#/');
  await expect(voyageCard(page)).toContainText('Next clock change: +2 h');

  // 02:00 at +03:00 on the 26th is 23:00Z on the 25th.
  await page.clock.fastForward('16:00:00');
  await expect(page.getByTestId('ship-clock')).toContainText('(UTC+05:00)');
  await expect(page.getByText(/Next clock change/)).toHaveCount(0);
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
  await expect(page.getByRole('heading', { name: 'Home' })).toBeAttached();
  await expect(noBackupYet(page)).toBeVisible();                     // the page has loaded and the answer has come
  await expect(page.getByText(PERSISTENCE_NOTICE)).toHaveCount(0);
});

test('home fits a phone with everything on it at once', async ({ page }) => {
  await page.addInitScript(() => {
    StorageManager.prototype.persist = () => Promise.resolve(false);
  });
  await freshApp(page); await setupShip(page, 'MV OCEAN STAR WITH A VERY LONG MADE-UP NAME FOR A NARROW PHONE');
  await addCertificate(page, {
    certificate: 'Other', name: 'Supercalifragilisticexpialidocious-Certificate-Of-Extraordinary-Length-For-Narrow-Screens', expiryDate: '2026-10-01',
  });
  await addCertificate(page, { certificate: 'Other', name: 'A certificate with a name that runs over more than one line of a phone', nextSurveyDue: '2026-11-15' });
  await addMember(page, { surname: 'VAN DER BERG-PETROVIĆ-SCHMIDT', givenNames: 'Jean-Luc Alexander Maximilian', passportExpiry: '2026-12-01' });
  await page.goto('./#/ship/voyage');
  await page.getByLabel('Voyage no.').fill('V-2611-EXTRAORDINARILY-LONG-VOYAGE-NUMBER');
  await page.getByLabel('Last port').fill('Port of Santos Brazil Terminal Number Seven Extension Berth');
  await page.getByLabel('Next port', { exact: true }).fill('Supercalifragilisticexpialidocious-Harbour');
  await page.getByLabel('ETA (local)').fill('2026-11-02T14:30');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await scheduleChange(page, '2026-10-26T02:00', 'UTC-09:30');
  await page.goto('./#/');
  await expect(noBackupYet(page)).toBeVisible();
  await expect(page.getByText(PERSISTENCE_NOTICE)).toBeVisible();
  await expect(dueItems(page)).toHaveCount(3);
  await expect(voyageCard(page)).toContainText(`Next clock change: ${MINUS}12 h 30 min`);
  await expectNoHorizontalScroll(page);
});

test('home shows the personal budget alerts on screen, never in print', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  const budgetAlerts = page.getByRole('region', { name: 'Budget alerts' });
  await expect(page.getByRole('heading', { name: 'Home' })).toBeAttached();
  await expect(noBackupYet(page)).toBeVisible();
  await expect(budgetAlerts).toHaveCount(0); // a budget never opened has nothing to say
  await page.goto('./#/budget');
  await expect(page.getByRole('link', { name: /^Starting balances/ })).toBeVisible();
  // A fund due on 1 November 2026, 7 days after the ship's today.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('masterpiece');
    open.onsuccess = () => {
      const tx = open.result.transaction('budgetFunds', 'readwrite');
      tx.objectStore('budgetFunds').put({
        id: 'fund-ins', name: 'Home insurance', amount: 30000, dueYm: '2026-11', startBalance: 30000,
        createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: 'test', deleted: false, scope: 'personal',
      });
      tx.oncomplete = () => { open.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.goto('./#/');
  await expect(budgetAlerts).toContainText('1 budget alert');
  const row = budgetAlerts.getByRole('link', { name: 'Home insurance is due in November 2026' });
  await expect(row).toHaveAttribute('href', '#/budget/plan/funds');
  expect((await row.boundingBox())?.height).toBeGreaterThanOrEqual(48);
  await page.emulateMedia({ media: 'print' });
  await expect(budgetAlerts).toBeHidden();
  await expect(tiles(page)).toBeHidden();
});

test('the six tiles open their screens, and + Expense opens quick add', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  const links = tiles(page).getByRole('link');
  await expect(links).toHaveCount(6);
  const expected: [string, string][] = [
    ['Crew', '#/ship/crew'], ['Fill form', '#/forms'], ['Draft survey', '#/ship/survey'],
    ['+ Expense', '#/budget/add'], ['Converter', '#/tools'], ['Library', '#/library'],
  ];
  for (const [i, [name, href]] of expected.entries()) {
    await expect(links.nth(i)).toHaveAccessibleName(name);
    await expect(links.nth(i)).toHaveAttribute('href', href);
    expect((await links.nth(i).boundingBox())?.height).toBe(76);
  }
  await tiles(page).getByRole('link', { name: '+ Expense' }).click();
  await expect(page).toHaveURL(/#\/budget\/add$/);
  await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible();
});

test('switching ship with the pill swaps the card and Due at once', async ({ page }) => {
  await madeUpShip(page);
  await page.goto('./#/profiles');
  await page.getByRole('button', { name: 'New ship' }).click();
  await page.getByLabel('Ship name').fill('MV SEA BREEZE');
  await page.getByRole('button', { name: 'Create ship' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('./#/');
  await expect(voyageCard(page)).toContainText('Voyage V-112');
  await expect(dueItems(page)).toHaveCount(3);

  // Never, not for one frame, the old ship's voyage or alerts under the new ship's name.
  await page.evaluate(() => {
    const w = window as unknown as { staleSeen: boolean };
    w.staleSeen = false;
    const check = () => {
      const banner = document.querySelector('header')?.textContent ?? '';
      const main = document.querySelector('main')?.textContent ?? '';
      if (banner.includes('SEA BREEZE') && (main.includes('V-112') || main.includes('EXAMPLE'))) w.staleSeen = true;
    };
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await pill(page).click();
  await page.getByRole('dialog', { name: 'Switch ship' }).getByRole('button', { name: /MV SEA BREEZE/ }).click();
  await expect(page.getByRole('banner')).toContainText('MV SEA BREEZE');
  await expect(voyageCard(page)).toContainText('No voyage');
  await expect(dueRegion(page).getByText('✓ Nothing due')).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText('V-112');
  expect(await page.evaluate(() => (window as unknown as { staleSeen: boolean }).staleSeen)).toBe(false);

  // And back.
  await pill(page).click();
  await page.getByRole('dialog', { name: 'Switch ship' }).getByRole('button', { name: /MV OCEAN STAR/ }).click();
  await expect(voyageCard(page)).toContainText('Voyage V-112');
  await expect(dueItems(page)).toHaveCount(3);
});

test("the Ship hub's status lines follow the ship's records", async ({ page }) => {
  await madeUpShip(page);
  await page.goto('./#/ship');
  await expect(hubTile(page, 'Crew')).toHaveAccessibleDescription('2 on board');
  await expect(hubTile(page, 'Crew documents')).toHaveAccessibleDescription('1 expired');
  await expect(hubTile(page, 'Crew documents').locator('.hub-status')).toHaveAttribute('data-tone', 'danger');
  await expect(hubTile(page, 'Certificates')).toHaveAccessibleDescription('1 due in 14 d');
  await expect(hubTile(page, 'Certificates').locator('.hub-status')).toHaveAttribute('data-tone', 'warn');
  await expect(hubTile(page, 'Contracts & reliefs')).toHaveAccessibleDescription('1 due in 30 d');
  await expect(hubTile(page, 'Voyage')).toHaveAccessibleDescription('V-112 · ETA 19 Nov');
  await expect(hubTile(page, "Ship's time")).toHaveAccessibleDescription('UTC+03:00');
  await expect(hubTile(page, 'Draft survey')).toHaveAccessibleDescription('No surveys');
  // Only the ship's name is in: 15 of the 16 particulars the forms read are still to fill.
  await expect(hubTile(page, 'Particulars')).toHaveAccessibleDescription('15 to fill');
  await expect(hubTile(page, 'Particulars').locator('.hub-status')).toHaveAttribute('data-tone', 'warn');

  await fillParticulars(page);
  await page.goto('./#/ship');
  await expect(hubTile(page, 'Particulars')).toHaveAccessibleDescription('✓ Complete');
  await expect(hubTile(page, 'Particulars').locator('.hub-status')).toHaveAttribute('data-tone', 'ok');
  // The tiles are still named by their names alone.
  await expect(hubTile(page, 'Particulars')).toHaveAccessibleName('Particulars');
});

for (const size of [{ width: 360, height: 780 }, { width: 412, height: 860 }]) {
  test(`at ${size.width}×${size.height} Home does not scroll sideways, and the tiles end above the bottom bar`, async ({ page }) => {
    await madeUpShip(page);
    await page.setViewportSize(size);
    await expect(dueItems(page)).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const last = await tiles(page).getByRole('link').last().boundingBox();
    const nav = await page.getByRole('navigation', { name: 'Main' }).boundingBox();
    expect(last!.y + last!.height).toBeLessThanOrEqual(nav!.y);
  });
}

test('with little on Home the tiles still sit at the bottom, just above the bar', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.setViewportSize({ width: 412, height: 860 });
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(dueRegion(page).getByText('✓ Nothing due')).toBeVisible();
  const last = await tiles(page).getByRole('link').last().boundingBox();
  const nav = await page.getByRole('navigation', { name: 'Main' }).boundingBox();
  expect(last!.y + last!.height).toBeLessThanOrEqual(nav!.y);
  expect(nav!.y - (last!.y + last!.height)).toBeLessThanOrEqual(24);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(860);
});

test('Night red draws Home and the hub in red and black only', async ({ page }) => {
  await madeUpShip(page);
  await setTheme(page, 'Night red');
  await page.goto('./#/');
  await expect(dueItems(page)).toHaveCount(3);
  await expect(voyageCard(page)).toContainText('Voyage V-112');
  await expectRedOnly(page);
  await page.goto('./#/ship');
  await expect(hubTile(page, 'Crew')).toHaveAccessibleDescription('2 on board');
  await expectRedOnly(page);
});

test('in Night red a hub tile whose status is danger is filled, as drawn; in Day it is not', async ({ page }) => {
  await madeUpShip(page);
  const look = (name: string) => hubTile(page, name).evaluate((tile) => {
    const probe = (value: string) => {
      const span = document.createElement('span');
      span.style.color = value;
      document.body.append(span);
      const colour = getComputedStyle(span).color;
      span.remove();
      return colour;
    };
    const style = getComputedStyle(tile);
    return {
      background: style.backgroundColor, border: style.borderTopColor,
      name: getComputedStyle(tile.querySelector('.hub-name')!).color,
      icon: getComputedStyle(tile.querySelector('.hub-icon')!).color,
      dangerBg: probe('var(--danger-bg)'), danger: probe('var(--danger)'),
    };
  });
  await page.goto('./#/ship');
  await expect(hubTile(page, 'Crew documents')).toHaveAccessibleDescription('1 expired');
  await expect(hubTile(page, 'Crew documents')).toHaveAttribute('data-tone', 'danger');
  await expect(hubTile(page, 'Certificates')).not.toHaveAttribute('data-tone', /./);
  const dayDanger = await look('Crew documents');
  expect(dayDanger.background).toBe((await look('Crew')).background);

  await setTheme(page, 'Night red');
  await page.goto('./#/ship');
  await expect(hubTile(page, 'Crew documents')).toHaveAccessibleDescription('1 expired');
  const red = await look('Crew documents');
  expect(red.background).toBe(red.dangerBg);
  expect(red.name).toBe(red.danger);
  expect(red.icon).toBe(red.danger);
  expect(red.border).toBe('rgba(0, 0, 0, 0)');
  expect((await look('Certificates')).background).not.toBe(red.dangerBg);
  await expectRedOnly(page);
});
