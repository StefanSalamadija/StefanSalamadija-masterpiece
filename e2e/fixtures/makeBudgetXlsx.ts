import { promises as fs } from 'node:fs';
import * as XLSX from 'xlsx';

/*
 * A made-up budget workbook in the layout the budget import reads (base §3.9). Every label, amount and note here is
 * invented. The layout is the workbook's own:
 *  - rows 3–7: POTREBE, INVESTICIJE, ŽELJE, DUGOVANJA, CRNI FOND in column A, their amounts in C, and the sheet's own
 *    "UKUPNO POTROŠENO" (spent) in N, as formulas with their values;
 *  - row 8: the block headings PRIMANJA (A), POTREBE (E), ŠTEDNJE I INVESTICIJE (I), ŽELJE (M), DUGOVANJA (Q), each
 *    over two rows; the lines start at row 10, labels in the heading's column and amounts two columns to the right;
 *  - a Needs row with a label and no amount is a group heading;
 *  - a STANJA block in column W (values in Z), at a row that differs between sheets;
 *  - "Komentari i napomene" under the blocks, with the notes in the row below.
 */

export type Line = [label: string, amount: number];
/** A Needs row: a line, or a group heading (a label alone). */
export type NeedsRow = Line | [heading: string];

export interface FakeMonth {
  sheet: string;
  /** Needs, Investments, Wants, Debts, Emergency fund (CRNI FOND), in euros. */
  pots: [number, number, number, number, number];
  /** The first line is the planned income; the others are more income. */
  income: Line[];
  needs: NeedsRow[];
  savings: Line[];
  wants: Line[];
  debts: Line[];
  /** The month-end balances of the STANJA block, and the row (1-based) it starts at. */
  stanja?: { row: number; investments: number; debts: number; emergency: number };
  notes?: string;
}

/** Three made-up months: Serbian and English month names, Needs of different lengths, STANJA at different rows. */
export const FAKE_MONTHS: FakeMonth[] = [
  {
    sheet: 'Avgust 2026',
    pots: [1500, 800, 400, 300, 200],
    income: [['Plata prosjek', 3200], ['Izdavanje garaže', 100]],
    needs: [['Kirija', 600], ['Struja', 70.5], ['Apoteka', 25], ['AUTO'], ['Gorivo', 120], ['Registracija', 210], ['DRUGO'], ['Čišćenje', 40], ['Hrana', 350]],
    savings: [['S&P 500 ETF', 800], ['CRNI FOND', 200]],
    wants: [['Kafić sa društvom', 45], ['Koncert', 60]],
    debts: [['Rata kredita', 250], ['Dug prijatelju', 50]],
    stanja: { row: 23, investments: 12000, debts: 4500, emergency: 3000 },
    notes: 'Mirna sedmica, ništa posebno.',
  },
  {
    sheet: 'Septembar 2026',
    pots: [1500, 800, 400, 300, 200],
    income: [['Plata prosjek', 3200]],
    needs: [['Kirija', 600], ['Struja', 64], ['AUTO'], ['Gorivo', 95], ['DRUGO'], ['Čišćenje', 40], ['Hrana', 320]],
    savings: [['S&P 500 ETF', 800], ['CRNI FOND', 200]],
    wants: [['Poklon', 30]],
    debts: [['Rata kredita', 250]],
    stanja: { row: 19, investments: 12900, debts: 4270, emergency: 3200 },
  },
  {
    sheet: 'October 2026',
    pots: [1600, 800, 300, 300, 200],
    income: [['Plata prosjek', 3200]],
    needs: [['Kirija', 600], ['Struja', 58.25], ['Apoteka', 12], ['AUTO'], ['Gorivo', 110], ['DRUGO'], ['Hrana', 300]],
    savings: [['S&P 500 ETF', 800], ['CRNI FOND', 200]],
    wants: [['Bioskop', 20]],
    debts: [['Rata kredita', 250]],
    stanja: { row: 19, investments: 13800, debts: 4040, emergency: 3400 },
    notes: 'Plan za zimu.',
  },
];

type Cell = { t: 's'; v: string } | { t: 'n'; v: number; f?: string };

const sum = (lines: (NeedsRow | Line)[]) => lines.reduce((s, l) => s + (l.length === 2 ? l[1] : 0), 0);

function sheetOf(month: FakeMonth): XLSX.WorkSheet {
  const cells = new Map<string, Cell>();
  const text = (address: string, v: string) => cells.set(address, { t: 's', v });
  const num = (address: string, v: number, f?: string) => cells.set(address, { t: 'n', v, ...(f !== undefined && { f }) });

  text('C1', 'IDEALNA RASPODJELA NOVCA'); text('H1', 'CILJ (%)'); text('N1', 'UKUPNO POTROŠENO'); text('Q1', 'NEISKORIŠĆENO');
  const potLabels = ['POTREBE', 'INVESTICIJE', 'ŽELJE', 'DUGOVANJA', 'CRNI FOND'];
  const lastRow = 9 + Math.max(month.income.length, month.needs.length, month.savings.length, month.wants.length, month.debts.length);
  const index = month.savings.find(([l]) => l !== 'CRNI FOND');
  const fund = month.savings.find(([l]) => l === 'CRNI FOND');
  const spent = [sum(month.needs), index?.[1] ?? 0, sum(month.wants), sum(month.debts), fund?.[1] ?? 0];
  const spentFormula = [`SUM(G10:H${lastRow})`, 'SUM(K10)', `SUM(O10:P${lastRow})`, `SUM(S10:T${lastRow})`, 'K11'];
  potLabels.forEach((label, i) => {
    const row = 3 + i;
    text(`A${row}`, label);
    num(`C${row}`, month.pots[i]);
    num(`H${row}`, month.pots[i] / (month.income[0]?.[1] || 1), `C${row}/C10`);
    num(`N${row}`, spent[i], spentFormula[i]);
    num(`Q${row}`, month.pots[i] - spent[i], `C${row}-N${row}`);
  });

  text('A8', 'PRIMANJA'); text('E8', 'POTREBE'); text('I8', 'ŠTEDNJE I INVESTICIJE'); text('M8', 'ŽELJE'); text('Q8', 'DUGOVANJA');
  const block = (labelCol: string, amountCol: string, rows: (NeedsRow | Line)[]) => rows.forEach((row, i) => {
    text(`${labelCol}${10 + i}`, row[0]);
    if (row.length === 2) num(`${amountCol}${10 + i}`, row[1]);
  });
  block('A', 'C', month.income); block('E', 'G', month.needs); block('I', 'K', month.savings); block('M', 'O', month.wants); block('Q', 'S', month.debts);

  if (month.stanja) {
    const r = month.stanja.row;
    text(`W${r}`, 'STANJA');
    text(`W${r + 1}`, 'INVESTICIJE'); num(`Z${r + 1}`, month.stanja.investments);
    text(`W${r + 2}`, 'DUGOVANJA'); num(`Z${r + 2}`, month.stanja.debts);
    text(`W${r + 3}`, 'CRNI FOND'); num(`Z${r + 3}`, month.stanja.emergency);
  }

  const notesRow = Math.max(lastRow, month.stanja ? month.stanja.row + 3 : 0) + 2;
  for (const col of ['A', 'E', 'I', 'M', 'Q']) text(`${col}${notesRow}`, 'Komentari i napomene');
  if (month.notes !== undefined) text(`A${notesRow + 1}`, month.notes);

  const sheet: XLSX.WorkSheet = {};
  for (const [address, cell] of cells) sheet[address] = cell;
  sheet['!ref'] = `A1:AA${notesRow + 1}`;
  sheet['!merges'] = [
    ...[3, 4, 5, 6, 7].flatMap((r) => [XLSX.utils.decode_range(`A${r}:B${r}`), XLSX.utils.decode_range(`C${r}:G${r}`), XLSX.utils.decode_range(`N${r}:P${r}`)]),
    ...['A8:D9', 'E8:H9', 'I8:L9', 'M8:P9', 'Q8:T9'].map((r) => XLSX.utils.decode_range(r)),
  ];
  return sheet;
}

/** The workbook's bytes (.xlsx). */
export function budgetWorkbook(months: FakeMonth[] = FAKE_MONTHS): Uint8Array {
  const book = XLSX.utils.book_new();
  for (const month of months) XLSX.utils.book_append_sheet(book, sheetOf(month), month.sheet);
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

/** Writes the made-up workbook to `path` (the bytes are written here: see `makeCrewXlsx`). */
export async function makeBudgetXlsx(path: string, months: FakeMonth[] = FAKE_MONTHS): Promise<void> {
  await fs.writeFile(path, budgetWorkbook(months));
}
