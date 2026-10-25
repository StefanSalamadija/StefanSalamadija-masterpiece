import type { BaseRecord, Voyage } from './types';

/** What a voyage says about itself: everything but the record's own fields, its ship and whether it is the current one. */
export type VoyageFields = Omit<Voyage, keyof BaseRecord | 'shipId' | 'active'>;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Latest begun first; two begun at the same time are ordered by id, so every device lists them the same way. */
function newestFirst(a: Voyage, b: Voyage): number {
  return compareText(b.createdAt, a.createdAt) || compareText(b.id, a.id);
}

/**
 * The voyage the ship is on: its active voyage. If two devices each began one, the one begun last. Deleted voyages are
 * not considered.
 */
export function currentVoyage(voyages: Voyage[]): Voyage | undefined {
  return voyages.filter((v) => v.active && !v.deleted).sort(newestFirst)[0];
}

/** Every voyage but the current one, newest first. */
export function previousVoyages(voyages: Voyage[]): Voyage[] {
  const current = currentVoyage(voyages);
  return voyages.filter((v) => !v.deleted && v !== current).sort(newestFirst);
}

/** `V-2611 · Santos → Rotterdam`. A port that is not known is a dash; with neither known the ports are left out. */
export function voyageSummary(v: Voyage): string {
  const no = v.voyageNo || 'No voyage no.';
  if (!v.lastPort && !v.nextPort) return no;
  return `${no} · ${v.lastPort || '—'} → ${v.nextPort || '—'}`;
}
