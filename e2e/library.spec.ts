import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoHorizontalScroll, freshApp, setupShip } from './helpers';
import * as XLSX from 'xlsx';
import { makeDocx } from './fixtures/makeDocx';
import { makePdf } from './fixtures/makePdf';

const LONG = 'The quick brown fox jumps over the lazy dog';
const pdf = (name: string, pages: (string[] | 'image')[]) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(makePdf(pages)) });
const docx = (name: string) => ({
  name, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(makeDocx([LONG, 'Second paragraph of the safety plan.'])),
});

async function open(page: Page): Promise<void> {
  await freshApp(page); await setupShip(page);
  await page.goto('./#/library');
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
}

const importDocs = (page: Page, ...files: ReturnType<typeof pdf>[]) => page.getByLabel('Import documents').setInputFiles(files);
const list = (page: Page) => page.getByRole('list', { name: 'Documents' });

test('library: Home has a Library card', async ({ page }) => {
  await freshApp(page); await setupShip(page);
  const card = page.getByRole('link', { name: /^Library/ });
  await expect(card).toContainText('Your manuals and documents, searchable offline');
  await card.click();
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
});

test('library: imports a pdf (through the real pdf.js worker) and a docx', async ({ page }) => {
  await open(page);
  await importDocs(page, pdf('Bilge Manual.pdf', [[LONG], [LONG + ' two'], [LONG + ' three']]), docx('Safety Plan.docx'));
  await expect(list(page).getByRole('listitem')).toHaveCount(2);
  const bilge = list(page).getByRole('listitem').filter({ hasText: 'Bilge Manual' });
  await expect(bilge).toContainText('3 pages');
  await expect(bilge).toContainText('PDF');
  await expect(list(page).getByRole('listitem').filter({ hasText: 'Safety Plan' })).toContainText('DOCX');
  await expect(page.getByText(/Indexing/)).toHaveCount(0);
});

test('library: an image-only pdf says there is no searchable text', async ({ page }) => {
  await open(page);
  await importDocs(page, pdf('Scan.pdf', ['image']));
  await expect(list(page)).toContainText('No searchable text');
});

test('library: importing the same pdf again asks, and Cancel adds nothing', async ({ page }) => {
  await open(page);
  const file = pdf('Manual.pdf', [[LONG]]);
  await importDocs(page, file);
  await expect(list(page).getByRole('listitem')).toHaveCount(1);
  await importDocs(page, { ...file, name: 'Copy.pdf' });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Already in the library as Manual. Import again?');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(list(page).getByRole('listitem')).toHaveCount(1);
  await importDocs(page, { ...file, name: 'Copy.pdf' });
  await page.getByRole('dialog').getByRole('button', { name: 'Import again' }).click();
  await expect(list(page).getByRole('listitem')).toHaveCount(2);
});

test('library: rename, folder and tags persist after a reload', async ({ page }) => {
  await open(page);
  await importDocs(page, pdf('Manual.pdf', [[LONG]]));
  await page.getByRole('button', { name: '+ Folder' }).click();
  await page.getByRole('dialog').getByLabel('Folder name').fill('Engine room');
  await page.getByRole('dialog').getByRole('button', { name: 'Create folder' }).click();
  await expect(page.getByRole('button', { name: 'Engine room' })).toBeVisible();
  await list(page).getByRole('link', { name: /Manual/ }).click();
  await page.getByLabel('Title').fill('Purifier manual');
  await page.getByLabel('Folder').selectOption({ label: 'Engine room' });
  await page.getByLabel('Tags').fill('purifier, oil');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Title')).toHaveValue('Purifier manual');
  await expect(page.getByLabel('Folder')).toHaveValue(/.+/);
  await expect(page.getByLabel('Tags')).toHaveValue('purifier, oil');
  await page.goto('./#/library');
  await page.getByRole('button', { name: 'Engine room' }).click();
  await expect(list(page)).toContainText('Purifier manual');
  await page.getByRole('button', { name: 'All', exact: true }).click();
});

test('library: delete, undo, delete again, then restore from Recently deleted', async ({ page }) => {
  await open(page);
  await importDocs(page, pdf('Manual.pdf', [[LONG]]));
  await list(page).getByRole('link', { name: /Manual/ }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Deleted.')).toBeVisible();
  await page.goto('./#/library');
  await expect(list(page)).toHaveCount(0);
  await page.getByRole('link', { name: 'Recently deleted' }).click();
  const item = page.getByRole('listitem').filter({ hasText: 'Manual' });
  await expect(item).toContainText(/Deleted .* · removed after /);
  await item.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Manual' })).toHaveCount(0);
  await page.goto('./#/library');
  await expect(list(page)).toContainText('Manual');
});

test('library: Delete now removes a document from Recently deleted for good', async ({ page }) => {
  await open(page);
  await importDocs(page, pdf('Manual.pdf', [[LONG]]));
  await list(page).getByRole('link', { name: /Manual/ }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.goto('./#/library/deleted');
  await page.getByRole('button', { name: 'Delete now' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete now' }).click();
  await expect(page.getByText('Nothing deleted.')).toBeVisible();
});

test('library: opens offline after a reload, at 360 px with no sideways scroll', async ({ page, context }) => {
  await open(page);
  await importDocs(page, pdf('A very long manual title that should wrap instead of pushing the page sideways.pdf', [[LONG]]));
  await expect(list(page).getByRole('listitem')).toHaveCount(1);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await expect(list(page).getByRole('listitem')).toHaveCount(1);
  await expectNoHorizontalScroll(page);
});

test('library: a document whose file is missing can have its file attached, with a check that it is the same file', async ({ page }) => {
  await open(page);
  const file = pdf('Manual.pdf', [[LONG]]);
  await importDocs(page, file);
  await expect(list(page).getByRole('listitem')).toHaveCount(1);
  // As if the record had come from another device: no file here.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('masterpiece');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('libraryFiles', 'readwrite');
      tx.objectStore('libraryFiles').clear();
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  }));
  await page.reload();
  await expect(list(page)).toContainText('File not on this device');
  await list(page).getByRole('link', { name: /Manual/ }).click();
  await expect(page.getByLabel('Attach file')).toBeAttached();
  await page.getByLabel('Attach file').setInputFiles(pdf('Other.pdf', [[LONG + ' different']]));
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('This is a different file. Use it anyway?');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByLabel('Attach file')).toBeAttached();
  await page.getByLabel('Attach file').setInputFiles(file);
  await expect(page.getByRole('status').filter({ hasText: 'File attached.' })).toBeVisible();
  await expect(page.getByLabel('Attach file')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open with…' })).toBeVisible();
});

const clearFiles = (page: Page) => page.evaluate(() => new Promise<void>((resolve, reject) => {
  const open = indexedDB.open('masterpiece');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction('libraryFiles', 'readwrite');
    tx.objectStore('libraryFiles').clear();
    tx.oncomplete = () => { db.close(); resolve(); };
  };
}));

test('library: attach refuses a file that another document has, and uses a different file after asking', async ({ page }) => {
  await open(page);
  await importDocs(page, pdf('Manual.pdf', [[LONG]]), pdf('Second.pdf', [[LONG + ' second']]));
  await expect(list(page).getByRole('listitem')).toHaveCount(2);
  await clearFiles(page);
  await page.reload();
  await list(page).getByRole('link', { name: /Manual/ }).click();
  const attach = page.getByLabel('Attach file');
  // The bytes of Second.pdf, which is a live document: refused, and Manual still has no file.
  await attach.setInputFiles(pdf('x.pdf', [[LONG + ' second']]));
  await expect(page.getByRole('status').filter({ hasText: 'Already in the library as Second.' })).toBeVisible();
  await expect(page.getByText('File not on this device')).toBeVisible();
  await expect(attach).toBeAttached();
  // A file that is new to the library but not Manual's own: asks first.
  await attach.setInputFiles(docx('Plan.docx'));
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('This is a different file. Use it anyway?');
  await dialog.getByRole('button', { name: 'Use it anyway' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'File attached.' })).toBeVisible();
  await expect(page.getByText('DOCX')).toBeVisible();
  await expect(page.getByText('File not on this device')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open with…' })).toBeVisible();
});

const BALLAST = [['Introduction and exchange rates'], ['Pumps and valves'], ['The ballast exchange procedure for the tanks']];
const png = () => ({
  name: 'Pump room.png', mimeType: 'image/png',
  buffer: Buffer.from(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))),
});
const xlsx = (name: string) => ({
  name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  buffer: (() => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Item', 'Qty'], ['Ballast pump', 2]]), 'Pumps');
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Gate valve', 7]]), 'Valves');
    return Buffer.from(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer));
  })(),
});
const search = async (page: Page, text: string) => {
  await page.getByLabel('Search library').fill(text);
  return page.getByRole('list', { name: 'Search results' });
};

test('library search: a pdf result shows its page and snippet, and opens the viewer at that page with the words marked', async ({ page }) => {
  await open(page);
  await importDocs(page, pdf('Ballast Manual.pdf', BALLAST));
  await expect(list(page).getByRole('listitem')).toHaveCount(1);
  const results = await search(page, 'BALLAST exch');
  const hit = results.getByRole('listitem').filter({ hasText: 'Ballast Manual' });
  await expect(hit).toContainText('Page 3');
  // "ballast" is in the title, so a page matches on the other words: pages 1 and 3 both have "exchange".
  await expect(hit.getByRole('link', { name: /Page 3/ }).locator('mark').first()).toHaveText('ballast');
  await hit.getByRole('link', { name: /Page 3/ }).click();
  await expect(page.getByLabel('Go to page')).toHaveValue('3');
  await expect(page.getByText('/ 3', { exact: true })).toBeVisible();
  await expect(page.locator('.pdf-page[data-page="3"] .textLayer mark').first()).toHaveText('ballast');
  await expect(page.locator('.pdf-page[data-page="3"] canvas')).toBeVisible();
  // Find: next match across pages (page 3 -> page 1, wrapping), then back.
  await page.getByLabel('Find in document').fill('exchange');
  await page.getByRole('button', { name: 'Next match' }).click();
  await expect(page.getByLabel('Go to page')).toHaveValue('1');
  await expect(page.locator('.pdf-page[data-page="1"] .textLayer mark').first()).toHaveText('exchange');
  await page.getByRole('button', { name: 'Previous match' }).click();
  await expect(page.getByLabel('Go to page')).toHaveValue('3');
  // Go to page, next and previous page, zoom.
  await page.getByLabel('Go to page').fill('2');
  await page.getByLabel('Go to page').press('Enter');
  await expect(page.locator('.pdf-page[data-page="2"] canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByLabel('Go to page')).toHaveValue('3');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Fit width' }).click();
  await expect(page.getByRole('button', { name: 'Open with…' })).toBeVisible();
});

test('library search: tapping the title opens page 1, and opening sets Recently opened', async ({ page }) => {
  await open(page);
  await importDocs(page, pdf('Ballast Manual.pdf', BALLAST));
  const results = await search(page, 'ballast');
  await results.getByRole('link', { name: 'Ballast Manual' }).click();
  await expect(page.getByLabel('Go to page')).toHaveValue('1');
  await page.goto('./#/library');
  await expect(page.getByRole('region', { name: 'Recently opened' })).toContainText('Ballast Manual');
});

test('library search: a docx result opens with the word marked', async ({ page }) => {
  await open(page);
  await importDocs(page, docx('Safety Plan.docx'));
  const results = await search(page, 'FOX');
  await expect(results).toContainText('Document');
  await results.getByRole('link', { name: /Document/ }).click();
  await expect(page.locator('.docx-view mark').first()).toHaveText('fox');
  await expect(page.locator('.docx-view')).toContainText('Second paragraph of the safety plan.');
});

test('library search: an xlsx result opens on the sheet tab with the word marked', async ({ page }) => {
  await open(page);
  await importDocs(page, xlsx('Stores.xlsx'));
  const results = await search(page, 'gate');
  await expect(results).toContainText('Sheet Valves');
  await results.getByRole('link', { name: /Sheet Valves/ }).click();
  await expect(page.getByRole('tab', { name: 'Valves' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.xlsx-view td mark').first()).toHaveText('Gate');
  await page.getByRole('tab', { name: 'Pumps' }).click();
  await expect(page.locator('.xlsx-view')).toContainText('Ballast pump');
});

test('library search: a meta-only match on an image is found by its tag, and the image is shown', async ({ page }) => {
  await open(page);
  await importDocs(page, png());
  await list(page).getByRole('link', { name: /Pump room/ }).click();
  await page.getByLabel('Tags').fill('purifier, gauge');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await expect(page.locator('img.image-view')).toBeVisible();
  await page.goto('./#/library');
  const results = await search(page, 'GAUGE');
  const hit = results.getByRole('listitem').filter({ hasText: 'Pump room' });
  await expect(hit).toContainText('Matches the title');
  await search(page, 'nonexistentword');
  await expect(page.getByText('No documents match.')).toBeVisible();
});

test('library search: the pdf viewer has no sideways scroll at 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page);
  await importDocs(page, pdf('Ballast Manual.pdf', BALLAST));
  const results = await search(page, 'ballast exchange');
  await results.getByRole('link', { name: /Page 3/ }).click();
  await expect(page.locator('.pdf-page[data-page="3"] canvas')).toBeVisible();
  await expectNoHorizontalScroll(page);
  const widest = await page.locator('.pdf-page canvas').evaluateAll((els) => Math.max(...els.map((e) => e.getBoundingClientRect().right)));
  expect(widest).toBeLessThanOrEqual(360);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expectNoHorizontalScroll(page);
});
