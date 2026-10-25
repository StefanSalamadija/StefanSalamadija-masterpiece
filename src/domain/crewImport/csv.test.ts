import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('handles quoted commas and CRLF line endings', () => {
    expect(parseCsv('Surname,Given names\r\n"Smith, Jr",John\r\n')).toEqual([['Surname', 'Given names'], ['Smith, Jr', 'John']]);
  });

  it('uses ; as the delimiter when the first line has more of them than commas', () => {
    expect(parseCsv('Surname;Rank\nPetrović;Master')).toEqual([['Surname', 'Rank'], ['Petrović', 'Master']]);
  });

  it('keeps commas inside values of a semicolon file', () => {
    expect(parseCsv('Name;Rank\n"Smith, John";Master')).toEqual([['Name', 'Rank'], ['Smith, John', 'Master']]);
  });

  it('ignores delimiters inside quotes when picking the delimiter', () => {
    expect(parseCsv('"A;B;C",D\n1,2')).toEqual([['A;B;C', 'D'], ['1', '2']]);
  });

  it('strips a BOM, unescapes doubled quotes and drops trailing empty lines', () => {
    expect(parseCsv('﻿a,"He said ""hi"""\n\n\n')).toEqual([['a', 'He said "hi"']]);
  });

  it('keeps line breaks inside quoted values', () => {
    expect(parseCsv('a,"line 1\nline 2"\nb,c')).toEqual([['a', 'line 1\nline 2'], ['b', 'c']]);
  });

  it('keeps empty fields and a final row without a line ending', () => {
    expect(parseCsv('a,,c\n,,')).toEqual([['a', '', 'c']]);
    expect(parseCsv('a,,c\n,x,')).toEqual([['a', '', 'c'], ['', 'x', '']]);
  });

  it('keeps blank lines in the middle of the file', () => {
    expect(parseCsv('a\n\nb')).toEqual([['a'], [''], ['b']]);
  });

  it('returns no rows for empty input', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('﻿\r\n')).toEqual([]);
  });
});
