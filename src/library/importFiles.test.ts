import { describe, expect, it, vi } from 'vitest';
import { listDocuments, allText } from '../db/library';
import { openDb } from '../db/schema';
import { makePdf } from '../test/makePdf';
import * as pdfjsLegacy from 'pdfjs-dist/legacy/build/pdf.mjs';
import { useTestPdfjs } from './pdfjs';
import * as library from '../db/library';
import { attachChosenFile, importFiles } from './importFiles';

useTestPdfjs(pdfjsLegacy);

const LONG = 'The quick brown fox jumps over the lazy dog';
const freshDb = () => openDb('imp-' + crypto.randomUUID());
const pdfFile = (name: string, pages: (string[] | 'image')[]) => new File([makePdf(pages) as Uint8Array<ArrayBuffer>], name, { type: 'application/pdf' });
const hooks = () => ({ confirmDuplicate: vi.fn(async () => false), progress: vi.fn() });

describe('importFiles', () => {
  it('adds a pdf with its title from the file name, normalised text and progress text', async () => {
    const db = await freshDb();
    const h = hooks();
    const result = await importFiles(db, [pdfFile('Bilge Manual.pdf', [[`Ünit One ${LONG}`], [`Two ${LONG}`]])], h);
    expect(result.failed).toEqual([]);
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toMatchObject({ title: 'Bilge Manual', kind: 'pdf', pageCount: 2, textStatus: 'indexed' });
    expect((await listDocuments(db))).toHaveLength(1);
    expect((await allText(db)).map((r) => r.text)).toEqual([`unit one ${LONG.toLowerCase()}`, `two ${LONG.toLowerCase()}`]);
    expect(h.progress).toHaveBeenCalledWith('Indexing Bilge Manual: page 2 of 2');
  });

  it('asks about a duplicate and adds nothing when the answer is no', async () => {
    const db = await freshDb();
    const h = hooks();
    await importFiles(db, [pdfFile('a.pdf', [[LONG]])], h);
    const again = await importFiles(db, [pdfFile('b.pdf', [[LONG]])], h);
    expect(h.confirmDuplicate).toHaveBeenCalledWith('a');
    expect(again).toEqual({ added: [], failed: [] });
    expect(await listDocuments(db)).toHaveLength(1);
    h.confirmDuplicate.mockResolvedValueOnce(true);
    expect((await importFiles(db, [pdfFile('b.pdf', [[LONG]])], h)).added).toHaveLength(1);
  });

  it('refuses a file over 100 MB without reading it', async () => {
    const db = await freshDb();
    const big = { name: 'huge.pdf', size: 100 * 1024 * 1024 + 1, type: '', arrayBuffer: vi.fn() } as unknown as File;
    const result = await importFiles(db, [big], hooks());
    expect(result.failed).toEqual([{ name: 'huge.pdf', message: 'huge.pdf is over 100 MB' }]);
    expect(big.arrayBuffer).not.toHaveBeenCalled();
  });

  it('keeps an image-only pdf with no-text status', async () => {
    const db = await freshDb();
    const result = await importFiles(db, [pdfFile('scan.pdf', ['image'])], hooks());
    expect(result.added[0].textStatus).toBe('no-text');
  });

  it('lists a file whose storing fails and still imports the later ones', async () => {
    const db = await freshDb();
    const spy = vi.spyOn(library, 'addDocument').mockRejectedValueOnce(new Error('The disk is full.'));
    const result = await importFiles(db, [pdfFile('a.pdf', [[LONG]]), pdfFile('b.pdf', [[LONG + ' b']])], hooks());
    spy.mockRestore();
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].name).toBe('a.pdf');
    expect(result.added.map((d) => d.title)).toEqual(['b']);
  });
});

describe('attachChosenFile', () => {
  const missing = async (db: Awaited<ReturnType<typeof freshDb>>, name: string, pages: (string[] | 'image')[]) => {
    const [doc] = (await importFiles(db, [pdfFile(name, pages)], hooks())).added;
    await db.libraryFiles.clear();
    await db.libraryText.clear();
    return doc;
  };
  const attachHooks = (answer: boolean) => ({ confirmDifferent: vi.fn(async () => answer), progress: vi.fn() });

  it('attaches the same file without asking', async () => {
    const db = await freshDb();
    const doc = await missing(db, 'a.pdf', [[LONG]]);
    const h = attachHooks(false);
    expect(await attachChosenFile(db, doc, pdfFile('a.pdf', [[LONG]]), h)).toEqual({ status: 'attached' });
    expect(h.confirmDifferent).not.toHaveBeenCalled();
    expect((await library.hasFiles(db)).has(doc.id)).toBe(true);
  });

  it('refuses a file that another live document already has', async () => {
    const db = await freshDb();
    const doc = await missing(db, 'a.pdf', [[LONG]]);
    await importFiles(db, [pdfFile('Other.pdf', [[LONG + ' other']])], hooks());
    const result = await attachChosenFile(db, doc, pdfFile('x.pdf', [[LONG + ' other']]), attachHooks(true));
    expect(result).toEqual({ status: 'duplicate', title: 'Other' });
    expect((await library.hasFiles(db)).has(doc.id)).toBe(false);
  });

  it('uses a different file only when confirmed, and then takes its kind, name and size', async () => {
    const db = await freshDb();
    const doc = await missing(db, 'a.pdf', [[LONG]]);
    const docx = new File([new Uint8Array([1, 2, 3])], 'plan.docx');
    expect((await attachChosenFile(db, doc, docx, attachHooks(false))).status).toBe('cancelled');
    expect((await library.hasFiles(db)).has(doc.id)).toBe(false);
    expect((await attachChosenFile(db, doc, docx, attachHooks(true))).status).toBe('attached');
    expect(await db.libraryDocs.get(doc.id)).toMatchObject({ kind: 'docx', fileName: 'plan.docx', size: 3 });
  });
});
