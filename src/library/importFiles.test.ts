import { describe, expect, it, vi } from 'vitest';
import { listDocuments, allText } from '../db/library';
import { openDb } from '../db/schema';
import { makePdf } from '../test/makePdf';
import * as pdfjsLegacy from 'pdfjs-dist/legacy/build/pdf.mjs';
import { useTestPdfjs } from './pdfjs';
import { importFiles } from './importFiles';

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
});
