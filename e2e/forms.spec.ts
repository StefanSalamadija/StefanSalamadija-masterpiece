import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { test, expect } from '@playwright/test';
import type { Download, Page } from '@playwright/test';
import { detectExcel } from '../src/forms/excel/detect';
import { readExcelValues } from '../src/forms/excel/read';
import { readPackage } from '../src/forms/package';
import { oddLayoutsDocx } from '../src/forms/testing/wordFixtures';
import { detectWord } from '../src/forms/word/detect';
import { readWordValues } from '../src/forms/word/read';
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

test('a draft opens with its auto values, keeps every change, and Make file gives the form filled in', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  await openFillOf(page, 'toolbox.docx', 'TST-01 Toolbox Talk');
  await expect(page.getByText('25-OCT-2026', { exact: true })).toBeVisible(); // the period line

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
  await expect.poll(async () => (await liveDrafts(page))[0]?.values).toEqual({
    fields: { f1: 'MV SEA BREEZE', f2: subject },
    rows: { g1: [{ 'g1.c1': 'Ann Lee', 'g1.c2': 'Bosun' }] },
  });
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
      configurable: true, value: () => Promise.reject(new DOMException('Share canceled', 'AbortError')),
    });
  });
  await freshApp(page); await setupShip(page);
  await openFillOf(page, 'toolbox.docx', 'TST-01 Toolbox Talk');
  await page.getByLabel('Subject', { exact: true }).fill('Boat drill');
  const downloads: Download[] = [];
  page.on('download', (d) => downloads.push(d));

  await page.getByRole('button', { name: 'Make file' }).click();
  await expect(page.getByRole('status')).toHaveText(SHARE_CANCELLED);
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
