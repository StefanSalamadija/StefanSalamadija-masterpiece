import * as XLSX from 'xlsx';
import type {
  BudgetAsset, BudgetCategory, BudgetCorrection, BudgetDebt, BudgetEntry, BudgetFund, BudgetFundMove, BudgetMonth, BudgetRecurring, Cents, IncomeSource,
  PotId, Ym,
} from '../../domain/types';
import { POTS } from '../catalog';
import { balancesByMonth } from '../ledger';
import { summariseMonth } from '../month';
import type { MonthSummary } from '../month';
import { addMonths, monthLabel, monthsBetween, ymOf } from '../months';
import { effectiveMonth } from '../targets';

/*
 * The budget as an Excel workbook (base §3.9): a summary sheet, then one sheet per month named `<Month> <YYYY>` in the
 * layout of the user's own workbook, so that the import reads it back:
 *  - rows 3–7: the pots' labels (A), targets (C), target and spent shares (H, K), spent (N) and unused (Q);
 *  - row 8: the blocks PRIMANJA (A), POTREBE (E), ŠTEDNJE I INVESTICIJE (I), ŽELJE (M) and DUGOVANJA (Q), with their
 *    lines from row 10, labels in the heading's column and amounts two to the right. PRIMANJA's first line is the
 *    planned income, then each income received; the others list each category's spending, Needs under group headings;
 *  - a STANJA block in W–Z with the month-end investments, debts, emergency fund and bank;
 *  - "Komentari i napomene" below the blocks, with the month's notes under it.
 * Amounts are numbers in euros, never formulas.
 */

export interface ExportData {
  categories: BudgetCategory[]; entries: BudgetEntry[]; months: BudgetMonth[]; funds: BudgetFund[]; fundMoves: BudgetFundMove[];
  corrections: BudgetCorrection[]; debts: BudgetDebt[]; assets: BudgetAsset[]; recurring: BudgetRecurring[];
}

type Value = string | number;
const MONEY = '#,##0.00';
const PCT = '0.00%';

const POT_LABELS: Record<PotId, string> = { needs: 'POTREBE', savings: 'INVESTICIJE', wants: 'ŽELJE', debts: 'DUGOVANJA', emergency: 'CRNI FOND' };
const SOURCE_LABELS: Record<IncomeSource, string> = { salary: 'Salary', property: 'Property', sales: 'Sales', jobs: 'Jobs', other: 'Other income' };
/** Where each block's labels are (its amounts are two columns to the right). */
const BLOCK_COLUMNS = { income: 0, needs: 4, savings: 8, wants: 12, debts: 16 } as const;
const FIRST_LINE = 9;
const STANJA_COLUMN = 22;
const STANJA_VALUE = 25;

const euros = (c: Cents) => c / 100;

class SheetWriter {
  readonly sheet: XLSX.WorkSheet = {};
  private lastRow = 0;
  private lastColumn = 0;

  set(r: number, c: number, value: Value | undefined, format?: string): void {
    if (value === undefined) return;
    const cell: XLSX.CellObject = typeof value === 'number' ? { t: 'n', v: value, ...(format !== undefined && { z: format }) } : { t: 's', v: value };
    this.sheet[XLSX.utils.encode_cell({ r, c })] = cell;
    this.lastRow = Math.max(this.lastRow, r);
    this.lastColumn = Math.max(this.lastColumn, c);
  }

  done(widths: number[] = []): XLSX.WorkSheet {
    this.sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: this.lastRow, c: this.lastColumn } });
    if (widths.length > 0) this.sheet['!cols'] = widths.map((wch) => ({ wch }));
    return this.sheet;
  }
}

interface Line { label: string; amount?: Cents }

/** The month's lines of a pot: each category's spending, in the categories' order, Needs under their group headings. */
function potLines(pots: PotId[], summary: MonthSummary, categories: BudgetCategory[], headings: boolean): Line[] {
  const spent = new Map(summary.categories.map((c) => [c.categoryId, c.spent]));
  const lines: Line[] = [];
  let group: string | undefined;
  for (const c of categories) {
    const amount = spent.get(c.id) ?? 0;
    if (!pots.includes(c.pot) || amount === 0) continue;
    if (headings && c.group !== undefined && c.group !== group) lines.push({ label: c.group });
    group = c.group;
    lines.push({ label: c.name, amount });
  }
  return lines;
}

function monthSheet(ym: Ym, data: ExportData, summary: MonthSummary, balances: Record<string, Cents> | undefined, notes: string | undefined, hasTarget: (pot: PotId) => boolean): XLSX.WorkSheet {
  const w = new SheetWriter();
  w.set(0, 2, 'IDEALNA RASPODJELA NOVCA'); w.set(0, 7, 'CILJ (%)'); w.set(0, 10, 'STVARNO STANJE(%)'); w.set(0, 13, 'UKUPNO POTROŠENO');
  w.set(0, 16, 'NEISKORIŠĆENO'); w.set(0, 22, 'UKUPNI VIŠAK'); w.set(0, 25, euros(summary.surplus), MONEY);
  POTS.forEach(({ id }, i) => {
    const p = summary.pots.find((x) => x.pot === id)!;
    const r = 2 + i;
    w.set(r, 0, POT_LABELS[id]);
    if (hasTarget(id)) {
      w.set(r, 2, euros(p.target), MONEY);
      w.set(r, 7, p.targetPct / 100, PCT);
    }
    w.set(r, 10, p.spentPct / 100, PCT);
    w.set(r, 13, euros(p.spent), MONEY);
    w.set(r, 16, euros(p.unused), MONEY);
  });
  w.set(7, BLOCK_COLUMNS.income, 'PRIMANJA'); w.set(7, BLOCK_COLUMNS.needs, 'POTREBE'); w.set(7, BLOCK_COLUMNS.savings, 'ŠTEDNJE I INVESTICIJE');
  w.set(7, BLOCK_COLUMNS.wants, 'ŽELJE'); w.set(7, BLOCK_COLUMNS.debts, 'DUGOVANJA');

  const income: Line[] = [{ label: 'Planned income', ...(summary.plannedIncome > 0 && { amount: summary.plannedIncome }) }];
  for (const e of data.entries) {
    if (!e.deleted && e.kind === 'income' && e.status === 'actual' && ymOf(e.date) === ym) {
      income.push({ label: e.note ?? e.payee ?? SOURCE_LABELS[e.incomeSource ?? 'other'], amount: e.amount });
    }
  }
  const categories = data.categories.filter((c) => !c.deleted);
  const blocks: [number, Line[]][] = [
    [BLOCK_COLUMNS.income, income],
    [BLOCK_COLUMNS.needs, potLines(['needs'], summary, categories, true)],
    [BLOCK_COLUMNS.savings, potLines(['savings', 'emergency'], summary, categories, false)],
    [BLOCK_COLUMNS.wants, potLines(['wants'], summary, categories, false)],
    [BLOCK_COLUMNS.debts, potLines(['debts'], summary, categories, false)],
  ];
  let last = FIRST_LINE;
  for (const [c, lines] of blocks) {
    lines.forEach((line, i) => {
      w.set(FIRST_LINE + i, c, line.label);
      if (line.amount !== undefined) w.set(FIRST_LINE + i, c + 2, euros(line.amount), MONEY);
    });
    last = Math.max(last, FIRST_LINE + lines.length);
  }

  const debts = Object.entries(balances ?? {}).reduce((sum, [account, v]) => (account.startsWith('debt:') ? sum + v : sum), 0);
  const stanja: [string, Cents][] = [
    ['INVESTICIJE', balances?.investments ?? 0], ['DUGOVANJA', debts], ['CRNI FOND', balances?.emergency ?? 0], ['BANKA', balances?.bank ?? 0],
  ];
  w.set(FIRST_LINE, STANJA_COLUMN, 'STANJA');
  stanja.forEach(([label, value], i) => {
    w.set(FIRST_LINE + 1 + i, STANJA_COLUMN, label);
    w.set(FIRST_LINE + 1 + i, STANJA_VALUE, euros(value), MONEY);
  });

  const notesRow = Math.max(last, FIRST_LINE + 1 + stanja.length) + 1;
  for (const c of Object.values(BLOCK_COLUMNS)) w.set(notesRow, c, 'Komentari i napomene');
  if (notes !== undefined && notes !== '') w.set(notesRow + 1, 0, notes);

  const sheet = w.done([16, 2, 12, 2, 24, 2, 12, 2, 24, 2, 12, 2, 24, 2, 12, 2, 20, 2, 12, 2, 2, 2, 14, 2, 2, 12]);
  sheet['!merges'] = [0, 1, 2, 3, 4].flatMap((i) => [
    { s: { r: 2 + i, c: 0 }, e: { r: 2 + i, c: 1 } }, { s: { r: 2 + i, c: 2 }, e: { r: 2 + i, c: 6 } },
  ]);
  return sheet;
}

const SUMMARY_HEAD = ['Month', 'Planned income', 'Income received', ...POTS.map((p) => p.label), 'Surplus'];

/** The months from `fromYm` to `toYm` as an .xlsx workbook: the summary sheet, then a sheet per month. */
export function budgetWorkbookOf(data: ExportData, fromYm: Ym, toYm: Ym): ArrayBuffer {
  const count = monthsBetween(fromYm, toYm) + 1;
  if (count < 1) throw new Error('The last month comes before the first.');
  const yms = Array.from({ length: count }, (_, i) => addMonths(fromYm, i));
  const { balances } = balancesByMonth({
    entries: data.entries, corrections: data.corrections, debts: data.debts, assets: data.assets, categories: data.categories,
    fundMoves: data.fundMoves, funds: data.funds, recurring: data.recurring, fromYm, toYm,
  });
  const summary = new SheetWriter();
  SUMMARY_HEAD.forEach((label, c) => summary.set(0, c, label));
  const sheets: [string, XLSX.WorkSheet][] = [];
  yms.forEach((ym, i) => {
    const plan = effectiveMonth(data.months, ym);
    const s = summariseMonth({ month: plan, entries: data.entries, categories: data.categories, fundMoves: data.fundMoves, funds: data.funds, corrections: data.corrections });
    const name = monthLabel(ym);
    sheets.push([name, monthSheet(ym, data, s, balances.get(ym), plan.notes, (pot) => plan.potTargets[pot] !== undefined)]);
    const row = [name, plan.plannedIncome === undefined ? undefined : euros(plan.plannedIncome), euros(s.actualIncome),
      ...POTS.map((p) => euros(s.pots.find((x) => x.pot === p.id)!.spent)), euros(s.surplus)];
    row.forEach((v, c) => summary.set(i + 1, c, v, c === 0 ? undefined : MONEY));
  });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, summary.done([16, 16, 16, 14, 22, 14, 14, 16, 14]), 'Summary');
  for (const [name, sheet] of sheets) XLSX.utils.book_append_sheet(book, sheet, name);
  return XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
}

/** `budget-2026-10.xlsx` for a month, `budget-2026.xlsx` for a calendar year, `budget-2026-08-to-2026-10.xlsx` for a range. */
export function exportFileName(fromYm: Ym, toYm: Ym): string {
  if (fromYm === toYm) return `budget-${fromYm}.xlsx`;
  const year = fromYm.slice(0, 4);
  if (fromYm === `${year}-01` && toYm === `${year}-12`) return `budget-${year}.xlsx`;
  return `budget-${fromYm}-to-${toYm}.xlsx`;
}
