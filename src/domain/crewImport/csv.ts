/** Counts the commas and semicolons outside quotes on the first line, so quoted values cannot skew the choice. */
function detectDelimiter(text: string): ',' | ';' {
  let commas = 0;
  let semicolons = 0;
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) break;
    else if (!inQuotes && ch === ',') commas++;
    else if (!inQuotes && ch === ';') semicolons++;
  }
  return semicolons > commas ? ';' : ',';
}

/**
 * Parses CSV text into rows of strings. Handles a leading BOM, `"` quoting with `""` escapes, quoted line breaks and
 * CRLF. The delimiter is `;` when the first line has more unquoted semicolons than commas, otherwise `,`.
 * Trailing rows with no content are dropped.
 */
export function parseCsv(text: string): string[][] {
  const source = text.startsWith('﻿') ? text.slice(1) : text;
  const delimiter = detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStart = true;

  const endField = () => {
    row.push(field);
    field = '';
    fieldStart = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inQuotes) {
      if (ch !== '"') field += ch;
      else if (source[i + 1] === '"') {
        field += '"';
        i++;
      } else inQuotes = false;
    } else if (ch === '"' && fieldStart) {
      inQuotes = true;
      fieldStart = false;
    } else if (ch === delimiter) endField();
    else if (ch === '\n') endRow();
    else if (ch === '\r') {
      if (source[i + 1] === '\n') i++;
      endRow();
    } else {
      field += ch;
      fieldStart = false;
    }
  }
  if (field !== '' || row.length > 0) endRow();

  while (rows.length > 0 && rows[rows.length - 1].every(value => value === '')) rows.pop();
  return rows;
}
