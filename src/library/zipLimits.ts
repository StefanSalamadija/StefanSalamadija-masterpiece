import { unzipSync } from 'fflate';

/** The most `word/document.xml` may inflate to. A bigger one is treated as damaged (a zip bomb would exhaust the tab's memory). */
export const DOCX_XML_MAX_BYTES = 200 * 1024 * 1024;
/** The most one entry of a library file may inflate to: a part is about 100 MB, and one file can be a little over that. */
export const MPLIB_ENTRY_MAX_BYTES = 110 * 1024 * 1024;

/**
 * Unzips only the entries the filter keeps. The size is the one the archive declares; fflate allocates that much for
 * the entry and stops at it, so an entry that declares more than `maxBytes` is never inflated.
 */
export function unzipLimited(
  data: Uint8Array, maxBytes: number, keep: (f: { name: string; compression: number }) => boolean = () => true,
): Record<string, Uint8Array> {
  return unzipSync(data, { filter: (f) => f.originalSize <= maxBytes && keep(f) });
}
