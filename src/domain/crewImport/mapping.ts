import type { CrewField, CrewImportMapping, DateFormat } from '../types';
import { HEADER_SYNONYMS, matchHeader, normaliseHeader } from './header';
import type { Cell } from './readSpreadsheet';

/** The 0-based column of the sheet that holds each crew field. A field with no column is not imported. */
export type ColumnMapping = Partial<Record<CrewField, number>>;

/**
 * Maps each field to the first column whose header `matchHeader` recognises as it; a later column never takes the field over.
 * No header (the header row of an empty sheet) maps nothing.
 */
export function guessMapping(header: Cell[] | undefined): ColumnMapping {
  const mapping: ColumnMapping = {};
  (header ?? []).forEach((cell, column) => {
    const field = matchHeader(cell);
    if (field !== undefined && mapping[field] === undefined) mapping[field] = column;
  });
  return mapping;
}

function isCrewField(value: unknown): value is CrewField {
  return typeof value === 'string' && Object.hasOwn(HEADER_SYNONYMS, value);
}

/**
 * The guess, overridden by the saved entries whose header is in this sheet. A column ends up with one field only
 * and a field with one column only (its first one), whichever of the guess and the saved mapping put it there.
 */
export function applySavedMapping(header: Cell[] | undefined, saved: CrewImportMapping | undefined): ColumnMapping {
  const mapping = guessMapping(header);
  const byHeader: Record<string, unknown> = saved?.byHeader ?? {}; // from storage or a backup, so not trusted to be there
  const taken = new Set<CrewField>();
  (header ?? []).forEach((cell, column) => {
    const key = normaliseHeader(cell);
    if (key === '' || !Object.hasOwn(byHeader, key)) return;
    const field = byHeader[key];
    if (!isCrewField(field) || taken.has(field)) return;
    for (const other of Object.keys(mapping) as CrewField[]) if (mapping[other] === column) delete mapping[other];
    mapping[field] = column;
    taken.add(field);
  });
  return mapping;
}

/** The mapping as it is saved with the ship, keyed by normalised header text so it still applies when the columns move. */
export function toSavedMapping(header: Cell[], mapping: ColumnMapping, dateFormat: DateFormat): CrewImportMapping {
  const byHeader: Record<string, CrewField> = {};
  const columns = (Object.entries(mapping) as [CrewField, number | undefined][])
    .flatMap(([field, column]) => (column === undefined ? [] : [{ field, column }]))
    .sort((a, b) => a.column - b.column);
  for (const { field, column } of columns) {
    const key = normaliseHeader(header[column] ?? null);
    if (key !== '' && !Object.hasOwn(byHeader, key)) byHeader[key] = field;
  }
  return { byHeader, dateFormat };
}
