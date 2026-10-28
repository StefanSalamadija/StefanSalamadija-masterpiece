import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { allowWrites, expectNoHorizontalScroll, failWrites, freshApp, setupShip } from './helpers';

// The clock is 2026-10-25T09:00Z and the ship is at UTC+03:00, so the ship's today is 2026-10-25.

const certificateList = (page: Page) => page.getByRole('list', { name: 'Certificates' });
const certificateRow = (page: Page, name: string) => certificateList(page).getByRole('listitem').filter({ hasText: name });
// "Certificate" alone would match "Certificate name" as well, once Other is chosen.
const certificateSelect = (page: Page) => page.getByLabel('Certificate', { exact: true });

interface NewCertificate {
  /** The option of the select: a certificate of the catalogue, or `Other`. */
  certificate: string;
  /** The name typed for Other. */
  name?: string;
  number?: string;
  issuedBy?: string;
  issueDate?: string;
  expiryDate?: string;
  nextSurveyDue?: string;
  remarks?: string;
}

/** Fills in the Add form and saves it, which leaves the browser on the register. */
async function addCertificate(page: Page, c: NewCertificate): Promise<void> {
  await page.goto('./#/ship/certificates/new');
  await certificateSelect(page).selectOption({ label: c.certificate });
  if (c.name !== undefined) await page.getByLabel('Certificate name').fill(c.name);
  if (c.number) await page.getByLabel('Number').fill(c.number);
  if (c.issuedBy) await page.getByLabel('Issued by').fill(c.issuedBy);
  if (c.issueDate) await page.getByLabel('Issue date').fill(c.issueDate);
  if (c.expiryDate) await page.getByLabel('Expiry date').fill(c.expiryDate);
  if (c.nextSurveyDue) await page.getByLabel('Next survey due').fill(c.nextSurveyDue);
  if (c.remarks) await page.getByLabel('Remarks').fill(c.remarks);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/certificates$/);
}

type StoredCertificate = Record<string, unknown> & { id: string; deleted: boolean };

/** Every certificate as stored in IndexedDB, deleted ones included, to check what was really written. */
function storedCertificates(page: Page): Promise<StoredCertificate[]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('masterpiece');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('certificates').objectStore('certificates').getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
        };
      }),
  );
}

test('certificate warnings and validation', async ({ page }) => {
  await freshApp(page); await setupShip(page); await page.goto('./#/ship/certificates/new');
  await certificateSelect(page).selectOption({ label: 'International Load Line' });
  await page.getByLabel('Issue date').fill('2026-05-01'); await page.getByLabel('Expiry date').fill('2026-04-01');
  await expect(page.getByRole('alert')).toHaveText("Expiry date can't be before the issue date.");
  await page.getByLabel('Expiry date').fill('2026-12-24');         // 60 days → amber
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/certificates$/);
  await page.goto('./#/ship/certificates/new');
  await certificateSelect(page).selectOption({ label: 'Other' });
  await page.getByLabel('Certificate name').fill('Fumigation exemption');
  await page.getByLabel('Expiry date').fill('2026-10-01');         // past → red
  await page.getByRole('button', { name: 'Save' }).click();
  const items = certificateList(page).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Fumigation exemption'); await expect(items.nth(0)).toContainText('Overdue');
  await expect(items.nth(1)).toContainText('International Load Line'); await expect(items.nth(1)).toContainText('Due soon');
  await expectNoHorizontalScroll(page);
});

test('certificates list: overdue first, then due soon, then the rest by name; a row opens the certificate', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addCertificate(page, { certificate: 'Class Certificate (Hull)', number: 'CL-9', expiryDate: '2030-01-01' });
  await addCertificate(page, { certificate: 'Certificate of Registry' });
  await addCertificate(page, { certificate: 'International Load Line', number: 'LL-1', expiryDate: '2026-12-24' });
  // Its expiry is far off, but its survey is past.
  await addCertificate(page, { certificate: 'Safety Management Certificate', expiryDate: '2030-01-01', nextSurveyDue: '2026-10-20' });
  await addCertificate(page, { certificate: 'Other', name: 'Fumigation exemption', expiryDate: '2026-10-01' });

  const rows = certificateList(page).getByRole('listitem');
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText('Fumigation exemption');
  await expect(rows.nth(1)).toContainText('Safety Management Certificate');
  await expect(rows.nth(2)).toContainText('International Load Line');
  await expect(rows.nth(3)).toContainText('Certificate of Registry');
  await expect(rows.nth(4)).toContainText('Class Certificate (Hull)');

  await expect(rows.locator('[data-band]')).toHaveCount(3);
  await expect(rows.nth(0).locator('[data-band="red"]')).toHaveText('Overdue');
  await expect(rows.nth(1).locator('[data-band="red"]')).toHaveText('Overdue');
  await expect(rows.nth(2).locator('[data-band="amber"]')).toHaveText('Due soon');

  // The number and the dates are shown year first, as kept.
  await expect(rows.nth(2)).toContainText('No. LL-1');
  await expect(rows.nth(2)).toContainText('Expires 2026-12-24');
  await expect(rows.nth(1)).toContainText('Expires 2030-01-01');
  await expect(rows.nth(1)).toContainText('Next survey 2026-10-20');
  await expect(rows.nth(4)).toContainText('No. CL-9');
  await expect(rows.nth(3)).not.toContainText('Expires');

  const [loadLine] = (await storedCertificates(page)).filter((c) => c.key === 'loadLine');
  const link = certificateRow(page, 'International Load Line').getByRole('link');
  await expect(link).toHaveAttribute('href', `#/ship/certificates/${loadLine.id}`);
  await link.click();
  await expect(page.getByRole('heading', { name: 'Edit certificate' })).toBeVisible();
  await expect(certificateSelect(page)).toHaveValue('loadLine');
});

test('certificates list: the Add link and an empty register', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/certificates');
  await expect(page.getByRole('heading', { name: 'Certificates' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add certificate' })).toHaveAttribute('href', '#/ship/certificates/new');
  await expect(page.getByText('No certificates yet.')).toBeVisible();
  await expect(certificateList(page)).toHaveCount(0);
  await page.getByRole('link', { name: 'Add certificate' }).click();
  await expect(page.getByRole('heading', { name: 'Add certificate' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0); // nothing to delete yet
});

test('certificates list: the ship nav leads to the register', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Ship', exact: true }).click();
  await page.getByRole('navigation', { name: 'Ship sections' }).getByRole('link', { name: 'Certificates' }).click();
  await expect(page).toHaveURL(/#\/ship\/certificates$/);
  await expect(page.getByRole('link', { name: 'Add certificate' })).toBeVisible();
});

test('certificate edit: the select groups the catalogue, with Other last', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/certificates/new');
  const select = certificateSelect(page);
  await expect(select).toHaveValue('');
  await expect(page.locator('select optgroup')).toHaveCount(8);
  await expect(page.locator('select optgroup').first()).toHaveAttribute('label', 'Registry and tonnage');
  await expect(page.locator('select optgroup[label="Statutory safety"] option').first()).toHaveText('Minimum Safe Manning Document');
  await expect(page.locator('select optgroup[label="Health"] option')).toHaveText(['Ship Sanitation Control (Exemption) Certificate']);
  await expect(select.locator('option').last()).toHaveText('Other');
  await expect(page.locator('select optgroup option', { hasText: /^Other$/ })).toHaveCount(0);
  await expect(page.getByLabel('Certificate name')).toHaveCount(0);
  for (const label of ['Number', 'Issued by', 'Issue date', 'Expiry date', 'Next survey due', 'Remarks']) {
    await expect(page.getByLabel(label)).toBeVisible();
  }
  await expect(page.getByLabel('Number')).toHaveAttribute('type', 'text');
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
});

test('certificate edit: an error shows once its field is changed, and Save shows them all', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/certificates/new');
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/certificates\/new$/);
  await expect(page.getByRole('alert')).toHaveText('Certificate name is required.');
  await expect(certificateSelect(page)).toBeFocused();
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
  expect(await storedCertificates(page)).toHaveLength(0);

  // Other: the name is what is missing, and the focus goes to it.
  await certificateSelect(page).selectOption({ label: 'Other' });
  await page.getByLabel('Issue date').fill('2026-05-01');
  await page.getByLabel('Expiry date').fill('2026-04-01');
  await expect(page.getByRole('alert')).toHaveText(["Certificate name is required.", "Expiry date can't be before the issue date."]);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('Certificate name')).toBeFocused();
  expect(await storedCertificates(page)).toHaveLength(0);

  await page.getByLabel('Certificate name').fill('Fumigation exemption');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('Expiry date')).toBeFocused(); // the first control with a problem
  await expect(page.getByRole('alert')).toHaveText("Expiry date can't be before the issue date.");
  expect(await storedCertificates(page)).toHaveLength(0);

  await page.getByLabel('Expiry date').fill('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/certificates$/);
  expect(await storedCertificates(page)).toHaveLength(1);
});

test('certificate edit: the first control with a problem is not left under the header', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('./#/ship/certificates/new');
  await page.getByRole('button', { name: 'Save' }).click(); // the page is scrolled down to Save, and the focus goes back up
  await expect(certificateSelect(page)).toBeFocused();
  const header = await page.getByRole('banner').boundingBox();
  const select = await certificateSelect(page).boundingBox();
  const message = await page.getByRole('alert').boundingBox();
  expect(select!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  expect(message!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  await expect(page.getByLabel('Certificate', { exact: true })).toBeInViewport();
});

test('certificate edit: a name typed for Other is dropped when another certificate is chosen', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/certificates/new');
  await certificateSelect(page).selectOption({ label: 'Other' });
  await page.getByLabel('Certificate name').fill('Fumigation exemption');
  await certificateSelect(page).selectOption({ label: 'IOPP' });
  await expect(page.getByLabel('Certificate name')).toHaveCount(0);
  await certificateSelect(page).selectOption({ label: 'Other' });
  await expect(page.getByLabel('Certificate name')).toHaveValue('');

  await certificateSelect(page).selectOption({ label: 'IOPP' });
  await page.getByLabel('Number').fill('  IOPP-77 ');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(certificateRow(page, 'IOPP')).toContainText('No. IOPP-77');
  const [stored] = await storedCertificates(page);
  expect(stored).toMatchObject({
    key: 'iopp', name: 'IOPP', number: 'IOPP-77', issuedBy: '', issueDate: '', remarks: '', deleted: false, scope: 'ship',
    shipId: expect.any(String),
  });
  expect('expiryDate' in stored).toBe(false); // no date is left out, not stored as ''
  expect('nextSurveyDue' in stored).toBe(false);
});

test('certificate edit: opens a certificate with its fields, and Other can become an entry of the catalogue', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addCertificate(page, {
    certificate: 'Other', name: 'Fumigation exemption', number: 'FE-1', issuedBy: 'Port health', issueDate: '2026-01-10',
    expiryDate: '2027-01-10', nextSurveyDue: '2026-12-01', remarks: 'Renew at Santos',
  });
  await addCertificate(page, { certificate: 'IOPP', number: 'IOPP-1', expiryDate: '2030-01-01' });
  const [before] = (await storedCertificates(page)).filter((c) => c.key === 'other');

  await certificateRow(page, 'Fumigation exemption').getByRole('link').click();
  await expect(certificateSelect(page)).toHaveValue('other');
  await expect(page.getByLabel('Certificate name')).toHaveValue('Fumigation exemption');
  await expect(page.getByLabel('Number')).toHaveValue('FE-1');
  await expect(page.getByLabel('Issued by')).toHaveValue('Port health');
  await expect(page.getByLabel('Issue date')).toHaveValue('2026-01-10');
  await expect(page.getByLabel('Expiry date')).toHaveValue('2027-01-10');
  await expect(page.getByLabel('Next survey due')).toHaveValue('2026-12-01');
  await expect(page.getByLabel('Remarks')).toHaveValue('Renew at Santos');

  await certificateSelect(page).selectOption({ label: 'Safety Management Certificate' });
  await expect(page.getByLabel('Certificate name')).toHaveCount(0);
  await page.getByLabel('Next survey due').fill(''); // an emptied date is cleared
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/certificates$/);

  await expect(certificateRow(page, 'Fumigation exemption')).toHaveCount(0);
  await expect(certificateRow(page, 'Safety Management Certificate')).toContainText('No. FE-1');
  const stored = await storedCertificates(page);
  expect(stored).toHaveLength(2);
  const changed = stored.find((c) => c.id === before.id)!;
  expect(changed).toMatchObject({
    key: 'smc', name: 'Safety Management Certificate', number: 'FE-1', issuedBy: 'Port health', issueDate: '2026-01-10',
    expiryDate: '2027-01-10', remarks: 'Renew at Santos', createdAt: before.createdAt, shipId: before.shipId, deleted: false,
  });
  expect(changed.updatedAt).not.toBe(before.updatedAt);
  expect('nextSurveyDue' in changed).toBe(false);

  // The entry of the catalogue is selected on opening; the other way round, Other starts without a name.
  await certificateRow(page, 'Safety Management Certificate').getByRole('link').click();
  await expect(certificateSelect(page)).toHaveValue('smc');
  await expect(page.getByLabel('Certificate name')).toHaveCount(0);
  await certificateSelect(page).selectOption({ label: 'Other' });
  await expect(page.getByLabel('Certificate name')).toHaveValue('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/certificates\/[^/]+$/);
  await expect(page.getByLabel('Certificate name')).toBeFocused();
  await expect(page.getByRole('alert')).toHaveText('Certificate name is required.');
  expect((await storedCertificates(page)).find((c) => c.id === before.id)?.key).toBe('smc');
});

test('certificate edit: another certificate opened from the same screen has its own draft', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addCertificate(page, { certificate: 'IOPP', number: 'IOPP-1' });
  await addCertificate(page, { certificate: 'IEE', number: 'IEE-1' });
  const [iopp] = (await storedCertificates(page)).filter((c) => c.key === 'iopp');
  const [iee] = (await storedCertificates(page)).filter((c) => c.key === 'iee');

  await page.goto(`./#/ship/certificates/${iopp.id}`);
  await expect(page.getByLabel('Number')).toHaveValue('IOPP-1');
  await page.getByLabel('Number').fill('typed, not saved');
  await page.goto(`./#/ship/certificates/${iee.id}`);
  await expect(certificateSelect(page)).toHaveValue('iee');
  await expect(page.getByLabel('Number')).toHaveValue('IEE-1');
});

test('certificate edit: an unknown certificate says so, with a way back', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/certificates/no-such-certificate');
  await expect(page.getByText('Certificate not found.')).toBeVisible();
  await page.getByRole('link', { name: 'Back to certificates' }).click();
  await expect(page).toHaveURL(/#\/ship\/certificates$/);
  await expect(page.getByRole('link', { name: 'Add certificate' })).toBeVisible();
});

test('certificate delete: asks first, then removes the certificate, keeps a tombstone, and returns to the list', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addCertificate(page, { certificate: 'Other', name: 'Fumigation exemption', number: 'FE-1' });
  await addCertificate(page, { certificate: 'IOPP' });
  const [target] = (await storedCertificates(page)).filter((c) => c.key === 'other');

  await certificateRow(page, 'Fumigation exemption').getByRole('link').click();
  const deleteButton = page.getByRole('button', { name: 'Delete', exact: true });
  await deleteButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Delete Fumigation exemption?' })).toBeVisible();
  await expect(dialog).toContainText('This removes the certificate from this device.');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(deleteButton).toBeFocused();
  expect((await storedCertificates(page)).every((c) => !c.deleted)).toBe(true);

  await deleteButton.click();
  await dialog.getByRole('button', { name: 'Delete certificate' }).click();
  await expect(page).toHaveURL(/#\/ship\/certificates$/);
  await expect(dialog).toHaveCount(0);
  await expect(certificateRow(page, 'Fumigation exemption')).toHaveCount(0);
  await expect(certificateRow(page, 'IOPP')).toHaveCount(1);
  const stored = await storedCertificates(page);
  expect(stored).toHaveLength(2); // a soft delete: the record stays, marked
  expect(stored.find((c) => c.id === target.id)?.deleted).toBe(true);

  await page.goto(`./#/ship/certificates/${target.id}`);
  await expect(page.getByText('Certificate not found.')).toBeVisible();
});

test('certificate delete: a failed write keeps the dialog open, with the message and no toast', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addCertificate(page, { certificate: 'IOPP' });
  await certificateRow(page, 'IOPP').getByRole('link').click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await failWrites(page);
  await dialog.getByRole('button', { name: 'Delete certificate' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Storage on this device is full.');
  await expect(page.getByRole('alert')).toHaveCount(1);
  await expect(page).toHaveURL(/#\/ship\/certificates\/[^/]+$/);
  await expect(dialog.getByRole('button', { name: 'Delete certificate' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  expect((await storedCertificates(page))[0].deleted).toBe(false);

  await allowWrites(page);
  await dialog.getByRole('button', { name: 'Delete certificate' }).click();
  await expect(page).toHaveURL(/#\/ship\/certificates$/);
  await expect(certificateRow(page, 'IOPP')).toHaveCount(0);
  expect((await storedCertificates(page))[0].deleted).toBe(true);
});

test('certificate edit: a failed save keeps the form and what was typed', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/certificates/new');
  await certificateSelect(page).selectOption({ label: 'IOPP' });
  await page.getByLabel('Number').fill('IOPP-1');
  await failWrites(page);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toContainText('Storage on this device is full.');
  await expect(page).toHaveURL(/#\/ship\/certificates\/new$/);
  await expect(page.getByLabel('Number')).toHaveValue('IOPP-1');
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();

  // On a phone the message covers the button until it is dismissed.
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await allowWrites(page);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/certificates$/);
  await expect(certificateRow(page, 'IOPP')).toContainText('No. IOPP-1');
});

test('certificates: the screens and the dialog fit a 360 px phone, even with long names', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  const longName = 'Document of Compliance for Dangerous Goods and Solid Bulk Cargoes of the Flag State Administration';
  await addCertificate(page, {
    certificate: 'Other', name: longName, number: 'A-VERY-LONG-CERTIFICATE-NUMBER-0123456789-0123456789-0123456789',
    expiryDate: '2026-10-01', nextSurveyDue: '2026-12-01',
  });
  await addCertificate(page, { certificate: 'Document of Compliance for Dangerous Goods / IMSBC solid bulk cargoes', expiryDate: '2026-12-24' });
  await addCertificate(page, { certificate: 'Other', name: 'X'.repeat(90) });
  await expect(certificateList(page).getByRole('listitem')).toHaveCount(3);
  await expectNoHorizontalScroll(page);

  await certificateRow(page, longName).getByRole('link').click();
  await expect(page.getByLabel('Certificate name')).toHaveValue(longName);
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: `Delete ${longName}?` })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test.describe('with the ship profiles', () => {
  const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
  const shipRow = (page: Page, name: string) => page.getByRole('list', { name: 'Ships' }).getByRole('listitem').filter({ hasText: name });

  async function openProfiles(page: Page): Promise<void> {
    await mainNav(page).getByRole('link', { name: 'Profiles', exact: true }).click();
    await expect(page.getByRole('button', { name: 'New ship' })).toBeVisible();
  }

  async function addTwoCertificates(page: Page): Promise<void> {
    await addCertificate(page, {
      certificate: 'International Load Line', number: 'LL-1', issuedBy: 'DNV', issueDate: '2026-01-10', expiryDate: '2026-12-24',
      nextSurveyDue: '2026-11-01', remarks: 'Annual survey due',
    });
    await addCertificate(page, { certificate: 'Other', name: 'Fumigation exemption', number: 'FE-1', expiryDate: '2030-01-01' });
  }

  test('copy with the certificate list: the same names, without numbers or dates', async ({ page }) => {
    await freshApp(page); await setupShip(page);
    await addTwoCertificates(page);
    await openProfiles(page);
    await shipRow(page, 'MV OCEAN STAR').getByRole('button', { name: 'Copy' }).click();
    await page.getByLabel('New ship name').fill('MV OCEAN PEARL');
    await page.getByLabel('Copy certificate list (names only)').check();
    await page.getByRole('button', { name: 'Copy ship' }).click();
    await expect(shipRow(page, 'MV OCEAN PEARL')).toHaveCount(1);
    await shipRow(page, 'MV OCEAN PEARL').getByRole('button', { name: 'Make active' }).click();
    await expect(page.getByRole('banner')).toContainText('MV OCEAN PEARL');

    await page.goto('./#/ship/certificates');
    const rows = certificateList(page).getByRole('listitem');
    await expect(rows).toHaveCount(2);
    await expect(rows).toContainText(['Fumigation exemption', 'International Load Line']);
    for (const text of ['FE-1', 'LL-1', '2026', '2030', 'No.', 'Expires', 'Next survey', 'Overdue', 'Due soon']) {
      await expect(certificateList(page)).not.toContainText(text);
    }

    // The shell opens as an empty certificate of the same kind.
    await certificateRow(page, 'International Load Line').getByRole('link').click();
    await expect(certificateSelect(page)).toHaveValue('loadLine');
    for (const label of ['Number', 'Issued by', 'Issue date', 'Expiry date', 'Next survey due', 'Remarks']) {
      await expect(page.getByLabel(label)).toHaveValue('');
    }
    await page.goto('./#/ship/certificates');
    await certificateRow(page, 'Fumigation exemption').getByRole('link').click();
    await expect(certificateSelect(page)).toHaveValue('other');
    await expect(page.getByLabel('Certificate name')).toHaveValue('Fumigation exemption');

    // The first ship keeps its numbers and dates.
    await page.goto('./#/profiles');
    await shipRow(page, 'MV OCEAN STAR').getByRole('button', { name: 'Make active' }).click();
    await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');
    await page.goto('./#/ship/certificates');
    await expect(certificateRow(page, 'International Load Line')).toContainText('No. LL-1');
    await expect(certificateRow(page, 'International Load Line')).toContainText('Expires 2026-12-24');
  });

  test('copy without the certificate list leaves the new ship with none', async ({ page }) => {
    await freshApp(page); await setupShip(page);
    await addTwoCertificates(page);
    await openProfiles(page);
    await shipRow(page, 'MV OCEAN STAR').getByRole('button', { name: 'Copy' }).click();
    await page.getByLabel('New ship name').fill('MV OCEAN PEARL');
    await page.getByRole('button', { name: 'Copy ship' }).click();
    await shipRow(page, 'MV OCEAN PEARL').getByRole('button', { name: 'Make active' }).click();
    await expect(page.getByRole('banner')).toContainText('MV OCEAN PEARL');
    await page.goto('./#/ship/certificates');
    await expect(page.getByText('No certificates yet.')).toBeVisible();
  });

  test('the delete dialog counts the ship\'s certificates, and not those already deleted', async ({ page }) => {
    await freshApp(page); await setupShip(page);
    await addTwoCertificates(page);
    await openProfiles(page);
    await shipRow(page, 'MV OCEAN STAR').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('dialog')).toContainText('This removes 0 crew, 2 certificates, 0 voyages, 0 crew documents and 1 clock change from this device.');
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.goto('./#/ship/certificates');
    await certificateRow(page, 'Fumigation exemption').getByRole('link').click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete certificate' }).click();
    await expect(page).toHaveURL(/#\/ship\/certificates$/);

    await openProfiles(page);
    await shipRow(page, 'MV OCEAN STAR').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('dialog')).toContainText('This removes 0 crew, 1 certificate, 0 voyages, 0 crew documents and 1 clock change from this device.');
  });
});
