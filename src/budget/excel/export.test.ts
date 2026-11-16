import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { budgetWorkbook } from '../../../e2e/fixtures/makeBudgetXlsx';
import { defaultCategoryId } from '../../db/budget';
import type { BudgetCategory, BudgetCorrection, BudgetEntry, BudgetMonth } from '../../domain/types';
import { category, correction, debt, entry, month } from '../../test/budgetRecords';
import { DEFAULT_CATEGORIES } from '../catalog';
import { budgetWorkbookOf, exportFileName } from './export';
import type { ExportData } from './export';
import { defaultChoices, importWrites, previewImport, readBudgetWorkbook } from './import';

// Every label, amount and note comes from the made-up fixture.

const defaults: BudgetCategory[] = DEFAULT_CATEGORIES.map((c, order) => category(defaultCategoryId(c), c.pot, { name: c.name, group: c.group, order }));
const id = (pot: string, name: string) => defaultCategoryId({ pot, name });

/** The made-up workbook imported into records, as the app would hold them. */
async function imported(): Promise<ExportData> {
  const months = (await readBudgetWorkbook(budgetWorkbook().buffer as ArrayBuffer)).months;
  const choices = defaultChoices(months, defaults, []);
  choices.mapping['needs|ciscenje'] = { categoryId: id('needs', 'Other needs') };
  choices.debtId = 'debt-1';
  choices.bank = { ym: '2026-10', balance: 250000 };
  const w = importWrites({ months, choices, categories: defaults, entries: [], budgetMonths: [], corrections: [] });
  const entries: BudgetEntry[] = w.entries.map((e) => entry(e.date, e.amount, e));
  const budgetMonths: BudgetMonth[] = w.months.create.map((m) => month(m.ym, m));
  const corrections: BudgetCorrection[] = w.corrections.create.map((c) => correction(c.account, c.ym, c.balance));
  return {
    categories: defaults, entries, months: budgetMonths, corrections, debts: [debt({ id: 'debt-1', startBalance: 450000, startYm: '2026-08' })],
    funds: [], fundMoves: [], assets: [], recurring: [],
  };
}

const sheetRows = (book: XLSX.WorkBook, name: string) => XLSX.utils.sheet_to_json<(string | number | null)[]>(book.Sheets[name], { header: 1, defval: null });

describe('budgetWorkbookOf', () => {
  it('writes one sheet per month in the workbook layout, plus a summary sheet', async () => {
    const book = XLSX.read(budgetWorkbookOf(await imported(), '2026-08', '2026-10'), { type: 'array' });
    expect(book.SheetNames).toEqual(['Summary', 'August 2026', 'September 2026', 'October 2026']);
    const aug = sheetRows(book, 'August 2026');
    expect(aug[2].slice(0, 3)).toEqual(['POTREBE', null, 1500]);
    expect(aug[7][0]).toBe('PRIMANJA');
    expect(aug[7][4]).toBe('POTREBE');
    expect(aug[7][8]).toBe('ŠTEDNJE I INVESTICIJE');
    expect(aug[7][12]).toBe('ŽELJE');
    expect(aug[7][16]).toBe('DUGOVANJA');
    // The Needs lines sit under their group's heading, a row with a label and no amount.
    const needs = aug.slice(9).map((r) => [r[4], r[6]]).filter(([label]) => label !== null);
    expect(needs.slice(0, 3)).toEqual([['Housing', null], ['Rent / mortgage', 600], ['Utilities & bills', 70.5]]);
    const summary = sheetRows(book, 'Summary');
    expect(summary[0]).toEqual(['Month', 'Planned income', 'Income received', 'Needs', 'Savings & investments', 'Wants', 'Debts', 'Emergency fund', 'Surplus']);
    expect(summary[1]).toEqual(['August 2026', 3200, 100, 1415.5, 800, 105, 300, 200, 379.5]);
  });

  it('round-trips: importing the export gives the same months, totals, plan, balances and notes', async () => {
    const data = await imported();
    const original = (await readBudgetWorkbook(budgetWorkbook().buffer as ArrayBuffer)).months;
    const back = (await readBudgetWorkbook(budgetWorkbookOf(data, '2026-08', '2026-10'))).months;
    expect(back.map((m) => m.ym)).toEqual(['2026-08', '2026-09', '2026-10']);
    const totals = (months: typeof back) => previewImport(months, defaultChoices(months, defaults, []), defaults, []).map((p) => [p.ym, p.plannedIncome, p.pots.map((x) => x.total)]);
    expect(totals(back)).toEqual(totals(original));
    back.forEach((m, i) => {
      expect(m.potTargets).toEqual(original[i].potTargets);
      expect(m.balances).toMatchObject(original[i].balances);
      expect(m.notes).toEqual(original[i].notes);
      expect(m.sheetSpent).toEqual(original[i].sheetSpent);
    });
    expect(back[2].balances.bank).toBe(250000);
    // Every line maps on its own: the export names the app's categories.
    const mapping = defaultChoices(back, defaults, []);
    expect(Object.keys(mapping.mapping).length).toBeGreaterThan(0);
    expect(previewImport(back, mapping, defaults, [])[0].pots.every((p) => p.difference === 0)).toBe(true);
  });

  it('a year gives twelve month sheets, empty months included', async () => {
    const book = XLSX.read(budgetWorkbookOf(await imported(), '2026-01', '2026-12'), { type: 'array' });
    expect(book.SheetNames).toHaveLength(13);
    expect(book.SheetNames[1]).toBe('January 2026');
    expect(book.SheetNames[12]).toBe('December 2026');
  });
});

describe('exportFileName', () => {
  it('names a month, a year or a range', () => {
    expect(exportFileName('2026-10', '2026-10')).toBe('budget-2026-10.xlsx');
    expect(exportFileName('2026-01', '2026-12')).toBe('budget-2026.xlsx');
    expect(exportFileName('2026-08', '2026-10')).toBe('budget-2026-08-to-2026-10.xlsx');
  });
});
