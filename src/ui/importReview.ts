import { RANKS } from '../domain/catalogues';
import { formatUtcMinute } from '../domain/dates';
import { conflictKey } from '../domain/merge';
import type { MergeItem, MergePlan } from '../domain/merge';
import { formatOffset, isValidOffset } from '../domain/shipTime';
import type { SyncRecord, TableName } from '../domain/types';
import { MAPPING_FIELDS } from './crewImportView';

/*
 * What the import screen shows of a backup file, as plain strings. Everything in a file is unauthenticated text until
 * the password has opened it, and even after that it was typed by whoever made the file: it is only ever shown as text
 * (Preact never reads it as HTML), with the characters that hide or reorder text taken out, and shortened.
 */

export const MAX_DEVICE_NAME_SHOWN = 60;
/** A backup is the data of a ship's office, a few megabytes at most. Anything bigger is not one, and is not read. */
export const MAX_BACKUP_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TITLE = 80;
const MAX_VALUE = 200;
/** Shown for a value that is empty or missing. */
export const EMPTY_VALUE = '—';

/** Control characters, and the ones that hide text or flip its direction (zero-width space, LRM/RLM, bidi embeddings and isolates, word joiner, BOM). */
const HIDDEN = /[\u0000-\u001F\u007F-\u009F​‎‏‪-‮⁠⁦-⁩﻿]/g;

/** `text` made safe to show: line breaks and tabs as spaces, hidden characters removed, trimmed, and cut to `max` characters with `…` where it was cut. */
export function plainText(text: string, max: number): string {
  const clean = text.replace(/[\t\n\r]/g, ' ').replace(HIDDEN, '').trim();
  const characters = Array.from(clean);
  return characters.length > max ? `${characters.slice(0, max).join('')}…` : clean;
}

export function isTooBigForBackup(bytes: number): boolean {
  return bytes > MAX_BACKUP_FILE_BYTES;
}

/** "From Bridge laptop, exported 2026-10-25 09:05 UTC": the file's header, which has not been checked against the password yet. */
export function fromLine({ deviceName, exportedAt }: { deviceName: string; exportedAt: string }): string {
  const when = formatUtcMinute(exportedAt);
  return `From ${plainText(deviceName, MAX_DEVICE_NAME_SHOWN) || 'an unknown device'}, exported ${when ? when : 'at an unknown time'}`;
}

export function summaryLine({ added, updated, deleted, conflicts }: MergePlan['summary']): string {
  return `${added} new · ${updated} updated · ${deleted} deleted · ${conflicts} conflicts`;
}

export function deletionsLabel(count: number): string {
  return `Apply ${count} deletions`;
}

type Values = Record<string, unknown>;

function isObject(value: unknown): value is Values {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The words of the existing forms, so that a change reads the way the field is called where it is edited. */
const CREW_LABELS: Record<string, string> = {
  ...Object.fromEntries(MAPPING_FIELDS.filter(({ field }) => field !== 'fullName').map(({ field, label }) => [field, label])),
  rankOther: 'Rank (other)',
};
const PARTICULARS_LABELS: Record<string, string> = {
  name: 'Ship name', imo: 'IMO number', callSign: 'Call sign', mmsi: 'MMSI', flag: 'Flag', portOfRegistry: 'Port of registry',
  gt: 'GT', nt: 'NT', dwt: 'DWT (summer)', loa: 'LOA (m)', beam: 'Beam (m)', yearBuilt: 'Year built',
  owners: 'Owners', managers: 'Managers (ISM company)', pandi: 'P&I club', classSociety: 'Classification society',
  crewImportMapping: 'Crew import settings',
};
const CERTIFICATE_LABELS: Record<string, string> = {
  name: 'Certificate name', number: 'Number', issuedBy: 'Issued by', issueDate: 'Issue date', expiryDate: 'Expiry date',
  nextSurveyDue: 'Next survey due', remarks: 'Remarks',
};
const VOYAGE_LABELS: Record<string, string> = {
  voyageNo: 'Voyage no.', lastPort: 'Last port', nextPort: 'Next port', etaLocal: 'ETA (local)', etaOffsetMinutes: 'ETA UTC offset',
  cargo: 'Cargo', charterers: 'Charterers', agents: 'Agents at next port', active: 'Current voyage',
};
// A clock change is stored as an instant; the form's "Change at (ship's time)" is that instant on the ship's clock.
const CLOCK_LABELS: Record<string, string> = { effectiveAt: 'Change at (UTC)', toOffsetMinutes: 'New offset', note: 'Note' };

const LABELS: Record<TableName, Record<string, string>> = {
  ships: PARTICULARS_LABELS, crew: CREW_LABELS, voyages: VOYAGE_LABELS, certificates: CERTIFICATE_LABELS, clockChanges: CLOCK_LABELS,
};

/** Bookkeeping that is never a change to show. A certificate's catalogue key is told by its name. */
const BOOKKEEPING: ReadonlySet<string> = new Set(['id', 'createdAt', 'updatedAt', 'updatedBy', 'scope', 'shipId', 'deleted']);
const HIDDEN_OF: Partial<Record<TableName, ReadonlySet<string>>> = { certificates: new Set(['key']) };

/** The fields of a record that the review compares, by the name they have in the file. A ship's particulars are at the top level. */
function valuesOf(table: TableName, record: SyncRecord): Values {
  const raw = record as unknown as Values;
  const source: Values = table === 'ships'
    ? { ...(isObject(raw.particulars) ? raw.particulars : {}), crewImportMapping: raw.crewImportMapping }
    : raw;
  const out: Values = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && !BOOKKEEPING.has(key) && !HIDDEN_OF[table]?.has(key)) out[key] = value;
  }
  return out;
}

const ETA_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function show(key: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return EMPTY_VALUE;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    return (key === 'etaOffsetMinutes' || key === 'toOffsetMinutes') && isValidOffset(value) ? formatOffset(value) : String(value);
  }
  if (typeof value === 'string') {
    if (key === 'rank') return RANKS.find((rank) => rank.key === value)?.label ?? plainText(value, MAX_VALUE);
    if (key === 'effectiveAt') return formatUtcMinute(value) ?? plainText(value, MAX_VALUE);
    if (key === 'etaLocal' && ETA_LOCAL.test(value)) return value.replace('T', ' ');
    return plainText(value, MAX_VALUE) || EMPTY_VALUE;
  }
  if (key === 'crewImportMapping' && isObject(value) && isObject(value.byHeader)) return `${Object.keys(value.byHeader).length} mapped columns`;
  return plainText(JSON.stringify(value), MAX_VALUE);
}

export interface FieldChange { label: string; local: string; incoming: string }

/** The fields whose value differs between this device's record and the file's, in the order of the form, with the form's words. */
export function changedFields(table: TableName, local: SyncRecord, incoming: SyncRecord): FieldChange[] {
  const mine = valuesOf(table, local);
  const theirs = valuesOf(table, incoming);
  const labels = LABELS[table];
  const known = Object.keys(labels);
  const keys = [...new Set([...Object.keys(mine), ...Object.keys(theirs)])];
  keys.sort((a, b) => {
    const [i, j] = [known.indexOf(a), known.indexOf(b)];
    if (i >= 0 && j >= 0) return i - j;
    if (i >= 0 || j >= 0) return i >= 0 ? -1 : 1; // the fields with words come first
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const changes: FieldChange[] = [];
  if (local.deleted !== incoming.deleted) {
    changes.push({ label: 'Status', local: local.deleted ? 'Deleted' : 'Active', incoming: incoming.deleted ? 'Deleted' : 'Active' });
  }
  for (const key of keys) {
    if (JSON.stringify(mine[key]) === JSON.stringify(theirs[key])) continue;
    changes.push({ label: labels[key] ?? (plainText(key, MAX_TITLE) || EMPTY_VALUE), local: show(key, mine[key]), incoming: show(key, theirs[key]) });
  }
  return changes;
}

function nameOf(value: unknown, whenMissing: string): string {
  return (typeof value === 'string' && plainText(value, MAX_TITLE)) || whenMissing;
}

/** What a record is, for a line of the review: "Crew: Ivan PETROVIĆ". */
export function recordTitle(table: TableName, record: SyncRecord): string {
  const r = record as unknown as Values;
  switch (table) {
    case 'ships': return `Ship: ${nameOf(isObject(r.particulars) ? r.particulars.name : undefined, '(no name)')}`;
    case 'crew': {
      const names = [r.givenNames, r.surname].filter((part): part is string => typeof part === 'string');
      return `Crew: ${nameOf(names.join(' '), '(no name)')}`;
    }
    case 'voyages': return `Voyage: ${nameOf(r.voyageNo, '(no number)')}`;
    case 'certificates': return `Certificate: ${nameOf(r.name, '(no name)')}`;
    case 'clockChanges': return `Clock change: ${(typeof r.effectiveAt === 'string' && formatUtcMinute(r.effectiveAt)) || '(unknown time)'}`;
  }
}

/** One conflict, ready to show: what it is, what differs, and the words of the two choices. `key` is the key of the merge's decisions. */
export interface ConflictView {
  key: string;
  title: string;
  changes: FieldChange[];
  keepLabel: string;
  useLabel: string;
}

function conflictView(item: MergeItem): ConflictView | undefined {
  const { local } = item;
  if (item.kind !== 'conflict' || !local) return undefined;
  return {
    key: conflictKey(item),
    title: recordTitle(item.table, local),
    changes: changedFields(item.table, local, item.incoming),
    // Whoever deleted the record, the choice that keeps the deletion says so: it is not the one the words suggest.
    keepLabel: `Keep this device's version${local.deleted ? ' (deleted)' : ''}`,
    useLabel: `Use the file's version${item.incoming.deleted ? ' (deleted)' : ''}`,
  };
}

export function conflictViews(plan: MergePlan): ConflictView[] {
  return plan.items.flatMap((item) => conflictView(item) ?? []);
}

/** What the file would delete here, if the deletions are applied. */
export function deletionTitles(plan: MergePlan): string[] {
  return plan.items.filter((item) => item.kind === 'delete').map((item) => recordTitle(item.table, item.local ?? item.incoming));
}

/** How many of the conflicts have no choice yet. */
export function unresolvedCount(conflicts: ConflictView[], choices: Record<string, 'local' | 'incoming'>): number {
  return conflicts.filter(({ key }) => choices[key] === undefined).length;
}
