import type { LibraryKind, TextStatus } from '../../domain/types';
import { extractDocx } from './docx';
import { extractPdf } from './pdf';
import { extractXlsx } from './xlsx';

export { sha256Hex } from './hash';

export interface Extracted {
  pageCount?: number;
  textStatus: TextStatus;
  textError?: string;
  parts: { part: number; label: string; text: string }[];
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp', 'tif', 'tiff']);

export function kindOf(fileName: string, mimeType: string): LibraryKind {
  const dot = fileName.lastIndexOf('.');
  const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (ext === 'xlsx') return 'xlsx';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (ext) return 'other';
  const mime = mimeType.toLowerCase();
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if (mime.startsWith('image/')) return 'image';
  return 'other';
}

/** Returns the raw text of a file in parts (pages, sheets or the document). Callers normalise it before storing. */
export async function extract(kind: LibraryKind, data: ArrayBuffer, onProgress?: (done: number, total: number) => void): Promise<Extracted> {
  if (data.byteLength === 0) return { textStatus: 'failed', textError: 'Empty file', parts: [] };
  switch (kind) {
    case 'pdf': return extractPdf(data, onProgress);
    case 'docx': return extractDocx(data);
    case 'xlsx': return extractXlsx(data);
    default: return { textStatus: 'not-supported', parts: [] };
  }
}
