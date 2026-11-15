import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { BackupError, NewerVersionError, WrongPasswordError } from '../backup/envelope';
import {
  DEFAULT_ITERATIONS, IV_BYTES, SALT_BYTES, TAG_BYTES, deriveKey, fromBase64, isBase64, isValidIterations, toBase64,
} from '../backup/crypto';
import { attachFile, findBySha, putImportedDocument, putImportedFolder, putImportedMetadata } from '../db/library';
import type { MasterpieceDB } from '../db/schema';
import type { LibraryDoc, LibraryFolder } from '../domain/types';
import { extract, sha256Hex } from './extract';
import { normaliseText } from './search';

/*
 * Library files (`.mplib`): the library's documents, encrypted, in parts that are each small enough to share. A part is one
 * header line of JSON, a newline, then the AES-GCM ciphertext of a stored (not compressed: the documents are already
 * compressed) zip that holds `manifest.json` and `files/<docId>`. The header line is authenticated, so it cannot be changed.
 * A document is whole in one part; the folders are in every part, so that any part can be imported on its own, in any order.
 */

export const LIBRARY_PART_BYTES = 100 * 1024 * 1024;
const FORMAT = 'masterpiece-library';
const MAX_HEADER_BYTES = 1024;
const NEWLINE = 10;

export class NotALibraryFileError extends BackupError {
  constructor() { super('This is not a Masterpiece library file.', 'NotALibraryFileError'); }
}
export class LibraryDamagedError extends BackupError {
  constructor() { super("The file is damaged and can't be read. Nothing was changed.", 'LibraryDamagedError'); }
}

export interface LibraryPart { fileName: string; blob: Blob }
export interface ReadPart {
  exportId: string; part: number; parts: number; docs: LibraryDoc[]; folders: LibraryFolder[]; files: Map<string, Uint8Array>;
}
/** Which documents go in which part (`parts[n - 1]` holds the ids of part n). Made without reading any file. */
export interface LibraryPlan { exportId: string; parts: string[][] }

interface Header { format: string; version: number; exportId: string; part: number; parts: number; salt: string; iv: string; iterations: number }
interface Manifest { docs: LibraryDoc[]; folders: LibraryFolder[] }

function partFileName(now: Date, part: number, parts: number): string {
  return `Masterpiece-library-${now.toISOString().slice(0, 10)}-part-${part}-of-${parts}.mplib`;
}

/**
 * Splits the live documents that have a file (`withFile`) into parts of whole documents: a part is filled until the next
 * document would take it over `partBytes` (a document alone may exceed it). Nothing is read; the sizes are the records'.
 */
export function planLibraryParts(docs: LibraryDoc[], withFile: Set<string>, opts: { partBytes?: number } = {}): LibraryPlan {
  const limit = opts.partBytes ?? LIBRARY_PART_BYTES;
  const parts: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const doc of docs) {
    if (doc.deleted || !withFile.has(doc.id)) continue;
    if (current.length > 0 && size + doc.size > limit) {
      parts.push(current);
      current = [];
      size = 0;
    }
    current.push(doc.id);
    size += doc.size;
  }
  if (current.length > 0 || parts.length === 0) parts.push(current);
  return { exportId: crypto.randomUUID(), parts };
}

/** The zip of one part. Its own function, so the file copies are gone before the encryption starts. */
async function zipPart(docs: LibraryDoc[], folders: LibraryFolder[], getFile: (id: string) => Promise<Blob | undefined>): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    'manifest.json': strToU8(JSON.stringify({ docs, folders } satisfies Manifest)),
  };
  for (const doc of docs) {
    const blob = await getFile(doc.id);
    if (!blob) throw new Error(`The file of ${doc.title} is missing.`);
    entries[`files/${doc.id}`] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }
  return zipSync(entries, { level: 0 });
}

/**
 * Makes part `n` (from 1) of `plan`: reads only that part's files, and returns the part as a Blob. The caller makes the parts
 * one at a time, so only the one being saved is in memory.
 */
export async function packLibraryPart(
  plan: LibraryPlan, n: number,
  input: { docs: LibraryDoc[]; folders: LibraryFolder[]; getFile: (id: string) => Promise<Blob | undefined> },
  password: string, opts: { now: Date; iterations?: number },
): Promise<LibraryPart> {
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  if (!isValidIterations(iterations)) throw new RangeError('iterations is out of range');
  const ids = plan.parts[n - 1];
  if (!ids) throw new RangeError('There is no such part.');
  const byId = new Map(input.docs.map((d) => [d.id, d]));
  const docs = ids.map((id) => byId.get(id)!);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const header = strToU8(JSON.stringify({
    format: FORMAT, version: 1, exportId: plan.exportId, part: n, parts: plan.parts.length,
    salt: toBase64(salt), iv: toBase64(iv), iterations,
  }));
  const key = await deriveKey(password, salt, iterations);
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: header as Uint8Array<ArrayBuffer> }, key, (await zipPart(docs, input.folders, input.getFile)) as Uint8Array<ArrayBuffer>,
  );
  return { fileName: partFileName(opts.now, n, plan.parts.length), blob: new Blob([header as Uint8Array<ArrayBuffer>, '\n', sealed]) };
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100_000;
}

/** The header of a library file, checked before any key is derived. */
function parseHeader(bytes: Uint8Array, headOnly = false): { header: Header; headerBytes: Uint8Array; bodyStart: number } {
  const end = bytes.subarray(0, MAX_HEADER_BYTES).indexOf(NEWLINE);
  if (end < 0) throw new NotALibraryFileError();
  const headerBytes = bytes.subarray(0, end);
  let value: unknown;
  try {
    value = JSON.parse(strFromU8(headerBytes));
  } catch {
    throw new NotALibraryFileError();
  }
  if (typeof value !== 'object' || value === null || (value as { format?: unknown }).format !== FORMAT) throw new NotALibraryFileError();
  const h = value as Record<string, unknown>;
  if (typeof h.version === 'number' && h.version > 1) throw new NewerVersionError();
  const valid = h.version === 1 && typeof h.exportId === 'string' && isCount(h.part) && isCount(h.parts) && h.part <= h.parts
    && typeof h.salt === 'string' && isBase64(h.salt) && fromBase64(h.salt).length === SALT_BYTES
    && typeof h.iv === 'string' && isBase64(h.iv) && fromBase64(h.iv).length === IV_BYTES && isValidIterations(h.iterations);
  if (!valid) throw new NotALibraryFileError();
  if (!headOnly && bytes.length - end - 1 < TAG_BYTES) throw new LibraryDamagedError();
  return { header: h as unknown as Header, headerBytes, bodyStart: end + 1 };
}

/** Checks the first bytes of a file (`MAX_HEADER_BYTES` are enough) before the rest is read: throws if it is not a part of a library. */
export function checkLibraryHeader(head: Uint8Array): void {
  parseHeader(head, true);
}
export const LIBRARY_HEADER_BYTES = MAX_HEADER_BYTES;

/** Opens one part. Throws `NotALibraryFileError` for another kind of file, `WrongPasswordError` for a wrong password or an altered part. */
export async function readLibraryPart(bytes: Uint8Array, password: string): Promise<ReadPart> {
  const { header, headerBytes, bodyStart } = parseHeader(bytes);
  let plain: Uint8Array;
  try {
    const key = await deriveKey(password, fromBase64(header.salt), header.iterations);
    plain = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(header.iv), additionalData: headerBytes as Uint8Array<ArrayBuffer> },
      key, bytes.subarray(bodyStart) as Uint8Array<ArrayBuffer>,
    ));
  } catch {
    throw new WrongPasswordError();
  }
  try {
    const entries = unzipSync(plain);
    const manifest = JSON.parse(strFromU8(entries['manifest.json']!)) as Manifest;
    if (!Array.isArray(manifest.docs) || !Array.isArray(manifest.folders)) throw new Error('manifest');
    const files = new Map<string, Uint8Array>();
    for (const doc of manifest.docs) {
      const data = entries[`files/${doc.id}`];
      if (!data || typeof doc.id !== 'string') throw new Error('file');
      files.set(doc.id, data);
    }
    return { exportId: header.exportId, part: header.part, parts: header.parts, docs: manifest.docs, folders: manifest.folders, files };
  } catch {
    throw new LibraryDamagedError();
  }
}

function newer(a: string, b: string): boolean {
  return a > b;
}

/** Title, folder and tags of `incoming` onto `existing`, when `incoming` is newer. File facts (hash, size, kind) stay what this device has. */
function withNewerMetadata(existing: LibraryDoc, incoming: LibraryDoc): LibraryDoc {
  const { folderId: _f, ...rest } = existing;
  return {
    ...rest, title: incoming.title, tags: incoming.tags, updatedAt: incoming.updatedAt, updatedBy: incoming.updatedBy,
    ...(incoming.folderId !== undefined ? { folderId: incoming.folderId } : {}),
  };
}

/** A part that failed half way: what it had done by then, for the report. The documents done stay, and importing again does the rest. */
export class PartialImportError extends Error {
  constructor(readonly counts: { added: number; attached: number; skipped: number }, cause: unknown) {
    super(cause instanceof Error && cause.message !== '' ? cause.message : 'The import stopped.', { cause });
    this.name = 'PartialImportError';
  }
}

/**
 * Merges one part into the library: folders by id (the newer `updatedAt` wins, a deletion included), documents by id and
 * then by the hash of a live document. A new document is added with its file; a known one with no file gets it; one that has
 * its file is skipped. A deleted document comes back only when the incoming record is newer than its deletion. The text of
 * every file that is added is read here, on this device. If a document fails, `PartialImportError` says what was done.
 */
export async function importLibraryPart(
  db: MasterpieceDB, part: ReadPart, progress: (text: string) => void,
): Promise<{ added: number; attached: number; skipped: number }> {
  const result = { added: 0, attached: 0, skipped: 0 };
  try {
    for (const folder of part.folders) {
      const have = await db.libraryFolders.get(folder.id);
      if (!have || newer(folder.updatedAt, have.updatedAt)) await putImportedFolder(db, folder);
    }
    for (const doc of part.docs) {
      const bytes = part.files.get(doc.id)!;
      const byId = await db.libraryDocs.get(doc.id);
      const known = byId ?? (await findBySha(db, doc.sha256));
      const revive = known?.deleted === true && newer(doc.updatedAt, known.updatedAt);
      if (known?.deleted && !revive) {
        result.skipped += 1;
        continue;
      }
      const hasFile = known !== undefined && !revive && (await db.libraryFiles.get(known.id)) !== undefined;
      if (known && hasFile) {
        if (byId && newer(doc.updatedAt, known.updatedAt)) await putImportedMetadata(db, withNewerMetadata(known, doc));
        result.skipped += 1;
        continue;
      }
      progress(`Indexing ${doc.title}`);
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const read = await extract(doc.kind, data, (done, total) => progress(`Indexing ${doc.title}: page ${done} of ${total}`));
      const parts = read.parts.map((p) => ({ ...p, text: normaliseText(p.text) }));
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: doc.mimeType });
      const sha256 = await sha256Hex(data);
      if (!known || revive) {
        const { pageCount: _p, textError: _e, deletedAt: _d, ...rest } = doc;
        await putImportedDocument(db, {
          ...rest, sha256, size: bytes.byteLength, textStatus: read.textStatus,
          ...(read.pageCount !== undefined ? { pageCount: read.pageCount } : {}), ...(read.textError !== undefined ? { textError: read.textError } : {}),
        }, blob, parts);
        result.added += 1;
        continue;
      }
      const meta = byId && newer(doc.updatedAt, known.updatedAt) ? { title: doc.title, tags: doc.tags, folderId: doc.folderId } : undefined;
      await attachFile(db, known.id, blob, {
        sha256, pageCount: read.pageCount, textStatus: read.textStatus, textError: read.textError, parts,
        fileName: doc.fileName, mimeType: doc.mimeType, kind: doc.kind,
      }, meta);
      result.attached += 1;
    }
  } catch (err) {
    throw new PartialImportError(result, err);
  }
  return result;
}
