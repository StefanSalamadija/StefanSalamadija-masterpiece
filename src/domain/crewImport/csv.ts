const DELIMITER_SAMPLE_LINES = 10;

/**
 * Counts the commas and semicolons outside quotes over the first 10 non-empty lines, so a title line above the header
 * cannot decide the delimiter. A tie, or no delimiters at all, gives a comma.
 */
function detectDelimiter(text: string): ',' | ';' {
  let commas = 0;
  let semicolons = 0;
  let inQuotes = false;
  let lines = 0;
  let lineHasContent = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (lineHasContent && ++lines === DELIMITER_SAMPLE_LINES) break;
      lineHasContent = false;
      continue;
    }
    if (ch.trim() !== '') lineHasContent = true;
    if (!inQuotes && ch === ',') commas++;
    else if (!inQuotes && ch === ';') semicolons++;
  }
  return semicolons > commas ? ';' : ',';
}

/**
 * Parses CSV text into rows of strings. Handles a leading BOM, `"` quoting with `""` escapes, quoted line breaks and
 * CRLF. The delimiter is `;` when the first 10 non-empty lines have more unquoted semicolons than commas, otherwise `,`.
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
