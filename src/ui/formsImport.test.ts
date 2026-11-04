import { describe, expect, it, vi } from 'vitest';
import type { FormTemplate } from '../domain/types';
import type { FormSchema } from '../forms/types';
import { importMany, importProgress, importSummaryLines } from './formsImport';
import type { ImportDeps, ImportFile } from './formsImport';

class FileProblem extends Error {}

const schemaOf = (code: string, revision = '00'): FormSchema =>
  ({ kind: 'docx', identity: { code, title: 'T', revision }, fields: [], rowGroups: [], unsupported: [] }) as unknown as FormSchema;
const file = (name: string): ImportFile => ({ name, bytes: async () => new Uint8Array([1]) });
const existing = (code: string, revision: string): FormTemplate => ({ id: `id-${code}`, code, revision }) as FormTemplate;

/** Files named `<code>.docx` read as a form with that code; `bad*` files are refused; `crash` throws something else. */
function deps(library: FormTemplate[] = [], over: Partial<ImportDeps> = {}): ImportDeps & { saved: string[]; replaced: string[] } {
  const saved: string[] = [];
  const replaced: string[] = [];
  return {
    saved, replaced,
    read: (name) => {
      if (name.startsWith('bad')) throw new FileProblem(`${name} is no form`);
      return { kind: 'docx', schema: schemaOf(name.replace('.docx', ''), '01'), bytes: new Uint8Array([1]) };
    },
    isFileError: (err): err is Error => err instanceof FileProblem,
    findTarget: async (code) => library.find((t) => t.code === code),
    confirmReplace: async () => true,
    replace: async (_target, input) => void replaced.push(input.fileName),
    save: async (input) => void saved.push(input.fileName),
    ...over,
  };
}

describe('importMany', () => {
  it('stores the bytes the engine gives back (a macro file without its macros), not the file as chosen', async () => {
    const stored: Uint8Array[] = [];
    const replaced: Uint8Array[] = [];
    const d = deps([existing('B', '00')], {
      read: (name) => ({ kind: 'docx', schema: schemaOf(name.replace('.docm', ''), '01'), bytes: new Uint8Array([9, 9]) }),
      save: async (input) => void stored.push(input.bytes),
      replace: async (_target, input) => void replaced.push(input.bytes),
    });
    await importMany([file('A.docm'), file('B.docm')], d, () => {});
    expect(stored).toEqual([new Uint8Array([9, 9])]);
    expect(replaced).toEqual([new Uint8Array([9, 9])]);
  });

  it('saves each file in turn and counts them', async () => {
    const d = deps();
    const progress = vi.fn();
    const summary = await importMany([file('A.docx'), file('B.docx'), file('C.docx')], d, progress);
    expect(d.saved).toEqual(['A.docx', 'B.docx', 'C.docx']);
    expect(summary).toEqual({ imported: 3, failures: [], skipped: 0 });
    expect(progress.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('lists a refused file with its message and carries on', async () => {
    const d = deps();
    const summary = await importMany([file('A.docx'), file('bad.doc'), file('B.docx')], d, () => {});
    expect(summary.imported).toBe(2);
    expect(summary.failures).toEqual([{ name: 'bad.doc', message: 'bad.doc is no form' }]);
  });

  it('asks before replacing a revision; Cancel skips only that file', async () => {
    const asked: string[] = [];
    const d = deps([existing('A', '00'), existing('B', '00')], {
      confirmReplace: async (target) => { asked.push(target.code); return target.code === 'B'; },
    });
    const summary = await importMany([file('A.docx'), file('B.docx'), file('C.docx')], d, () => {});
    expect(asked).toEqual(['A', 'B']);
    expect(d.replaced).toEqual(['B.docx']);
    expect(d.saved).toEqual(['C.docx']);
    expect(summary).toEqual({ imported: 2, failures: [], skipped: 1 });
  });

  it('stops at a failure that is not about the file, and says what was done', async () => {
    const boom = new Error('disk');
    const d = deps([], { save: async (input) => { if (input.fileName === 'B.docx') throw boom; } });
    const summary = await importMany([file('A.docx'), file('B.docx'), file('C.docx')], d, () => {});
    expect(summary.imported).toBe(1);
    expect(summary.stopped).toBe(boom);
  });
});

describe('a file that cannot be read', () => {
  it('is listed for that file only; the batch goes on', async () => {
    const d = deps();
    const broken: ImportFile = { name: 'gone.docx', bytes: async () => { throw new Error('NotReadableError'); } };
    const summary = await importMany([file('A.docx'), broken, file('B.docx')], d, () => {});
    expect(summary.imported).toBe(2);
    expect(summary.failures).toEqual([{ name: 'gone.docx', message: "This file couldn't be read." }]);
    expect(summary.stopped).toBeUndefined();
  });
});

describe('the texts', () => {
  it('words the progress', () => expect(importProgress(3, 16)).toBe('Importing 3 of 16…'));
  it('words the summary: the count, then a line for each failure', () => {
    expect(importSummaryLines({ imported: 2, failures: [{ name: 'old.doc', message: 'Old format.' }], skipped: 0 }))
      .toEqual(['2 forms imported', 'old.doc: Old format.']);
    expect(importSummaryLines({ imported: 1, failures: [], skipped: 0 })).toEqual(['1 form imported']);
    expect(importSummaryLines({ imported: 0, failures: [], skipped: 1 })).toEqual(['0 forms imported']);
  });
});
