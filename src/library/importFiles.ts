import { addDocument, findBySha } from '../db/library';
import type { MasterpieceDB } from '../db/schema';
import type { LibraryDoc } from '../domain/types';
import { describeError } from '../app/errors';
import { extract, kindOf, sha256Hex } from './extract';
import { normaliseText } from './search';

/** The biggest file the library takes. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export interface ImportHooks {
  /** A file with the same content is already in the library: true adds it anyway. */
  confirmDuplicate(title: string): Promise<boolean>;
  progress(text: string): void;
}

export interface ImportResult {
  added: LibraryDoc[];
  failed: { name: string; message: string }[];
}

/** A file name without its extension. */
export function titleOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return (dot > 0 ? fileName.slice(0, dot) : fileName).trim() || fileName;
}

/**
 * Imports files one after another: reads and indexes each on this device and stores it. A file that cannot be stored is
 * listed in `failed` and the rest go on; a duplicate that is declined is skipped silently.
 */
export async function importFiles(db: MasterpieceDB, files: File[], hooks: ImportHooks): Promise<ImportResult> {
  const result: ImportResult = { added: [], failed: [] };
  for (const file of files) {
    const title = titleOf(file.name);
    if (file.size > MAX_FILE_BYTES) {
      result.failed.push({ name: file.name, message: `${file.name} is over 100 MB` });
      continue;
    }
    try {
      const data = await file.arrayBuffer();
      const sha256 = await sha256Hex(data);
      const existing = await findBySha(db, sha256);
      if (existing && !(await hooks.confirmDuplicate(existing.title))) continue;
      const kind = kindOf(file.name, file.type);
      hooks.progress(`Indexing ${title}`);
      const read = await extract(kind, data, (done, total) => hooks.progress(`Indexing ${title}: page ${done} of ${total}`));
      const doc = await addDocument(db, {
        title, tags: [], fileName: file.name, mimeType: file.type, kind, size: file.size, sha256,
        pageCount: read.pageCount, textStatus: read.textStatus, textError: read.textError,
        blob: file, parts: read.parts.map((p) => ({ ...p, text: normaliseText(p.text) })),
      });
      result.added.push(doc);
    } catch (err) {
      result.failed.push({ name: file.name, message: describeError(err).message });
    }
  }
  return result;
}
