import { unzipSync } from 'fflate';
import { IntegrityError } from './errors';
import { detectExcel } from './excel/detect';
import { readExcelValues } from './excel/read';
import { canonicalExcelValue } from './excel/values';
import { writeExcel } from './excel/write';
import { formFileName } from './fileName';
import { partText, readPackage, sniffFormat, writePackage } from './package';
import type { Package } from './package';
import type { DraftValues, FieldDef, FormKind, FormSchema, FormValue } from './types';
import { detectWord } from './word/detect';
import { readWordValues } from './word/read';
import { extraRowsOf, wordText, writeWord } from './word/write';
import { parseXml } from './xml';

/*
 * The forms engine as the app sees it (spec §8): import a form, make a file from a draft, and check the file before it
 * is handed over.
 *
 * `makeFile` is `assemble` (write the values, zip the parts) followed by `verifyOutput` on the zip it made, read back
 * from its bytes. Only a file that passes is returned; anything else throws, and the caller keeps the draft:
 * - `IntegrityError` when the check fails (its message is the Global Constraints text);
 * - `FormWriteError`, as the writer threw it, when a value has no place in the form. It is not wrapped, so the app can
 *   show its message, which names the field.
 */

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** What `makeFile` needs: the stored template (`fileName`, `bytes`) and its schema, a draft's values and its photos, and the ship's date of the file (ISO). */
export interface MakeFileInput {
  kind: FormKind;
  fileName: string;
  bytes: Uint8Array;
  schema: FormSchema;
  values: DraftValues;
  /** Photo id to JPEG bytes, for picture fields (Word). */
  photos: Record<string, Uint8Array>;
  date: string;
}

/** A file made from a draft, checked, ready to be shared or saved. */
export interface MadeFile {
  fileName: string;
  bytes: Uint8Array;
  mime: string;
}

const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

const isWord = (kind: FormKind): boolean => kind !== 'xlsx';

/**
 * Says what a file is and finds its fields. Throws the `FormFileError` that says why a file can't be used: an old
 * format, macros, too large, damaged, or not a form at all.
 */
export function importForm(fileName: string, bytes: Uint8Array): { kind: FormKind; schema: FormSchema } {
  const kind = sniffFormat(fileName, bytes);
  const pkg = readPackage(bytes);
  const schema = kind === 'xlsx' ? detectExcel(pkg, fileName) : detectWord(pkg, kind, fileName);
  return { kind, schema };
}

/**
 * Writes the values into a copy of the template and zips it, without checking it: the template as read, the bytes of
 * the zip, and the paths of the parts the writer changed or added. `makeFile` checks the result; it is exported so a
 * test can change the output before it is checked.
 */
export function assemble(input: MakeFileInput): { original: Package; bytes: Uint8Array; changed: Set<string> } {
  const original = readPackage(input.bytes);
  const parts = isWord(input.kind)
    ? writeWord(original, input.schema, input.values, { photos: input.photos })
    : writeExcel(original, input.schema, input.values);
  return { original, bytes: writePackage(original, parts), changed: new Set(parts.keys()) };
}

/**
 * Makes the file of a draft: writes the values into the template, zips it, checks it (`verifyOutput`, on the zip read
 * back from its bytes) and names it (`formFileName`; a form with neither code nor title takes the template's own file
 * name as its title). Throws `IntegrityError` when the check fails, and lets a writer's `FormWriteError` through as it
 * is (see the top of this file).
 */
export function makeFile(input: MakeFileInput): MadeFile {
  const { original, bytes, changed } = assemble(input);
  verifyOutput(original, unpack(bytes), changed, input.schema, input.values);
  const identity = input.schema.identity;
  const title = identity.code.trim() || identity.title.trim() ? identity.title : input.fileName.replace(/\.[^.]*$/, '');
  return {
    fileName: formFileName({ ...identity, title }, input.date, input.kind),
    bytes,
    mime: isWord(input.kind) ? DOCX_MIME : XLSX_MIME,
  };
}

/**
 * The parts of a zip this engine has just made. Not `readPackage`: its limits are for files from outside, and a form
 * near 20 MB with photos added can be larger than that and still be right. Anything that cannot be read is an
 * `IntegrityError`.
 */
function unpack(bytes: Uint8Array): Package {
  try {
    const parts = unzipSync(bytes);
    const order = Object.keys(parts);
    return { entries: new Map(order.map((name) => [name, parts[name]!])), order };
  } catch (error) {
    throw new IntegrityError('The made zip cannot be read.', { cause: error });
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** A part of the output, parsed; an `IntegrityError` when it is not well-formed XML. */
function parsed(pkg: Package, part: string): Document {
  try {
    return parseXml(partText(pkg, part)!);
  } catch (error) {
    throw new IntegrityError(`The part ${part} is not well-formed XML.`, { cause: error });
  }
}

/** Whether a part is XML: by its name (`.xml`, `.rels`), or by the content type `[Content_Types].xml` gives it. */
function xmlPartTest(pkg: Package): (part: string) => boolean {
  const types = new Map<string, string>();
  if (pkg.entries.has('[Content_Types].xml')) {
    const doc = parsed(pkg, '[Content_Types].xml');
    for (const el of Array.from(doc.getElementsByTagNameNS(CONTENT_TYPES_NS, 'Default'))) types.set(`ext:${(el.getAttribute('Extension') ?? '').toLowerCase()}`, el.getAttribute('ContentType') ?? '');
    for (const el of Array.from(doc.getElementsByTagNameNS(CONTENT_TYPES_NS, 'Override'))) types.set((el.getAttribute('PartName') ?? '').replace(/^\//, ''), el.getAttribute('ContentType') ?? '');
  }
  return (part) => {
    if (/\.(?:xml|rels)$/i.test(part)) return true;
    const type = types.get(part) ?? types.get(`ext:${part.slice(part.lastIndexOf('.') + 1).toLowerCase()}`) ?? '';
    return /[+/]xml$/i.test(type.trim());
  };
}

/** The parts: every part not written is the template's to the byte; nothing is lost; nothing is added unwritten; every written XML part parses. */
function checkParts(original: Package, output: Package, changed: Set<string>): void {
  for (const part of original.entries.keys()) {
    const out = output.entries.get(part);
    if (out === undefined) throw new IntegrityError(`The part ${part} is missing from the output.`);
    if (!changed.has(part) && !sameBytes(out, original.entries.get(part)!)) throw new IntegrityError(`The part ${part} changed, and nothing was written to it.`);
  }
  for (const part of output.entries.keys()) {
    if (!original.entries.has(part) && !changed.has(part)) throw new IntegrityError(`The part ${part} is in the output, and nothing wrote it.`);
  }
  const isXml = xmlPartTest(output);
  for (const part of changed) {
    const bytes = output.entries.get(part);
    if (bytes === undefined) throw new IntegrityError(`The written part ${part} is missing from the output.`);
    if (isXml(part)) parsed(output, part);
  }
}

const isBlank = (value: FormValue | undefined): boolean => value === null || value === undefined || value === '';

/** What a filled value reads back as from a Word form: a boolean as it is, text as `wordText` (ISO dates stay ISO). */
function wordValue(value: string | boolean): FormValue {
  if (typeof value === 'boolean') return value;
  const text = wordText(value);
  return text === '' ? null : text;
}

type Expect = (field: FieldDef, value: string | boolean) => FormValue;

/**
 * Whether one field or column read back right:
 * - a left-empty field, or one the draft leaves blank, is not written, so it reads as the template has it (a control
 *   that already held text, a ticked default), or as blank;
 * - a filled picture, by presence: it shows a picture that the writer added to the file. A control that showed a
 *   picture in the template reads as filled without being written, so reading as filled is not enough;
 * - any other filled value reads back as `expect` gives it (both sides `''` as `null`).
 */
function readsRight(field: FieldDef, value: FormValue | undefined, back: FormValue | undefined, template: FormValue | undefined, expect: Expect, changed: Set<string>, output: Package): boolean {
  if (field.leftEmpty || isBlank(value)) return back === template || back === null || back === '';
  if (field.kind === 'picture') return typeof back === 'string' && changed.has(back) && output.entries.has(back);
  const want = expect(field, value!);
  return (back === '' ? null : back) === (want === '' ? null : want);
}

/**
 * Checks a made file before it is handed over, and throws `IntegrityError` when anything is wrong:
 * - every part of `original` that is not in `changed` is in `output` with the very same bytes;
 * - no part of `original` is missing, every part in `changed` is in `output`, and `output` has no part that is in
 *   neither;
 * - every part in `changed` that is XML parses (`parseXml`, so a `<!DOCTYPE` fails too). A changed binary part, a new
 *   photo, is not parsed;
 * - every value reads back from `output` through the stored schema (R1), as `readsRight` says: the Word reader with the
 *   rows the writer cloned (`extraRowsOf`), the Excel reader as it is. Every row the output has is checked, rows the
 *   draft does not fill included; a filled value in a row the output does not have fails.
 *
 * Nothing else escapes it: whatever stops the check is an `IntegrityError` too.
 *
 * Known limits, in the safe direction (a right file refused, never a wrong one passed):
 * - a date written with a 2-digit year (`yy`) before 2000 reads back as 20xx, and is refused;
 * - a date-field value that is not ISO is compared as text, and is refused when it happens to be a date in the form's
 *   own format (it then reads back as ISO). The fill screen gives ISO dates (R2).
 */
export function verifyOutput(original: Package, output: Package, changed: Set<string>, schema: FormSchema, values: DraftValues): void {
  try {
    checkParts(original, output, changed);
    checkValues(original, output, changed, schema, values);
  } catch (error) {
    // Whatever stops the check (a part that cannot be parsed or read back) is a file that is not handed over.
    if (error instanceof IntegrityError) throw error;
    throw new IntegrityError('The output could not be checked.', { cause: error });
  }
}

/** The values, as `verifyOutput` says. */
function checkValues(original: Package, output: Package, changed: Set<string>, schema: FormSchema, values: DraftValues): void {
  const word = isWord(schema.kind);
  const back = word ? readWordValues(output, schema, extraRowsOf(schema, values)) : readExcelValues(output, schema);
  const template = word ? readWordValues(original, schema) : readExcelValues(original, schema);
  const expect: Expect = word ? (_field, value) => wordValue(value) : canonicalExcelValue;
  const check = (field: FieldDef, value: FormValue | undefined, read: FormValue | undefined, before: FormValue | undefined, where: string) => {
    if (!readsRight(field, value, read, before, expect, changed, output)) throw new IntegrityError(`${where} does not read back as written.`);
  };

  for (const field of schema.fields) check(field, values.fields[field.id], back.fields[field.id], template.fields[field.id], `The field ${field.id} (${field.label})`);

  for (const group of schema.rowGroups) {
    const given = values.rows[group.id] ?? [];
    const rows = back.rows[group.id];
    const before = template.rows[group.id];
    if (rows === undefined && before !== undefined) throw new IntegrityError(`The table ${group.id} (${group.label}) is missing from the output.`);
    for (let i = 0; i < Math.max(given.length, rows?.length ?? 0); i += 1) {
      const row = rows?.[i];
      const draft = given[i] ?? {};
      if (row === undefined) {
        if (group.columns.some((column) => !column.leftEmpty && !isBlank(draft[column.id]))) throw new IntegrityError(`Row ${i + 1} of ${group.id} (${group.label}) is missing from the output.`);
        continue;
      }
      // A row the writer cloned is a copy of the template's last row.
      const was = before?.[Math.min(i, before.length - 1)];
      for (const column of group.columns) check(column, draft[column.id], row[column.id], was?.[column.id], `The column ${column.id} (${column.label}) in row ${i + 1}`);
    }
  }
}
