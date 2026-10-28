import { promises as fs } from 'node:fs';
import * as XLSX from 'xlsx';

export type CrewSheetRow = (string | number | null)[];

/** The crew list of the import tests: title rows and a blank row above the header, a blank row and a total below the crew. */
export const CREW_LIST_ROWS: CrewSheetRow[] = [
  ['CREW LIST'],
  ['MV OCEAN STAR'],
  [],
  ['No.', 'Surname', 'Given names', 'Rank', 'Date of birth', 'Passport No'],
  ['1', 'PETROVIĆ', 'Ivan', 'Master', '05.01.1985', '012345678'],
  ['2', "O'BRIEN", 'Jean-Luc', 'A/B', '31.02.1990', 'X1'],
  ['3', 'ŠAŠIĆ', 'Marko', 'C/O', '12.12.1990', 'P77'],
  [],
  ['Total crew: 3'],
];

/**
 * Writes a one-sheet workbook to `path`: `.xlsx` for 'xlsx', and the old `.xls` (BIFF8) for 'biff8'. It writes the bytes
 * itself, since `XLSX.writeFile` needs the file system handed to SheetJS first when it is loaded as an ES module, as
 * Playwright loads this file.
 */
export async function makeCrewXlsx(path: string, bookType: 'xlsx' | 'biff8' = 'xlsx', rows: CrewSheetRow[] = CREW_LIST_ROWS): Promise<void> {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Crew');
  await fs.writeFile(path, XLSX.write(book, { type: 'buffer', bookType }));
}
