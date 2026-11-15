import { addDays, formatDisplayDate } from '../domain/dates';
import type { LibraryDoc, LibraryFolder } from '../domain/types';
import { RETENTION_DAYS } from '../db/library';

/*
 * What the library screens say about a document, apart from the screens.
 */

export const LIBRARY_FILE_TYPES = '.pdf,.docx,.xlsx,.jpg,.jpeg,.png,.doc,.xls';
export const RECENT_COUNT = 5;

export type SortKey = 'title' | 'added' | 'opened';
export const SORT_OPTIONS: readonly { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'added', label: 'Date added' },
  { key: 'opened', label: 'Last opened' },
];

const KIND_LABELS: Record<LibraryDoc['kind'], string> = { pdf: 'PDF', docx: 'DOCX', xlsx: 'XLSX', image: 'Image', other: 'File' };

/** Megabytes with one decimal; a file under 0.1 MB is "<0.1 MB". */
export function sizeText(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb > 0 && mb < 0.05 ? '<0.1 MB' : `${mb.toFixed(1)} MB`;
}

/** "PDF · 1.2 MB · 3 pages". */
export function metaText(doc: Pick<LibraryDoc, 'kind' | 'size' | 'pageCount'>): string {
  const parts: string[] = [KIND_LABELS[doc.kind], sizeText(doc.size)];
  if (doc.pageCount !== undefined) parts.push(`${doc.pageCount} ${doc.pageCount === 1 ? 'page' : 'pages'}`);
  return parts.join(' · ');
}

/** The label under a row for a document that has no text, could not be read, or has no file here; none when all is well. */
export function statusLabel(doc: Pick<LibraryDoc, 'textStatus'>, hasFile: boolean): string | undefined {
  if (!hasFile) return 'File not on this device';
  if (doc.textStatus === 'no-text') return 'No searchable text';
  if (doc.textStatus === 'failed') return 'Text could not be read';
  return undefined;
}

export function sortDocs(docs: LibraryDoc[], key: SortKey, opened: Map<string, string> = new Map()): LibraryDoc[] {
  const copy = [...docs];
  if (key === 'title') return copy.sort((a, b) => a.title.localeCompare(b.title));
  if (key === 'added') return copy.sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0));
  return copy.sort((a, b) => (opened.get(b.id) ?? '').localeCompare(opened.get(a.id) ?? '') || a.title.localeCompare(b.title));
}

/** The documents in `folderId` (all of them when none is given). */
export function inFolder(docs: LibraryDoc[], folderId: string | undefined, folders: LibraryFolder[]): LibraryDoc[] {
  if (folderId === undefined) return docs;
  // A folder that has gone is shown as all.
  return folders.some((f) => f.id === folderId) ? docs.filter((d) => d.folderId === folderId) : docs;
}

/** The last opened documents, newest first. */
export function recentlyOpened(docs: LibraryDoc[], opened: Map<string, string>): LibraryDoc[] {
  return docs.filter((d) => opened.has(d.id)).sort((a, b) => (opened.get(b.id) ?? '').localeCompare(opened.get(a.id) ?? '')).slice(0, RECENT_COUNT);
}

/** A storage line such as "12.3 MB of 4.0 GB used". */
export function storageText(used: number, quota: number): string {
  const unit = (n: number): string => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`);
  return `${unit(used)} of ${unit(quota)} used`;
}

/** The documents whose deletion is within the retention period; older ones have had their file and text removed. */
export function restorable(docs: LibraryDoc[], now: Date): LibraryDoc[] {
  const cutoff = now.getTime() - RETENTION_DAYS * 86_400_000;
  return docs.filter((d) => d.deleted && d.deletedAt !== undefined && Date.parse(d.deletedAt) >= cutoff);
}

/** "Deleted 15-NOV-2026 · removed after 15-DEC-2026". */
export function deletedText(deletedAt: string): string {
  const day = deletedAt.slice(0, 10);
  return `Deleted ${formatDisplayDate(day)} · removed after ${formatDisplayDate(addDays(day, RETENTION_DAYS))}`;
}

/** Tags typed as "a, b": trimmed, no empty ones, no repeats (ignoring case). */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(',')) {
    const tag = raw.trim();
    if (tag !== '' && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out;
}
