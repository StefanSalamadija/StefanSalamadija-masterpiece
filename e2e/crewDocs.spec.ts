import { test, expect } from '@playwright/test';
import type { Download, Locator, Page } from '@playwright/test';
import { expectNoHorizontalScroll, freshApp, setupShip, skipProtectStep } from './helpers';

// The clock is 2026-10-25T09:00Z and the ship is at UTC+03:00, so the ship's today is 2026-10-25. Sealing or opening a
// backup derives a key with 600,000 PBKDF2 rounds, which takes a moment: the waits that follow are given more time than
// the default, and are always on what the page shows, never a fixed sleep.

const PASSWORD = 'lozinka-ćevapi';
const CRYPTO = { timeout: 20_000 };

const crewRow = (page: Page, name: string) => page.getByRole('list', { name: 'Crew' }).getByRole('listitem').filter({ hasText: name });
const documentList = (page: Page) => page.getByRole('list', { name: 'Documents' });
const expiringList = (page: Page) => page.getByRole('list', { name: 'Expiring' });
const alertsRegion = (page: Page) => page.getByRole('region', { name: 'Alerts' });
const shipList = (page: Page) => page.getByRole('list', { name: 'Ships' });

interface NewDocument {
  /** The option of the select: a paper of the catalogue, or `Other`. */
  document: string;
  /** The name typed for Other. */
  name?: string;
  grade?: string;
  number?: string;
  issuedBy?: string;
  issue?: string;
  expiry?: string;
  remarks?: string;
}

/** Fills in the Add form of a crew member and saves it, which leaves the browser on the crew list. */
async function addMember(page: Page, surname = 'PETROVIĆ', givenNames = 'Ivan'): Promise<void> {
  await page.goto('./#/ship/crew/new');
  await page.getByLabel('Surname').fill(surname);
  await page.getByLabel('Given names').fill(givenNames);
  await page.getByLabel('Rank').selectOption({ label: 'Master' });
  await page.getByLabel('Date of birth').fill('1985-01-05');
  await page.getByLabel('Passport expiry').fill('2030-01-01');
  await page.getByLabel("Seaman's book expiry").fill('2030-01-01');
  await page.getByLabel('Sign-on date').fill('2026-06-01');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew$/);
}

/** From the crew list to the edit screen of one crew member. */
async function openMember(page: Page, who: string | Locator): Promise<void> {
  if (typeof who === 'string') await page.goto('./#/ship/crew');
  await (typeof who === 'string' ? crewRow(page, who) : who).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit crew member' })).toBeVisible();
}

/** On the edit screen of a crew member: Add document, fill in the form, Save, and wait for the edit screen again. */
async function addDocument(page: Page, d: NewDocument): Promise<void> {
  await page.getByRole('button', { name: 'Add document' }).click();
  await expect(page.getByRole('heading', { name: 'Add document' })).toBeVisible();
  await page.getByLabel('Document', { exact: true }).selectOption({ label: d.document });
  if (d.name !== undefined) await page.getByLabel('Document name').fill(d.name);
  if (d.grade !== undefined) await page.getByLabel('Grade / capacity').fill(d.grade);
  if (d.number !== undefined) await page.getByLabel('Number').fill(d.number);
  if (d.issuedBy !== undefined) await page.getByLabel('Issued by').fill(d.issuedBy);
  if (d.issue !== undefined) await page.getByLabel('Issue date').fill(d.issue);
  if (d.expiry !== undefined) await page.getByLabel('Expiry date').fill(d.expiry);
  if (d.remarks !== undefined) await page.getByLabel('Remarks').fill(d.remarks);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Edit crew member' })).toBeVisible();
}

/** A new crew member with one document, ending on the crew list. */
async function addMemberWithDocument(page: Page, d: NewDocument, surname = 'PETROVIĆ', givenNames = 'Ivan'): Promise<void> {
  await addMember(page, surname, givenNames);
  await openMember(page, `${givenNames} ${surname}`);
  await addDocument(page, d);
  await page.goto('./#/ship/crew');
}

/** Signs a member off through the dialog and waits for it to close. */
async function signOff(page: Page, row: Locator, date: string, port = ''): Promise<void> {
  await row.getByRole('button', { name: 'Sign off' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Sign-off date').fill(date);
  await dialog.getByLabel('Sign-off port').fill(port);
  await dialog.getByRole('button', { name: 'Sign off' }).click();
  await expect(dialog).toHaveCount(0);
}

/** Re-joins a signed-off contract through the dialog and waits for it to close. */
async function rejoin(page: Page, row: Locator, signOn: string, port = ''): Promise<void> {
  await row.getByRole('button', { name: 'Re-join' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Sign-on date').fill(signOn);
  await dialog.getByLabel('Sign-on port').fill(port);
  await dialog.getByRole('button', { name: 'Re-join' }).click();
  await expect(dialog).toHaveCount(0);
}

type Store = 'ships' | 'crew' | 'crewDocuments' | 'settings';

/** Every record of an IndexedDB store as stored, deleted ones included, to check what was really written. */
function stored(page: Page, store: Store): Promise<Record<string, any>[]> {
  return page.evaluate(
    (name) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('masterpiece');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction(name).objectStore(name).getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
        };
      }),
    store,
  );
}

/** Saves the Next port and its ETA on the Voyage screen. */
async function setNextPort(page: Page, port: string, eta: string): Promise<void> {
  await page.goto('./#/ship/voyage');
  await page.getByLabel('Next port', { exact: true }).fill(port);
  await page.getByLabel('ETA (local)').fill(eta);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
}

test('documents: warning, expiring before next port, carry-over on re-join', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  // set up a ship, add crew PETROVIĆ Ivan (Master, sign-on 2026-06-01, passport and SB expiry 2030-01-01)
  await addMember(page, 'PETROVIĆ', 'Ivan');
  const row = crewRow(page, 'Ivan PETROVIĆ');
  await expect(row.locator('[data-band]')).toHaveCount(0);

  // on his edit screen: Add document → Document 'Medical fitness certificate', Number 'M-1', Expiry date 2026-12-24 → Save
  await openMember(page, 'Ivan PETROVIĆ');
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
  await expect(page.getByText('No documents yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Add document' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew\/[^/]+\/documents\/new$/);
  await page.getByLabel('Document', { exact: true }).selectOption({ label: 'Medical fitness certificate' });
  await page.getByLabel('Number').fill('M-1');
  await page.getByLabel('Expiry date').fill('2026-12-24');
  await page.getByRole('button', { name: 'Save' }).click();
  // Save returns to the crew member, whose Documents section lists the document with its warning.
  await expect(page).toHaveURL(/#\/ship\/crew\/[^/]+$/);
  const documentRow = documentList(page).getByRole('listitem').filter({ hasText: 'Medical fitness certificate' });
  await expect(documentRow).toContainText('No. M-1');
  await expect(documentRow).toContainText('Expires 2026-12-24');
  await expect(documentRow.locator('[data-band="amber"]')).toHaveText('Expires soon');

  // crew list row shows 'Expires soon'
  await page.goto('./#/ship/crew');
  await expect(row.getByText('Expires soon')).toBeVisible();
  await expect(row.locator('[data-band="amber"]')).toHaveCount(1);

  // Voyage: Next port 'Rotterdam', ETA (local) 2027-01-05T08:00 → Save
  await setNextPort(page, 'Rotterdam', '2027-01-05T08:00');

  // #/ship/expiring shows 'Next port Rotterdam, ETA 2027-01-05' and a row containing 'Medical fitness certificate'
  await page.goto('./#/ship/crew');
  await page.getByRole('navigation', { name: 'Ship sections' }).getByRole('link', { name: 'Expiring' }).click();
  await expect(page).toHaveURL(/#\/ship\/expiring$/);
  await expect(page.getByRole('heading', { name: 'Expiring before next port' })).toBeVisible();
  await expect(page.getByText('Next port Rotterdam, ETA 2027-01-05')).toBeVisible();
  const expiringRow = expiringList(page).getByRole('listitem').filter({ hasText: 'Medical fitness certificate' });
  await expect(expiringRow).toHaveCount(1);
  await expect(expiringRow).toContainText('Master');
  await expect(expiringRow).toContainText('Ivan PETROVIĆ');
  await expect(expiringRow).toContainText('Medical fitness certificate expires 2026-12-24');
  await expect(expiringRow.locator('[data-band="amber"]')).toHaveText('Expires soon');
  // The passport and the seaman's book expire in 2030, long after the ETA, so only the medical is listed.
  await expect(expiringList(page).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Ship sections' }).getByRole('link', { name: 'Expiring' })).toHaveAttribute('aria-current', 'page');
  // expectNoHorizontalScroll on the Expiring screen
  await expectNoHorizontalScroll(page);

  // Sign off 2026-10-26 Santos; set As at 2026-10-26; Re-join sign-on 2026-11-01 Rotterdam
  await page.goto('./#/ship/crew');
  await signOff(page, row, '2026-10-26', 'Santos');
  await page.getByLabel('As at').fill('2026-10-26');
  await expect(row).toHaveCount(1);
  await rejoin(page, row, '2026-11-01', 'Rotterdam');

  // → the new contract's Documents section lists 'Medical fitness certificate'
  await page.getByLabel('As at').fill('2026-11-01');
  const newContract = crewRow(page, 'Signed on 2026-11-01 at Rotterdam');
  await expect(newContract).toHaveCount(1);
  await expect(newContract.getByText('Expires soon')).toBeVisible(); // the copy counts for the new contract's badge
  await openMember(page, newContract);
  const carried = documentList(page).getByRole('listitem').filter({ hasText: 'Medical fitness certificate' });
  await expect(carried).toHaveCount(1);
  await expect(carried).toContainText('No. M-1');
  await expect(carried).toContainText('Expires 2026-12-24');

  // The signed-off contract keeps its own copy: two documents, one for each contract.
  const documents = await stored(page, 'crewDocuments');
  const contracts = await stored(page, 'crew');
  expect(contracts).toHaveLength(2);
  expect(documents).toHaveLength(2);
  expect(new Set(documents.map((d) => d.crewId))).toEqual(new Set(contracts.map((c) => c.id)));
  expect(documents.map((d) => d.number)).toEqual(['M-1', 'M-1']);
  await expectNoHorizontalScroll(page);
});

test('re-join carries over the papers that have no expiry or are valid on the sign-on day, and not an expired one', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page);
  await openMember(page, 'Ivan PETROVIĆ');
  await addDocument(page, { document: 'Basic safety training', number: 'B-1' }); // no expiry
  await addDocument(page, { document: 'US C1/D visa', number: 'V-1', expiry: '2026-10-31' }); // runs out the day before
  await addDocument(page, { document: 'Schengen visa', number: 'S-1', expiry: '2026-11-01' }); // runs out on the sign-on day
  await page.goto('./#/ship/crew');
  const row = crewRow(page, 'Ivan PETROVIĆ');
  await signOff(page, row, '2026-10-26');
  await rejoin(page, row, '2026-11-01');
  await page.getByLabel('As at').fill('2026-11-01');
  await openMember(page, crewRow(page, 'Signed on 2026-11-01'));
  await expect(documentList(page).getByRole('listitem')).toHaveText([/Basic safety training/, /Schengen visa/]);
  await expect(documentList(page).getByText('US C1/D visa')).toHaveCount(0);
  // The expired visa stays with the contract it belongs to.
  expect((await stored(page, 'crewDocuments')).filter((d) => d.type === 'usVisa')).toHaveLength(1);
});

test('crew delete removes the documents with the contract', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page);
  await openMember(page, 'Ivan PETROVIĆ');
  await addDocument(page, { document: 'Medical fitness certificate', number: 'M-1', expiry: '2027-06-01' });
  await addDocument(page, { document: 'Other', name: 'Tanker familiarisation', number: 'T-1' });
  const before = await stored(page, 'crewDocuments');
  expect(before).toHaveLength(2);
  expect(before.every((d) => d.deleted === false)).toBe(true);

  await page.goto('./#/ship/crew');
  await crewRow(page, 'Ivan PETROVIĆ').getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('This removes this contract from the crew list on this device.');
  await expect(dialog).toContainText('Its documents are removed with it.');
  await dialog.getByRole('button', { name: 'Delete crew member' }).click();
  await expect(crewRow(page, 'Ivan PETROVIĆ')).toHaveCount(0);

  // Soft deleted, as the sync rule says: the records are still there, as tombstones.
  const [member] = await stored(page, 'crew');
  expect(member.deleted).toBe(true);
  const after = await stored(page, 'crewDocuments');
  expect(after).toHaveLength(2);
  expect(after.every((d) => d.deleted === true && d.updatedAt === member.updatedAt)).toBe(true);
  expect(after.map((d) => d.number).sort()).toEqual(['M-1', 'T-1']);

  // Nothing of them is left to warn about, or to find.
  await page.goto('./#/ship/expiring');
  await expect(page.getByText('Nothing expires in that time.')).toBeVisible();
  await page.goto(`./#/ship/crew/${member.id}/documents/${after[0].id}`);
  await expect(page.getByText('Crew member not found.')).toBeVisible();
});

test('a full backup round trip keeps the documents', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMemberWithDocument(page, {
    document: 'Certificate of Competency (CoC)', grade: 'Master (unlimited)', number: 'CoC-ŠĆ-123', issuedBy: 'Lučka kapetanija',
    issue: '2024-05-01', expiry: '2029-05-01', remarks: 'Original sighted',
  });
  const before = await stored(page, 'crewDocuments');
  expect(before).toHaveLength(1);

  await page.goto('./#/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export full backup' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Backup password').fill(PASSWORD);
  await dialog.getByLabel('Repeat password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  const file = await (await download).path();
  await expect(page.getByText('Full backup exported.')).toBeVisible();

  // A wiped device: the file brings the ship, the crew member, the clock change and the document back.
  await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('masterpiece'); q.onsuccess = q.onerror = q.onblocked = r; }));
  await page.reload();
  await page.getByRole('link', { name: 'Import a backup' }).click();
  await page.getByLabel('Backup file').setInputFiles(file!);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Open' }).click();
  // 1 ship + 1 crew + 1 clock change + 1 crew document
  await expect(page.getByText('4 new · 0 updated · 0 deleted · 0 conflicts')).toBeVisible(CRYPTO);
  await page.getByRole('button', { name: 'Apply import' }).click();
  await skipProtectStep(page, 'MV OCEAN STAR');

  expect(await stored(page, 'crewDocuments')).toEqual(before);
  await openMember(page, 'Ivan PETROVIĆ');
  const restored = documentList(page).getByRole('listitem').filter({ hasText: 'Certificate of Competency (CoC)' });
  await expect(restored).toContainText('Master (unlimited)');
  await expect(restored).toContainText('No. CoC-ŠĆ-123');
  await restored.getByRole('link').click();
  await expect(page.getByLabel('Grade / capacity')).toHaveValue('Master (unlimited)');
  await expect(page.getByLabel('Issued by')).toHaveValue('Lučka kapetanija');
  await expect(page.getByLabel('Issue date')).toHaveValue('2024-05-01');
  await expect(page.getByLabel('Remarks')).toHaveValue('Original sighted');
});

test("a handover holds only that ship's documents", async ({ browser }) => {
  const [contextA, contextB] = [await browser.newContext(), await browser.newContext()];
  try {
    const [a, b] = [await contextA.newPage(), await contextB.newPage()];
    await freshApp(a); await setupShip(a);
    await addMemberWithDocument(a, { document: 'Medical fitness certificate', number: 'M-OCEAN', expiry: '2027-06-01' });

    // The other ship has a crew member and a document of its own.
    await a.goto('./#/profiles');
    await a.getByRole('button', { name: 'New ship' }).click();
    const newShip = a.getByRole('dialog');
    await newShip.getByLabel('Ship name').fill('MV SEA BREEZE');
    await newShip.getByRole('button', { name: 'Create ship' }).click();
    await expect(newShip).toHaveCount(0);
    await shipList(a).getByRole('listitem').filter({ hasText: 'MV SEA BREEZE' }).getByRole('button', { name: 'Make active' }).click();
    await expect(a.getByRole('banner')).toContainText('MV SEA BREEZE');
    await addMemberWithDocument(a, { document: 'Medical fitness certificate', number: 'M-SEA' }, 'ŠAŠIĆ', 'Marko');
    expect((await stored(a, 'crewDocuments')).map((d) => d.number).sort()).toEqual(['M-OCEAN', 'M-SEA']);
    await a.goto('./#/profiles');
    await shipList(a).getByRole('listitem').filter({ hasText: 'MV OCEAN STAR' }).getByRole('button', { name: 'Make active' }).click();
    await expect(a.getByRole('banner')).toContainText('MV OCEAN STAR');

    await a.goto('./#/settings');
    await a.getByLabel('Ship', { exact: true }).selectOption({ label: 'MV OCEAN STAR' });
    const download = a.waitForEvent('download');
    await a.getByRole('button', { name: 'Export handover file' }).click();
    const dialog = a.getByRole('dialog');
    await dialog.getByLabel('Backup password').fill('relief-pass-1');
    await dialog.getByLabel('Repeat password').fill('relief-pass-1');
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    const handover = await (await download).path();
    await expect(a.getByText('Handover file exported.')).toBeVisible();

    await freshApp(b);
    await b.getByRole('link', { name: 'Import a backup' }).click();
    await b.getByLabel('Backup file').setInputFiles(handover!);
    await b.getByLabel('Password').fill('relief-pass-1');
    await b.getByRole('button', { name: 'Open' }).click();
    // 1 ship + 1 crew + 1 clock change + 1 crew document: the other ship's papers are not in it.
    await expect(b.getByText('4 new · 0 updated · 0 deleted · 0 conflicts')).toBeVisible(CRYPTO);
    await b.getByRole('button', { name: 'Apply import' }).click();
    await skipProtectStep(b, 'MV OCEAN STAR');
    expect((await stored(b, 'crewDocuments')).map((d) => d.number)).toEqual(['M-OCEAN']);
    expect((await stored(b, 'crew')).map((c) => c.surname)).toEqual(['PETROVIĆ']);
    await openMember(b, 'Ivan PETROVIĆ');
    await expect(documentList(b).getByRole('listitem')).toHaveCount(1);
    await expect(documentList(b)).toContainText('No. M-OCEAN');
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('home: a crew certificate that runs out is an alert that opens the crew member', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMemberWithDocument(page, { document: 'Medical fitness certificate', number: 'M-1', expiry: '2026-12-24' });
  await openMember(page, 'Ivan PETROVIĆ');
  const crewScreen = page.url();
  await addDocument(page, { document: 'US C1/D visa', number: 'V-1', expiry: '2026-09-01' });
  await addDocument(page, { document: 'Basic safety training', number: 'B-1' }); // no expiry, no alert
  await addDocument(page, { document: 'Schengen visa', number: 'S-1', expiry: '2027-01-24' }); // 91 days out, no alert

  await page.goto('./#/');
  const alerts = alertsRegion(page).getByRole('listitem');
  await expect(alerts).toHaveCount(2);
  // Red first: the visa that has run out, then the medical that is about to.
  await expect(alerts.first()).toContainText('Ivan PETROVIĆ');
  await expect(alerts.first()).toContainText('US C1/D visa expired 2026-09-01');
  await expect(alerts.first().getByText('Expired', { exact: true })).toBeVisible();
  await expect(alerts.last()).toContainText('Medical fitness certificate expires 2026-12-24');
  await expect(alerts.last().getByText('Expires soon', { exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // The alert opens the crew member, where the document is.
  await alerts.last().getByRole('link').click();
  await expect(page).toHaveURL(crewScreen);
  await expect(page.getByRole('heading', { name: 'Edit crew member' })).toBeVisible();
  await expect(documentList(page).getByRole('listitem').filter({ hasText: 'Medical fitness certificate' })).toBeVisible();
});

test('expiring: with no next port ETA it shows the next 90 days, whatever the voyage says', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page);
  await openMember(page, 'Ivan PETROVIĆ');
  await addDocument(page, { document: 'Basic safety training', expiry: '2027-01-23' }); // 90 days out: in
  await addDocument(page, { document: 'Advanced fire fighting', expiry: '2027-01-24' }); // 91 days out: out

  await page.goto('./#/ship/expiring');
  await expect(page.getByRole('heading', { name: 'Expiring before next port' })).toBeVisible();
  await expect(page.getByText('No next port ETA set — showing the next 90 days.')).toBeVisible();
  await expect(expiringList(page).getByRole('listitem')).toHaveCount(1);
  await expect(expiringList(page)).toContainText('Basic safety training expires 2027-01-23');
  await expect(expiringList(page)).not.toContainText('Advanced fire fighting');

  // A voyage without an ETA says the same; one with an ETA that is further out brings the second document in.
  await page.goto('./#/ship/voyage');
  await page.getByLabel('Next port', { exact: true }).fill('Rotterdam');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.goto('./#/ship/expiring');
  await expect(page.getByText('No next port ETA set — showing the next 90 days.')).toBeVisible();
  await expect(expiringList(page).getByRole('listitem')).toHaveCount(1);

  await setNextPort(page, 'Rotterdam', '2027-01-24T00:30');
  await page.goto('./#/ship/expiring');
  await expect(page.getByText('Next port Rotterdam, ETA 2027-01-24')).toBeVisible();
  await expect(page.getByText('No next port ETA set')).toHaveCount(0);
  await expect(expiringList(page).getByRole('listitem')).toHaveText([/Basic safety training/, /Advanced fire fighting/]);
  await expectNoHorizontalScroll(page);
});

test('expiring: says when nothing runs out, and a row opens the crew member', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/expiring');
  await expect(page.getByText('Nothing expires in that time.')).toBeVisible();
  await expect(expiringList(page)).toHaveCount(0);

  await addMember(page);
  const [member] = await stored(page, 'crew');
  await openMember(page, 'Ivan PETROVIĆ');
  await addDocument(page, { document: 'Yellow fever certificate', expiry: '2026-12-01' });
  await page.goto('./#/ship/expiring');
  await expect(expiringList(page).getByRole('listitem')).toHaveCount(1);
  await expiringList(page).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`#/ship/crew/${member.id}$`));
  await expect(page.getByRole('heading', { name: 'Edit crew member' })).toBeVisible();
});

test('document form: errors show once a field is changed, Save shows them all and focuses the first', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page);
  await openMember(page, 'Ivan PETROVIĆ');
  await page.getByRole('button', { name: 'Add document' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('Document name')).toHaveCount(0);
  await expect(page.getByLabel('Grade / capacity')).toHaveCount(0);

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/documents\/new$/);
  await expect(page.getByRole('alert')).toHaveText('Document is required.');
  await expect(page.getByLabel('Document', { exact: true })).toBeFocused();
  expect(await stored(page, 'crewDocuments')).toHaveLength(0);

  // Other asks for a name; a paper of the catalogue does not.
  await page.getByLabel('Document', { exact: true }).selectOption({ label: 'Other' });
  await expect(page.getByLabel('Document name')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('Document name')).toBeFocused();
  await expect(page.getByRole('alert')).toHaveText('Document name is required.');
  await page.getByLabel('Document', { exact: true }).selectOption({ label: 'Flag endorsement' });
  await expect(page.getByLabel('Document name')).toHaveCount(0);
  await expect(page.getByLabel('Grade / capacity')).toBeVisible(); // endorsements have a grade
  await page.getByLabel('Document', { exact: true }).selectOption({ label: 'ECDIS' });
  await expect(page.getByLabel('Grade / capacity')).toHaveCount(0); // a course does not

  // An expiry before the issue date is refused at the expiry field, in these words.
  await page.getByLabel('Issue date').fill('2026-05-01');
  await page.getByLabel('Expiry date').fill('2026-04-01');
  await expect(page.getByRole('alert')).toHaveText("Expiry date can't be before the issue date.");
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/documents\/new$/);
  await expect(page.getByLabel('Expiry date')).toBeFocused();
  expect(await stored(page, 'crewDocuments')).toHaveLength(0);

  await page.getByLabel('Expiry date').fill('2026-05-01');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Edit crew member' })).toBeVisible();
  const [document] = await stored(page, 'crewDocuments');
  expect(document).toMatchObject({ type: 'ecdis', grade: '', issueDate: '2026-05-01', expiryDate: '2026-05-01', deleted: false, scope: 'ship' });
  expect('typeOther' in document).toBe(false);
  await expectNoHorizontalScroll(page);
});

test('document edit: opens a document, saves the changes, and clears what was emptied', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page);
  await openMember(page, 'Ivan PETROVIĆ');
  await addDocument(page, { document: 'Other', name: 'Tanker familiarisation', number: 'T-1', expiry: '2027-06-01' });
  await expect(documentList(page).getByRole('listitem')).toContainText('Tanker familiarisation');
  const [before] = await stored(page, 'crewDocuments');
  expect(before).toMatchObject({ type: 'other', typeOther: 'Tanker familiarisation', expiryDate: '2027-06-01' });

  await documentList(page).getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'Edit document' })).toBeVisible();
  await expect(page.getByLabel('Document', { exact: true })).toHaveValue('other');
  await expect(page.getByLabel('Document name')).toHaveValue('Tanker familiarisation');
  await expect(page.getByLabel('Number')).toHaveValue('T-1');
  await page.getByLabel('Document', { exact: true }).selectOption({ label: 'Medical care' });
  await page.getByLabel('Number').fill('  MC-2 ');
  await page.getByLabel('Expiry date').fill('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew\/[^/]+$/);

  const [after] = await stored(page, 'crewDocuments');
  expect(after).toMatchObject({ id: before.id, crewId: before.crewId, shipId: before.shipId, type: 'medicalCare', number: 'MC-2', deleted: false });
  expect('expiryDate' in after).toBe(false);
  expect('typeOther' in after).toBe(false);
  await expect(documentList(page).getByRole('listitem')).toContainText('Medical care');
  await expect(documentList(page).getByRole('listitem')).not.toContainText('Expires');
  expect(await stored(page, 'crewDocuments')).toHaveLength(1);
});

test('document delete: asks first, can be cancelled, and soft-deletes the document', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page);
  await openMember(page, 'Ivan PETROVIĆ');
  await addDocument(page, { document: 'Medical fitness certificate', number: 'M-1', expiry: '2027-06-01' });
  await documentList(page).getByRole('link').click();
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Delete Medical fitness certificate?' })).toBeVisible();
  await expect(dialog.getByText('This removes the document from this device.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Delete document' })).toHaveClass(/btn-danger/);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await stored(page, 'crewDocuments'))[0].deleted).toBe(false);

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete document' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Edit crew member' })).toBeVisible();
  await expect(page.getByText('No documents yet.')).toBeVisible();
  const [removed] = await stored(page, 'crewDocuments');
  expect(removed).toMatchObject({ number: 'M-1', deleted: true });
  // It no longer warns, nor lists.
  await page.goto('./#/ship/crew');
  await expect(crewRow(page, 'Ivan PETROVIĆ').locator('[data-band]')).toHaveCount(0);
});

test('document edit: an unknown document or crew member says so, with a way back', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page);
  const [member] = await stored(page, 'crew');

  await page.goto(`./#/ship/crew/${member.id}/documents/no-such-document`);
  await expect(page.getByText('Document not found.')).toBeVisible();
  await page.getByRole('link', { name: 'Back to crew member' }).click();
  await expect(page).toHaveURL(new RegExp(`#/ship/crew/${member.id}$`));
  await expect(page.getByRole('heading', { name: 'Edit crew member' })).toBeVisible();

  await page.goto('./#/ship/crew/no-such-member/documents/new');
  await expect(page.getByText('Crew member not found.')).toBeVisible();
  await page.getByRole('link', { name: 'Back to crew' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew$/);
});

test('crew edit: a new crew member is told to save first, and an existing one has the Documents section', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/ship/crew/new');
  await expect(page.getByText('Save the crew member first to add documents.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Documents' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add document' })).toHaveCount(0);

  await addMember(page);
  await openMember(page, 'Ivan PETROVIĆ');
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add document' })).toBeVisible();
  await expect(page.getByText('Save the crew member first to add documents.')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test('expiring: an ETA that has passed falls back to the next 90 days, and says so', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page);
  await openMember(page, 'Ivan PETROVIĆ');
  await addDocument(page, { document: 'Basic safety training', expiry: '2026-12-01' });
  await addDocument(page, { document: 'Advanced fire fighting', expiry: '2027-01-24' }); // 91 days out: outside the window

  // The ETA is 5 days ago: a window that ended then would show nothing of what is coming.
  await setNextPort(page, 'Rotterdam', '2026-10-20T08:00');
  await page.goto('./#/ship/expiring');
  await expect(page.getByText('ETA 2026-10-20 has passed — showing the next 90 days.')).toBeVisible();
  await expect(page.getByText('Next port Rotterdam')).toHaveCount(0);
  await expect(page.getByText('No next port ETA set')).toHaveCount(0);
  await expect(expiringList(page).getByRole('listitem')).toHaveCount(1);
  await expect(expiringList(page)).toContainText('Basic safety training expires 2026-12-01');
  await expectNoHorizontalScroll(page);

  // An ETA today has not passed.
  await setNextPort(page, 'Rotterdam', '2026-10-25T18:00');
  await page.goto('./#/ship/expiring');
  await expect(page.getByText('Next port Rotterdam, ETA 2026-10-25')).toBeVisible();
  await expect(expiringList(page)).toHaveCount(0);
  await expect(page.getByText('Nothing expires in that time.')).toBeVisible();
});

test('crew edit: unsaved changes are not lost to Add document or a document row; they are asked to be saved first', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addMember(page);
  await openMember(page, 'Ivan PETROVIĆ');
  await addDocument(page, { document: 'Medical fitness certificate', number: 'M-1', expiry: '2027-06-01' });
  const crewScreen = page.url();
  const saveFirst = page.getByText('Save your changes first.');

  // Nothing has been changed: Add document goes on, and there is no message.
  await expect(saveFirst).toHaveCount(0);

  // A change, then Add document: the screen stays, the change stays, and the message is next to the Documents section.
  await page.getByLabel('Nationality').fill('Montenegrin');
  await page.getByRole('button', { name: 'Add document' }).click();
  await expect(saveFirst).toBeVisible();
  await expect(saveFirst).toHaveAttribute('role', 'alert');
  await expect(page.locator('.crew-documents').getByText('Save your changes first.')).toBeVisible();
  await expect(page).toHaveURL(crewScreen);
  await expect(page.getByLabel('Nationality')).toHaveValue('Montenegrin');
  await expect(page.getByRole('heading', { name: 'Add document' })).toHaveCount(0);

  // A document row does the same.
  await documentList(page).getByRole('link').click();
  await expect(saveFirst).toBeVisible();
  await expect(page).toHaveURL(crewScreen);
  await expect(page.getByLabel('Nationality')).toHaveValue('Montenegrin');
  expect((await stored(page, 'crew'))[0].nationality).toBe(''); // and nothing was saved behind the person's back

  // Typing it back is no change: the message goes, and Add document works.
  await page.getByLabel('Nationality').fill('');
  await expect(saveFirst).toHaveCount(0);
  await page.getByRole('button', { name: 'Add document' }).click();
  await expect(page.getByRole('heading', { name: 'Add document' })).toBeVisible();

  // After a Save the changes are kept, and the Documents section is free.
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Edit crew member' })).toBeVisible();
  await page.getByLabel('Nationality').fill('Montenegrin');
  await page.getByRole('button', { name: 'Add document' }).click();
  await expect(saveFirst).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew$/);
  expect((await stored(page, 'crew'))[0].nationality).toBe('Montenegrin');
  await openMember(page, 'Ivan PETROVIĆ');
  await expect(saveFirst).toHaveCount(0);
  await documentList(page).getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'Edit document' })).toBeVisible();
});
