import { TABLE_NAMES } from './types';
import type { SyncRecord, TableName, Tables } from './types';

export interface MergeItem {
  table: TableName;
  id: string;
  kind: 'add' | 'update' | 'delete' | 'conflict';
  local?: SyncRecord;
  incoming: SyncRecord;
}

export interface MergePlan {
  items: MergeItem[];
  summary: { added: number; updated: number; deleted: number; conflicts: number };
}

export interface MergeDecisions {
  conflicts: Record<string, 'local' | 'incoming'>;
  applyDeletions: boolean;
}

const IGNORED_FOR_CONTENT: ReadonlySet<string> = new Set(['updatedAt', 'updatedBy']);
const NO_KEYS: ReadonlySet<string> = new Set();

/** Equal own properties, ignoring `ignore`. A missing property equals one that is `undefined`; key order is irrelevant. */
function sameProps(a: Record<string, unknown>, b: Record<string, unknown>, ignore: ReadonlySet<string>): boolean {
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!ignore.has(key) && !deepEqual(a[key], b[key])) return false;
  }
  return true;
}

/** Deep equality of two values from JSON: object key order is irrelevant, array order is not. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b || Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  return sameProps(a as Record<string, unknown>, b as Record<string, unknown>, NO_KEYS);
}

/** Deep equality of everything except `updatedAt` and `updatedBy`. */
export function sameContent(a: SyncRecord, b: SyncRecord): boolean {
  return sameProps(a as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>, IGNORED_FOR_CONTENT);
}

/**
 * True when the record changed after `since` (epoch ms). With no usable `since` (never synced), or a timestamp that
 * cannot be read, the record counts as changed: that surfaces a conflict instead of silently picking a side.
 */
function changedSince(record: SyncRecord, since: number): boolean {
  if (Number.isNaN(since)) return true;
  const updated = Date.parse(record.updatedAt);
  return Number.isNaN(updated) || updated > since;
}

/** What the file's version of a record that exists on both sides means for this device, or undefined to leave it alone. */
function classify(local: SyncRecord, incoming: SyncRecord, since: number): MergeItem['kind'] | undefined {
  if (sameContent(local, incoming)) return undefined;
  const localChanged = changedSince(local, since);
  const incomingChanged = changedSince(incoming, since);
  if (localChanged && incomingChanged) return 'conflict';
  // One side changed: it wins. Neither changed (for example after an earlier conflict choice): the newer one wins.
  const incomingWins = localChanged || incomingChanged ? incomingChanged : Date.parse(incoming.updatedAt) > Date.parse(local.updatedAt);
  if (!incomingWins) return undefined;
  // A tombstone replacing a record that is already deleted is not a deletion the user needs to confirm.
  return incoming.deleted && !local.deleted ? 'delete' : 'update';
}

/** Decide, per incoming record, whether it is added, updates or deletes the local one, or conflicts with it. */
export function computeMerge(local: Tables, incoming: Tables, lastSync: string | undefined): MergePlan {
  const since = lastSync === undefined ? NaN : Date.parse(lastSync);
  const items: MergeItem[] = [];
  for (const table of TABLE_NAMES) {
    // A table missing from a side (an older backup file) is empty.
    const localById = new Map((local[table] ?? []).map((r) => [r.id, r]));
    for (const record of incoming[table] ?? []) {
      const mine = localById.get(record.id);
      if (!mine) {
        items.push({ table, id: record.id, kind: 'add', incoming: record });
        continue;
      }
      const kind = classify(mine, record, since);
      if (kind) items.push({ table, id: record.id, kind, local: mine, incoming: record });
    }
  }
  const summary = { added: 0, updated: 0, deleted: 0, conflicts: 0 };
  for (const item of items) {
    if (item.kind === 'add') {
      if (!item.incoming.deleted) summary.added += 1; // a tombstone for a record we never had is not news
    } else if (item.kind === 'update') summary.updated += 1;
    else if (item.kind === 'delete') summary.deleted += 1;
    else summary.conflicts += 1;
  }
  return { items, summary };
}

export function conflictKey(item: MergeItem): string {
  return `${item.table}:${item.id}`;
}

/**
 * The records to write for a plan once the user has decided. Add, update and delete take the incoming record unchanged
 * (deletes only when `applyDeletions`). A conflict takes the chosen side, stamped `updatedAt = now`, `updatedBy = deviceId`
 * so the choice reaches the other device on the next exchange. Throws if any conflict has no decision; nothing is returned then.
 */
export function resolveMerge(
  plan: MergePlan,
  decisions: MergeDecisions,
  now: string,
  deviceId: string,
): { table: TableName; record: SyncRecord }[] {
  const out: { table: TableName; record: SyncRecord }[] = [];
  for (const item of plan.items) {
    if (item.kind === 'conflict') {
      const key = conflictKey(item);
      const choice = decisions.conflicts[key];
      const chosen = choice === 'local' ? item.local : choice === 'incoming' ? item.incoming : undefined;
      if (!chosen) throw new Error(`Unresolved conflict: ${key}`);
      out.push({ table: item.table, record: { ...chosen, updatedAt: now, updatedBy: deviceId } });
    } else if (item.kind !== 'delete' || decisions.applyDeletions) {
      out.push({ table: item.table, record: item.incoming });
    }
  }
  return out;
}
