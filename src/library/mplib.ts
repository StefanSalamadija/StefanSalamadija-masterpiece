import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { BackupError, NewerVersionError, WrongPasswordError } from '../backup/envelope';
import {
  DEFAULT_ITERATIONS, IV_BYTES, SALT_BYTES, TAG_BYTES, deriveKey, fromBase64, isBase64, isValidIterations, toBase64,
} from '../backup/crypto';
import { attachFile, findBySha, putImportedDocument } from '../db/library';
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

export interface LibraryPart { fileName: string; bytes: Uint8Array }
export interface ReadPart {
  exportId: string; part: number; parts: number; docs: LibraryDoc[]; folders: LibraryFolder[]; files: Map<string, Uint8Array>;
}

interface Header { format: string; version: number; exportId: string; part: number; parts: number; salt: string; iv: string; iterations: number }
interface Manifest { docs: LibraryDoc[]; folders: LibraryFolder[] }

function partFileName(now: Date, part: number, parts: number): string {
  return `Masterpiece-library-${now.toISOString().slice(0, 10)}-part-${part}-of-${parts}.mplib`;
}

/** Whole documents per part: a part is filled until the next document would take it over `limit` (a document alone may exceed it). */
function groupDocs(docs: LibraryDoc[], files: Map<string, Blob>, limit: number): LibraryDoc[][] {
  const groups: LibraryDoc[][] = [];
  let current: LibraryDoc[] = [];
  let size = 0;
  for (const doc of docs) {
    const bytes = files.get(doc.id)?.size ?? 0;
    if (current.length > 0 && size + bytes > limit) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(doc);
    size += bytes;
  }
  if (current.length > 0 || groups.length === 0) groups.push(current);
  return groups;
}

async function sealPart(
  docs: LibraryDoc[], folders: LibraryFolder[], files: Map<string, Blob>, password: string,
  meta: { exportId: string; part: number; parts: number; iterations: number },
): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    'manifest.json': strToU8(JSON.stringify({ docs, folders } satisfies Manifest)),
  };
  for (const doc of docs) entries[`files/${doc.id}`] = [new Uint8Array(await files.get(doc.id)!.arrayBuffer()), { level: 0 }];
  const plain = zipSync(entries, { level: 0 });
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const header = strToU8(JSON.stringify({
    format: FORMAT, version: 1, exportId: meta.exportId, part: meta.part, parts: meta.parts,
    salt: toBase64(salt), iv: toBase64(iv), iterations: meta.iterations,
  }));
  const key = await deriveKey(password, salt, meta.iterations);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: header as Uint8Array<ArrayBuffer> }, key, plain as Uint8Array<ArrayBuffer>));
  const out = new Uint8Array(header.length + 1 + sealed.length);
  out.set(header, 0);
  out[header.length] = NEWLINE;
  out.set(sealed, header.length + 1);
  return out;
}

/** The live documents that have a file, in as many parts as their sizes need. Each part has the folders. */
export async function packLibrary(
  input: { docs: LibraryDoc[]; folders: LibraryFolder[]; files: Map<string, Blob> }, password: string,
  opts: { now: Date; partBytes?: number; iterations?: number },
): Promise<LibraryPart[]> {
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  if (!isValidIterations(iterations)) throw new RangeError('iterations is out of range');
  const docs = input.docs.filter((d) => !d.deleted && input.files.has(d.id));
  const groups = groupDocs(docs, input.files, opts.partBytes ?? LIBRARY_PART_BYTES);
  const exportId = crypto.randomUUID();
  const parts: LibraryPart[] = [];
  for (const [i, group] of groups.entries()) {
    const bytes = await sealPart(group, input.folders, input.files, password, { exportId, part: i + 1, parts: groups.length, iterations });
    parts.push({ fileName: partFileName(opts.now, i + 1, groups.length), bytes });
  }
  return parts;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100_000;
}

/** The header of a library file, checked before any key is derived. */
function parseHeader(bytes: Uint8Array): { header: Header; headerBytes: Uint8Array; bodyStart: number } {
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
  if (bytes.length - end - 1 < TAG_BYTES) throw new LibraryDamagedError();
  return { header: h as unknown as Header, headerBytes, bodyStart: end + 1 };
}

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

/**
 * Merges one part into the library: folders by id (the newer wins), documents by id and then by the hash of a live document.
 * A new document is added with its file; a known one with no file gets it; one that has its file is skipped. The text of every
 * file that is added is read here, on this device.
 */
export async function importLibraryPart(
  db: MasterpieceDB, part: ReadPart, progress: (text: string) => void,
): Promise<{ added: number; attached: number; skipped: number }> {
  for (const folder of part.folders) {
    const have = await db.libraryFolders.get(folder.id);
    if (!have || (!have.deleted && newer(folder.updatedAt, have.updatedAt))) await db.libraryFolders.put(folder);
  }
  const result = { added: 0, attached: 0, skipped: 0 };
  for (const doc of part.docs) {
    const bytes = part.files.get(doc.id)!;
    const byId = await db.libraryDocs.get(doc.id);
    const known = byId ?? (await findBySha(db, doc.sha256));
    if (known?.deleted) {
      result.skipped += 1;
      continue;
    }
    const hasFile = known !== undefined && (await db.libraryFiles.get(known.id)) !== undefined;
    if (known && hasFile) {
      if (byId && newer(doc.updatedAt, known.updatedAt)) await db.libraryDocs.put(withNewerMetadata(known, doc));
      result.skipped += 1;
      continue;
    }
    progress(`Indexing ${doc.title}`);
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const read = await extract(doc.kind, data, (done, total) => progress(`Indexing ${doc.title}: page ${done} of ${total}`));
    const parts = read.parts.map((p) => ({ ...p, text: normaliseText(p.text) }));
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: doc.mimeType });
    if (!known) {
      const { pageCount: _p, textError: _e, ...rest } = doc;
      await putImportedDocument(db, {
        ...rest, sha256: await sha256Hex(data), size: bytes.byteLength, textStatus: read.textStatus,
        ...(read.pageCount !== undefined ? { pageCount: read.pageCount } : {}), ...(read.textError !== undefined ? { textError: read.textError } : {}),
      }, blob, parts);
      result.added += 1;
      continue;
    }
    if (byId && newer(doc.updatedAt, known.updatedAt)) await db.libraryDocs.put(withNewerMetadata(known, doc));
    await attachFile(db, known.id, blob, {
      sha256: await sha256Hex(data), pageCount: read.pageCount, textStatus: read.textStatus, textError: read.textError, parts,
      fileName: doc.fileName, mimeType: doc.mimeType, kind: doc.kind,
    });
    result.attached += 1;
  }
  return result;
}
