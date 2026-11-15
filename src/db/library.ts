import type { BaseRecord, LibraryDoc, LibraryFolder, LibraryKind, LibraryTextRow, TextStatus } from '../domain/types';
import { createRecord, tombstoneOf, updateRecord } from './records';
import type { MasterpieceDB } from './schema';
import { getSettings } from './settings';
import { guardWrite } from './storage';

/*
 * The knowledge library's data. A document is a small personal record (`libraryDocs`, which syncs and is in backups);
 * its file (`libraryFiles`) and its searchable text (`libraryText`) are kept on this device only. A deleted document
 * stays as a tombstone for `RETENTION_DAYS` ("recently deleted"), then `purgeDeleted` drops its file and text.
 *
 * `LibraryTextRow.text` is stored as given: the callers normalise it.
 */

/** How long a deleted document can be restored. */
export const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What `addDocument` stores: the record's fields, the file, and the text parts read from it. */
export interface NewDocument {
  title: string; folderId?: string; tags: string[]; fileName: string; mimeType: string; kind: LibraryKind;
  size: number; sha256: string; pageCount?: number; textStatus: TextStatus; textError?: string;
  blob: Blob; parts: Omit<LibraryTextRow, 'id' | 'docId'>[];
}

/** What reading a file gives: the fields of a document that come from its content. */
export type Extracted = Pick<NewDocument, 'pageCount' | 'textStatus' | 'textError' | 'parts'> & { sha256: string }
  & Partial<Pick<NewDocument, 'fileName' | 'mimeType' | 'kind'>>;

function textRows(docId: string, parts: NewDocument['parts']): LibraryTextRow[] {
  return parts.map((part, i) => ({ ...part, id: `${docId}:${i}`, docId }));
}

async function stampNow(db: MasterpieceDB): Promise<Pick<BaseRecord, 'updatedAt' | 'updatedBy'>> {
  const { deviceId } = await getSettings(db);
  return { updatedAt: new Date().toISOString(), updatedBy: deviceId };
}

/** Adds a document: its record, its file and its text rows are one transaction, so a failed write leaves nothing behind. */
export function addDocument(db: MasterpieceDB, doc: NewDocument): Promise<LibraryDoc> {
  const { blob, parts, ...fields } = doc;
  return guardWrite(() =>
    // `settings` is in the scope because `createRecord` reads the device id from it.
    db.transaction('rw', [db.libraryDocs, db.libraryFiles, db.libraryText, db.settings], async () => {
      const created = await createRecord<LibraryDoc>(db, 'libraryDocs', { ...fields, addedAt: new Date().toISOString() } as Omit<LibraryDoc, keyof BaseRecord>, { scope: 'personal' });
      await db.libraryFiles.put({ docId: created.id, blob });
      await db.libraryText.bulkAdd(textRows(created.id, parts));
      return created;
    }),
  );
}

/**
 * Adds a document that came from a library file, keeping its own id and record as it was made (unlike `addDocument`, which
 * makes a new record). The record, its file and its text rows are one transaction.
 */
export function putImportedDocument(db: MasterpieceDB, doc: LibraryDoc, blob: Blob, parts: NewDocument['parts']): Promise<void> {
  return guardWrite(() =>
    db.transaction('rw', [db.libraryDocs, db.libraryFiles, db.libraryText], async () => {
      await db.libraryDocs.put(doc);
      await db.libraryFiles.put({ docId: doc.id, blob });
      await db.libraryText.where('docId').equals(doc.id).delete();
      await db.libraryText.bulkAdd(textRows(doc.id, parts));
    }),
  );
}

/** Stores a folder from a library file as it was made (its own id and times). */
export function putImportedFolder(db: MasterpieceDB, folder: LibraryFolder): Promise<void> {
  return guardWrite(async () => { await db.libraryFolders.put(folder); });
}

/** Stores a document record from a library file as it was made, without its file. */
export function putImportedMetadata(db: MasterpieceDB, doc: LibraryDoc): Promise<void> {
  return guardWrite(async () => { await db.libraryDocs.put(doc); });
}

/** The documents that are live (the default) or the recently deleted ones, newest first (by when added, or deleted). */
export async function listDocuments(db: MasterpieceDB, opts: { deleted?: boolean } = {}): Promise<LibraryDoc[]> {
  const wanted = opts.deleted === true;
  const docs = await db.libraryDocs.filter((d) => d.deleted === wanted).toArray();
  const key = (d: LibraryDoc): string => (wanted ? (d.deletedAt ?? d.updatedAt) : d.addedAt);
  return docs.sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
}

/** A live document with this content, if there is one: a deleted document does not count. */
export function findBySha(db: MasterpieceDB, sha256: string): Promise<LibraryDoc | undefined> {
  return db.libraryDocs.where('sha256').equals(sha256).filter((d) => !d.deleted).first();
}

/** Changes a live document's title, folder, tags or last-opened time. A field set to `undefined` is removed. */
export function updateDocument(
  db: MasterpieceDB, id: string, patch: Partial<Pick<LibraryDoc, 'title' | 'folderId' | 'tags' | 'openedAt'>>,
): Promise<LibraryDoc> {
  const { title, folderId, tags, openedAt } = patch;
  const allowed = Object.fromEntries(Object.entries({ title, folderId, tags, openedAt }).filter(([key]) => key in patch));
  return updateRecord<LibraryDoc>(db, 'libraryDocs', id, allowed);
}

/** Moves a document to "recently deleted". Its file and text stay until `purgeDeleted`. Deleting it again keeps the first time. */
export async function deleteDocument(db: MasterpieceDB, id: string, now: Date): Promise<void> {
  await guardWrite(() =>
    db.transaction('rw', [db.libraryDocs, db.settings], async () => {
      const doc = await db.libraryDocs.get(id);
      if (!doc) throw new Error(`There is no library document with id ${id}.`);
      if (doc.deleted) return;
      await db.libraryDocs.put({ ...tombstoneOf('libraryDocs', doc, await stampNow(db)), deletedAt: now.toISOString() });
    }),
  );
}

/** Brings a recently deleted document back. */
export async function restoreDocument(db: MasterpieceDB, id: string): Promise<void> {
  await guardWrite(() =>
    db.transaction('rw', [db.libraryDocs, db.settings], async () => {
      const doc = await db.libraryDocs.get(id);
      if (!doc) throw new Error(`There is no library document with id ${id}.`);
      if (!doc.deleted) return;
      const { deletedAt: _gone, ...rest } = doc;
      await db.libraryDocs.put({ ...rest, deleted: false, ...(await stampNow(db)) });
    }),
  );
}

/**
 * Drops the file and the text of the documents deleted more than `RETENTION_DAYS` ago. The tombstone stays, so the
 * deletion still reaches other devices. Returns how many documents it dropped something for.
 */
export function purgeDeleted(db: MasterpieceDB, now: Date): Promise<number> {
  const cutoff = now.getTime() - RETENTION_DAYS * DAY_MS;
  return guardWrite(() =>
    db.transaction('rw', [db.libraryDocs, db.libraryFiles, db.libraryText], async () => {
      const expired = await db.libraryDocs
        .filter((d) => d.deleted && d.deletedAt !== undefined && Date.parse(d.deletedAt) < cutoff).toArray();
      let purged = 0;
      for (const doc of expired) {
        const hadFile = (await db.libraryFiles.get(doc.id)) !== undefined;
        const texts = await db.libraryText.where('docId').equals(doc.id).primaryKeys();
        if (!hadFile && texts.length === 0) continue;
        await db.libraryFiles.delete(doc.id);
        await db.libraryText.bulkDelete(texts);
        purged += 1;
      }
      return purged;
    }),
  );
}

/**
 * "Delete now": drops a deleted document's file and text at once, and dates its deletion beyond the retention period so
 * that it no longer shows in "recently deleted". The tombstone stays, so the deletion still reaches other devices.
 */
export function purgeDocument(db: MasterpieceDB, id: string, now: Date): Promise<void> {
  return guardWrite(() =>
    db.transaction('rw', [db.libraryDocs, db.libraryFiles, db.libraryText, db.settings], async () => {
      const doc = await db.libraryDocs.get(id);
      if (!doc?.deleted) throw new Error(`There is no recently deleted library document with id ${id}.`);
      await db.libraryFiles.delete(id);
      await db.libraryText.where('docId').equals(id).delete();
      const expired = new Date(now.getTime() - (RETENTION_DAYS + 1) * DAY_MS).toISOString();
      await db.libraryDocs.put({ ...doc, deletedAt: expired, ...(await stampNow(db)) });
    }),
  );
}

/**
 * Gives a document that has no file here (its record came from another device) its file, and the text and facts read
 * from it (its size, and the file name, type and kind when given). The text rows it had are replaced.
 */
export function attachFile(
  db: MasterpieceDB, id: string, blob: Blob, extracted: Extracted, meta?: { title: string; tags: string[]; folderId?: string },
): Promise<void> {
  const { parts, sha256, pageCount, textStatus, textError, fileName, mimeType, kind } = extracted;
  return guardWrite(() =>
    db.transaction('rw', [db.libraryDocs, db.libraryFiles, db.libraryText, db.settings], async () => {
      const doc = await db.libraryDocs.get(id);
      if (!doc || doc.deleted) throw new Error(`There is no library document with id ${id}.`);
      await db.libraryFiles.put({ docId: id, blob });
      await db.libraryText.where('docId').equals(id).delete();
      await db.libraryText.bulkAdd(textRows(id, parts));
      const { pageCount: _p, textError: _e, ...kept } = doc;
      // With `meta` (newer details from a library file) the title, tags and folder change in the same transaction.
      const { folderId: _f, ...unfiled } = kept;
      const rest = meta ? { ...unfiled, title: meta.title, tags: meta.tags, ...(meta.folderId !== undefined ? { folderId: meta.folderId } : {}) } : kept;
      await db.libraryDocs.put({
        ...rest, sha256, textStatus, size: blob.size, ...(fileName !== undefined ? { fileName } : {}),
        ...(mimeType !== undefined ? { mimeType } : {}), ...(kind !== undefined ? { kind } : {}), ...(pageCount !== undefined ? { pageCount } : {}), ...(textError !== undefined ? { textError } : {}),
        ...(await stampNow(db)),
      });
    }),
  );
}

export async function getFile(db: MasterpieceDB, id: string): Promise<Blob | undefined> {
  return (await db.libraryFiles.get(id))?.blob;
}

/** The ids of the documents whose file is on this device. */
export async function hasFiles(db: MasterpieceDB): Promise<Set<string>> {
  return new Set(await db.libraryFiles.toCollection().primaryKeys());
}

/** Every text row, for building the search index. */
export function allText(db: MasterpieceDB): Promise<LibraryTextRow[]> {
  return db.libraryText.toArray();
}

export function listFolders(db: MasterpieceDB): Promise<LibraryFolder[]> {
  return db.libraryFolders.filter((f) => !f.deleted).toArray().then((folders) => folders.sort((a, b) => a.name.localeCompare(b.name)));
}

/** Creates a folder, or renames the one with `id`. */
export function saveFolder(db: MasterpieceDB, name: string, id?: string): Promise<LibraryFolder> {
  const trimmed = name.trim();
  if (trimmed === '') return Promise.reject(new Error('A folder needs a name.'));
  if (id) return updateRecord<LibraryFolder>(db, 'libraryFolders', id, { name: trimmed });
  return createRecord<LibraryFolder>(db, 'libraryFolders', { name: trimmed } as Omit<LibraryFolder, keyof BaseRecord>, { scope: 'personal' });
}

/** Deletes a folder; the documents in it (deleted ones too) are kept and move to no folder. */
export async function deleteFolder(db: MasterpieceDB, id: string): Promise<void> {
  await guardWrite(() =>
    db.transaction('rw', [db.libraryFolders, db.libraryDocs, db.settings], async () => {
      const folder = await db.libraryFolders.get(id);
      if (!folder) throw new Error(`There is no library folder with id ${id}.`);
      const stamp = await stampNow(db);
      if (!folder.deleted) await db.libraryFolders.put(tombstoneOf('libraryFolders', folder, stamp));
      const inside = await db.libraryDocs.where('folderId').equals(id).toArray();
      await db.libraryDocs.bulkPut(inside.map(({ folderId: _f, ...rest }) => ({ ...rest, ...stamp })));
    }),
  );
}
