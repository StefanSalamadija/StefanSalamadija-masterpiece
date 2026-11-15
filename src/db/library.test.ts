import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allTables } from './records';
import {
  addDocument, allText, attachFile, deleteDocument, deleteFolder, findBySha, getFile, hasFiles, listDocuments, listFolders, purgeDeleted,
  restoreDocument, saveFolder, updateDocument,
} from './library';
import type { NewDocument } from './library';
import { openDb } from './schema';

// Invented content only.
const doc = (over: Partial<NewDocument> = {}): NewDocument => ({
  title: 'Pump notes', tags: ['pump'], fileName: 'pump.pdf', mimeType: 'application/pdf', kind: 'pdf', size: 3, sha256: 'sha-1', pageCount: 2,
  textStatus: 'indexed', blob: new Blob(['abc']), parts: [{ part: 1, label: 'Page 1', text: 'bilge pump' }, { part: 2, label: 'Page 2', text: 'spare seal' }],
  ...over,
});

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-01T09:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const freshDb = () => openDb('lib-' + crypto.randomUUID());

describe('addDocument', () => {
  it('writes the personal record, the file and the text rows together', async () => {
    const db = freshDb();
    const added = await addDocument(db, doc());
    expect(added).toMatchObject({ scope: 'personal', deleted: false, title: 'Pump notes', sha256: 'sha-1', addedAt: '2026-11-01T09:00:00.000Z' });
    expect(added).not.toHaveProperty('blob');
    expect(added).not.toHaveProperty('parts');
    expect(await db.libraryDocs.get(added.id)).toEqual(added);
    expect(await (await getFile(db, added.id))?.text()).toBe('abc');
    expect((await allText(db)).map((r) => [r.docId, r.part, r.label, r.text])).toEqual([
      [added.id, 1, 'Page 1', 'bilge pump'], [added.id, 2, 'Page 2', 'spare seal'],
    ]);
    expect([...(await hasFiles(db))]).toEqual([added.id]);
  });

  it('leaves nothing behind when a write fails', async () => {
    const db = freshDb();
    await db.open();
    vi.spyOn(db.libraryText, 'bulkAdd').mockRejectedValue(new Error('boom'));
    await expect(addDocument(db, doc())).rejects.toThrow('boom');
    expect(await db.libraryDocs.count()).toBe(0);
    expect(await db.libraryFiles.count()).toBe(0);
    expect(await db.libraryText.count()).toBe(0);
  });
});

describe('findBySha and listDocuments', () => {
  it('finds a live document by its hash and ignores a deleted one', async () => {
    const db = freshDb();
    const added = await addDocument(db, doc());
    expect((await findBySha(db, 'sha-1'))?.id).toBe(added.id);
    expect(await findBySha(db, 'other')).toBeUndefined();
    await deleteDocument(db, added.id, new Date());
    expect(await findBySha(db, 'sha-1')).toBeUndefined();
  });

  it('lists live documents by default and recently deleted ones on request', async () => {
    const db = freshDb();
    const a = await addDocument(db, doc({ sha256: 'a' }));
    vi.setSystemTime(new Date('2026-11-02T09:00:00Z'));
    const b = await addDocument(db, doc({ sha256: 'b' }));
    await deleteDocument(db, a.id, new Date());
    expect((await listDocuments(db)).map((d) => d.id)).toEqual([b.id]);
    expect((await listDocuments(db, { deleted: true })).map((d) => d.id)).toEqual([a.id]);
  });
});

describe('updateDocument', () => {
  it('changes the allowed fields, stamps the record and removes a field set to undefined', async () => {
    const db = freshDb();
    const added = await addDocument(db, doc({ folderId: 'f1' }));
    vi.setSystemTime(new Date('2026-11-03T09:00:00Z'));
    const updated = await updateDocument(db, added.id, { title: 'Renamed', tags: ['x', 'y'], folderId: undefined, openedAt: '2026-11-03T09:00:00.000Z' });
    expect(updated).toMatchObject({ title: 'Renamed', tags: ['x', 'y'], openedAt: '2026-11-03T09:00:00.000Z', updatedAt: '2026-11-03T09:00:00.000Z' });
    expect(updated).not.toHaveProperty('folderId');
    expect(updated.sha256).toBe('sha-1');
  });
});

describe('deleting, restoring and purging', () => {
  it('moves a document to recently deleted, keeping its file, and restores it', async () => {
    const db = freshDb();
    const added = await addDocument(db, doc());
    await deleteDocument(db, added.id, new Date('2026-11-05T00:00:00Z'));
    expect(await db.libraryDocs.get(added.id)).toMatchObject({ deleted: true, deletedAt: '2026-11-05T00:00:00.000Z' });
    expect(await getFile(db, added.id)).toBeDefined();
    await restoreDocument(db, added.id);
    const restored = await db.libraryDocs.get(added.id);
    expect(restored?.deleted).toBe(false);
    expect(restored).not.toHaveProperty('deletedAt');
  });

  it('purges after 30 days: drops the file and text, keeps the tombstone, and says how many', async () => {
    const db = freshDb();
    const added = await addDocument(db, doc());
    const keep = await addDocument(db, doc({ sha256: 'keep' }));
    const deletedAt = new Date('2026-11-01T09:00:00Z');
    await deleteDocument(db, added.id, deletedAt);
    expect(await purgeDeleted(db, new Date(deletedAt.getTime() + 29 * DAY))).toBe(0);
    expect(await getFile(db, added.id)).toBeDefined();
    expect(await purgeDeleted(db, new Date(deletedAt.getTime() + 31 * DAY))).toBe(1);
    expect(await getFile(db, added.id)).toBeUndefined();
    expect((await allText(db)).every((r) => r.docId === keep.id)).toBe(true);
    expect(await db.libraryDocs.get(added.id)).toMatchObject({ deleted: true });
    expect(await getFile(db, keep.id)).toBeDefined();
    // Nothing is left to drop the second time.
    expect(await purgeDeleted(db, new Date(deletedAt.getTime() + 32 * DAY))).toBe(0);
  });
});

describe('attachFile', () => {
  it('gives a document that has no file its file and text', async () => {
    const db = freshDb();
    const added = await addDocument(db, doc());
    await db.libraryFiles.clear();
    await db.libraryText.clear();
    expect((await hasFiles(db)).size).toBe(0);
    await attachFile(db, added.id, new Blob(['xyz']), {
      sha256: 'sha-2', pageCount: 1, textStatus: 'indexed', parts: [{ part: 1, label: 'Page 1', text: 'new text' }],
    });
    expect(await (await getFile(db, added.id))?.text()).toBe('xyz');
    expect((await allText(db)).map((r) => r.text)).toEqual(['new text']);
    expect(await db.libraryDocs.get(added.id)).toMatchObject({ sha256: 'sha-2', pageCount: 1, textStatus: 'indexed' });
    expect((await hasFiles(db)).has(added.id)).toBe(true);
  });
});

describe('folders', () => {
  it('creates, renames and lists folders by name', async () => {
    const db = freshDb();
    const b = await saveFolder(db, 'Zeta');
    await saveFolder(db, 'Alpha');
    await saveFolder(db, 'Engine', b.id);
    expect((await listFolders(db)).map((f) => f.name)).toEqual(['Alpha', 'Engine']);
    expect(b.scope).toBe('personal');
  });

  it("deleting a folder moves its documents to no folder", async () => {
    const db = freshDb();
    const folder = await saveFolder(db, 'Engine');
    const inside = await addDocument(db, doc({ folderId: folder.id }));
    const other = await addDocument(db, doc({ sha256: 'o', folderId: 'elsewhere' }));
    await deleteFolder(db, folder.id);
    expect(await db.libraryDocs.get(inside.id)).not.toHaveProperty('folderId');
    expect((await db.libraryDocs.get(other.id))?.folderId).toBe('elsewhere');
    expect(await listFolders(db)).toEqual([]);
    expect(await db.libraryFolders.get(folder.id)).toMatchObject({ deleted: true });
  });
});

describe('what is local only', () => {
  it('keeps files and text out of allTables', async () => {
    const db = freshDb();
    await addDocument(db, doc());
    const tables = await allTables(db);
    expect(tables.libraryDocs).toHaveLength(1);
    expect(tables).not.toHaveProperty('libraryFiles');
    expect(tables).not.toHaveProperty('libraryText');
  });
});
