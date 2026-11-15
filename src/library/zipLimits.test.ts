import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { WrongPasswordError } from '../backup/envelope';
import { deriveKey, toBase64 } from '../backup/crypto';
import { forgeZipSize } from '../test/forgeZipSize';
import { docxBlocks } from './docxBlocks';
import { extractDocx } from './extract/docx';
import { LibraryDamagedError, readLibraryPart } from './mplib';
import { DOCX_XML_MAX_BYTES, MPLIB_ENTRY_MAX_BYTES, unzipLimited } from './zipLimits';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docxXml = `<?xml version="1.0"?><w:document ${NS}><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>`;
const docx = () => zipSync({ 'word/document.xml': strToU8(docxXml) });
const ab = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

describe('archive size caps', () => {
  it('unzipLimited drops an entry that declares more than the cap', () => {
    const zip = zipSync({ a: strToU8('x') });
    expect(Object.keys(unzipLimited(zip, 10))).toEqual(['a']);
    expect(Object.keys(unzipLimited(forgeZipSize(zip, 11), 10))).toEqual([]);
  });

  it('reads a normal docx', () => {
    expect(extractDocx(ab(docx()))).toMatchObject({ textStatus: 'indexed' });
  });

  it('treats a docx whose document.xml declares more than 200 MB as damaged', () => {
    const bomb = ab(forgeZipSize(docx(), DOCX_XML_MAX_BYTES + 1));
    expect(extractDocx(bomb)).toMatchObject({ textStatus: 'failed', textError: 'Damaged document', parts: [] });
    expect(() => docxBlocks(bomb)).toThrow();
  });

  describe('a library part', () => {
    async function sealed(zip: Uint8Array): Promise<Uint8Array> {
      const salt = new Uint8Array(16).fill(1);
      const iv = new Uint8Array(12).fill(2);
      const iterations = 200_000;
      const header = strToU8(JSON.stringify({ format: 'masterpiece-library', version: 1, exportId: 'e', part: 1, parts: 1, salt: toBase64(salt), iv: toBase64(iv), iterations }));
      const key = await deriveKey('pw', salt, iterations);
      const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: header as Uint8Array<ArrayBuffer> }, key, zip as Uint8Array<ArrayBuffer>));
      return new Uint8Array([...header, 10, ...body]);
    }
    const manifest = strToU8(JSON.stringify({ docs: [{ id: 'd1' }], folders: [] }));
    const entries = { 'manifest.json': [manifest, { level: 0 }], 'files/d1': [strToU8('abc'), { level: 0 }] } as never;

    it('reads a part with small stored entries', async () => {
      const part = await readLibraryPart(await sealed(zipSync(entries, { level: 0 })), 'pw').catch((e: unknown) => e);
      expect(part).not.toBeInstanceOf(LibraryDamagedError);
      expect(part).not.toBeInstanceOf(WrongPasswordError);
    });
    it('is damaged when an entry declares more than 110 MB', async () => {
      const bomb = forgeZipSize(zipSync(entries, { level: 0 }), MPLIB_ENTRY_MAX_BYTES + 1);
      await expect(readLibraryPart(await sealed(bomb), 'pw')).rejects.toBeInstanceOf(LibraryDamagedError);
    });
    it('is damaged when an entry is deflated', async () => {
      const deflated = zipSync({ 'manifest.json': [manifest, { level: 9 }], 'files/d1': [strToU8('abc'.repeat(100)), { level: 9 }] } as never);
      await expect(readLibraryPart(await sealed(deflated), 'pw')).rejects.toBeInstanceOf(LibraryDamagedError);
    });
  });
});
