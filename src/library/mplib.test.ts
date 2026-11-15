import { describe, expect, it, vi } from 'vitest';
import { WrongPasswordError } from '../backup/envelope';
import { addDocument, allText, getFile, hasFiles, listDocuments, listFolders, saveFolder } from '../db/library';
import { openDb } from '../db/schema';
import type { MasterpieceDB } from '../db/schema';
import { sha256Hex } from './extract';
import {
  importLibraryPart, LibraryDamagedError, NotALibraryFileError, packLibraryPart, PartialImportError, planLibraryParts, readLibraryPart,
} from './mplib';
import { BackupError } from '../backup/envelope';

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

/** Every part of the library, made one after another the way the screen does. */
async function packAll(db: MasterpieceDB, partBytes?: number, withFile?: Set<string>) {
  const docs = await listDocuments(db);
  const plan = planLibraryParts(docs, withFile ?? new Set(docs.map((d) => d.id)), { partBytes });
  const folders = await listFolders(db);
  const out: { fileName: string; bytes: Uint8Array }[] = [];
  for (let n = 1; n <= plan.parts.length; n++) {
    const part = await packLibraryPart(plan, n, { docs, folders, getFile: (id) => getFile(db, id) }, PASSWORD, { now: NOW, ...FAST });
    out.push({ fileName: part.fileName, bytes: new Uint8Array(await part.blob.arrayBuffer()) });
  }
  return out;
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
    const parts = await packAll(db, undefined, new Set([docs[0]!.id]));
    expect((await readLibraryPart(parts[0]!.bytes, PASSWORD)).docs).toHaveLength(1);
  });

  it('plans whole documents per part without reading a file', async () => {
    const db = await freshDb();
    await seed(db, ['One', 'Two', 'Three']);
    const docs = await listDocuments(db);
    const ids = new Set(docs.map((d) => d.id));
    expect(planLibraryParts(docs, ids, { partBytes: 2500 }).parts.map((p) => p.length).sort()).toEqual([1, 2]);
    expect(planLibraryParts(docs, ids, { partBytes: 1 }).parts).toHaveLength(3);
    expect(planLibraryParts(docs, ids).parts).toHaveLength(1);
  });

  it('a deleted document comes back only when the incoming record is newer than its deletion', async () => {
    const db = await freshDb();
    await seed(db, ['One']);
    const [part] = await packAll(db);
    const r = await readLibraryPart(part!.bytes, PASSWORD);
    const incoming = r.docs[0]!;
    const older = await freshDb();
    await older.libraryDocs.put({ ...incoming, deleted: true, deletedAt: '2030-01-01T00:00:00.000Z', updatedAt: '2030-01-01T00:00:00.000Z' });
    expect(await importLibraryPart(older, r, vi.fn())).toEqual({ added: 0, attached: 0, skipped: 1 });
    expect(await listDocuments(older)).toHaveLength(0);
    expect((await hasFiles(older)).size).toBe(0);
    const newerDb = await freshDb();
    await newerDb.libraryDocs.put({ ...incoming, deleted: true, deletedAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z' });
    expect(await importLibraryPart(newerDb, r, vi.fn())).toEqual({ added: 1, attached: 0, skipped: 0 });
    const [doc] = await listDocuments(newerDb);
    expect(doc).toMatchObject({ id: incoming.id, deleted: false });
    expect(doc!.deletedAt).toBeUndefined();
    expect((await hasFiles(newerDb)).has(incoming.id)).toBe(true);
  });

  it('a folder follows the newer updatedAt, a deletion included', async () => {
    const db = await freshDb();
    const folder = await saveFolder(db, 'Engine room');
    await seed(db, ['One']);
    const [part] = await packAll(db);
    const r = await readLibraryPart(part!.bytes, PASSWORD);
    const target = await freshDb();
    await target.libraryFolders.put({ ...folder, deleted: true, updatedAt: '2099-01-01T00:00:00.000Z' });
    await importLibraryPart(target, r, vi.fn());
    expect(await listFolders(target)).toHaveLength(0);
    await target.libraryFolders.put({ ...folder, deleted: true, updatedAt: '2000-01-01T00:00:00.000Z' });
    await importLibraryPart(target, r, vi.fn());
    expect((await listFolders(target)).map((f) => f.name)).toEqual(['Engine room']);
  });

  it('a part that fails half way reports what it did, and importing it again completes', async () => {
    const db = await freshDb();
    await seed(db, ['One', 'Two', 'Three']);
    const [part] = await packAll(db);
    const r = await readLibraryPart(part!.bytes, PASSWORD);
    const target = await freshDb();
    const put = target.libraryFiles.put.bind(target.libraryFiles);
    let calls = 0;
    const spy = vi.spyOn(target.libraryFiles, 'put').mockImplementation(((...args: Parameters<typeof put>) => {
      calls += 1;
      return calls === 2 ? Promise.reject(new Error('disk exploded')) : put(...args);
    }) as never);
    const failure = await importLibraryPart(target, r, vi.fn()).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(PartialImportError);
    expect((failure as PartialImportError).counts).toEqual({ added: 1, attached: 0, skipped: 0 });
    expect((failure as Error).message).toBe('disk exploded');
    expect(await listDocuments(target)).toHaveLength(1);
    expect((await hasFiles(target)).size).toBe(1);
    spy.mockRestore();
    expect(await importLibraryPart(target, r, vi.fn())).toEqual({ added: 2, attached: 0, skipped: 1 });
    expect((await hasFiles(target)).size).toBe(3);
  });

  describe('a header that is not right', () => {
    async function validPart(): Promise<{ header: Record<string, unknown>; body: Uint8Array }> {
      const db = await freshDb();
      await seed(db, ['One']);
      const [part] = await packAll(db);
      const nl = part!.bytes.indexOf(10);
      return { header: JSON.parse(new TextDecoder().decode(part!.bytes.slice(0, nl))), body: part!.bytes.slice(nl + 1) };
    }
    const file = (header: string, body: Uint8Array) => {
      const head = new TextEncoder().encode(header + '\n');
      const out = new Uint8Array(head.length + body.length);
      out.set(head);
      out.set(body, head.length);
      return out;
    };

    it.each([
      ['iterations too low', { iterations: 10 }],
      ['iterations too high', { iterations: 99_000_000 }],
      ['part after parts', { part: 3, parts: 2 }],
      ['part 0', { part: 0 }],
      ['no exportId', { exportId: undefined }],
      ['salt of the wrong size', { salt: 'AAAA' }],
    ])('%s is not a library file', async (_name, change) => {
      const { header, body } = await validPart();
      await expect(readLibraryPart(file(JSON.stringify({ ...header, ...change }), body), PASSWORD)).rejects.toBeInstanceOf(NotALibraryFileError);
    });

    it('version 2 is refused with its own message, not opened', async () => {
      const { header, body } = await validPart();
      const err = await readLibraryPart(file(JSON.stringify({ ...header, version: 2 }), body), PASSWORD).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BackupError);
      expect(err).not.toBeInstanceOf(WrongPasswordError);
    });

    it('no newline, or a header over 1 KB, is not a library file', async () => {
      const { header, body } = await validPart();
      const json = JSON.stringify(header);
      await expect(readLibraryPart(new TextEncoder().encode(json), PASSWORD)).rejects.toBeInstanceOf(NotALibraryFileError);
      await expect(readLibraryPart(file(json + ' '.repeat(1100), body), PASSWORD)).rejects.toBeInstanceOf(NotALibraryFileError);
    });

    it('a body that is cut short is damaged', async () => {
      const { header, body } = await validPart();
      await expect(readLibraryPart(file(JSON.stringify(header), body.slice(0, 5)), PASSWORD)).rejects.toBeInstanceOf(LibraryDamagedError);
      await expect(readLibraryPart(file(JSON.stringify(header), body.slice(0, body.length - 100)), PASSWORD)).rejects.toBeInstanceOf(WrongPasswordError);
    });
  });
});
