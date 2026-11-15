import * as XLSX from 'xlsx';
import type { Extracted } from './index';

/** One part per sheet: the cell values of each row joined by spaces, one row per line. */
export function extractXlsx(data: ArrayBuffer): Extracted {
  try {
    const book = XLSX.read(new Uint8Array(data), { type: 'array', cellDates: false });
    const parts: Extracted['parts'] = [];
    book.SheetNames.forEach((name, i) => {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false });
      const text = rows.map((r) => r.map((c) => String(c).trim()).filter(Boolean).join(' ')).filter(Boolean).join('\n');
      if (text) parts.push({ part: i + 1, label: `Sheet ${name}`, text });
    });
    return { textStatus: parts.length ? 'indexed' : 'no-text', parts };
  } catch {
    return { textStatus: 'failed', textError: 'Damaged workbook', parts: [] };
  }
}
