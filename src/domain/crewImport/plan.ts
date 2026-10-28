import type { CrewDraft, CrewMember } from '../types';
import type { PreviewChange, PreviewRow } from './preview';

/** Optional in a record: when the file empties one, the record loses it rather than keeping an empty text. */
const OPTIONAL_FIELDS: ReadonlySet<keyof CrewDraft> = new Set(['rankOther', 'signOffDate', 'signOffPort']);

/** What an import writes for a row: a new row is saved, an update that changes something is saved, and nothing else. */
export function isImportable(row: PreviewRow): boolean {
  return !row.skip && (row.status === 'new' || (row.status === 'update' && row.changes.length > 0));
}

/**
 * The patch that saves `changes` over `match`: only the changed fields. A field that is emptied and is optional is set
 * to `undefined`, which `updateRecord` takes as "remove it", and a rank text the new rank no longer needs is removed too.
 */
export function crewPatch(match: CrewMember, changes: PreviewChange[]): Partial<CrewMember> {
  const patch: Record<string, string | undefined> = {};
  for (const { field, to } of changes) patch[field] = to === '' && OPTIONAL_FIELDS.has(field) ? undefined : to;
  const rank = patch.rank ?? match.rank;
  if (rank !== 'other' && match.rankOther !== undefined && !('rankOther' in patch)) patch.rankOther = undefined;
  return patch as Partial<CrewMember>;
}

export interface ImportPlan {
  /** The contracts to add, in the order of the sheet. */
  creates: CrewDraft[];
  /** The saved contracts to change, in the order of the sheet, each with the fields that change. */
  updates: { id: string; patch: Partial<CrewMember> }[];
}

/** What importing `rows` writes, given the crew they were checked against. */
export function importPlan(rows: PreviewRow[], existing: CrewMember[]): ImportPlan {
  const byId = new Map(existing.map(m => [m.id, m]));
  const plan: ImportPlan = { creates: [], updates: [] };
  for (const row of rows.filter(isImportable)) {
    if (row.existingId === undefined) {
      plan.creates.push(row.draft);
      continue;
    }
    const match = byId.get(row.existingId);
    if (!match) throw new Error(`Crew record ${row.existingId} is not on this ship any more.`);
    plan.updates.push({ id: match.id, patch: crewPatch(match, row.changes) });
  }
  return plan;
}
