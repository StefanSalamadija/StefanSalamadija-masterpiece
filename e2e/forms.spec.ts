import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import type { Download, Page } from '@playwright/test';
import { detectExcel } from '../src/forms/excel/detect';
import { readExcelValues } from '../src/forms/excel/read';
import { readPackage } from '../src/forms/package';
import { inventoryXlsx } from '../src/forms/testing/excelFixtures';
import { withMacros } from '../src/forms/testing/macroFixtures';
import { oddLayoutsDocx } from '../src/forms/testing/wordFixtures';
import { detectWord } from '../src/forms/word/detect';
import { readWordValues } from '../src/forms/word/read';
import { writeFormFixtures } from './fixtures/makeForms';
import { allowWrites, expectNoHorizontalScroll, failWrites, freshApp, setupShip } from './helpers';

// The clock is 2026-10-25T09:00Z and the ship is at UTC+03:00, so the ship's today is 2026-10-25.

const OLD_FORMAT = 'This is an old Word or Excel format. Open it once in Word or Excel and save it as .docx or .xlsx, then import that file.';

let dir: string;
let paths: Record<string, string>;

test.beforeAll(async () => {
  dir = await fs.mkdtemp(`${tmpdir()}/masterpiece-forms-`);
  paths = await writeFormFixtures(dir);
  // An old binary Word file: only the compound-file magic is needed to be refused.
  paths['old.doc'] = `${dir}/old.doc`;
  await fs.writeFile(paths['old.doc'], new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]));
  // A form with a field that has no name of its own, and parts that cannot be filled here.
  paths['odd.docx'] = `${dir}/odd.docx`;
  await fs.writeFile(paths['odd.docx'], oddLayoutsDocx());
  // The inventory saved with a (made-up) VBA project and a ribbon that calls it (R21).
  paths['inventory.xlsm'] = `${dir}/inventory.xlsm`;
  await fs.writeFile(paths['inventory.xlsm'], withMacros(inventoryXlsx(), 'xlsm', { printerSettings: true, ribbon: true }));
});

test.afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const library = (page: Page) => page.getByRole('list', { name: 'Forms' });
const section = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

async function openForms(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Forms' }).click();
  await expect(page.getByRole('heading', { name: 'Forms', exact: true })).toBeVisible();
}

async function importFile(page: Page, name: string): Promise<void> {
  await page.getByLabel('Import form').setInputFiles(paths[name]);
}

/** Every record of an IndexedDB store as stored. */
function stored(page: Page, store: string): Promise<Record<string, any>[]> {
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

/** Writes records straight into a store, as another device's handover would have left them. */
function putRecords(page: Page, store: string, records: Record<string, unknown>[]): Promise<void> {
  return page.evaluate(
    ({ name, rows }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('masterpiece');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(name, 'readwrite');
          for (const row of rows) tx.objectStore(name).put(row);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { name: store, rows: records },
  );
}

test('the Forms tab imports a form, shows its setup review, and lists it once saved', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openForms(page);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Forms' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('No forms yet.', { exact: false })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await importFile(page, 'toolbox.docx');
  await expect(page.getByRole('heading', { name: 'Set up TST-01' })).toBeVisible();
  await expect(page).toHaveURL(/#\/forms\/[^/]+\/setup$/);
  await expect(page.getByText('Found 4 fields and 1 table of 12 rows.')).toBeVisible();

  const filled = section(page, 'Filled for you');
  await expect(filled.getByLabel('Vessel')).toHaveValue('link:vessel.name');
  await expect(filled.getByLabel('Date')).toHaveValue('link:time.date');
  await expect(section(page, 'You fill').getByLabel('Subject')).toHaveValue('you');
  // The participants' Signature column, under its table's heading.
  const empty = section(page, 'Left empty');
  await expect(empty.getByRole('heading', { name: 'Participants' })).toBeVisible();
  await expect(empty.getByLabel('Signature')).toHaveValue('empty');
  await expect(section(page, "Can't be filled here")).toBeVisible();
  await expect(section(page, 'Helpers').getByRole('switch', { name: 'Add from crew: Participants' })).toBeChecked();
  await expect(page.getByLabel('OK word')).toHaveValue('Satisfactory');
  await expect(page.getByLabel('Not finished value')).toHaveCount(0); // the toolbox talk has no job log

  // A field left empty is taken out of its helper: Time has the Now helper until it is left empty.
  const now = section(page, 'Helpers').getByRole('switch', { name: 'Now: Time' });
  await expect(now).toBeChecked();
  await section(page, 'Filled for you').getByLabel('Time').selectOption({ label: 'Leave empty' });
  await expect(now).toHaveCount(0);
  await section(page, 'Left empty').getByLabel('Time').selectOption({ label: "Time now (ship's time)" });
  await expect(now).not.toBeChecked(); // offered again, and off: it was taken out when the field was left empty
  await now.check();
  await expectNoHorizontalScroll(page);

  // A choice moves the field to its section, and the focus goes with it (a tap on the select focuses it).
  await section(page, 'You fill').getByLabel('Subject').focus();
  await section(page, 'You fill').getByLabel('Subject').selectOption({ label: 'Leave empty' });
  await expect(empty.getByLabel('Subject')).toHaveValue('empty');
  await expect(empty.getByLabel('Subject')).toBeFocused(); // the focus follows the field to its new section
  await expect(section(page, 'You fill').getByLabel('Subject')).toHaveCount(0);
  await empty.getByLabel('Subject').selectOption({ label: 'Voyage number' });
  await expect(filled.getByLabel('Subject')).toHaveValue('link:voyage.no');
  await filled.getByLabel('Subject').selectOption({ label: 'You fill' });
  await expect(section(page, 'You fill').getByLabel('Subject')).toHaveValue('you');

  // The OK word is needed, and said so only once Save is tried.
  await page.getByLabel('OK word').fill('');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save form' }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter the OK word.');
  await page.getByLabel('OK word').fill('Satisfactory');

  await page.getByRole('button', { name: 'Save form' }).click();
  await expect(page).toHaveURL(/#\/forms$/);
  await expect(page.getByRole('status')).toHaveText('Form saved.');
  await expect(library(page).getByRole('listitem')).toHaveCount(1);
  await expect(library(page).getByRole('link', { name: 'TST-01 · Toolbox Talk · Rev 00 / 01.01.2026' })).toHaveAttribute('href', /#\/forms\/[^/]+\/fill$/);
  await expect(library(page).getByRole('link', { name: 'Set up' })).toHaveAttribute('href', /#\/forms\/[^/]+\/setup$/);
  const [saved] = await stored(page, 'formTemplates');
  expect(saved.setup.okWord).toBe('Satisfactory');
  expect(saved.setup.links.f1).toEqual({ source: 'vessel.name' });
  expect(saved.setup.links.f2).toEqual({ source: 'none' });
  expect(saved.setup.leftEmpty).toEqual(['g1.c3']);
  await expectNoHorizontalScroll(page);

  // The search box filters on code, title and revision.
  await page.getByLabel('Search forms').fill('permit');
  await expect(library(page)).toHaveCount(0);
  await expect(page.getByText('No form matches your search.')).toBeVisible();
  await page.getByLabel('Search forms').fill('toolbox 00');
  await expect(library(page).getByRole('listitem')).toHaveCount(1);
});

test('an old Word file is refused with the one-time fix, and nothing is imported', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openForms(page);
  await importFile(page, 'old.doc');
  await expect(page.getByRole('alert')).toHaveText(OLD_FORMAT);
  await expect(page.getByText('old.doc', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Import form')).toHaveValue(''); // reset, so that the same file can be chosen again
  expect(await stored(page, 'formTemplates')).toEqual([]);
  await expectNoHorizontalScroll(page);

  // A good file afterwards clears the message.
  await importFile(page, 'toolbox.docx');
  await expect(page.getByRole('heading', { name: 'Set up TST-01' })).toBeVisible();
});

test('a new revision asks first: cancel keeps the old one, replace carries the form over and lists new fields', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openForms(page);
  await importFile(page, 'toolbox.docx');
  await expect(page.getByRole('heading', { name: 'Set up TST-01' })).toBeVisible();
  await page.getByRole('button', { name: 'Save form' }).click();
  await expect(library(page).getByRole('listitem')).toHaveCount(1);
  const [original] = await stored(page, 'formTemplates');

  const prompt = 'Replace Revision 00 / 01.01.2026 with Revision 01 / 01.06.2026?';
  await importFile(page, 'toolbox-rev01.docx');
  const dialog = page.getByRole('dialog', { name: prompt });
  await expect(dialog).toBeVisible();
  await expectNoHorizontalScroll(page);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(library(page).getByRole('link', { name: 'TST-01 · Toolbox Talk · Rev 00 / 01.01.2026' })).toBeVisible();
  const afterCancel = await stored(page, 'formTemplates');
  expect(afterCancel).toHaveLength(1);
  expect(afterCancel[0].updatedAt).toBe(original.updatedAt);

  await importFile(page, 'toolbox-rev01.docx');
  await page.getByRole('dialog', { name: prompt }).getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByRole('heading', { name: 'Set up TST-01' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/forms/${original.id}/setup$`));
  await expect(page.getByText('New fields to check: Location')).toBeVisible();
  await expect(section(page, 'You fill').getByLabel('Topic')).toBeVisible();
  await page.getByRole('button', { name: 'Save form' }).click();
  await expect(library(page).getByRole('listitem')).toHaveCount(1);
  await expect(library(page).getByRole('link', { name: 'TST-01 · Toolbox Talk · Rev 01 / 01.06.2026' })).toBeVisible();
});

test('In progress lists the ship\'s drafts with their period, and a draft whose form is not here', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openForms(page);
  await expect(page.getByText('No drafts in progress.')).toBeVisible();
  await importFile(page, 'toolbox.docx');
  await page.getByRole('button', { name: 'Save form' }).click();
  await expect(library(page).getByRole('listitem')).toHaveCount(1);

  const [ship] = await stored(page, 'ships');
  const [toolbox] = await stored(page, 'formTemplates');
  const base = { createdAt: '2026-10-25T09:00:00.000Z', updatedAt: '2026-10-25T09:00:00.000Z', updatedBy: 'x', deleted: false, scope: 'ship', values: { fields: {}, rows: {} }, photoIds: [] };
  await putRecords(page, 'formDrafts', [
    { ...base, id: 'd1', shipId: ship.id, templateId: toolbox.id, code: 'TST-01', period: '2026-10-25' },
    { ...base, id: 'd2', shipId: ship.id, templateId: 'from-another-device', code: 'TST-77', period: '2026-W43' },
    { ...base, id: 'd3', shipId: 'another-ship', templateId: toolbox.id, code: 'TST-01', period: '2026-10-24' },
    { ...base, id: 'd4', shipId: ship.id, templateId: toolbox.id, code: 'TST-01', period: '2026-10-20', deleted: true },
    // R25: handed over from a device whose copy of the form is another revision.
    { ...base, id: 'd5', shipId: ship.id, templateId: 'from-another-device', code: 'TST-01', revision: '07 / 01.07.2026', period: '2026-10-23' },
  ]);
  await page.reload();
  const drafts = page.getByRole('list', { name: 'In progress' });
  await expect(drafts.getByRole('listitem')).toHaveText([
    'TST-01 Toolbox Talk — 25-OCT-2026', 'TST-01 — made with Revision 07 / 01.07.2026; import that revision to continue', 'TST-77 — import this form to continue',
  ]);
  await expect(drafts.getByRole('link', { name: 'TST-01 Toolbox Talk — 25-OCT-2026' })).toHaveAttribute('href', `#/forms/${toolbox.id}/fill`);
  await expect(drafts.getByRole('link')).toHaveCount(1);
  await expectNoHorizontalScroll(page);
});

test('the setup names an unsure field, lists what cannot be filled, and asks for the not-finished status of a job log', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openForms(page);
  await importFile(page, 'odd.docx');
  await expect(page.getByRole('heading', { name: 'Set up TST-05' })).toBeVisible();
  const yours = section(page, 'You fill');
  // The unsure field comes first, with an input to name it.
  await expect(yours.getByRole('listitem').first()).toContainText('Field 1');
  const name = yours.getByLabel('Name this field (Field 1)', { exact: true }); // each such input has a name of its own
  await expect(name).toHaveValue('Field 1');
  await expect(section(page, "Can't be filled here").getByRole('listitem')).toHaveCount(2);
  await expectNoHorizontalScroll(page);

  await name.fill('');
  await expect(page.getByRole('alert')).toHaveCount(0); // not until the field is left
  await name.blur();
  await expect(page.getByRole('alert')).toHaveText('Enter a name for this field.');
  await name.fill('Remarks');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(yours.getByLabel('Remarks', { exact: true })).toHaveValue('you');
  await page.getByRole('button', { name: 'Save form' }).click();
  await expect(library(page).getByRole('listitem')).toHaveCount(1);
  const [odd] = await stored(page, 'formTemplates');
  expect(odd.schema.fields.find((f: { id: string }) => f.id === 'f1').label).toBe('Remarks');

  await importFile(page, 'weekly.dotx');
  await expect(page.getByRole('heading', { name: 'Set up TST-03' })).toBeVisible();
  await expect(page.getByLabel('Not finished value')).toHaveValue('Pending');
  const carry = section(page, 'Helpers').getByRole('switch', { name: 'Carry over unfinished jobs: Jobs' });
  await expect(carry).toBeChecked();
  await carry.uncheck();
  await expect(page.getByLabel('Not finished value')).toHaveCount(0);
  await carry.check();
  // Asked for while the job log is on, like the OK word.
  await page.getByLabel('Not finished value').fill('');
  await page.getByLabel('Not finished value').blur();
  await expect(page.getByRole('alert')).toHaveText('Enter the status of a job that is not finished.');
  await page.getByRole('button', { name: 'Save form' }).click();
  await expect(page.getByRole('heading', { name: 'Set up TST-03' })).toBeVisible();
  await page.getByLabel('Not finished value').fill('Open');
  await page.getByRole('button', { name: 'Save form' }).click();
  await expect(library(page).getByRole('listitem')).toHaveCount(2);
  const weekly = (await stored(page, 'formTemplates')).find((t) => t.code === 'TST-03')!;
  expect(weekly.setup.notFinished).toBe('Open');
  expect(weekly.setup.helpers.jobLog).toEqual(['g1']);
});

test('a guessed name links nothing until the person confirms or renames it; then its link is shown and can be changed (R24)', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openForms(page);
  await importFile(page, 'guessed.docx');
  await expect(page.getByRole('heading', { name: 'Set up TST-10' })).toBeVisible();
  const filled = section(page, 'Filled for you');
  const yours = section(page, 'You fill');
  // Both guessed fields are among the fields you fill, unlinked, each with its name to confirm.
  await expect(filled.getByRole('listitem')).toHaveCount(0);
  await expect(yours.getByLabel('Vessel', { exact: true })).toHaveValue('you');
  await expect(yours.getByLabel('Date', { exact: true })).toHaveValue('you');
  await expect(yours.getByLabel('Name this field (Vessel)', { exact: true })).toHaveValue('Vessel');

  // Confirmed as it is: the link for its name is suggested, and shown.
  await yours.getByRole('button', { name: 'Confirm name Vessel' }).click();
  await expect(filled.getByLabel('Vessel', { exact: true })).toHaveValue('link:vessel.name');
  await expect(filled.getByRole('button', { name: /^Confirm name/ })).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  // Renamed, and the form sent with Enter: nothing is saved yet, so that the link for the new name is seen first.
  const dateName = yours.getByLabel('Name this field (Date)', { exact: true });
  await dateName.fill('IMO No.');
  await dateName.press('Enter');
  await expect(filled.getByLabel('IMO No.', { exact: true })).toHaveValue('link:vessel.imo');
  await expect(page.getByRole('heading', { name: 'Set up TST-10' })).toBeVisible();
  // Renamed again, and left: the link suggested before gives way to the new name's (none).
  const renamed = filled.getByLabel('Name this field (Date)', { exact: true });
  await renamed.fill('Notes');
  await renamed.blur();
  await expect(yours.getByLabel('Notes', { exact: true })).toHaveValue('you');
  // The person's own choice is kept.
  await yours.getByLabel('Notes', { exact: true }).selectOption({ label: 'Voyage number' });
  await expect(filled.getByLabel('Notes', { exact: true })).toHaveValue('link:voyage.no');

  await page.getByRole('button', { name: 'Save form' }).click();
  await expect(library(page).getByRole('listitem')).toHaveCount(1);
  const [saved] = await stored(page, 'formTemplates');
  expect(saved.schema.fields.map((f: { label: string; confidence: string }) => [f.label, f.confidence])).toEqual([['Vessel', 'high'], ['Notes', 'high'], ['Remarks', 'high']]);
  expect(saved.setup.links).toEqual({ f1: { source: 'vessel.name' }, f2: { source: 'voyage.no' } });
});

test('a batch import never links a guessed name (R24)', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openForms(page);
  await page.getByLabel('Import form').setInputFiles([paths['guessed.docx'], paths['toolbox.docx']]);
  await expect(page.getByText('2 forms imported', { exact: true })).toBeVisible();
  const guessed = (await stored(page, 'formTemplates')).find((t) => t.code === 'TST-10')!;
  expect(guessed.schema.fields.map((f: { label: string; confidence: string }) => [f.label, f.confidence])).toEqual([['Vessel', 'low'], ['Date', 'low'], ['Remarks', 'high']]);
  expect(guessed.setup.links).toEqual({});
  // The fill screen gives the guessed boxes no value of their own.
  await library(page).getByRole('link', { name: /^TST-10 · / }).click();
  await expect(page.getByRole('heading', { name: 'TST-10 Demo Guessed Labels', exact: true })).toBeVisible();
  for (const label of ['Vessel', 'Date']) {
    const box = page.getByRole('textbox', { name: label, exact: true });
    await expect(box).toHaveValue('');
    await expect(box).not.toHaveAccessibleDescription('Auto');
  }
});

test('a setup left open while another tab imports a new revision says at once that it is out of date, and saves nothing', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openForms(page);
  await importFile(page, 'toolbox.docx');
  await page.getByRole('button', { name: 'Save form' }).click();
  await expect(library(page).getByRole('listitem')).toHaveCount(1);
  await library(page).getByRole('link', { name: 'Set up' }).click();
  await expect(page.getByRole('heading', { name: 'Set up TST-01' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  const other = await page.context().newPage();
  await other.goto('./#/forms');
  await other.getByLabel('Import form').setInputFiles(paths['toolbox-rev01.docx']);
  await other.getByRole('button', { name: 'Replace' }).click();
  await expect(other.getByRole('heading', { name: 'Set up TST-01' })).toBeVisible();

  const stale = 'This form was changed since its setup was opened. Open its setup again to see the changes.';
  await expect(page.getByRole('alert')).toHaveText(stale);
  await page.getByRole('button', { name: 'Save form' }).click();
  await expect(page.getByRole('heading', { name: 'Set up TST-01' })).toBeVisible(); // refused: still here
  const [template] = await stored(page, 'formTemplates');
  expect(template.revision).toBe('01 / 01.06.2026');
  expect(template.schema.fields.map((f: { label: string }) => f.label)).toContain('Location');
});

/* ---- Part 2: the fill screen and making the file (Task 15) ---- */

const SHARE_CANCELLED = 'File not shared — your draft is still here.';

/** Imports a form, saves its setup as suggested, and opens its fill screen from the library. */
async function openFillOf(page: Page, file: string, heading: string): Promise<void> {
  await openForms(page);
  await importFile(page, file);
  await page.getByRole('button', { name: 'Save form' }).click();
  await expect(page.getByRole('status')).toHaveText('Form saved.');
  await library(page).getByRole('link', { name: new RegExp(`^${heading.split(' ')[0]} · `) }).click();
  await expect(page).toHaveURL(/#\/forms\/[^/]+\/fill$/);
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
}

async function downloaded(download: Download): Promise<Uint8Array> {
  const path = await download.path();
  if (path === null) throw new Error('The download has no file.');
  return new Uint8Array(await fs.readFile(path));
}

/** The ship's live drafts, as stored. */
async function liveDrafts(page: Page): Promise<Record<string, any>[]> {
  return (await stored(page, 'formDrafts')).filter((d) => !d.deleted);
}

test('Remove form asks first, then takes the form, its draft and its file out, and goes back to Forms (R26)', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openFillOf(page, 'toolbox.docx', 'TST-01 Toolbox Talk');
  await page.getByLabel('Subject', { exact: true }).fill('Mooring');
  await expect.poll(async () => (await liveDrafts(page)).length).toBe(1);
  await openForms(page);
  await expect(page.getByRole('list', { name: 'In progress' }).getByRole('listitem')).toHaveCount(1);

  await library(page).getByRole('link', { name: 'Set up' }).click();
  await expect(page.getByRole('heading', { name: 'Set up TST-01' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove form' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toHaveText('Remove TST-01 Toolbox Talk and its drafts?');
  await expectNoHorizontalScroll(page);
  // Cancel keeps everything.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Set up TST-01' })).toBeVisible();
  const [before] = await stored(page, 'formTemplates');
  expect(before.deleted).toBe(false);

  await page.getByRole('button', { name: 'Remove form' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove form' }).click();
  await expect(page).toHaveURL(/#\/forms$/);
  await expect(page.getByRole('status')).toHaveText('Form removed.');
  await expect(library(page).getByRole('listitem')).toHaveCount(0);
  await expect(page.getByText('No drafts in progress.')).toBeVisible();
  const [removed] = await stored(page, 'formTemplates');
  expect([removed.deleted, removed.fileBase64]).toEqual([true, '']);
  expect(await liveDrafts(page)).toEqual([]);
  expect((await stored(page, 'formDrafts')).map((d) => d.deleted)).toEqual([true]);
  // The dialog's own form did not save the setup on the way: the removal is all that happened.
  expect({ ...removed, deleted: false, fileBase64: before.fileBase64, updatedAt: before.updatedAt }).toEqual(before);
});

test('a draft opens with its auto values, keeps every change, and Make file gives the form filled in', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openFillOf(page, 'toolbox.docx', 'TST-01 Toolbox Talk');
  await expect(page.getByText('25-OCT-2026', { exact: true })).toBeVisible(); // the period line
  expect(await liveDrafts(page)).toEqual([]); // looking stores nothing (R18)

  // Filled in from the ship and the ship's clock (UTC+03:00), marked Auto, and editable.
  const vessel = page.getByLabel('Vessel', { exact: true });
  await expect(vessel).toHaveValue('MV OCEAN STAR');
  await expect(vessel).toHaveAccessibleDescription('Auto');
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-10-25');
  await expect(page.getByLabel('Time', { exact: true })).toHaveValue(/^12:0\d$/);
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('');
  // The participants' Signature column is signed by hand: it is not asked for.
  const participants = section(page, 'Participants');
  await expect(participants.getByText('No rows yet.')).toBeVisible();
  await expectNoHorizontalScroll(page);

  const subject = 'Fire drill & <muster> "Šćđ"';
  await page.getByLabel('Subject', { exact: true }).fill(subject);
  await vessel.fill('MV SEA BREEZE'); // an edit wins over the auto value
  await expect(vessel).not.toHaveAccessibleDescription('Auto');
  await participants.getByRole('button', { name: 'Add row' }).click();
  await expect(participants.getByRole('group', { name: 'Row 1' }).getByLabel('Name')).toBeFocused();
  await participants.getByRole('group', { name: 'Row 1' }).getByLabel('Name').fill('Ann Lee');
  await participants.getByRole('group', { name: 'Row 1' }).getByLabel('Rank').fill('Bosun');
  await participants.getByRole('button', { name: 'Add row' }).click();
  await participants.getByRole('group', { name: 'Row 2' }).getByLabel('Name').fill('Ben Ode');
  await participants.getByRole('group', { name: 'Row 2' }).getByRole('button', { name: 'Remove' }).click();
  await expect(participants.getByRole('group')).toHaveCount(1);
  await expect(participants.getByLabel('Signature')).toHaveCount(0);

  // Saved as it is typed: after a reload the draft has it all, and the edited Vessel stays edited.
  await expect.poll(async () => (await liveDrafts(page))[0]?.values.rows).toEqual({ g1: [{ 'g1.c1': 'Ann Lee', 'g1.c2': 'Bosun' }] });
  const [saved] = await liveDrafts(page);
  // The auto values are fixed in the draft (R18), and only the untouched ones are marked as such.
  expect(saved.values.fields).toMatchObject({ f1: 'MV SEA BREEZE', f2: subject, f3: '2026-10-25' });
  expect(saved.values.fields.f4).toMatch(/^12:0\d$/);
  expect(saved.autoIds).toEqual(['f3', 'f4']);
  expect(saved.period).toBe('2026-10-25');
  await page.reload();
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue(subject);
  await expect(page.getByLabel('Vessel', { exact: true })).toHaveValue('MV SEA BREEZE');
  await expect(page.getByLabel('Vessel', { exact: true })).not.toHaveAccessibleDescription('Auto');
  await expect(page.getByLabel('Date', { exact: true })).toHaveAccessibleDescription('Auto');
  await expectNoHorizontalScroll(page);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Make file' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('TST-01 Toolbox Talk 2026-10-25.docx');
  // Read back with the template's own field addresses, as the app's check does.
  const schema = detectWord(readPackage(new Uint8Array(await fs.readFile(paths['toolbox.docx']))), 'docx', 'toolbox.docx');
  const back = readWordValues(readPackage(await downloaded(file)), schema);
  expect(back.fields.f1).toBe('MV SEA BREEZE');
  expect(back.fields.f2).toBe(subject);
  expect(back.fields.f3).toBe('2026-10-25');
  expect(back.fields.f4).toMatch(/^12:0\d$/);
  expect(back.rows.g1[0]).toMatchObject({ 'g1.c1': 'Ann Lee', 'g1.c2': 'Bosun' });

  await expect(page).toHaveURL(/#\/forms$/);
  await expect(page.getByRole('status')).toHaveText('File made: TST-01 Toolbox Talk 2026-10-25.docx');
  await expect(page.getByText('No drafts in progress.')).toBeVisible();
  expect(await liveDrafts(page)).toEqual([]);
  const [last] = await stored(page, 'formLastValues');
  expect(last.values.fields).toMatchObject({ f1: 'MV SEA BREEZE', f2: subject, f3: '2026-10-25' });
});

test('cancelled_share_keeps_draft: a share sheet closed after Make file keeps the draft and its values', async ({ page }) => {
  // A phone with a share sheet, which the person closes: the browser rejects the share with an AbortError.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', {
      // The sheet stays up a moment before it is closed.
      configurable: true, value: () => new Promise((_, reject) => setTimeout(() => reject(new DOMException('Share canceled', 'AbortError')), 400)),
    });
  });
  await freshApp(page); await setupShip(page);
  await openFillOf(page, 'toolbox.docx', 'TST-01 Toolbox Talk');
  await page.getByLabel('Subject', { exact: true }).fill('Boat drill');
  const downloads: Download[] = [];
  page.on('download', (d) => downloads.push(d));

  await page.getByRole('button', { name: 'Make file' }).click();
  // While the file is being handed over nothing can be changed, so the file holds what the screen shows.
  await expect(page.getByLabel('Subject', { exact: true })).toBeDisabled();
  await expect(page.getByRole('status')).toHaveText(SHARE_CANCELLED);
  await expect(page.getByLabel('Subject', { exact: true })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'TST-01 Toolbox Talk', exact: true })).toBeVisible();
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Boat drill');
  await expect(page.getByRole('button', { name: 'Make file' })).not.toHaveAttribute('aria-disabled');
  expect(downloads).toEqual([]); // not downloaded instead
  expect(await stored(page, 'formLastValues')).toEqual([]); // the last values are not updated
  await expectNoHorizontalScroll(page);

  // The draft is still in progress, with what was typed: leaving the screen saved it.
  await page.getByLabel('Subject', { exact: true }).fill('Boat drill, port side');
  await openForms(page);
  const drafts = page.getByRole('list', { name: 'In progress' });
  await expect(drafts.getByRole('listitem')).toHaveText(['TST-01 Toolbox Talk — 25-OCT-2026']);
  await drafts.getByRole('link').click();
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Boat drill, port side');
  expect(await liveDrafts(page)).toHaveLength(1);

  // Discard asks first; Cancel keeps it, Discard draft throws it away.
  await page.getByRole('button', { name: 'Discard draft' }).click();
  const dialog = page.getByRole('dialog', { name: 'Discard this draft?' });
  await expect(dialog).toBeVisible();
  await expectNoHorizontalScroll(page);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await liveDrafts(page)).toHaveLength(1);
  await page.getByRole('button', { name: 'Discard draft' }).click();
  await page.getByRole('dialog', { name: 'Discard this draft?' }).getByRole('button', { name: 'Discard draft' }).click();
  await expect(page).toHaveURL(/#\/forms$/);
  await expect(page.getByRole('status')).toHaveText('Draft discarded.');
  await expect(page.getByText('No drafts in progress.')).toBeVisible();
  expect(await liveDrafts(page)).toEqual([]);
  expect(await stored(page, 'formLastValues')).toEqual([]);
});

test('a 120-row inventory fills: every row is there, it scrolls to the end, and the last row is saved and written', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openFillOf(page, 'inventory.xlsx', 'TST-11 Demo Inventory');
  const rows = page.getByRole('group', { name: /^Item \d{3}$/ });
  await expect(rows).toHaveCount(120);
  // A table that names its rows has them all, always: no Add row and no Remove.
  await expect(page.getByRole('button', { name: 'Add row' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await expect(page.getByLabel('Signature C/O')).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  const last = page.getByRole('group', { name: 'Item 120' });
  await last.getByLabel('Qty').fill('7,5');
  await expect(last.getByLabel('Qty')).toBeInViewport();
  await page.getByRole('button', { name: 'Make file' }).scrollIntoViewIfNeeded();
  const atEnd = await page.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2);
  expect(atEnd).toBe(true);
  const [template] = await stored(page, 'formTemplates');
  const group = template.schema.rowGroups[0].id as string;
  const qty = 'Demo inventory!g1.E';
  await expect.poll(async () => (await liveDrafts(page))[0]?.values.rows[group]?.[119]?.[qty]).toBe('7,5');

  // A number is checked once the field is left, and Make file goes to it.
  const first = page.getByRole('group', { name: 'Item 001' });
  await first.getByLabel('Qty').fill('lots');
  await expect(first.getByRole('alert')).toHaveCount(0);
  await first.getByLabel('Specification').focus();
  await expect(first.getByRole('alert')).toHaveText('Enter a number, such as 12.5 or 12,5.');
  await page.getByRole('button', { name: 'Make file' }).click();
  await expect(first.getByLabel('Qty')).toBeFocused();
  await first.getByLabel('Qty').fill('3');
  await expect(first.getByRole('alert')).toHaveCount(0);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Make file' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('TST-11 Demo Inventory 2026-10-25.xlsx');
  const schema = detectExcel(readPackage(new Uint8Array(await fs.readFile(paths['inventory.xlsx']))), 'inventory.xlsx');
  const back = readExcelValues(readPackage(await downloaded(file)), schema);
  expect(String(back.rows[group][119][qty])).toMatch(/^7[.,]5$/);
  expect(String(back.rows[group][0][qty])).toBe('3');
  expect(back.fields['Demo inventory!C6']).toBe('MV OCEAN STAR');
  await expect(page.getByRole('status')).toHaveText('File made: TST-11 Demo Inventory 2026-10-25.xlsx');
});

test('a form only looked at leaves no draft; Discard just leaves; Make file with no change at all still makes the file', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openFillOf(page, 'toolbox.docx', 'TST-01 Toolbox Talk');
  await expect(page.getByLabel('Vessel', { exact: true })).toHaveValue('MV OCEAN STAR');
  await openForms(page);
  await expect(page.getByText('No drafts in progress.')).toBeVisible();
  expect(await stored(page, 'formDrafts')).toEqual([]);

  // Discard on a draft that was never stored asks nothing: it only leaves the screen.
  await library(page).getByRole('link', { name: /^TST-01 · / }).click();
  await page.getByRole('button', { name: 'Discard draft' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/forms$/);
  expect(await stored(page, 'formDrafts')).toEqual([]);

  await library(page).getByRole('link', { name: /^TST-01 · / }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Make file' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('TST-01 Toolbox Talk 2026-10-25.docx');
  const schema = detectWord(readPackage(new Uint8Array(await fs.readFile(paths['toolbox.docx']))), 'docx', 'toolbox.docx');
  const back = readWordValues(readPackage(await downloaded(file)), schema);
  expect(back.fields).toMatchObject({ f1: 'MV OCEAN STAR', f3: '2026-10-25' });
  await expect(page.getByRole('status')).toHaveText('File made: TST-01 Toolbox Talk 2026-10-25.docx');
  await expect(page.getByText('No drafts in progress.')).toBeVisible();
  expect(await liveDrafts(page)).toEqual([]);
  const [last] = await stored(page, 'formLastValues');
  expect(last.values.fields).toMatchObject({ f1: 'MV OCEAN STAR', f3: '2026-10-25' });
});

test('a draft reopened on a later day keeps the auto values of when it started: date, time, week and month (R18)', async ({ page }) => {
  await freshApp(page); await setupShip(page); // Sunday 25 October 2026, 12:00 on the ship: ISO week 43
  // A day form: its Date and Time.
  await openFillOf(page, 'toolbox.docx', 'TST-01 Toolbox Talk');
  const time = await page.getByLabel('Time', { exact: true }).inputValue();
  expect(time).toMatch(/^12:0\d$/);
  await page.getByLabel('Subject', { exact: true }).fill('Fire drill');
  // The weekly job log: its week and dates.
  await openFillOf(page, 'weekly.dotx', 'TST-03 Demo Weekly Jobs');
  await expect(page.getByText('Week 43, 2026', { exact: true })).toBeVisible();
  const week = await page.getByLabel('Year / Week No.', { exact: true }).inputValue();
  const range = await page.getByLabel('Date (from to)', { exact: true }).inputValue();
  expect(week).toMatch(/43/);
  expect(range).not.toBe('');
  await page.getByLabel('Vessel', { exact: true }).fill('MV OCEAN STAR II');
  // The month grid: its month and its date.
  await openFillOf(page, 'daygrid.xlsx', 'TST-12 Demo Day Grid');
  await expect(page.getByText('October 2026', { exact: true })).toBeVisible();
  await page.getByLabel('M/V', { exact: true }).fill('MV OCEAN STAR II');
  await expect.poll(async () => (await liveDrafts(page)).length).toBe(3);

  // A week and a day later (Monday 2 November, week 45), after the app was closed and opened again.
  await page.clock.setSystemTime(new Date('2026-11-02T07:30:00Z'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'TST-12 Demo Day Grid', exact: true })).toBeVisible();
  await expect(page.getByText('October 2026', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Dated', { exact: true })).toHaveValue('2026-10-25');
  await expect(page.getByLabel('Dated', { exact: true })).toHaveAccessibleDescription('Auto');

  await openForms(page);
  const drafts = page.getByRole('list', { name: 'In progress' });
  await drafts.getByRole('link', { name: /^TST-03 / }).click();
  await expect(page.getByText('Week 43, 2026', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Year / Week No.', { exact: true })).toHaveValue(week);
  await expect(page.getByLabel('Date (from to)', { exact: true })).toHaveValue(range);

  await openForms(page);
  await drafts.getByRole('link', { name: /^TST-01 / }).click();
  await expect(page.getByText('25-OCT-2026', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-10-25');
  await expect(page.getByLabel('Time', { exact: true })).toHaveValue(time);
  await expect(page.getByLabel('Time', { exact: true })).toHaveAccessibleDescription('Auto');

  // The file carries the values of the draft, and is named by the ship's date when it is made.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Make file' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('TST-01 Toolbox Talk 2026-11-02.docx');
  const schema = detectWord(readPackage(new Uint8Array(await fs.readFile(paths['toolbox.docx']))), 'docx', 'toolbox.docx');
  const back = readWordValues(readPackage(await downloaded(file)), schema);
  expect(back.fields).toMatchObject({ f2: 'Fire drill', f3: '2026-10-25', f4: time });
});

/* ---- Part 3: the helpers in the fill screen (Task 16) ---- */

// The clock is 2026-10-28T13:00Z and the ship is at UTC+01:00, so the ship's today is 2026-10-28 and its clock reads 14:00.
const HELPERS_TIME = { time: '2026-10-28T13:00:00Z' };
const startShip = async (page: Page): Promise<void> => {
  await freshApp(page, HELPERS_TIME);
  await setupShip(page, 'MV OCEAN STAR', 'UTC+01:00');
};

/**
 * A valid PNG of `size` × `size` pixels, made here (the browser decodes it and draws it as a JPEG). Its data is stored
 * in a deflate stream without compression, which every decoder reads.
 */
function pngOf(size = 10): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: number[]): number => bytes.reduce((c, b) => crcTable[(c ^ b) & 0xff] ^ (c >>> 8), 0xffffffff) ^ 0xffffffff;
  const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const ascii = (text: string): number[] => [...text].map((ch) => ch.charCodeAt(0));
  const chunk = (type: string, data: number[]): number[] => [...u32(data.length), ...ascii(type), ...data, ...u32(crc([...ascii(type), ...data]) >>> 0)];
  const raw: number[] = [];
  for (let y = 0; y < size; y += 1) raw.push(0, ...Array<number>(size * 3).fill(0x80)); // filter 0, grey pixels
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  // zlib header, one stored block (final), its length and its complement, the data, and the Adler-32.
  const idat = [0x78, 0x01, 0x01, raw.length & 255, raw.length >> 8, ~raw.length & 255, (~raw.length >> 8) & 255, ...raw, ...u32(((b << 16) | a) >>> 0)];
  const header = [...u32(size), ...u32(size), 8, 2, 0, 0, 0]; // 8 bits, RGB
  return Uint8Array.from([0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', header), ...chunk('IDAT', idat), ...chunk('IEND', [])]);
}

/** Puts a crew onboard (and one who has signed off) straight into the ship's crew store. */
async function seedCrew(page: Page): Promise<void> {
  const [ship] = await stored(page, 'ships');
  const base = {
    createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-01T09:00:00.000Z', updatedBy: 'x', deleted: false, scope: 'ship', shipId: ship.id,
    nationality: 'Croatia', dateOfBirth: '1980-01-01', placeOfBirth: 'Split', passportNo: 'P1', passportExpiry: '2030-01-01',
    seamansBookNo: 'S1', seamansBookExpiry: '2030-01-01', signOnDate: '2026-06-01', signOnPort: 'Split',
  };
  await putRecords(page, 'crew', [
    { ...base, id: 'c1', surname: 'Babic', givenNames: 'Ivo', rank: 'master' },
    { ...base, id: 'c2', surname: 'Lee', givenNames: 'Ann', rank: 'bosun' },
    { ...base, id: 'c3', surname: 'Ode', givenNames: 'Ben', rank: 'ab' },
    { ...base, id: 'c4', surname: 'Gone', givenNames: 'Old', rank: 'os', signOffDate: '2026-09-01' },
  ]);
}

const wordSchema = async (name: string) => detectWord(readPackage(new Uint8Array(await fs.readFile(paths[name]))), name.endsWith('dotx') ? 'dotx' : 'docx', name);

test('Add from crew: the crew onboard as checkboxes fill the next free rows, and the signature column stays empty', async ({ page }) => {
  await startShip(page);
  await seedCrew(page);
  await openFillOf(page, 'toolbox.docx', 'TST-01 Toolbox Talk');
  const participants = section(page, 'Participants');
  await participants.getByRole('button', { name: 'Add row' }).click();
  await participants.getByRole('group', { name: 'Row 1' }).getByLabel('Name').fill('Cy Dee'); // a row in use stays

  await participants.getByRole('button', { name: 'Add from crew' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add from crew' });
  await expect(dialog.getByRole('checkbox')).toHaveCount(3); // the one who signed off is not onboard
  await expect(dialog.getByRole('checkbox')).toHaveCount(3);
  await expect(dialog.getByText('Old Gone')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
  await expectNoHorizontalScroll(page);
  await dialog.getByRole('checkbox', { name: /Ann Lee/ }).check();
  await dialog.getByRole('checkbox', { name: /Ben Ode/ }).check();
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await expect(participants.getByRole('group')).toHaveCount(3);
  await expect(participants.getByRole('group', { name: 'Row 1' }).getByLabel('Name')).toHaveValue('Cy Dee');
  await expect(participants.getByRole('group', { name: 'Row 2' }).getByLabel('Name')).toHaveValue('Ann Lee');
  await expect(participants.getByRole('group', { name: 'Row 2' }).getByLabel('Rank')).toHaveValue('Bosun');
  await expect(participants.getByRole('group', { name: 'Row 3' }).getByLabel('Name')).toHaveValue('Ben Ode');
  await expect(participants.getByRole('group', { name: 'Row 3' }).getByLabel('Rank')).toHaveValue('AB');
  await expect.poll(async () => (await liveDrafts(page))[0]?.values.rows.g1?.length).toBe(3);
  const [draft] = await liveDrafts(page);
  expect(Object.keys(draft.values.rows.g1[1]).sort()).toEqual(['g1.c1', 'g1.c2']); // no Signature
});

test('the permit: All Yes for a section, asking before it replaces answers, a gas warning that stays out of the file, and Now', async ({ page }) => {
  await startShip(page);
  await openFillOf(page, 'permit.docx', 'TST-02 Demo Permit');
  const one = section(page, 'Section 1 – Checks');
  const two = section(page, 'Section 2 – Entry');
  const yes = (region: ReturnType<typeof section>) => region.getByRole('button', { name: 'Yes', exact: true });

  await one.getByRole('button', { name: 'All Yes' }).click();
  await expect(yes(one)).toHaveCount(4);
  for (const button of await yes(one).all()) await expect(button).toHaveAttribute('aria-pressed', 'true');
  for (const button of await yes(two).all()) await expect(button).toHaveAttribute('aria-pressed', 'false'); // another section
  await expectNoHorizontalScroll(page);

  // An answer already given is asked about: Cancel keeps it, Replace changes it.
  await one.getByRole('group', { name: 'Check 1.2' }).getByRole('button', { name: 'No', exact: true }).click();
  await one.getByRole('button', { name: 'All Yes' }).click();
  const ask = page.getByRole('dialog', { name: 'Replace answers already given?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(one.getByRole('group', { name: 'Check 1.2' }).getByRole('button', { name: 'No', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await one.getByRole('button', { name: 'All Yes' }).click();
  await page.getByRole('dialog', { name: 'Replace answers already given?' }).getByRole('button', { name: 'Replace' }).click();
  await expect(one.getByRole('group', { name: 'Check 1.2' }).getByRole('button', { name: 'Yes', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // A reading past an alarm limit is warned about, as it is typed; the warning is only on the screen.
  const gas = section(page, 'Gas readings');
  await gas.getByRole('button', { name: 'Add row' }).click();
  const row = gas.getByRole('group', { name: 'Row 1' });
  // Not while it is typed (`1` on the way to `19.8`), but once the reading is left.
  await row.getByLabel('O2 [Vol.%]').pressSequentially('18.5');
  await expect(row.getByRole('alert')).toHaveCount(0);
  await row.getByLabel('O2 [Vol.%]').blur();
  await expect(row.getByRole('alert')).toHaveText('O2 18.5 — below 19.5');
  await row.getByLabel('CO [ppm]').fill('31');
  await expect(row.getByRole('alert')).toHaveCount(1); // CO is not left yet
  await row.getByLabel('CO [ppm]').blur();
  await expect(row.getByRole('alert').filter({ hasText: 'CO 31 — above 25' })).toBeVisible();
  await row.getByLabel('H2S [ppm]').fill('4');
  await row.getByLabel('H2S [ppm]').blur();
  await expect(row.getByRole('alert')).toHaveCount(2); // in range: none for H2S
  await row.getByLabel('O2 [Vol.%]').fill('20,5');
  await expect(row.getByRole('alert')).toHaveCount(1);
  await expectNoHorizontalScroll(page);

  // Now: the ship's clock, 14:00 at UTC+01:00.
  await row.getByRole('button', { name: 'Now' }).click();
  await expect(row.getByLabel('Time', { exact: true })).toHaveValue(/^14:0\d$/);
  const personnel = section(page, 'Personnel');
  await personnel.getByRole('button', { name: 'Add row' }).click();
  await personnel.getByRole('group', { name: 'Row 1' }).getByRole('button', { name: 'Now' }).first().click();

  await row.getByLabel('O2 [Vol.%]').fill('18.5');
  await row.getByLabel('O2 [Vol.%]').blur();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Make file' }).click();
  const file = await download;
  const back = readWordValues(readPackage(await downloaded(file)), await wordSchema('permit.docx'));
  expect(back.fields).toMatchObject({ f1: 'Yes', f2: 'Yes', f3: 'Yes', f4: 'Yes' });
  expect(back.fields.f5).toBeFalsy();
  expect(back.rows.g1[0]).toMatchObject({ 'g1.c2': '18.5', 'g1.c3': '31', 'g1.c4': '4' });
  expect(back.rows.g1[0]['g1.c1']).toMatch(/^14:0\d$/);
  expect(JSON.stringify(back)).not.toMatch(/below|above/);
});

test('Now: a time field gets the ship\'s clock and is no longer an Auto value', async ({ page }) => {
  await startShip(page);
  await openFillOf(page, 'toolbox.docx', 'TST-01 Toolbox Talk');
  const time = page.getByLabel('Time', { exact: true });
  await time.fill('08:15');
  await time.locator('xpath=ancestor::div[contains(@class,"fill-field")][1]').getByRole('button', { name: 'Now' }).click();
  await expect(time).toHaveValue(/^14:0\d$/);
  await expect(time).not.toHaveAccessibleDescription('Auto');
});

test('the weekly job log: Add job, a crew choice for Responsible, a photo from the camera, and the unfinished job carried to next week', async ({ page }) => {
  await startShip(page);
  await seedCrew(page);
  await openFillOf(page, 'weekly.dotx', 'TST-03 Demo Weekly Jobs');
  const jobs = section(page, 'Jobs');
  await jobs.getByRole('button', { name: 'Add job' }).click();
  await jobs.getByRole('button', { name: 'Add job' }).click();
  const first = jobs.getByRole('group', { name: 'Row 1' });
  const second = jobs.getByRole('group', { name: 'Row 2' });
  // A new job has the ship's today and the not-finished status.
  await expect(first.getByLabel('Date', { exact: true })).toHaveValue('2026-10-28');
  await expect(first.getByRole('button', { name: 'Pending', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await first.getByLabel('Description').fill('Grease the mooring winch');
  await first.getByLabel('Responsible', { exact: true }).selectOption({ label: 'Ann Lee' });
  await second.getByLabel('Description').fill('Paint the rails');
  await second.getByLabel('Responsible', { exact: true }).selectOption({ label: 'Someone else' });
  await second.getByLabel('Responsible, someone else').fill('Yard worker');
  await second.getByRole('button', { name: 'Completed', exact: true }).click();
  await expectNoHorizontalScroll(page);

  // A file that is no picture is refused in words, and keeps nothing.
  const pictures = section(page, 'Pictures');
  await pictures.getByLabel('Add photo').setInputFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from(new TextEncoder().encode('not a picture')) });
  await expect(pictures.getByRole('alert')).toHaveText("That picture couldn't be read. Choose another photo.");
  expect(await stored(page, 'formPhotos')).toEqual([]);

  await expect(pictures.getByText('No photos yet.')).toBeVisible();
  await pictures.getByLabel('Add photo').setInputFiles({ name: 'winch.png', mimeType: 'image/png', buffer: Buffer.from(pngOf(10)) });
  await expect(pictures.getByRole('img', { name: 'Photo' })).toBeVisible();
  await expect(pictures.getByRole('alert')).toHaveCount(0);
  await pictures.getByRole('button', { name: 'Before', exact: true }).click();
  await expect.poll(async () => (await stored(page, 'formPhotos')).length).toBe(1);
  const [photo] = await stored(page, 'formPhotos');
  expect(photo.width).toBe(10);
  expect(photo.jpegBase64.startsWith('/9j/')).toBe(true); // a JPEG
  await expect.poll(async () => (await liveDrafts(page))[0]?.values.rows.g2?.[0]).toEqual({ 'g2.c1': photo.id, 'g2.c2': 'Before' });
  await expect.poll(async () => (await liveDrafts(page))[0]?.photoIds).toEqual([photo.id]);
  await expectNoHorizontalScroll(page);

  // The file has the photo, and the job still to do is the next week's first.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Make file' }).click();
  const file = await download;
  const made = readPackage(await downloaded(file));
  expect(made.order.filter((name) => /^word\/media\/.*\.jpe?g$/.test(name))).toHaveLength(1);
  const back = readWordValues(made, await wordSchema('weekly.dotx'));
  expect(back.rows.g1[0]).toMatchObject({ 'g1.c3': 'Grease the mooring winch', 'g1.c2': 'Ann Lee', 'g1.c4': 'Pending' });
  expect(back.rows.g1[1]).toMatchObject({ 'g1.c2': 'Yard worker', 'g1.c4': 'Completed' });
  await expect(page).toHaveURL(/#\/forms$/);
  const [next] = await liveDrafts(page);
  expect(next.period).toBe('2026-W45');
  expect(next.values.rows.g1).toHaveLength(1);
  expect(next.values.rows.g1[0]).toMatchObject({ 'g1.c3': 'Grease the mooring winch', 'g1.c4': 'Pending' });
  expect(next.values.rows.g2).toBeUndefined();
  expect(next.autoIds).toBeUndefined(); // its auto values are not fixed yet (R18)

  // Its first change fixes the auto values for its own week, not for today (R19): week 45 starts on Monday 2 November.
  await page.getByRole('list', { name: 'In progress' }).getByRole('link').click();
  await expect(page.getByLabel('Year / Week No.', { exact: true })).toHaveValue(/45/);
  await page.getByLabel('Vessel', { exact: true }).fill('MV OCEAN STAR II');
  await expect.poll(async () => (await liveDrafts(page))[0]?.autoIds).toContain('f2');
  const [fixed] = await liveDrafts(page);
  expect(fixed.values.fields.f2).toMatch(/45/);
  expect(fixed.values.fields.f3).toBe('02-NOV-2026 - 08-NOV-2026'); // the Monday to the Sunday of week 45
  await expect(page.getByLabel('Year / Week No.', { exact: true })).toHaveAccessibleDescription('Auto');
});

test('a day grid opens on today\'s row and offers the other days', async ({ page }) => {
  await startShip(page);
  await openFillOf(page, 'daygrid.xlsx', 'TST-12 Demo Day Grid');
  const days = page.getByRole('group', { name: /^\d+$/ });
  await expect(days).toHaveCount(1);
  await expect(page.getByRole('group', { name: '28', exact: true })).toBeVisible();
  await page.getByRole('group', { name: '28', exact: true }).getByLabel('Hold 1 PORT').fill('3');
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Show all days' }).click();
  await expect(days).toHaveCount(31);
  await page.getByRole('button', { name: 'Show today only' }).click();
  await expect(days).toHaveCount(1);
  const [template] = await stored(page, 'formTemplates');
  const group = template.schema.rowGroups[0];
  await expect.poll(async () => (await liveDrafts(page))[0]?.values.rows[group.id]?.[27]?.[group.columns[0].id]).toBe('3');
});

test('a macro file imports without its macros: the setup says so, and Make file gives an .xlsx (R21)', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openForms(page);
  await importFile(page, 'inventory.xlsm');
  await expect(page.getByRole('heading', { name: 'Set up TST-11' })).toBeVisible();
  await expect(section(page, "Can't be filled here").getByRole('listitem').first()).toHaveText('Macros were removed from this file.');
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Save form' }).click();
  await expect(page.getByRole('status')).toHaveText('Form saved.');

  // What is stored is the workbook without its macros.
  const [template] = await stored(page, 'formTemplates');
  expect(template.fileName).toBe('inventory.xlsm');
  const kept = readPackage(Uint8Array.from(atob(template.fileBase64), (c) => c.charCodeAt(0)));
  expect(kept.order.filter((name) => /vbaProject|customUI/i.test(name))).toEqual([]);
  expect(kept.entries.has('xl/printerSettings/printerSettings1.bin')).toBe(true);
  expect(new TextDecoder().decode(kept.entries.get('[Content_Types].xml'))).not.toMatch(/macroEnabled|vbaProject/i);

  await library(page).getByRole('link', { name: /^TST-11 · / }).click();
  await expect(page.getByRole('heading', { name: 'TST-11 Demo Inventory', exact: true })).toBeVisible();
  await page.getByRole('group', { name: 'Item 001' }).getByLabel('Qty').fill('4');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Make file' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('TST-11 Demo Inventory 2026-10-25.xlsx');
  const bytes = await downloaded(file);
  const made = readPackage(bytes);
  expect(made.order.filter((name) => /vbaProject|customUI/i.test(name))).toEqual([]);
  expect(new TextDecoder().decode(made.entries.get('[Content_Types].xml'))).toContain('spreadsheetml.sheet.main+xml');
  const book = XLSX.read(bytes, { type: 'array' });
  expect(book.Sheets[book.SheetNames[0]!]!.E9).toMatchObject({ t: 'n', v: 4 });
});

test('start from last: a second inventory starts from the last file, and says what the last value was', async ({ page }) => {
  await startShip(page);
  await openFillOf(page, 'inventory.xlsx', 'TST-11 Demo Inventory');
  const item = (n: string) => page.getByRole('group', { name: `Item ${n}` });
  await item('001').getByLabel('Qty').fill('5');
  await item('001').getByLabel('Location').fill('Store A');
  await item('002').getByLabel('Qty').fill('2');
  await expect.poll(async () => (await liveDrafts(page)).length).toBe(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Make file' }).click();
  await download;
  await expect(page).toHaveURL(/#\/forms$/);
  expect(await liveDrafts(page)).toEqual([]);

  await library(page).getByRole('link', { name: /^TST-11 · / }).click();
  await expect(page.getByRole('heading', { name: 'TST-11 Demo Inventory', exact: true })).toBeVisible();
  // Shown as filled in before anything is changed, and no draft is stored for it yet.
  await expect(item('001').getByLabel('Qty')).toHaveValue('5');
  await expect(item('001').getByLabel('Location')).toHaveValue('Store A');
  await expect(item('002').getByLabel('Qty')).toHaveValue('2');
  await expect(item('003').getByLabel('Qty')).toHaveValue('');
  await expect(page.getByText(/^Last: /)).toHaveCount(0);
  expect(await liveDrafts(page)).toEqual([]);

  await item('001').getByLabel('Qty').fill('8');
  await expect(item('001').getByText('Last: 5')).toBeVisible();
  await expect(item('001').getByText('Last: Store A')).toHaveCount(0); // not changed
  await item('003').getByLabel('Qty').fill('1');
  await expect(item('003').getByText(/^Last:/)).toHaveCount(0); // there was no last value
  await item('002').getByLabel('Qty').fill('');
  await expect(item('002').getByText('Last: 2')).toBeVisible();
  const [template] = await stored(page, 'formTemplates');
  const group = template.schema.rowGroups[0].id as string;
  const qty = 'Demo inventory!g1.E';
  await expect.poll(async () => (await liveDrafts(page))[0]?.values.rows[group]?.[0]?.[qty]).toBe('8');
  const [draft] = await liveDrafts(page);
  expect(draft.values.rows[group][0]['Demo inventory!g1.D']).toBe('Store A'); // carried into the draft at its first change
  await expectNoHorizontalScroll(page);
});

test('a condition list: All Satisfactory fills the empty ones, and Remarks come under a row that is not satisfactory', async ({ page }) => {
  await startShip(page);
  await openFillOf(page, 'conditions.xlsx', 'TST-14 Demo Conditions');
  const row = (n: string) => page.getByRole('group', { name: `Item ${n}` });
  await row('003').getByLabel('Condition').fill('Defective');
  await page.getByRole('button', { name: 'All Satisfactory' }).click();
  const ask = page.getByRole('dialog', { name: 'Replace answers already given?' });
  await expect(ask).toContainText('1 other answer already given');
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(row('001').getByLabel('Condition')).toHaveValue('Satisfactory');
  await expect(row('100').getByLabel('Condition')).toHaveValue('Satisfactory');
  await expect(row('003').getByLabel('Condition')).toHaveValue('Defective');
  // Remarks are under the rows that are not satisfactory only.
  await expect(row('001').getByLabel('Remarks')).toHaveCount(0);
  await expect(row('003').getByLabel('Remarks')).toBeVisible();
  await row('003').getByLabel('Remarks').fill('Hatch cover seal torn');
  await row('004').getByLabel('Condition').fill('Worn');
  await expect(row('004').getByLabel('Remarks')).toBeVisible();
  await row('004').getByLabel('Condition').fill('Satisfactory');
  await expect(row('004').getByLabel('Remarks')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test('a matrix is shown under its block, with one heading', async ({ page }) => {
  await startShip(page);
  await openFillOf(page, 'matrix.xlsx', 'TST-13 Demo Matrix');
  const block = page.getByRole('group', { name: 'Table 1' });
  await expect(page.getByRole('heading', { name: 'Table 1' })).toHaveCount(1);
  await expect(block.getByLabel('Equipment 1 · Kind')).toBeVisible();
  await expect(block.locator('input, textarea')).toHaveCount(81);
  await expect(block.getByLabel('Master')).toHaveCount(0); // the fields under it are not part of the block
  await expect(page.getByLabel('Master', { exact: true })).toBeVisible();
});

test('a save that fails while the file is being made clears the "Making the file" line', async ({ page }) => {
  await startShip(page);
  await openFillOf(page, 'toolbox.docx', 'TST-01 Toolbox Talk');
  await failWrites(page);
  await page.getByRole('button', { name: 'Make file' }).click();
  await expect(page.getByRole('alert')).toBeVisible(); // the save failed, and said so
  await expect(page.locator('p.live').first()).toHaveText('');
  await expect(page.getByRole('button', { name: 'Make file' })).not.toHaveAttribute('aria-disabled');
  await allowWrites(page);
});

test('a job log with its photos in the same table: a photo in a job row, removed photos are deleted, and the file has the jpeg', async ({ page }) => {
  await startShip(page);
  await openFillOf(page, 'jobs-photos.dotx', 'TST-05 Demo Jobs With Photos');
  const jobs = section(page, 'Jobs');
  await jobs.getByRole('button', { name: 'Add job' }).click();
  const row = jobs.getByRole('group', { name: 'Row 1' });
  await row.getByLabel('Description').fill('Check the pilot ladder');
  await expect(row.getByRole('button', { name: 'Remove photo' })).toHaveCount(0);
  await row.getByLabel('Add photo').setInputFiles({ name: 'ladder.png', mimeType: 'image/png', buffer: Buffer.from(pngOf(10)) });
  await expect(row.getByRole('img', { name: 'Photo' })).toBeVisible();
  await row.getByRole('button', { name: 'Before', exact: true }).click();
  await expectNoHorizontalScroll(page);
  await expect.poll(async () => (await stored(page, 'formPhotos')).length).toBe(1);
  const [first] = await stored(page, 'formPhotos');

  // Replacing a photo removes the old one: it keeps no image.
  await expect(row.getByText('Replace photo')).toBeVisible();
  await row.getByLabel('Replace photo').setInputFiles({ name: 'ladder2.png', mimeType: 'image/png', buffer: Buffer.from(pngOf(12)) });
  await expect.poll(async () => (await stored(page, 'formPhotos')).find((x) => x.id === first.id)?.deleted).toBe(true);
  const photos = await stored(page, 'formPhotos');
  expect(photos.find((x) => x.id === first.id)).toMatchObject({ deleted: true, jpegBase64: '' });
  const [kept] = photos.filter((x) => !x.deleted);
  expect(kept.width).toBe(12);
  await expect.poll(async () => (await liveDrafts(page))[0]?.photoIds).toEqual([kept.id]);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Make file' }).click();
  const made = readPackage(await downloaded(await download));
  expect(made.order.filter((name) => /^word\/media\/.*\.jpe?g$/.test(name))).toHaveLength(1);
  const back = readWordValues(made, await wordSchema('jobs-photos.dotx'));
  expect(back.rows.g1[0]).toMatchObject({ 'g1.c3': 'Check the pilot ladder', 'g1.c4': 'Pending', 'g1.c6': 'Before' });
  expect(back.rows.g1[0]['g1.c5']).toBeTruthy();
});

test('Remove photo takes the photo out of the table and deletes its record', async ({ page }) => {
  await startShip(page);
  await openFillOf(page, 'jobs-photos.dotx', 'TST-05 Demo Jobs With Photos');
  const row = section(page, 'Jobs').getByRole('group', { name: 'Row 1' });
  await section(page, 'Jobs').getByRole('button', { name: 'Add job' }).click();
  await row.getByLabel('Add photo').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(pngOf(10)) });
  await expect(row.getByRole('img', { name: 'Photo' })).toBeVisible();
  await row.getByRole('button', { name: 'Remove photo' }).click();
  await expect(row.getByRole('img', { name: 'Photo' })).toHaveCount(0);
  await expect.poll(async () => (await stored(page, 'formPhotos')).filter((x) => !x.deleted).length).toBe(0);
  expect((await stored(page, 'formPhotos'))[0]).toMatchObject({ deleted: true, jpegBase64: '' });
  await expect.poll(async () => (await liveDrafts(page))[0]?.photoIds).toEqual([]);
});

/* ---- Part 4: Home card and importing several forms (Task 17) ---- */

test('Home lists the forms in progress and says when a day grid has no row for today', async ({ page }) => {
  await startShip(page);
  await expect(page.getByRole('region', { name: 'Forms in progress' })).toHaveCount(0);
  await openFillOf(page, 'daygrid.xlsx', 'TST-12 Demo Day Grid');
  await page.getByRole('button', { name: 'Show all days' }).click();
  // A value on another day starts the draft; today's row (the 28th) is still empty.
  await page.getByRole('group', { name: '27', exact: true }).getByLabel('Hold 1 PORT').fill('3');
  await expect.poll(async () => (await liveDrafts(page)).length).toBe(1);

  await page.goto('./#/');
  const card = page.getByRole('region', { name: 'Forms in progress' });
  await expect(card.getByRole('heading', { name: 'Forms in progress' })).toBeVisible();
  const link = card.getByRole('link', { name: "TST-12 Demo Day Grid — today's row not entered" });
  await expect(link).toBeVisible();
  await expectNoHorizontalScroll(page);
  await link.click();
  await expect(page).toHaveURL(/#\/forms\/[^/]+\/fill$/);
  await expect(page.getByRole('heading', { name: 'TST-12 Demo Day Grid', exact: true })).toBeVisible();

  await page.getByRole('group', { name: '28', exact: true }).getByLabel('Hold 1 PORT').fill('4');
  await expect.poll(async () => JSON.stringify((await liveDrafts(page))[0].values.rows).includes('"4"')).toBe(true);
  await page.goto('./#/');
  await expect(page.getByRole('region', { name: 'Forms in progress' }).getByRole('link', { name: 'TST-12 Demo Day Grid — October 2026' })).toBeVisible();
});

test('several forms are imported at once: a count, and a line for the file that failed', async ({ page }) => {
  await startShip(page);
  await openForms(page);
  await expect(page.getByLabel('Import form')).toHaveAttribute('multiple', '');
  await page.getByLabel('Import form').setInputFiles([paths['toolbox.docx'], paths['inventory.xlsx'], paths['old.doc']]);
  await expect(page.getByText('2 forms imported', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText(`old.doc: ${OLD_FORMAT}`);
  // No setup was opened; both forms are in the library.
  await expect(page).toHaveURL(/#\/forms$/);
  await expect(library(page).getByRole('listitem')).toHaveCount(2);
  await expect(library(page).getByRole('link', { name: /^TST-01 · / })).toBeVisible();
  await expect(library(page).getByRole('link', { name: /^TST-11 · / })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // A second batch with a new revision asks for that file only; Cancel skips it.
  await page.getByLabel('Import form').setInputFiles([paths['toolbox-rev01.docx'], paths['inventory.xlsx']]);
  await expect(page.getByRole('dialog')).toContainText('Replace Revision 00 / 01.01.2026 with Revision 01 / 01.06.2026?');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toContainText('Replace Revision');
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(page.getByText('1 form imported', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/forms$/);
  await expect(library(page).getByRole('link', { name: 'TST-01 · Toolbox Talk · Rev 00 / 01.01.2026' })).toBeVisible();
});

test('two files with the same code in one selection: the second asks to replace', async ({ page }) => {
  await startShip(page);
  await openForms(page);
  await page.getByLabel('Import form').setInputFiles([paths['toolbox.docx'], paths['toolbox-rev01.docx']]);
  await expect(page.getByRole('dialog')).toContainText('Replace Revision 00 / 01.01.2026 with Revision 01 / 01.06.2026?');
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(page.getByText('2 forms imported', { exact: true })).toBeVisible();
  await expect(library(page).getByRole('listitem')).toHaveCount(1);
  await expect(library(page).getByRole('link', { name: 'TST-01 · Toolbox Talk · Rev 01 / 01.06.2026' })).toBeVisible();
});
