import { fullName, laterContractFinder, normalisePassport, overlapFinder, overlapMessage } from '../crew';
import type { CrewMember, FieldError } from '../types';
import { crewPatch, isImportable } from './plan';
import { DUPLICATE_PASSPORT, revalidateRow } from './preview';
import type { PreviewRow } from './preview';

function flag(row: PreviewRow, error: FieldError): PreviewRow {
  return { ...row, status: 'error', errors: [...row.errors, error] };
}

/** Every row that shares its passport number with another row that is not skipped. A skipped row is not part of any pair. */
function flagDuplicatePassports(rows: PreviewRow[]): PreviewRow[] {
  const keyOf = (row: PreviewRow): string => (row.skip ? '' : normalisePassport(row.draft.passportNo));
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key !== '') counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return rows.map(row => ((counts.get(keyOf(row)) ?? 0) > 1 ? flag(row, DUPLICATE_PASSPORT) : row));
}

/**
 * A row is matched to a contract by its passport number, and an update changes that contract. When the person has a
 * later contract (after a renewed passport, say) the number is that of an earlier one, and the update would change the
 * wrong contract: the row is an error, for the user to fix (the passport number, usually) or skip. A row that changes
 * nothing, or is skipped, writes nothing and is left alone.
 */
function flagEarlierContracts(rows: PreviewRow[], existing: CrewMember[]): PreviewRow[] {
  const byId = new Map(existing.map(m => [m.id, m]));
  const laterContract = laterContractFinder(existing);
  return rows.map(row => {
    const match = isImportable(row) && row.existingId !== undefined ? byId.get(row.existingId) : undefined;
    const later = match && laterContract(match);
    if (!later) return row;
    const passport = later.passportNo.trim() === '' ? 'has no passport number' : `has passport ${later.passportNo}`;
    return flag(row, {
      field: 'passportNo', severity: 'error',
      message: `This passport belongs to an earlier contract. ${fullName(later)}'s latest contract (from ${later.signOnDate}) ${passport}.`,
    });
  });
}

/** The contract a row would leave in the crew list: the saved one with its changes made, or a new one. */
function contractOf(row: PreviewRow, byId: Map<string, CrewMember>): CrewMember | undefined {
  if (row.existingId === undefined) {
    return {
      id: `row-${row.rowNumber}`, shipId: '', createdAt: '', updatedAt: '', updatedBy: '', deleted: false, scope: 'ship', ...row.draft,
    };
  }
  const match = byId.get(row.existingId);
  return match && { ...match, ...crewPatch(match, row.changes) };
}

/**
 * One person's contracts on a ship must never overlap, so a row that would write a contract (new, or an update that
 * changes something, and not skipped or wrong already) is checked against the crew list as the import would leave it:
 * the saved contracts, with the ones that rows update as updated, plus the new contracts of the rows. Both contracts of
 * a clash between two rows get the error, so that skipping either one clears the other.
 */
function flagOverlaps(rows: PreviewRow[], existing: CrewMember[]): PreviewRow[] {
  const byId = new Map(existing.map(m => [m.id, m]));
  const importing = new Map<PreviewRow, CrewMember>();
  for (const row of rows.filter(isImportable)) {
    const contract = contractOf(row, byId);
    if (contract) importing.set(row, contract);
  }
  const changed = new Set([...importing.values()].map(contract => contract.id));
  const fileRowOf = new Map([...importing].map(([row, contract]) => [contract.id, row.rowNumber]));
  const findOverlap = overlapFinder([...existing.filter(m => !changed.has(m.id)), ...importing.values()]);

  return rows.map(row => {
    const contract = importing.get(row);
    const other = contract && findOverlap({ ...row.draft, id: contract.id });
    if (!other) return row;
    const fileRow = fileRowOf.get(other.id);
    const message = fileRow === undefined ? overlapMessage(other) : `This overlaps row ${fileRow} of this file.`;
    return flag(row, { field: 'signOnDate', message, severity: 'error' });
  });
}

/**
 * The preview again after the user changed something (a fix, a skip): each row is revalidated on its own with
 * `revalidateRow`, and then the checks that need the other rows are made, which `revalidateRow` cannot:
 * - a passport number that another row also has makes every row that has it an error;
 * - an update that would change a contract that the person has since followed with another is an error;
 * - a contract that runs into another contract of the same person, saved or in the file, makes the row an error.
 * Skipped rows take no part in these checks, so skipping one of two rows that clash frees the other.
 */
export function recheckRows(rows: PreviewRow[], existing: CrewMember[], today: string): PreviewRow[] {
  const revalidated = rows.map(row => revalidateRow(row, existing, today));
  return flagOverlaps(flagEarlierContracts(flagDuplicatePassports(revalidated), existing), existing);
}
