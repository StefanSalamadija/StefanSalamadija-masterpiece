import type { FormTemplate } from '../domain/types';
import type { FormKind, FormSchema } from '../forms/types';

/*
 * Importing several form files at once. The order of the work and what is said about it are here, apart from the
 * screen; the screen supplies what touches the engine, the database and the dialog (`ImportDeps`).
 */

/** What is stored for a file read as a form, before its setup. */
export interface ReadForm {
  fileName: string;
  bytes: Uint8Array;
  kind: FormKind;
  schema: FormSchema;
}

export interface ImportFile {
  name: string;
  bytes: () => Promise<Uint8Array>;
}

export interface ImportDeps {
  /**
   * Reads a file as a form; throws what `isFileError` recognises for a file that is not a usable form. `bytes` is what
   * is stored as the template: for a macro file, the package without its macros (R21), never the file as chosen.
   */
  read: (name: string, bytes: Uint8Array) => { kind: FormKind; schema: FormSchema; bytes: Uint8Array };
  isFileError: (err: unknown) => err is Error;
  /** The library form a file of this code would replace. */
  findTarget: (code: string) => Promise<FormTemplate | undefined>;
  /** Asks `Replace Revision … with Revision …?`; false skips the file. */
  confirmReplace: (target: FormTemplate, input: ReadForm) => Promise<boolean>;
  replace: (target: FormTemplate, input: ReadForm) => Promise<void>;
  /** Saves a new form with its suggested setup. */
  save: (input: ReadForm) => Promise<void>;
}

export interface ImportSummary {
  imported: number;
  failures: { name: string; message: string }[];
  /** Files whose replacement was cancelled. */
  skipped: number;
  /** A failure that was not about a file (the database); the import stopped there. */
  stopped?: unknown;
}

export const UNREADABLE = "This file couldn't be read.";

/**
 * Imports the files one after another, each as a single import is, but never opening a setup. A file the engine refuses
 * is listed with its message and the rest go on; Cancel on a replacement skips that file only. `onProgress(n, total)` is
 * called as file `n` starts.
 */
export async function importMany(files: ImportFile[], deps: ImportDeps, onProgress: (n: number, total: number) => void): Promise<ImportSummary> {
  const summary: ImportSummary = { imported: 0, failures: [], skipped: 0 };
  for (const [i, file] of files.entries()) {
    onProgress(i + 1, files.length);
    try {
      let bytes: Uint8Array;
      try {
        bytes = await file.bytes();
      } catch {
        summary.failures.push({ name: file.name, message: UNREADABLE });
        continue;
      }
      let read: ReturnType<ImportDeps['read']>;
      try {
        read = deps.read(file.name, bytes);
      } catch (err) {
        if (!deps.isFileError(err)) throw err;
        summary.failures.push({ name: file.name, message: err.message });
        continue;
      }
      const input: ReadForm = { fileName: file.name, bytes: read.bytes, kind: read.kind, schema: read.schema };
      const target = await deps.findTarget(read.schema.identity.code);
      if (target) {
        if (!(await deps.confirmReplace(target, input))) {
          summary.skipped += 1;
          continue;
        }
        await deps.replace(target, input);
      } else {
        await deps.save(input);
      }
      summary.imported += 1;
    } catch (err) {
      summary.stopped = err;
      break;
    }
  }
  return summary;
}

export const importProgress = (n: number, total: number): string => `Importing ${n} of ${total}…`;

/** `2 forms imported`, then `<file name>: <message>` for each failure. */
export function importSummaryLines(summary: ImportSummary): string[] {
  const n = summary.imported;
  return [`${n} ${n === 1 ? 'form' : 'forms'} imported`, ...summary.failures.map((f) => `${f.name}: ${f.message}`)];
}
