import { unzipSync, zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import { DamagedFormError, FormFileError, FormTooLargeError, MacroFileError, NotAFormError, OldFormatError } from './errors';
import { parseXml } from './xml';

/** An Office file: a zip of parts. `order` is the order they are in the file, which a rewrite keeps. */
export type Package = { entries: Map<string, Uint8Array>; order: string[] };
export type FormKind = 'docx' | 'dotx' | 'xlsx';

/** What a form file may be: at most 20 MB, with at most 2,000 zip entries that inflate to at most 100 MB in all (the last two stop a zip bomb). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_ENTRIES = 2000;
export const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

const CONTENT_TYPES = '[Content_Types].xml';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
/** `PK\x03\x04`, which starts every zip that has a part in it. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
/** The start of the compound file that holds an old `.doc` or `.xls`. */
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];
const MACRO_FILE_NAME = /\.(?:docm|dotm|xlsm|xltm)$/i;
const VBA_PROJECT_PART = /(?:^|\/)vbaProject\.bin$/i;
/** Every macro-enabled content type (`...macroEnabled.main+xml`, `...macroEnabledTemplate.main+xml`) and the VBA project itself (`application/vnd.ms-office.vbaProject`). */
const MACRO_CONTENT_TYPE = /macroenabled|vbaproject/i;
/** Content types (lower case) of the part that makes a package a form, and which form it is. */
const MAIN_PART_KINDS = new Map<string, FormKind>([
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml', 'docx'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml', 'dotx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml', 'xlsx'],
]);

/**
 * A fixed modification time for every part we write: 1 January 1980, the earliest a zip can hold. Left to fflate it
 * would be the time of writing, so the same form and values would give a different file each time.
 */
const WRITTEN_AT = new Date(1980, 0, 1);

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

/** The text of a part's bytes (UTF-8; a leading byte order mark is dropped). */
export function utf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** The UTF-8 bytes of a text. */
export function bytesOf(text: string): Uint8Array {
  return encoder.encode(text);
}

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return bytes.length >= magic.length && magic.every((byte, i) => bytes[i] === byte);
}

/**
 * The names of the parts, in file order, read from the zip's directory alone: nothing is inflated, so the limits are
 * checked before any memory is spent on a part. The size of a part is the one its directory entry declares, and
 * fflate inflates into a buffer of exactly that size, so a part that claims less than it holds is cut short, not grown.
 */
function listParts(bytes: Uint8Array): string[] {
  if (bytes.length > MAX_FILE_BYTES) throw new FormTooLargeError();
  const names: string[] = [];
  const seen = new Set<string>();
  let inflated = 0;
  try {
    unzipSync(bytes, {
      filter: (file) => {
        inflated += file.originalSize;
        // A name twice would leave two readers with two answers to "which part is this", so it is not a form.
        if (names.length >= MAX_ENTRIES || inflated > MAX_UNCOMPRESSED_BYTES || seen.has(file.name)) throw new DamagedFormError();
        seen.add(file.name);
        names.push(file.name);
        return false;
      },
    });
  } catch (error) {
    throw error instanceof FormFileError ? error : new DamagedFormError();
  }
  return names;
}

/** The bytes of the named parts, inflated. */
function inflateParts(bytes: Uint8Array, wanted: ReadonlySet<string>): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes, { filter: (file) => wanted.has(file.name) });
  } catch {
    throw new DamagedFormError();
  }
}

/**
 * Reads a zip of parts. Throws `FormTooLargeError` over 20 MB and `DamagedFormError` for a file that isn't a readable
 * zip, has more than 2,000 entries, would inflate to more than 100 MB, or names a part twice.
 */
export function readPackage(bytes: Uint8Array): Package {
  const order = listParts(bytes);
  const parts = inflateParts(bytes, new Set(order));
  const entries = new Map<string, Uint8Array>();
  for (const name of order) {
    const part = Object.hasOwn(parts, name) ? parts[name] : undefined;
    if (!part) throw new DamagedFormError();
    entries.set(name, part);
  }
  return { entries, order };
}

/**
 * The zip for `original` with the parts in `changed` replaced and any that `original` lacks added at the end. Parts not
 * in `changed` are handed to the zip as the very bytes read, so what comes out is what went in. `original` is not changed.
 */
export function writePackage(original: Package, changed: Map<string, Uint8Array>): Uint8Array {
  const order = [...original.order];
  for (const name of changed.keys()) if (!original.entries.has(name)) order.push(name);
  const parts: Zippable = {};
  for (const name of order) parts[name] = changed.get(name) ?? original.entries.get(name)!;
  return zipSync(parts, { mtime: WRITTEN_AT });
}

/** The text of a part, or `undefined` when the package has no part by that path. */
export function partText(pkg: Package, path: string): string | undefined {
  const bytes = pkg.entries.get(path);
  return bytes === undefined ? undefined : utf8(bytes);
}

/**
 * Says what a file is without reading all of it: `docx`, `dotx` or `xlsx`. The zip magic and the main part decide, as
 * declared in `[Content_Types].xml` (not the file name, which only matters for a macro-enabled one). Throws
 * `FormTooLargeError`, `OldFormatError` (the old binary formats), `MacroFileError`, `NotAFormError` (another kind of
 * file, or no main part in the zip) and `DamagedFormError` (a zip or content types that can't be read).
 */
export function sniffFormat(fileName: string, bytes: Uint8Array): FormKind {
  if (bytes.length > MAX_FILE_BYTES) throw new FormTooLargeError();
  if (startsWith(bytes, CFB_MAGIC)) throw new OldFormatError();
  if (!startsWith(bytes, ZIP_MAGIC)) throw new NotAFormError();
  if (MACRO_FILE_NAME.test(fileName)) throw new MacroFileError();

  const names = listParts(bytes);
  if (names.some((name) => VBA_PROJECT_PART.test(name))) throw new MacroFileError();
  if (!names.includes(CONTENT_TYPES)) throw new NotAFormError();
  const types = parseXml(utf8(inflateParts(bytes, new Set([CONTENT_TYPES]))[CONTENT_TYPES]!));

  const defaults = Array.from(types.getElementsByTagNameNS(CONTENT_TYPES_NS, 'Default'));
  const overrides = Array.from(types.getElementsByTagNameNS(CONTENT_TYPES_NS, 'Override'));
  if ([...defaults, ...overrides].some((element) => MACRO_CONTENT_TYPE.test(element.getAttribute('ContentType') ?? ''))) throw new MacroFileError();

  for (const override of overrides) {
    const kind = MAIN_PART_KINDS.get((override.getAttribute('ContentType') ?? '').trim().toLowerCase());
    if (kind === undefined) continue;
    // The main part must be in the zip: a package whose content types promise one that isn't there is not a form.
    if (!names.includes((override.getAttribute('PartName') ?? '').replace(/^\//, ''))) throw new NotAFormError();
    return kind;
  }
  throw new NotAFormError();
}
