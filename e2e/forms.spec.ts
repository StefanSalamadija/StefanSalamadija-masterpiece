import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { oddLayoutsDocx } from '../src/forms/testing/wordFixtures';
import { writeFormFixtures } from './fixtures/makeForms';
import { expectNoHorizontalScroll, freshApp, setupShip } from './helpers';

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
  ]);
  await page.reload();
  const drafts = page.getByRole('list', { name: 'In progress' });
  await expect(drafts.getByRole('listitem')).toHaveText(['TST-01 Toolbox Talk — 25-OCT-2026', 'TST-77 — import this form to continue']);
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
  const name = yours.getByLabel('Name this field');
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
  await page.getByLabel('Not finished value').fill('Open');
  await page.getByRole('button', { name: 'Save form' }).click();
  await expect(library(page).getByRole('listitem')).toHaveCount(2);
  const weekly = (await stored(page, 'formTemplates')).find((t) => t.code === 'TST-03')!;
  expect(weekly.setup.notFinished).toBe('Open');
  expect(weekly.setup.helpers.jobLog).toEqual(['g1']);
});
