import { strToU8, zipSync } from 'fflate';

/** 1 January 1980, the earliest time a zip can hold, as `writePackage` uses for the files it writes. */
const FIXED_TIME = new Date(1980, 0, 1);

/**
 * A zip package built from `{ part path: text or bytes }`, for tests. Text is encoded as UTF-8. Parts are written in
 * the order given (except a name that is only digits, which JavaScript lists first). Nothing here is read from a real
 * company form: the callers invent every part.
 *
 * Every entry gets the same fixed time. Left to fflate it would be the time of writing (to 2 seconds), so the same
 * parts would give different bytes from one call to the next, and a test that builds a fixture twice would flake.
 */
export function zipOf(files: Record<string, string | Uint8Array>): Uint8Array {
  const parts: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) parts[path] = typeof content === 'string' ? strToU8(content) : content;
  return zipSync(parts, { mtime: FIXED_TIME });
}

/*
 * The parts that every Office package has, shared by the Word and Excel fixture builders.
 */

export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Text for an XML text node or a double-quoted attribute. */
export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A real 1 by 1 pixel PNG. It stands in for the company logo and for the placeholder image of a picture control. */
export const PNG_1X1: Uint8Array = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (character) => character.charCodeAt(0),
);

const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Relationship types (the `Type` of a `Relationship`). */
export const REL_TYPE = {
  officeDocument: `${OFFICE_REL}/officeDocument`,
  styles: `${OFFICE_REL}/styles`,
  header: `${OFFICE_REL}/header`,
  image: `${OFFICE_REL}/image`,
  worksheet: `${OFFICE_REL}/worksheet`,
  sharedStrings: `${OFFICE_REL}/sharedStrings`,
  drawing: `${OFFICE_REL}/drawing`,
} as const;

/** Content types (the `ContentType` of a `Default` or `Override`) of the parts the fixtures hold. */
export const CONTENT_TYPE = {
  rels: 'application/vnd.openxmlformats-package.relationships+xml',
  xml: 'application/xml',
  png: 'image/png',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',
  wordStyles: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  wordHeader: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  workbook: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  worksheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
  excelStyles: 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml',
  sharedStrings: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml',
  drawing: 'application/vnd.openxmlformats-officedocument.drawing+xml',
} as const;

/** `[Content_Types].xml`: the `Default` types by extension (`rels`, `xml`, `png`) and the `Override` type of each part, by part path. */
export function contentTypesXml(overrides: Record<string, string>): string {
  const defaults = [['rels', CONTENT_TYPE.rels], ['xml', CONTENT_TYPE.xml], ['png', CONTENT_TYPE.png]]
    .map(([extension, type]) => `<Default Extension="${extension}" ContentType="${type}"/>`);
  const parts = Object.entries(overrides).map(([path, type]) => `<Override PartName="/${path}" ContentType="${type}"/>`);
  return `${XML_DECLARATION}<Types xmlns="${CONTENT_TYPES_NS}">${defaults.join('')}${parts.join('')}</Types>`;
}

/** A `.rels` part: `{ id: [type, target] }`, with targets relative to the part that owns the relationships. */
export function relationshipsXml(rels: Record<string, readonly [type: string, target: string]>): string {
  const entries = Object.entries(rels).map(([id, [type, target]]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`);
  return `${XML_DECLARATION}<Relationships xmlns="${RELATIONSHIPS_NS}">${entries.join('')}</Relationships>`;
}
