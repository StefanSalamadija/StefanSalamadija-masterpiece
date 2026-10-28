import { promises as fs } from 'node:fs';
import { test, expect } from '@playwright/test';
import type { Download, Page } from '@playwright/test';
import { expectNoHorizontalScroll, freshApp, setupShip, skipProtectStep } from './helpers';

// Every device starts at 2026-10-25T09:00Z with the ship at UTC+03:00, so the ship's today is 2026-10-25.
// Opening or sealing a file derives a key with 600,000 PBKDF2 rounds, which takes a moment: the waits that follow one
// are given more time than the default, and are always on what the page shows, never a fixed sleep.

const PASSWORD = 'lozinka-ćevapi';
const CRYPTO = { timeout: 20_000 };

const shipList = (page: Page) => page.getByRole('list', { name: 'Ships' });
const crewRow = (page: Page, name: string) => page.getByRole('list', { name: 'Crew' }).getByRole('listitem').filter({ hasText: name });
const snapshotRow = (page: Page, reason: string) => page.getByRole('list', { name: 'Snapshots' }).getByRole('listitem').filter({ hasText: reason });
const summary = (page: Page, text: string) => expect(page.getByText(text)).toBeVisible(CRYPTO);
// Exact, because other text on the Settings screen says "saved" too.
const saved = (page: Page) => page.getByText('Saved', { exact: true });

type Store = 'ships' | 'crew' | 'clockChanges' | 'settings' | 'snapshots';

/** Every record of an IndexedDB store as stored, to check what was really written. */
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

const deviceSettings = async (page: Page) => (await stored(page, 'settings'))[0];

/**
 * Puts a device on the shared timeline of a test with two devices: its clock jumps to `iso` and runs on from there.
 * Whether two changes are a conflict depends on when they were made and when the devices last exchanged, so the
 * devices must not each count from their own start.
 */
const at = (page: Page, iso: string) => page.clock.setSystemTime(iso);

/** Adds a crew member on the Add form, which leaves the browser on the crew list. */
async function addCrew(page: Page, surname: string, givenNames = 'Ivan'): Promise<void> {
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

/** Changes a crew member's nationality on the edit form. */
async function setNationality(page: Page, who: string, nationality: string): Promise<void> {
  await page.goto('./#/ship/crew');
  await crewRow(page, who).getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Nationality').fill(nationality);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ship\/crew$/);
}

/** Deletes a crew member from the crew list. */
async function deleteCrew(page: Page, who: string): Promise<void> {
  await page.goto('./#/ship/crew');
  await crewRow(page, who).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete crew member' }).click();
  await expect(crewRow(page, who)).toHaveCount(0);
}

/** Adds a ship from the Profiles screen. */
async function addShip(page: Page, name: string): Promise<void> {
  await page.goto('./#/profiles');
  await page.getByRole('button', { name: 'New ship' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Ship name').fill(name);
  await dialog.getByRole('button', { name: 'Create ship' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(shipList(page).getByRole('listitem').filter({ hasText: name })).toBeVisible();
}

async function makeActive(page: Page, name: string): Promise<void> {
  await page.goto('./#/profiles');
  await shipList(page).getByRole('listitem').filter({ hasText: name }).getByRole('button', { name: 'Make active' }).click();
  await expect(page.getByRole('banner')).toContainText(name);
}

/** Fills in the export dialog and presses Export. */
async function submitExport(page: Page, password: string): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Backup password').fill(password);
  await dialog.getByLabel('Repeat password').fill(password);
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
}

/** Exports a full backup from the Settings screen and waits for the browser to save it. */
async function exportFull(page: Page, password: string): Promise<Download> {
  await page.goto('./#/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export full backup' }).click();
  await submitExport(page, password);
  const file = await download;
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return file;
}

/** Exports one ship as a handover file from the Settings screen and waits for the browser to save it. */
async function exportHandover(page: Page, ship: string, password: string): Promise<Download> {
  await page.goto('./#/settings');
  await page.getByLabel('Ship', { exact: true }).selectOption({ label: ship });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export handover file' }).click();
  await submitExport(page, password);
  const file = await download;
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return file;
}

async function pathOf(download: Download): Promise<string> {
  const path = await download.path();
  if (path === null) throw new Error('The download has no file.');
  return path;
}

/** On the import screen: chooses the file, gives the password and presses Open. */
async function openFile(page: Page, file: string, password: string): Promise<void> {
  await page.getByLabel('Backup file').setInputFiles(file);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Open' }).click();
}

/** From Settings, on a device that has a ship, to the import screen. */
async function goToImport(page: Page): Promise<void> {
  await page.goto('./#/settings');
  await page.getByRole('link', { name: 'Import backup' }).click();
  await expect(page.getByRole('heading', { name: 'Import backup' })).toBeVisible();
}

const applyButton = (page: Page) => page.getByRole('button', { name: 'Apply import' });

test('full backup round trip on a wiped device', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await addCrew(page, 'PETROVIĆ');
  await page.goto('./#/settings');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export full backup' }).click();
  const dialog = page.getByRole('dialog');
  await expect(page.getByText('Keep this password safe.')).toBeVisible();
  await expect(dialog.getByText('Keep this password safe. If you forget it, nobody can open this backup — not even Masterpiece.')).toBeVisible();
  await expect(dialog.getByLabel('Remember until the app is closed')).toBeChecked();
  await dialog.getByLabel('Backup password').fill(PASSWORD); await dialog.getByLabel('Repeat password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  const file = await (await dl).path();
  expect((await dl).suggestedFilename()).toMatch(/^masterpiece-full-mv-ocean-star-2026-10-25-\d{4}\.mpbak$/);
  await expect(page.getByText('Full backup exported.')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export full backup' })).toBeFocused();

  // The file left the app, so the backup is recorded: the reminder starts over and the warning is not shown again.
  const recorded = await deviceSettings(page);
  expect(recorded.firstExportDone).toBe(true);
  expect(typeof recorded.lastExportAt).toBe('string');
  await page.getByRole('button', { name: 'Export full backup' }).click();
  await expect(dialog.getByLabel('Backup password')).toBeVisible();
  await expect(page.getByText('Keep this password safe.')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  await page.evaluate(() => new Promise(r => { const q = indexedDB.deleteDatabase('masterpiece'); q.onsuccess = q.onerror = q.onblocked = r; }));
  await page.reload();
  await page.getByRole('link', { name: 'Import a backup' }).click();
  await page.getByLabel('Backup file').setInputFiles(file!);
  await expect(page.getByText(file!.split('/').pop()!, { exact: true })).toBeVisible(); // the browser saves a download under its own name
  await expect(page.getByText(/^From (Laptop|Android device), exported 2026-10-25 09:0\d UTC$/)).toBeVisible();
  await page.getByLabel('Password').fill('wrong-password'); await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong password, or the file is damaged. Nothing was changed.', CRYPTO);
  // Open was busy while the file was being opened, and the focus stayed on it.
  await expect(page.getByRole('button', { name: 'Open' })).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('button', { name: 'Open' })).toBeFocused();
  await page.getByLabel('Password').fill(PASSWORD); await page.getByRole('button', { name: 'Open' }).click();
  // 1 ship + 1 crew + 1 clock change
  await expect(page.getByText('3 new · 0 updated · 0 deleted · 0 conflicts')).toBeVisible(CRYPTO);
  await expect(page.getByRole('alert')).toHaveText('');
  await expect(page.getByRole('heading', { name: 'Review' })).toBeFocused();
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Apply import' }).click();
  // A device restored from a backup is asked to protect the app before anything else is shown.
  await expect(page.getByRole('heading', { name: 'Protect Masterpiece' })).toBeVisible();
  await skipProtectStep(page, 'MV OCEAN STAR');
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByText('Import complete.')).toBeVisible();
  await page.goto('./#/ship/crew'); await expect(page.getByRole('listitem').filter({ hasText: 'PETROVIĆ' })).toBeVisible();
});

test('a backup restored onto an empty device asks to protect the app, and the answer is kept', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  const file = await pathOf(await exportFull(page, PASSWORD));
  await page.evaluate(() => new Promise(r => { const q = indexedDB.deleteDatabase('masterpiece'); q.onsuccess = q.onerror = q.onblocked = r; }));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Create your first ship' })).toBeVisible();
  await page.getByRole('link', { name: 'Import a backup' }).click();
  await openFile(page, file, PASSWORD);
  await expect(applyButton(page)).toBeVisible(CRYPTO);
  await applyButton(page).click();

  // The step comes before the app: no header, nothing of the restored ship behind it.
  await expect(page.getByRole('heading', { name: 'Protect Masterpiece' })).toBeVisible();
  await expect(page.getByRole('banner')).toHaveCount(0);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByText('Import complete.')).toBeVisible();

  // Skipping is an answer: it is not asked again.
  await page.reload();
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');
  await expect(page.getByRole('heading', { name: 'Protect Masterpiece' })).toHaveCount(0);
});

test('handover file holds one ship; conflict across two devices', async ({ browser }) => {
  const [contextA, contextB] = [await browser.newContext(), await browser.newContext()];
  try {
    const [a, b] = [await contextA.newPage(), await contextB.newPage()];

    // device A (context A): ships MV OCEAN STAR (+ crew PETROVIĆ) and MV SEA BREEZE; export handover for MV OCEAN STAR with password 'relief-pass-1'
    await freshApp(a); await setupShip(a);
    await addCrew(a, 'PETROVIĆ');
    await addShip(a, 'MV SEA BREEZE');
    await at(a, '2026-10-25T09:10:00Z');
    const handover = await exportHandover(a, 'MV OCEAN STAR', 'relief-pass-1');
    expect(handover.suggestedFilename()).toMatch(/^masterpiece-handover-mv-ocean-star-2026-10-25-\d{4}\.mpbak$/);

    // device B (fresh context): import the handover → Profiles lists only MV OCEAN STAR
    await freshApp(b, { time: '2026-10-25T09:20:00Z' });
    await b.getByRole('link', { name: 'Import a backup' }).click();
    await openFile(b, await pathOf(handover), 'relief-pass-1');
    await summary(b, '3 new · 0 updated · 0 deleted · 0 conflicts');
    await expect(applyButton(b)).toBeEnabled();
    await applyButton(b).click();
    await skipProtectStep(b, 'MV OCEAN STAR');
    await b.goto('./#/profiles');
    await expect(shipList(b).getByRole('listitem')).toHaveCount(1);
    await expect(shipList(b).getByRole('listitem')).toContainText('MV OCEAN STAR');

    // A: export full (pw 'pw-12345678') → B import, apply.
    await at(a, '2026-10-25T09:30:00Z');
    const full = await exportFull(a, 'pw-12345678');
    await at(b, '2026-10-25T09:40:00Z');
    await goToImport(b);
    await openFile(b, await pathOf(full), 'pw-12345678');
    await summary(b, '2 new · 0 updated · 0 deleted · 0 conflicts'); // MV SEA BREEZE and its clock
    await applyButton(b).click();
    await expect(b.getByText('Import complete.')).toBeVisible();
    await b.goto('./#/profiles');
    await expect(shipList(b).getByRole('listitem')).toHaveCount(2);

    // Then edit PETROVIĆ nationality on A to 'Croatian', on B to 'Montenegrin'.
    await at(a, '2026-10-25T10:00:00Z');
    await setNationality(a, 'PETROVIĆ', 'Croatian');
    await at(b, '2026-10-25T10:05:00Z');
    await setNationality(b, 'PETROVIĆ', 'Montenegrin');

    // A: export full → B import → summary contains '1 conflicts'; choose 'Use the file's version' → Apply import → B crew edit shows 'Croatian'
    await at(a, '2026-10-25T10:10:00Z');
    const again = await exportFull(a, 'pw-12345678');
    await at(b, '2026-10-25T10:20:00Z');
    await goToImport(b);
    await openFile(b, await pathOf(again), 'pw-12345678');
    await summary(b, '0 new · 0 updated · 0 deleted · 1 conflict');
    const conflict = b.getByRole('group', { name: 'Crew: Ivan PETROVIĆ' });
    await expect(conflict.getByRole('row', { name: /Nationality/ })).toContainText('Montenegrin');
    await expect(conflict.getByRole('row', { name: /Nationality/ })).toContainText('Croatian');
    await expect(conflict.getByLabel("Keep this device's version")).not.toBeChecked();
    await expect(conflict.getByLabel("Use the file's version")).not.toBeChecked();
    // Apply import waits for the choice.
    await expect(applyButton(b)).toBeDisabled();
    await expectNoHorizontalScroll(b);
    await b.getByLabel("Use the file's version").check();
    await expect(applyButton(b)).toBeEnabled();
    await applyButton(b).click();
    await expect(b.getByText('Import complete.')).toBeVisible();
    await b.goto('./#/ship/crew');
    await crewRow(b, 'PETROVIĆ').getByRole('button', { name: 'Edit' }).click();
    await expect(b.getByLabel('Nationality')).toHaveValue('Croatian');
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('snapshot restore', async ({ browser }) => {
  const [contextA, contextB] = [await browser.newContext(), await browser.newContext()];
  try {
    const [a, b] = [await contextA.newPage(), await contextB.newPage()];
    // Device A has MV OCEAN STAR and its crew; device B has a ship of its own, MV SEA BREEZE, and nothing else.
    await freshApp(a); await setupShip(a);
    await addCrew(a, 'PETROVIĆ');
    const file = await pathOf(await exportFull(a, PASSWORD));
    await freshApp(b); await setupShip(b, 'MV SEA BREEZE');

    // after an import (Task 11 creates 'before-import'), Settings → Restore snapshot lists it
    await goToImport(b);
    await openFile(b, file, PASSWORD);
    await summary(b, '3 new · 0 updated · 0 deleted · 0 conflicts');
    await applyButton(b).click();
    await expect(b.getByText('Import complete.')).toBeVisible();
    await b.goto('./#/profiles');
    await expect(shipList(b).getByRole('listitem')).toHaveCount(2);

    await b.goto('./#/settings');
    await expect(b.getByRole('heading', { name: 'Restore snapshot' })).toBeVisible();
    const snapshots = b.getByRole('list', { name: 'Snapshots' }).getByRole('listitem');
    await expect(snapshots).toHaveCount(1);
    await expect(snapshotRow(b, 'Before import')).toContainText(/^Before import2026-10-25 09:\d\d UTC1 ship · 1 clock change/);

    // Restore → confirm → data returns to the pre-import state
    await snapshotRow(b, 'Before import').getByRole('button', { name: 'Restore' }).click();
    const dialog = b.getByRole('dialog');
    await expect(dialog.getByText('Your current data is saved as a snapshot first, so the restore can be undone.')).toBeVisible();
    await expect(dialog.getByText(/ships, crew, crew documents, certificates, voyages and clock changes of the snapshot from 2026-10-25 09:\d\d UTC \(Before import\)/)).toBeVisible();
    await expect(dialog.getByText('is removed to make room')).toHaveCount(0); // there is room: two snapshots at most here
    await dialog.getByRole('button', { name: 'Restore' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(b.getByText(/^Restored the snapshot from 2026-10-25 09:\d\d UTC\./)).toBeVisible();
    await b.goto('./#/profiles');
    await expect(shipList(b).getByRole('listitem')).toHaveCount(1);
    await expect(shipList(b).getByRole('listitem')).toContainText('MV SEA BREEZE');
    expect((await stored(b, 'crew')).filter((c) => !c.deleted)).toHaveLength(0);

    // The restore saved what was there before it, so it can be undone.
    await b.goto('./#/settings');
    await expect(snapshots).toHaveCount(2);
    await expect(snapshots.first()).toContainText(/^Before restore.*UTC2 ships · 1 crew · 2 clock changes/);
    await expect(snapshots.last()).toContainText('Before import');
    await snapshotRow(b, 'Before restore').getByRole('button', { name: 'Restore' }).click();
    await dialog.getByRole('button', { name: 'Restore' }).click();
    await expect(dialog).toHaveCount(0);
    await b.goto('./#/profiles');
    await expect(shipList(b).getByRole('listitem')).toHaveCount(2);
    expect((await stored(b, 'crew')).filter((c) => !c.deleted).map((c) => c.surname)).toEqual(['PETROVIĆ']);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('closing the share sheet makes no backup; sharing one does', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/settings');
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));

  // The share sheet is closed: the browser reports an AbortError.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: () => Promise.reject(new DOMException('Share canceled', 'AbortError')) });
  });
  await page.getByRole('button', { name: 'Export full backup' }).click();
  await submitExport(page, PASSWORD);
  await expect(page.getByRole('status').filter({ hasText: 'Export cancelled — no backup was made.' })).toBeVisible(CRYPTO);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const cancelled = await deviceSettings(page);
  expect(cancelled.lastExportAt).toBeUndefined();
  expect(cancelled.firstExportDone).toBeUndefined();
  expect(downloads).toEqual([]);

  // Nothing was made, so the first-export warning is still there; the password that was typed is kept for the next try.
  await page.getByRole('button', { name: 'Export full backup' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Keep this password safe.')).toBeVisible();
  await expect(dialog.getByLabel('Backup password')).toHaveValue(PASSWORD);
  await expect(dialog.getByLabel('Repeat password')).toHaveValue(PASSWORD);
  await expect(page.getByText('Export cancelled — no backup was made.')).toHaveCount(0);

  // The share sheet takes the file this time: one tap, and the backup is recorded without a download.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: () => Promise.resolve() });
  });
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByText('Full backup exported.')).toBeVisible(CRYPTO);
  const shared = await deviceSettings(page);
  expect(shared.firstExportDone).toBe(true);
  expect(Date.parse(shared.lastExportAt)).not.toBeNaN();
  expect(downloads).toEqual([]);
});

test('a handover file has a password of its own and holds one ship only', async ({ browser }) => {
  const [contextA, contextB] = [await browser.newContext(), await browser.newContext()];
  try {
    const [a, b] = [await contextA.newPage(), await contextB.newPage()];
    await freshApp(a); await setupShip(a);
    await addCrew(a, 'PETROVIĆ');
    await addShip(a, 'MV SEA BREEZE');
    await makeActive(a, 'MV SEA BREEZE');
    await addCrew(a, 'ŠAŠIĆ', 'Marko');
    await makeActive(a, 'MV OCEAN STAR');

    // A full backup with a password that is remembered until the app is closed ...
    const full = await exportFull(a, 'pw-12345678');
    expect(full.suggestedFilename()).toMatch(/^masterpiece-full-mv-ocean-star-/);

    // ... is not offered for a handover, which asks for a password of its own, and is not remembered either.
    const afterFull = await deviceSettings(a);
    await a.getByLabel('Ship', { exact: true }).selectOption({ label: 'MV OCEAN STAR' });
    await expect(a.getByLabel('Ship', { exact: true }).getByRole('option')).toHaveText(['MV OCEAN STAR', 'MV SEA BREEZE']);
    await a.getByRole('button', { name: 'Export handover file' }).click();
    const dialog = a.getByRole('dialog');
    await expect(dialog.getByLabel('Backup password')).toHaveValue('');
    await expect(dialog.getByLabel('Repeat password')).toHaveValue('');
    await expect(dialog.getByLabel('Remember until the app is closed')).toHaveCount(0);
    await expect(dialog.getByText('Only MV OCEAN STAR goes into this file')).toBeVisible();
    await dialog.getByLabel('Backup password').fill('relief-pass-1');
    await dialog.getByLabel('Repeat password').fill('relief-pass-1');
    const download = a.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    const handover = await download;
    await expect(a.getByText('Handover file exported.')).toBeVisible();

    // A handover is not a full backup: the reminder was set by the full one and is not moved by this.
    expect((await deviceSettings(a)).lastExportAt).toBe(afterFull.lastExportAt);
    await a.getByRole('button', { name: 'Export full backup' }).click();
    await expect(dialog.getByLabel('Backup password')).toHaveValue('pw-12345678');
    await expect(dialog.getByLabel('Repeat password')).toHaveValue('pw-12345678');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // The remembered password does not open the handover file; its own password does, and only MV OCEAN STAR comes with it.
    await freshApp(b);
    await b.getByRole('link', { name: 'Import a backup' }).click();
    await openFile(b, await pathOf(handover), 'pw-12345678');
    await expect(b.getByRole('alert')).toHaveText('Wrong password, or the file is damaged. Nothing was changed.', CRYPTO);
    await b.getByLabel('Password').fill('relief-pass-1');
    await b.getByRole('button', { name: 'Open' }).click();
    await summary(b, '3 new · 0 updated · 0 deleted · 0 conflicts');
    await applyButton(b).click();
    await skipProtectStep(b, 'MV OCEAN STAR');
    await b.goto('./#/profiles');
    await expect(shipList(b).getByRole('listitem')).toHaveCount(1);
    expect((await stored(b, 'ships')).map((s) => s.particulars.name)).toEqual(['MV OCEAN STAR']);
    expect((await stored(b, 'crew')).map((c) => c.surname)).toEqual(['PETROVIĆ']);
    expect(await stored(b, 'clockChanges')).toHaveLength(1);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('deletions are listed and left alone unless they are ticked; a conflict can be a deletion', async ({ browser }) => {
  const [contextA, contextB] = [await browser.newContext(), await browser.newContext()];
  try {
    const [a, b] = [await contextA.newPage(), await contextB.newPage()];
    await freshApp(a); await setupShip(a);
    await addCrew(a, 'PETROVIĆ');
    await addCrew(a, 'ŠAŠIĆ', 'Marko');
    await at(a, '2026-10-25T09:10:00Z');
    const first = await exportFull(a, PASSWORD);
    await freshApp(b, { time: '2026-10-25T09:20:00Z' });
    await b.getByRole('link', { name: 'Import a backup' }).click();
    await openFile(b, await pathOf(first), PASSWORD);
    await summary(b, '4 new · 0 updated · 0 deleted · 0 conflicts');
    await applyButton(b).click();
    await skipProtectStep(b); // the restored device is asked to protect the app first; the message is shown on Home after it
    await expect(b.getByText('Import complete.')).toBeVisible();

    // A deletes both people. On B, one of them was changed meanwhile.
    await at(a, '2026-10-25T10:00:00Z');
    await deleteCrew(a, 'PETROVIĆ');
    await deleteCrew(a, 'ŠAŠIĆ');
    await at(b, '2026-10-25T10:05:00Z');
    await setNationality(b, 'ŠAŠIĆ', 'Serbian');
    await at(a, '2026-10-25T10:10:00Z');
    const second = await pathOf(await exportFull(a, PASSWORD));

    await at(b, '2026-10-25T10:20:00Z');
    await goToImport(b);
    await openFile(b, second, PASSWORD);
    await summary(b, '0 new · 0 updated · 1 deleted · 1 conflict');

    // The deletion is listed, and not ticked.
    const deletions = b.getByLabel('Apply 1 deletion');
    await expect(deletions).not.toBeChecked();
    await expect(b.getByRole('list', { name: 'Deletions' }).getByRole('listitem')).toHaveText(['Crew: Ivan PETROVIĆ']);

    // The conflict is one where the file's version is a deletion, and says so.
    const conflict = b.getByRole('group', { name: 'Crew: Marko ŠAŠIĆ' });
    await expect(conflict.getByRole('row', { name: /Status/ })).toContainText('Active');
    await expect(conflict.getByRole('row', { name: /Status/ })).toContainText('Deleted');
    await expect(conflict.getByLabel("Use the file's version (deleted)")).toBeVisible();
    await expect(conflict.getByLabel("Keep this device's version", { exact: true })).toBeVisible();
    await expect(applyButton(b)).toBeDisabled();
    await expectNoHorizontalScroll(b);
    await conflict.getByLabel("Keep this device's version").check();
    await expect(applyButton(b)).toBeEnabled();
    await expect(deletions).not.toBeChecked();
    await applyButton(b).click();
    await expect(b.getByText('Import complete.')).toBeVisible();

    // Not ticked: the deletion was not applied. The conflict was kept as it was on B.
    const crew = async () => Object.fromEntries((await stored(b, 'crew')).map((c) => [c.surname, c]));
    expect((await crew())['PETROVIĆ'].deleted).toBe(false);
    expect((await crew())['ŠAŠIĆ'].deleted).toBe(false);
    expect((await crew())['ŠAŠIĆ'].nationality).toBe('Serbian');

    // The same file again: the deletion is still on offer, the settled conflict is not.
    await goToImport(b);
    await openFile(b, second, PASSWORD);
    await summary(b, '0 new · 0 updated · 1 deleted · 0 conflicts');
    await expect(b.getByLabel('Apply 1 deletion')).not.toBeChecked();
    await b.getByLabel('Apply 1 deletion').check();
    await applyButton(b).click();
    await expect(b.getByText('Import complete.')).toBeVisible();
    expect((await crew())['PETROVIĆ'].deleted).toBe(true);
    expect((await crew())['ŠAŠIĆ'].deleted).toBe(false);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('a review that went stale is refused, and nothing is written', async ({ browser }) => {
  const [contextA, contextB] = [await browser.newContext(), await browser.newContext()];
  try {
    const [a, b] = [await contextA.newPage(), await contextB.newPage()];
    await freshApp(a); await setupShip(a);
    await addCrew(a, 'PETROVIĆ');
    await at(a, '2026-10-25T09:10:00Z');
    const first = await exportFull(a, PASSWORD);
    await freshApp(b, { time: '2026-10-25T09:20:00Z' });
    await b.getByRole('link', { name: 'Import a backup' }).click();
    await openFile(b, await pathOf(first), PASSWORD);
    await summary(b, '3 new · 0 updated · 0 deleted · 0 conflicts');
    await applyButton(b).click();
    await skipProtectStep(b); // the other tab of B, further down, then finds the step answered: the answer is kept with the device
    await expect(b.getByText('Import complete.')).toBeVisible();

    // A changes the crew member and exports again; B opens the new file, and the review shows one update.
    await at(a, '2026-10-25T10:00:00Z');
    await setNationality(a, 'PETROVIĆ', 'Croatian');
    await at(a, '2026-10-25T10:10:00Z');
    const second = await pathOf(await exportFull(a, PASSWORD));
    await at(b, '2026-10-25T10:20:00Z');
    await goToImport(b);
    await openFile(b, second, PASSWORD);
    await summary(b, '0 new · 1 updated · 0 deleted · 0 conflicts');

    // Meanwhile, in another tab of B, the same crew member is edited.
    const other = await contextB.newPage();
    await freshApp(other, { time: '2026-10-25T10:30:00Z' });
    await setNationality(other, 'PETROVIĆ', 'Montenegrin');
    const snapshotsBefore = (await stored(b, 'snapshots')).map((snapshot) => snapshot.id);
    const syncBefore = (await deviceSettings(b)).lastSync;
    expect(snapshotsBefore).toHaveLength(1); // the one before the first import

    // Apply is refused: the file's value does not go over the edit, nothing is written, and no snapshot is used up.
    await applyButton(b).click();
    await expect(b.getByRole('alert')).toHaveText('The data on this device changed while you were reviewing. Nothing was changed — open the file again.');
    await expect(applyButton(b)).toHaveCount(0);
    await expect(b.getByRole('heading', { name: 'Review' })).toHaveCount(0);
    await expect(b.getByText('Import complete.')).toHaveCount(0);
    await expect(b).toHaveURL(/#\/settings\/import$/);
    expect((await stored(b, 'crew'))[0].nationality).toBe('Montenegrin');
    expect((await stored(b, 'snapshots')).map((snapshot) => snapshot.id)).toEqual(snapshotsBefore);
    expect((await deviceSettings(b)).lastSync).toEqual(syncBefore);

    // The file is opened again, with the focus where the password is asked for: now the two edits are a conflict to decide.
    await expect(b.getByLabel('Password')).toBeFocused();
    await b.getByLabel('Password').fill(PASSWORD);
    await b.getByRole('button', { name: 'Open' }).click();
    await summary(b, '0 new · 0 updated · 0 deleted · 1 conflict');
    await expect(b.getByRole('alert')).toHaveText('');
    await b.getByLabel("Use the file's version").check();
    await applyButton(b).click();
    await expect(b.getByText('Import complete.')).toBeVisible();
    expect((await stored(b, 'crew'))[0].nationality).toBe('Croatian');
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

/** Writes snapshots straight into IndexedDB, one for each day of October 2026 named, taken at 08:15 UTC. */
function seedSnapshots(page: Page, days: number[]): Promise<void> {
  return page.evaluate(
    (list) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('masterpiece');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('snapshots', 'readwrite');
          for (const day of list) {
            tx.objectStore('snapshots').put({
              id: `seed-${day}`, createdAt: `2026-10-${String(day).padStart(2, '0')}T08:15:00.000Z`, reason: 'manual', note: `Seed ${day}`,
              data: { ships: [], crew: [], voyages: [], certificates: [], clockChanges: [] },
            });
          }
          tx.onerror = () => reject(tx.error);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    days,
  );
}

test('restore says when it will push the oldest snapshot out', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await seedSnapshots(page, [11, 12, 13, 14]);
  await page.goto('./#/settings');
  await page.reload();
  const snapshots = page.getByRole('list', { name: 'Snapshots' }).getByRole('listitem');
  await expect(snapshots).toHaveCount(4);
  await expect(page.getByText('Masterpiece keeps the last 5 snapshots of your data. One is saved automatically before an import, before an update and before a restore.')).toBeVisible();

  // Four are kept, so there is room for the one the restore takes.
  const dialog = page.getByRole('dialog');
  await snapshotRow(page, 'Seed 14').getByRole('button', { name: 'Restore' }).click();
  await expect(dialog.getByText(/ships, crew, crew documents, certificates, voyages and clock changes of the snapshot from 2026-10-14 08:15 UTC \(Seed 14\)/)).toBeVisible();
  await expect(dialog.getByText('Your current data is saved as a snapshot first, so the restore can be undone.')).toBeVisible();
  await expect(dialog.getByText('is removed to make room')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  // Five are kept: the restore pushes the oldest out, and the dialog says which.
  await seedSnapshots(page, [10]);
  await page.reload();
  await expect(snapshots).toHaveCount(5);
  await snapshotRow(page, 'Seed 14').getByRole('button', { name: 'Restore' }).click();
  await expect(dialog.getByText('The oldest snapshot (2026-10-10 08:15 UTC) is removed to make room.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(snapshots).toHaveCount(5);
  await expectNoHorizontalScroll(page);
});

test('settings: backup reminder days and device name', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  const days = page.getByLabel('Backup reminder (days)');
  const save = page.getByRole('button', { name: 'Save' });
  await expect(days).toHaveValue('7');
  await expect(days).toHaveAttribute('type', 'text');
  await expect(days).toHaveAttribute('inputmode', 'numeric');

  // A whole number from 1 to 365 and nothing else; a refused entry saves nothing and gets the focus.
  for (const bad of ['0', '366', '-1', '7.5', 'abc', '']) {
    await days.fill(bad);
    await save.click();
    await expect(page.getByRole('alert')).toHaveText('Enter a number of days from 1 to 365.');
    await expect(days).toBeFocused();
    await expect(saved(page)).toHaveCount(0);
    expect((await deviceSettings(page)).backupReminderDays).toBe(7);
  }
  await days.fill('14');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await save.click();
  await expect(saved(page)).toBeVisible();
  expect((await deviceSettings(page)).backupReminderDays).toBe(14);
  await days.fill('365'); await save.click();
  await expect(saved(page)).toBeVisible();
  await days.fill('1'); await save.click();
  await expect(saved(page)).toBeVisible();
  expect((await deviceSettings(page)).backupReminderDays).toBe(1);

  // The device name is trimmed and kept to 40 characters; it cannot be empty.
  const name = page.getByLabel('Device name');
  await name.fill('   '); await save.click();
  await expect(page.getByRole('alert')).toHaveText('Enter a device name.');
  await expect(name).toBeFocused();
  await name.fill(`  ${'N'.repeat(50)}  `); await save.click();
  await expect(saved(page)).toBeVisible();
  await expect(name).toHaveValue('N'.repeat(40));
  expect((await deviceSettings(page)).deviceName).toBe('N'.repeat(40));
  await name.fill('  Bridge laptop '); await save.click();
  await expect(name).toHaveValue('Bridge laptop');
  expect((await deviceSettings(page)).deviceName).toBe('Bridge laptop');

  await page.reload();
  await expect(page.getByLabel('Backup reminder (days)')).toHaveValue('1');
  await expect(page.getByLabel('Device name')).toHaveValue('Bridge laptop');
  await expect(page.getByText(/^Masterpiece \d+\.\d+\.\d+/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Snapshots' })).toHaveCount(0);
  await expect(page.getByText('No snapshots yet.')).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('the export dialog checks the password before it makes a file', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Export full backup' }).click();
  const dialog = page.getByRole('dialog');
  const password = dialog.getByLabel('Backup password');
  const repeat = dialog.getByLabel('Repeat password');
  const exportButton = dialog.getByRole('button', { name: 'Export', exact: true });
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));

  // The browser may offer to keep a password that is being made up.
  await expect(password).toHaveAttribute('autocomplete', 'new-password');
  await expect(repeat).toHaveAttribute('autocomplete', 'new-password');
  await password.fill('short'); await repeat.fill('short'); await exportButton.click();
  await expect(dialog.getByRole('alert')).toHaveText('Use at least 8 characters.');
  await expect(password).toBeFocused();
  await password.fill('long-enough-1'); await repeat.fill('long-enough-2'); await exportButton.click();
  await expect(dialog.getByRole('alert')).toHaveText("The passwords don't match.");
  await expect(repeat).toBeFocused();
  await repeat.fill('');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(downloads).toEqual([]);
  expect((await deviceSettings(page)).lastExportAt).toBeUndefined();

  // Escape closes the dialog, and the focus goes back to the button that opened it.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export full backup' })).toBeFocused();
});

test('import with no ship: no header, a way back, and a file that is not a backup', async ({ page }, testInfo) => {
  await freshApp(page);
  await page.getByRole('link', { name: 'Import a backup' }).click();
  await expect(page.getByRole('heading', { name: 'Import backup' })).toBeVisible();
  await expect(page.getByRole('banner')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveText('');
  await expectNoHorizontalScroll(page);

  // Counts the files the page reads, to see that a file far too big to be a backup is turned away without being read.
  await page.evaluate(() => {
    const counter = window as unknown as { reads: number };
    counter.reads = 0;
    const read = Blob.prototype.text;
    Blob.prototype.text = function text() {
      counter.reads += 1;
      return read.call(this);
    };
  });
  const reads = () => page.evaluate(() => (window as unknown as { reads: number }).reads);
  const huge = testInfo.outputPath('video.mp4');
  await fs.writeFile(huge, new Uint8Array(65 * 1024 * 1024));
  await page.getByLabel('Backup file').setInputFiles(huge);
  await expect(page.getByRole('alert')).toHaveText('This file is too large to be a Masterpiece backup (over 64 MB).');
  await expect(page.getByText('video.mp4')).toBeVisible();
  expect(await reads()).toBe(0);

  // A file that is not a backup: said so, the name shown, and the choice reset so that the same file can be chosen again.
  const notBackup = testInfo.outputPath('notes.txt');
  await fs.writeFile(notBackup, 'shopping list');
  await page.getByLabel('Backup file').setInputFiles(notBackup);
  await expect(page.getByRole('alert')).toHaveText("This isn't a Masterpiece backup file.");
  await expect(page.getByText('notes.txt')).toBeVisible();
  await expect(page.getByLabel('Password')).toHaveCount(0);
  expect(await reads()).toBe(1);
  expect(await page.getByLabel('Backup file').evaluate((input) => (input as HTMLInputElement).files?.length)).toBe(0);

  // A file made by a newer version of the app.
  const newer = testInfo.outputPath('newer.mpbak');
  await fs.writeFile(newer, JSON.stringify({
    format: 'masterpiece-backup', version: 2, kind: 'full', deviceId: 'd', deviceName: 'Tablet', exportedAt: '2026-10-25T09:00:00.000Z',
  }));
  await page.getByLabel('Backup file').setInputFiles(newer);
  await expect(page.getByRole('alert')).toHaveText(
    'This backup was made by a newer version of Masterpiece. Connect to the internet and reopen the app to update it, then try again.',
  );

  // Back to the welcome screen.
  await page.getByRole('link', { name: 'Back to the welcome screen' }).click();
  await expect(page.getByRole('button', { name: 'Create your first ship' })).toBeVisible();
});

test('the header of a file nobody has checked is shown as text, and shortened', async ({ page }) => {
  await freshApp(page);
  await page.getByRole('link', { name: 'Import a backup' }).click();
  const markup = '<img src=x onerror="window.pwned=1">';
  const override = String.fromCodePoint(0x202e); // a right-to-left override, which would show the extension backwards
  const header = JSON.stringify({
    format: 'masterpiece-backup', version: 1, kind: 'full', deviceId: 'd', deviceName: `${markup}${'N'.repeat(100)}`,
    exportedAt: '2026-10-25T09:05:00.000Z',
  });
  // Made in the page, with a name: the browser does not accept a file from disk whose name has such a character in it.
  await page.getByLabel('Backup file').evaluate((input, file) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([file.text], file.name, { type: 'application/octet-stream' }));
    (input as HTMLInputElement).files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { name: `hostile${override}kabpm.mpbak`, text: header });
  // The name of the file is plain text too, and is tied to the input, which is emptied once the file is read.
  await expect(page.locator('.import-file')).toHaveText('hostilekabpm.mpbak');
  const described = await page.getByLabel('Backup file').evaluate((input) =>
    (input.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent));
  expect(described[0]).toBe('hostilekabpm.mpbak');
  const line = page.locator('.import-from');
  await expect(line).toHaveText(`From ${markup}${'N'.repeat(60 - markup.length)}…, exported 2026-10-25 09:05 UTC`);
  await expect(line.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined();

  // Without the password nothing more is read: the file has no encrypted part, so it is damaged.
  await expect(page.getByLabel('Password')).toHaveAttribute('autocomplete', 'current-password');
  await page.getByLabel('Password').fill('anything-at-all');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('alert')).toHaveText("The file is damaged and can't be read. Nothing was changed.", CRYPTO);
});

test('a device with a ship can reach the import screen from Settings and come back', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await goToImport(page);
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'Back to Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('No snapshots yet.')).toBeVisible();
});
