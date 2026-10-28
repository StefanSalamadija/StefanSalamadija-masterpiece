import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Document as XmldomDocument } from '@xmldom/xmldom';
import { DamagedFormError } from './errors';

/**
 * xmldom reports a U+FFFD in the text as a warning ("source encoding issues?"). A form can hold one legitimately
 * (someone pasted text that had already lost a character), and nothing is repaired because of it, so it is let through.
 */
const HARMLESS_WARNING = /replacement character/i;

/**
 * xmldom's default is to log every problem to the console and carry on, repairing as it goes: it turns an unknown
 * entity such as `&nbsp;` into the text `&amp;nbsp;` and closes an unquoted attribute. A form that is written back
 * must never be changed that way, so any problem it reports, whatever the level, refuses the part.
 */
const parser = new DOMParser({
  locator: false, // line and column numbers on every node cost memory and time that a large form can't spare
  onError: (level, message) => {
    if (level === 'warning' && HARMLESS_WARNING.test(message)) return;
    throw new Error(message);
  },
});

/**
 * Parses an XML part. Throws `DamagedFormError` for text that isn't well-formed XML, and for any `<!DOCTYPE`: a form
 * has no use for one, and refusing it means no entity can ever be declared, so none can be expanded into a bomb or
 * point at a file or address.
 *
 * The result is typed as the browser's `Document`, so that `Element`, `Node` and the rest read as in any DOM code. It is
 * xmldom's, though, and has only what xmldom implements: `getElementsByTagNameNS`, `createElementNS`, `childNodes`,
 * `getAttribute`, `cloneNode` and the like, but no `querySelector`.
 */
export function parseXml(text: string): Document {
  if (text.includes('<!DOCTYPE')) throw new DamagedFormError();
  try {
    return parser.parseFromString(text, 'text/xml') as unknown as Document;
  } catch {
    throw new DamagedFormError();
  }
}

/**
 * The XML text of a document, with the declaration it was read with (`<?xml version="1.0" ... standalone="yes"?>`) and
 * the namespace declarations on its elements. A part that had no declaration gets none.
 */
export function serializeXml(doc: Document): string {
  return new XMLSerializer().serializeToString(doc as unknown as XmldomDocument);
}
