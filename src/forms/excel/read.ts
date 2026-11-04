import { parseDate } from '../format';
import type { Package } from '../package';
import type { DraftValues, FieldDef, FormSchema, FormValue } from '../types';
import { kindOfFormat } from './numFmt';
import { columnOfLoc, parseCellLoc, refOf } from './refs';
import { fractionToTime, serialToIso } from './values';
import { loadWorkbook } from './workbook';
import type { CellModel, SheetModel } from './workbook';

/*
 * Reading the values of a filled Excel form back (spec §8, the integrity check), through the stored addresses (R1):
 * nothing is detected again. Values come back in their canonical form (R2), as `canonicalExcelValue` gives them for
 * what was written:
 * - a `date` field reads as ISO `YYYY-MM-DD`: a number in a date-formatted cell as the date of its serial, in the
 *   workbook's date system; text through `parseDate` with the field's `formatHint`, which only accepts the very text
 *   `formatDate` writes, so the date read is the date written. Other text is given back as it is;
 * - a `time` field reads as `HH:mm`: a number in a time-formatted cell as the time of day of its fraction. Text is
 *   given back as it is (the writer writes `HH:mm` text into a cell with no time format);
 * - a `checkbox` reads as a boolean from a `t="b"` cell;
 * - everything else reads as the cell's text: a shared or inline string (with `\n` for a line break and `_xHHHH_`
 *   decoded), or a number as the file holds it (`2.5`).
 *
 * A cell with no `<c>`, or one with no value, reads as `null`. A field whose sheet part is not in the package is left
 * out of the result. Each group reads as `capacity` rows (Excel groups never grow), with every column in each.
 */

function readCell(cell: CellModel | undefined, field: FieldDef, date1904: boolean): FormValue {
  if (!cell || cell.text === '') return null;
  const isNumber = (cell.type === undefined || cell.type === 'n') && cell.formula === undefined;
  const format = kindOfFormat(cell.numFmtId, cell.numFmt);
  switch (field.kind) {
    case 'checkbox':
      return cell.type === 'b' ? cell.text === 'TRUE' : cell.text;
    case 'date':
      if (isNumber && format === 'date') return serialToIso(Number(cell.text), date1904) ?? cell.text;
      return parseDate(cell.text, field.formatHint) ?? cell.text;
    case 'time':
      if (isNumber && format === 'time') return fractionToTime(Number(cell.text)) ?? cell.text;
      return cell.text;
    default:
      return cell.text;
  }
}

/** Reads every field and group of `schema` from a workbook written by `writeExcel` (or from the template itself). */
export function readExcelValues(pkg: Package, schema: FormSchema): DraftValues {
  const workbook = loadWorkbook(pkg);
  const sheets = new Map<string, SheetModel>(workbook.sheets.map((sheet) => [sheet.path, sheet]));
  const out: DraftValues = { fields: {}, rows: {} };

  for (const field of schema.fields) {
    const at = parseCellLoc(field.loc);
    const sheet = at && sheets.get(at.part);
    if (!at || !sheet) continue;
    out.fields[field.id] = readCell(sheet.cells.get(at.ref), field, workbook.date1904);
  }

  for (const group of schema.rowGroups) {
    const at = parseCellLoc(group.loc);
    const sheet = at && sheets.get(at.part);
    if (!at || !sheet) continue;
    const firstRow = group.firstRow ?? at.row;
    const columns = group.columns.map((column) => ({ column, col: columnOfLoc(column.loc) }));
    out.rows[group.id] = Array.from({ length: group.capacity }, (_, i) => {
      const record: Record<string, FormValue> = {};
      for (const { column, col } of columns) {
        record[column.id] = col === undefined ? null : readCell(sheet.cells.get(refOf(col, firstRow + i)), column, workbook.date1904);
      }
      return record;
    });
  }
  return out;
}
