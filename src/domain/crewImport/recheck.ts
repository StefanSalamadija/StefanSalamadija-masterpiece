import { fullName, normalisePassport, overlappingContract } from '../crew';
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

/** The contract a row would leave in the crew list: the saved one with its changes made, or a new one. */
function contractOf(row: PreviewRow, existing: CrewMember[]): CrewMember | undefined {
  if (row.existingId === undefined) {
    return {
      id: `row-${row.rowNumber}`, shipId: '', createdAt: '', updatedAt: '', updatedBy: '', deleted: false, scope: 'ship', ...row.draft,
    };
  }
  const match = existing.find(m => m.id === row.existingId);
  return match && { ...match, ...crewPatch(match, row.changes) };
}

/** The wording of the crew form's overlap problem (`overlapProblem` in `crewForm.ts`), for a saved contract. */
function overlapWithSaved(other: CrewMember): string {
  const span = other.signOffDate ? `from ${other.signOnDate} to ${other.signOffDate}` : `from ${other.signOnDate} (still onboard)`;
  return `This overlaps ${fullName(other)}'s contract ${span}.`;
}

function addTo(index: Map<string, CrewMember[]>, key: string, contract: CrewMember): void {
  if (key !== '') index.set(key, [...(index.get(key) ?? []), contract]);
}

/**
 * One person's contracts on a ship must never overlap, so a row that would write a contract (new, or an update that
 * changes something, and not skipped or wrong already) is checked against the crew list as the import would leave it:
 * the saved contracts, with the ones that rows update as updated, plus the new contracts of the rows. Both contracts of
 * a clash between two rows get the error, so that skipping either one clears the other.
 */
function flagOverlaps(rows: PreviewRow[], existing: CrewMember[]): PreviewRow[] {
  const importing = new Map<PreviewRow, CrewMember>();
  for (const row of rows.filter(isImportable)) {
    const contract = contractOf(row, existing);
    if (contract) importing.set(row, contract);
  }
  const changed = new Set([...importing.values()].map(contract => contract.id));
  const fileRowOf = new Map([...importing].map(([row, contract]) => [contract.id, row.rowNumber]));
  const crew = [...existing.filter(m => !changed.has(m.id)), ...importing.values()];

  // A clash needs the same passport number or the same date of birth (the name only counts together with it), so only
  // the contracts that share one of them are looked at, and not every contract for every row.
  const byPassport = new Map<string, CrewMember[]>();
  const byBirth = new Map<string, CrewMember[]>();
  for (const contract of crew) {
    addTo(byPassport, normalisePassport(contract.passportNo), contract);
    addTo(byBirth, contract.dateOfBirth.trim(), contract);
  }

  return rows.map(row => {
    const contract = importing.get(row);
    if (!contract) return row;
    const neighbours = new Set([
      ...(byPassport.get(normalisePassport(contract.passportNo)) ?? []),
      ...(byBirth.get(contract.dateOfBirth.trim()) ?? []),
    ]);
    const other = overlappingContract({ ...row.draft, id: contract.id }, [...neighbours]);
    if (!other) return row;
    const fileRow = fileRowOf.get(other.id);
    const message = fileRow === undefined ? overlapWithSaved(other) : `This overlaps row ${fileRow} of this file.`;
    return flag(row, { field: 'signOnDate', message, severity: 'error' });
  });
}

/**
 * The preview again after the user changed something (a fix, a skip): each row is revalidated on its own with
 * `revalidateRow`, and then the checks that need the other rows are made, which `revalidateRow` cannot:
 * - a passport number that another row also has makes every row that has it an error;
 * - a contract that runs into another contract of the same person, saved or in the file, makes the row an error.
 * Skipped rows take no part in either check, so skipping one of two rows that clash frees the other.
 */
export function recheckRows(rows: PreviewRow[], existing: CrewMember[], today: string): PreviewRow[] {
  const revalidated = rows.map(row => revalidateRow(row, existing, today));
  return flagOverlaps(flagDuplicatePassports(revalidated), existing);
}
