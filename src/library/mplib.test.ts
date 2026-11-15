import { describe, expect, it, vi } from 'vitest';
import { WrongPasswordError } from '../backup/envelope';
import { addDocument, allText, getFile, hasFiles, listDocuments, listFolders, saveFolder } from '../db/library';
import { openDb } from '../db/schema';
import type { MasterpieceDB } from '../db/schema';
import { sha256Hex } from './extract';
import { importLibraryPart, NotALibraryFileError, packLibrary, readLibraryPart } from './mplib';

const freshDb = () => openDb('mplib-' + crypto.randomUUID());
const PASSWORD = 'correct horse';
const FAST = { iterations: 1000 };
const NOW = new Date('2026-11-15T10:00:00Z');

function bytesOf(seed: number, size = 1000): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = (i * 31 + seed * 17) % 251;
  return out;
}

async function seed(db: MasterpieceDB, names: string[]): Promise<void> {
  for (const [i, name] of names.entries()) {
    const bytes = bytesOf(i + 1);
    await addDocument(db, {
      title: name, tags: ['t' + i], fileName: name + '.bin', mimeType: 'application/octet-stream', kind: 'other', size: bytes.length,
      sha256: await sha256Hex(bytes.buffer), textStatus: 'not-supported', blob: new Blob([bytes]), parts: [],
    });
  }
}

async function packAll(db: MasterpieceDB, partBytes?: number) {
  const docs = await listDocuments(db);
  const files = new Map<string, Blob>();
  for (const d of docs) files.set(d.id, (await getFile(db, d.id))!);
  return packLibrary({ docs, folders: await listFolders(db), files }, PASSWORD, { now: NOW, partBytes, ...FAST });
}

describe('mplib', () => {
  it('round-trips 3 documents in 2 parts, each part readable on its own', async () => {
    const db = await freshDb();
    await saveFolder(db, 'Engine room');
    await seed(db, ['One', 'Two', 'Three']);
    const parts = await packAll(db, 2500);
    expect(parts).toHaveLength(2);
    expect(parts.map((p) => p.fileName)).toEqual([
      'Masterpiece-library-2026-11-15-part-1-of-2.mplib', 'Masterpiece-library-2026-11-15-part-2-of-2.mplib',
    ]);
    const read = await Promise.all(parts.map((p) => readLibraryPart(p.bytes, PASSWORD)));
    expect(read.map((r) => [r.part, r.parts])).toEqual([[1, 2], [2, 2]]);
    expect(read[0]!.exportId).toBe(read[1]!.exportId);
    expect(read.flatMap((r) => r.docs)).toHaveLength(3);
    expect(read.every((r) => r.folders.length === 1)).toBe(true);
    for (const r of read) for (const d of r.docs) expect(r.files.get(d.id)).toHaveLength(1000);

    const target = await freshDb();
    for (const r of read) await importLibraryPart(target, r, vi.fn());
    expect((await listDocuments(target)).map((d) => d.title).sort()).toEqual(['One', 'Three', 'Two']);
    expect((await hasFiles(target)).size).toBe(3);
    expect(await listFolders(target)).toHaveLength(1);
  });

  it('writes the header line and a stored zip', async () => {
    const db = await freshDb();
    await seed(db, ['One']);
    const [part] = await packAll(db);
    const nl = part!.bytes.indexOf(10);
    const header = JSON.parse(new TextDecoder().decode(part!.bytes.slice(0, nl)));
    expect(header).toMatchObject({ format: 'masterpiece-library', version: 1, part: 1, parts: 1, iterations: 1000 });
    expect(Object.keys(header).sort()).toEqual(['exportId', 'format', 'iterations', 'iv', 'part', 'parts', 'salt', 'version']);
  });

  it('a wrong password throws WrongPasswordError, a tampered byte too, and a stranger file is not a library file', async () => {
    const db = await freshDb();
    await seed(db, ['One']);
    const [part] = await packAll(db);
    await expect(readLibraryPart(part!.bytes, 'wrong password')).rejects.toBeInstanceOf(WrongPasswordError);
    const tampered = part!.bytes.slice();
    tampered[tampered.length - 20]! ^= 1;
    await expect(readLibraryPart(tampered, PASSWORD)).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(readLibraryPart(new TextEncoder().encode('hello world'), PASSWORD)).rejects.toThrow('This is not a Masterpiece library file.');
    await expect(readLibraryPart(new TextEncoder().encode('{"format":"masterpiece-backup"}\nxx'), PASSWORD)).rejects.toBeInstanceOf(NotALibraryFileError);
  });

  it('importing part 2 before part 1 ends with every document and file; a part twice adds nothing', async () => {
    const db = await freshDb();
    await seed(db, ['One', 'Two', 'Three']);
    const parts = await packAll(db, 2500);
    const target = await freshDb();
    const second = await readLibraryPart(parts[1]!.bytes, PASSWORD);
    const first = await readLibraryPart(parts[0]!.bytes, PASSWORD);
    expect(await importLibraryPart(target, second, vi.fn())).toEqual({ added: 1, attached: 0, skipped: 0 });
    expect(await importLibraryPart(target, first, vi.fn())).toEqual({ added: 2, attached: 0, skipped: 0 });
    expect(await importLibraryPart(target, first, vi.fn())).toEqual({ added: 0, attached: 0, skipped: 2 });
    expect(await listDocuments(target)).toHaveLength(3);
    expect((await hasFiles(target)).size).toBe(3);
    const doc = (await listDocuments(target))[0]!;
    expect(new Uint8Array(await (await getFile(target, doc.id))!.arrayBuffer())).toHaveLength(1000);
  });

  it('attaches the file to a document that came without one, and a newer title wins', async () => {
    const db = await freshDb();
    await seed(db, ['One']);
    const [part] = await packAll(db);
    const r = await readLibraryPart(part!.bytes, PASSWORD);
    const target = await freshDb();
    // As if restored from a backup: the record is there, its file is not.
    const old = { ...r.docs[0]!, title: 'Old title', updatedAt: '2020-01-01T00:00:00.000Z' };
    await target.libraryDocs.put(old);
    expect(await importLibraryPart(target, r, vi.fn())).toEqual({ added: 0, attached: 1, skipped: 0 });
    const [doc] = await listDocuments(target);
    expect(doc!.title).toBe('One');
    expect((await hasFiles(target)).has(doc!.id)).toBe(true);
    expect(await allText(target)).toEqual([]);
  });

  it('matches a document of another id by its sha256 and does not add it twice', async () => {
    const db = await freshDb();
    await seed(db, ['One']);
    const [part] = await packAll(db);
    const r = await readLibraryPart(part!.bytes, PASSWORD);
    const target = await freshDb();
    await seed(target, ['Same bytes']);
    expect(await importLibraryPart(target, r, vi.fn())).toEqual({ added: 0, attached: 0, skipped: 1 });
    expect(await listDocuments(target)).toHaveLength(1);
  });

  it('a document with no file is left out of the export', async () => {
    const db = await freshDb();
    await seed(db, ['One', 'Two']);
    const docs = await listDocuments(db);
    const files = new Map([[docs[0]!.id, (await getFile(db, docs[0]!.id))!]]);
    const parts = await packLibrary({ docs, folders: [], files }, PASSWORD, { now: NOW, ...FAST });
    expect((await readLibraryPart(parts[0]!.bytes, PASSWORD)).docs).toHaveLength(1);
  });
});
