import { describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import * as pdfjsLegacy from 'pdfjs-dist/legacy/build/pdf.mjs';
import { makePdf } from '../../test/makePdf';
import { makeWorkbook } from '../../test/makeWorkbook';
import { useTestPdfjs } from '../pdfjs';
import { extract, kindOf, sha256Hex } from './index';

useTestPdfjs(pdfjsLegacy);

const buf = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
const LONG = 'The quick brown fox jumps over the lazy dog';

describe('kindOf', () => {
  it('classifies by extension, then mime type', () => {
    expect(kindOf('A.PDF', '')).toBe('pdf');
    expect(kindOf('a.docx', '')).toBe('docx');
    expect(kindOf('a.xlsx', '')).toBe('xlsx');
    expect(kindOf('a.jpg', '')).toBe('image');
    expect(kindOf('a.doc', '')).toBe('other');
    expect(kindOf('a.txt', 'text/plain')).toBe('other');
    expect(kindOf('noext', 'application/pdf')).toBe('pdf');
    expect(kindOf('noext', 'image/png')).toBe('image');
  });
});

describe('sha256Hex', () => {
  it('hashes abc', async () => {
    const hex = await sha256Hex(buf(strToU8('abc')));
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('extract', () => {
  it('extracts a PDF page by page', async () => {
    const data = buf(makePdf([[`${LONG} one`], [`${LONG} two`, 'second line here'], [`${LONG} three`]]));
    const r = await extract('pdf', data);
    expect(r.textStatus).toBe('indexed');
    expect(r.pageCount).toBe(3);
    expect(r.parts.map((p) => p.label)).toEqual(['Page 1', 'Page 2', 'Page 3']);
    expect(r.parts[1].part).toBe(2);
    expect(r.parts[1].text).toContain('two');
    expect(r.parts[1].text).toContain('second line here');
  });

  it('reports an image-only PDF as no-text', async () => {
    const r = await extract('pdf', buf(makePdf(['image', 'image'])));
    expect(r.textStatus).toBe('no-text');
    expect(r.parts).toEqual([]);
    expect(r.pageCount).toBe(2);
  });

  it('fails on random bytes', async () => {
    const bytes = new Uint8Array(500).map((_, i) => (i * 37) % 251);
    const r = await extract('pdf', buf(bytes));
    expect(r.textStatus).toBe('failed');
    expect(r.textError).toBe('Protected or damaged PDF');
  });

  it('fails on 0 bytes', async () => {
    const r = await extract('pdf', new ArrayBuffer(0));
    expect(r).toMatchObject({ textStatus: 'failed', textError: 'Empty file', parts: [] });
  });

  it('reads a docx in paragraph order, table cells included', async () => {
    const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const xml = `<?xml version="1.0"?><w:document ${ns}><w:body>
      <w:p><w:r><w:t>First</w:t></w:r><w:r><w:t xml:space="preserve"> para</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:p><w:r><w:t>Last</w:t></w:r></w:p></w:body></w:document>`;
    const data = buf(zipSync({ 'word/document.xml': strToU8(xml) }));
    const r = await extract('docx', data);
    expect(r.textStatus).toBe('indexed');
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0].label).toBe('Document');
    expect(r.parts[0].text.split('\n').filter(Boolean)).toEqual(['First para', 'A1', 'B1', 'Last']);
  });

  it('fails on a damaged docx', async () => {
    const r = await extract('docx', buf(strToU8('not a zip')));
    expect(r.textStatus).toBe('failed');
  });

  it('reads one part per xlsx sheet', async () => {
    const data = makeWorkbook([
      { name: 'Crew', rows: [['a', 'b'], ['c', 1]] },
      { name: 'Stores', rows: [['rope', 5]] },
    ], 'xlsx');
    const r = await extract('xlsx', data);
    expect(r.parts.map((p) => p.label)).toEqual(['Sheet Crew', 'Sheet Stores']);
    expect(r.parts[0].text).toBe('a b\nc 1');
    expect(r.parts[1].text).toBe('rope 5');
  });

  it('does not support images and other files', async () => {
    expect(await extract('image', new ArrayBuffer(4))).toMatchObject({ textStatus: 'not-supported', parts: [] });
    expect(await extract('other', new ArrayBuffer(4))).toMatchObject({ textStatus: 'not-supported', parts: [] });
  });

  it('extracts 600 pages with progress and yields', async () => {
    const pages = Array.from({ length: 600 }, (_, i) => [`${LONG} ${i + 1}`]);
    const data = buf(makePdf(pages));
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const seen: number[] = [];
    const r = await extract('pdf', data, (done, total) => { seen.push(done); expect(total).toBe(600); });
    const yields = spy.mock.calls.filter((c) => c[1] === undefined).length;
    spy.mockRestore();
    expect(r.parts).toHaveLength(600);
    expect(seen.at(-1)).toBe(600);
    expect(yields).toBeGreaterThanOrEqual(60);
  }, 30_000);
});
