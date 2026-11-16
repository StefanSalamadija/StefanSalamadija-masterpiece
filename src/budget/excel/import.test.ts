import { describe, expect, it } from 'vitest';
import { budgetWorkbook, FAKE_MONTHS } from '../../../e2e/fixtures/makeBudgetXlsx';
import type { FakeMonth } from '../../../e2e/fixtures/makeBudgetXlsx';
import { defaultCategoryId } from '../../db/budget';
import type { BudgetCategory } from '../../domain/types';
import { category, correction, entry, month } from '../../test/budgetRecords';
import { DEFAULT_CATEGORIES } from '../catalog';
import { defaultChoices, importWrites, mappingFor, previewImport, readBudgetWorkbook, sheetYm } from './import';
import type { SheetMonth } from './import';

// Every label, amount and note comes from the made-up fixture.

const defaults: BudgetCategory[] = DEFAULT_CATEGORIES.map((c, order) => category(defaultCategoryId(c), c.pot, { name: c.name, group: c.group, order }));
const id = (pot: string, name: string) => defaultCategoryId({ pot, name });
const bytes = (months: FakeMonth[] = FAKE_MONTHS) => budgetWorkbook(months).buffer as ArrayBuffer;
const read = async (months?: FakeMonth[]) => (await readBudgetWorkbook(bytes(months))).months;

describe('sheetYm', () => {
  it('reads "<Month> <YYYY>" with Serbian or English month names', () => {
    const cases: [string, string][] = [
      ['Januar 2026', '2026-01'], ['Februar 2026', '2026-02'], ['Mart 2026', '2026-03'], ['April 2026', '2026-04'], ['Maj 2026', '2026-05'],
      ['Jun 2026', '2026-06'], ['Jul 2026', '2026-07'], ['Avgust 2026', '2026-08'], ['Septembar 2026', '2026-09'], ['Oktobar 2026', '2026-10'],
      ['Novembar 2025', '2025-11'], ['November 2025', '2025-11'], ['Decembar 2025', '2025-12'], ['March 2027', '2027-03'],
      ['June 2027', '2027-06'], ['August 2027', '2027-08'], ['  oktobar   2026 ', '2026-10'], ['May 2026', '2026-05'],
    ];
    for (const [name, ym] of cases) expect(sheetYm(name), name).toBe(ym);
  });

  it('is undefined for any other sheet name', () => {
    for (const name of ['Summary', 'Sheet1', 'Avgust', '2026', 'Smarch 2026', 'Avgust 26']) expect(sheetYm(name), name).toBeUndefined();
  });
});

describe('readBudgetWorkbook', () => {
  it('finds each month by its sheet name, in month order, and skips other sheets', async () => {
    const months = FAKE_MONTHS.slice();
    const { months: read, skipped } = await readBudgetWorkbook(bytes([months[2], months[0], months[1], { ...months[1], sheet: 'Notes' }]));
    expect(read.map((m) => m.ym)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(skipped).toEqual(['Notes']);
  });

  it('reads the pot amounts (column C) and the planned income (the first PRIMANJA line)', async () => {
    const [aug] = await read();
    expect(aug.potTargets).toEqual({ needs: 150000, savings: 80000, wants: 40000, debts: 30000, emergency: 20000 });
    expect(aug.plannedIncome).toBe(320000);
    expect(aug.lines.filter((l) => l.area === 'income')).toEqual([{ area: 'income', label: 'Izdavanje garaže', amount: 10000, cell: 'C11' }]);
  });

  it('reads Needs by label, with a label-only row as the group heading of the lines under it', async () => {
    const [aug, sep] = await read();
    const needs = (m: SheetMonth) => m.lines.filter((l) => l.area === 'needs').map((l) => [l.label, l.amount, l.group ?? null, l.cell]);
    expect(needs(aug)).toEqual([
      ['Kirija', 60000, null, 'G10'], ['Struja', 7050, null, 'G11'], ['Apoteka', 2500, null, 'G12'],
      ['Gorivo', 12000, 'AUTO', 'G14'], ['Registracija', 21000, 'AUTO', 'G15'],
      ['Čišćenje', 4000, 'DRUGO', 'G17'], ['Hrana', 35000, 'DRUGO', 'G18'],
    ]);
    // The row counts differ between sheets: the lines are found by label, not by row.
    expect(needs(sep)).toEqual([
      ['Kirija', 60000, null, 'G10'], ['Struja', 6400, null, 'G11'], ['Gorivo', 9500, 'AUTO', 'G13'], ['Čišćenje', 4000, 'DRUGO', 'G15'], ['Hrana', 32000, 'DRUGO', 'G16'],
    ]);
  });

  it('reads savings (I/K), wants (M/O) and debts (Q/S)', async () => {
    const [aug] = await read();
    const lines = (area: string) => aug.lines.filter((l) => l.area === area).map((l) => [l.label, l.amount, l.cell]);
    expect(lines('savings')).toEqual([['S&P 500 ETF', 80000, 'K10'], ['CRNI FOND', 20000, 'K11']]);
    expect(lines('wants')).toEqual([['Kafić sa društvom', 4500, 'O10'], ['Koncert', 6000, 'O11']]);
    expect(lines('debts')).toEqual([['Rata kredita', 25000, 'S10'], ['Dug prijatelju', 5000, 'S11']]);
  });

  it("reads the STANJA balances wherever the block sits, the sheet's own spent totals, and the notes", async () => {
    const [aug, sep, oct] = await read();
    expect(aug.balances).toEqual({ investments: 1200000, debts: 450000, emergency: 300000 });
    expect(sep.balances).toEqual({ investments: 1290000, debts: 427000, emergency: 320000 });
    // Formulas are not run: their saved values are read.
    expect(aug.sheetSpent).toEqual({ needs: 141550, savings: 80000, wants: 10500, debts: 30000, emergency: 20000 });
    expect(aug.notes).toBe('Mirna sedmica, ništa posebno.');
    expect(sep.notes).toBeUndefined();
    expect(oct.notes).toBe('Plan za zimu.');
  });

  it('a month sheet with empty blocks gives a month with no lines', async () => {
    const { months, skipped } = await readBudgetWorkbook(bytes([{ ...FAKE_MONTHS[0], sheet: 'Jun 2026', pots: [0, 0, 0, 0, 0], income: [], needs: [], savings: [], wants: [], debts: [], stanja: undefined }]));
    expect(months).toHaveLength(1);
    expect(months[0].lines).toEqual([]);
    expect(skipped).toEqual([]);
  });
});

describe('mappingFor', () => {
  it('matches labels to categories by name, synonym or a known word, and offers a new category for the rest', async () => {
    const months = await read();
    const cats = [...defaults, category('cat-books', 'wants', { name: 'Knjige', synonyms: ['Koncert'] })];
    const mapping = mappingFor(months, cats);
    const of = (area: string, label: string) => mapping.find((m) => m.area === area && m.label === label)!;
    expect(of('needs', 'Apoteka').choice).toEqual({ categoryId: id('needs', 'Pharmacy') });
    expect(of('needs', 'Kirija').choice).toEqual({ categoryId: id('needs', 'Rent / mortgage') });
    expect(of('needs', 'Gorivo').choice).toEqual({ categoryId: id('needs', 'Fuel & parking') });
    expect(of('needs', 'Hrana').choice).toEqual({ categoryId: id('needs', 'Groceries, food & drink') });
    expect(of('savings', 'S&P 500 ETF').choice).toEqual({ categoryId: id('savings', 'Index funds / ETFs (e.g. S&P 500)') });
    expect(of('savings', 'CRNI FOND').choice).toEqual({ categoryId: id('emergency', 'Emergency fund') });
    expect(of('debts', 'Rata kredita').choice).toEqual({ categoryId: id('debts', 'Loan instalment') });
    expect(of('debts', 'Dug prijatelju').choice).toEqual({ categoryId: id('debts', 'Personal debts') });
    const unknown = of('needs', 'Čišćenje');
    expect(unknown.known).toBe(false);
    expect(unknown.choice).toEqual({ newCategory: { pot: 'needs', name: 'Čišćenje', group: 'DRUGO' } });
    expect(unknown.lines).toBe(2);
    expect(mapping.filter((m) => !m.known).map((m) => m.label)).toEqual(['Čišćenje']);
    // Wants lines are free text: they are not listed; each goes to the Wants category it names, else to one chosen.
    expect(mapping.map((m) => m.area).filter((a) => !['needs', 'savings', 'debts'].includes(a))).toEqual([]);
  });

  it('a synonym saved on a category matches, whatever the case and accents', async () => {
    const months = await read();
    const cats = [...defaults, category('cat-clean', 'needs', { name: 'Cleaning', synonyms: ['ciscenje'] })];
    expect(mappingFor(months, cats).find((m) => m.label === 'Čišćenje')!.choice).toEqual({ categoryId: 'cat-clean' });
  });
});

describe('previewImport', () => {
  it("gives each month's totals per pot next to the sheet's own, with the differences", async () => {
    const months = await read();
    months[1].sheetSpent.needs = (months[1].sheetSpent.needs ?? 0) + 1000; // as if the sheet's formula left a line out
    const choices = defaultChoices(months, defaults, []);
    const preview = previewImport(months, choices, defaults, []);
    expect(preview.map((p) => p.ym)).toEqual(['2026-08', '2026-09', '2026-10']);
    const aug = preview[0];
    expect(aug.plannedIncome).toBe(320000);
    expect(aug.pots).toEqual([
      { pot: 'needs', total: 141550, sheet: 141550, difference: 0 },
      { pot: 'savings', total: 80000, sheet: 80000, difference: 0 },
      { pot: 'wants', total: 10500, sheet: 10500, difference: 0 },
      { pot: 'debts', total: 30000, sheet: 30000, difference: 0 },
      { pot: 'emergency', total: 20000, sheet: 20000, difference: 0 },
    ]);
    expect(aug.entries).toBe(14); // 13 expense lines and one more income
    expect(preview[1].pots[0]).toEqual({ pot: 'needs', total: 111900, sheet: 112900, difference: -1000 });
    expect(aug.replaces).toBe(0);
  });
});

describe('importWrites', () => {
  it('replaces only the entries imported before into the same months, never ones added in the app', async () => {
    const months = await read();
    const before = [
      entry('2026-08-01', 59000, { id: 'old-import', categoryId: id('needs', 'Rent / mortgage'), importKey: 'xlsx:2026-08:G10' }),
      entry('2026-08-01', 99900, { id: 'old-moved', categoryId: id('needs', 'Rent / mortgage'), importKey: 'xlsx:2026-08:G30' }),
      entry('2026-08-14', 1200, { id: 'typed-in-app', categoryId: id('wants', 'Cafés & restaurants') }),
      entry('2026-07-01', 5000, { id: 'july-import', categoryId: id('needs', 'Pharmacy'), importKey: 'xlsx:2026-07:G12' }),
    ];
    const choices = defaultChoices(months, defaults, []);
    expect(previewImport(months, choices, defaults, before)[0].replaces).toBe(2);
    const w = importWrites({ months, choices: { ...choices, mapping: { ...choices.mapping, 'needs|ciscenje': { categoryId: id('needs', 'Other needs') } } },
      categories: defaults, entries: before, budgetMonths: [], corrections: [] });
    expect(w.deleteEntryIds.sort()).toEqual(['old-import', 'old-moved']);
    const aug = w.entries.filter((e) => e.date.startsWith('2026-08'));
    expect(aug).toHaveLength(14);
    expect(aug.find((e) => e.importKey === 'xlsx:2026-08:G10')).toEqual({
      kind: 'expense', date: '2026-08-01', amount: 60000, categoryId: id('needs', 'Rent / mortgage'), status: 'actual', importKey: 'xlsx:2026-08:G10',
    });
    expect(aug.find((e) => e.importKey === 'xlsx:2026-08:O10')).toMatchObject({ categoryId: id('wants', 'Other wants'), note: 'Kafić sa društvom', amount: 4500 });
    expect(aug.find((e) => e.importKey === 'xlsx:2026-08:C11')).toEqual({
      kind: 'income', date: '2026-08-01', amount: 10000, incomeSource: 'other', note: 'Izdavanje garaže', status: 'actual', importKey: 'xlsx:2026-08:C11',
    });
    expect(w.entries.every((e) => e.importKey?.startsWith(`xlsx:${e.date.slice(0, 7)}:`))).toBe(true);
  });

  it('sets planned income and the pot amounts from each month on, and keeps notes already written', async () => {
    const months = await read();
    const choices = defaultChoices(months, defaults, []);
    const held = month('2026-10', { id: 'oct', notes: 'Written in the app.', potTargets: { wants: { thisOnly: { kind: 'pct', value: 5 } } } });
    const w = importWrites({ months, choices, categories: defaults, entries: [], budgetMonths: [held], corrections: [] });
    expect(w.months.create.map((m) => m.ym)).toEqual(['2026-08', '2026-09']);
    expect(w.months.create[0]).toEqual({
      ym: '2026-08', plannedIncome: { fromOn: 320000 }, categoryTargets: {}, notes: 'Mirna sedmica, ništa posebno.',
      potTargets: {
        needs: { fromOn: { kind: 'amount', value: 150000 } }, savings: { fromOn: { kind: 'amount', value: 80000 } },
        wants: { fromOn: { kind: 'amount', value: 40000 } }, debts: { fromOn: { kind: 'amount', value: 30000 } },
        emergency: { fromOn: { kind: 'amount', value: 20000 } },
      },
    });
    expect(w.months.update).toHaveLength(1);
    expect(w.months.update[0].id).toBe('oct');
    expect(w.months.update[0].potTargets.wants).toEqual({ fromOn: { kind: 'amount', value: 30000 } });
    expect(w.months.update[0].notes).toBe('Written in the app.\n\nPlan za zimu.');
    // Importing again adds the notes no second time.
    const again = importWrites({ months, choices, categories: defaults, entries: [], budgetMonths: [{ ...w.months.update[0] }], corrections: [] });
    expect(again.months.update).toEqual([]);
  });

  it('writes the STANJA balances as corrections, the debt to the chosen debt, and the bank balance given', async () => {
    const months = await read();
    const choices = { ...defaultChoices(months, defaults, []), debtId: 'debt-1', bank: { ym: '2026-10', balance: 250000 } };
    const held = [correction('investments', '2026-09', 1, { id: 'inv-sep' })];
    const w = importWrites({ months, choices, categories: defaults, entries: [], budgetMonths: [], corrections: held });
    expect(w.corrections.update).toEqual([{ id: 'inv-sep', balance: 1290000 }]);
    expect(w.corrections.create.map((c) => [c.account, c.ym, c.balance])).toEqual([
      ['investments', '2026-08', 1200000], ['emergency', '2026-08', 300000], ['debt:debt-1', '2026-08', 450000],
      ['emergency', '2026-09', 320000], ['debt:debt-1', '2026-09', 427000],
      ['investments', '2026-10', 1380000], ['emergency', '2026-10', 340000], ['debt:debt-1', '2026-10', 404000],
      ['bank', '2026-10', 250000],
    ]);
  });

  it("brings a month after the current one in as planned items to confirm, without its balances", async () => {
    const months = await read();
    const choices = { ...defaultChoices(months, defaults, []), debtId: 'debt-1' };
    const w = importWrites({ months, choices, categories: defaults, entries: [], budgetMonths: [], corrections: [], currentYm: '2026-09' });
    expect(new Set(w.entries.filter((e) => e.date.startsWith('2026-10')).map((e) => e.status))).toEqual(new Set(['planned']));
    expect(new Set(w.entries.filter((e) => e.date < '2026-10').map((e) => e.status))).toEqual(new Set(['actual']));
    expect(w.corrections.create.some((c) => c.ym === '2026-10')).toBe(false);
    expect(w.months.create.map((m) => m.ym)).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('saves a label mapped to another category as its synonym, so the next import matches it', async () => {
    const months = await read();
    const choices = defaultChoices(months, defaults, []);
    choices.mapping['needs|ciscenje'] = { categoryId: id('needs', 'Other needs') };
    const w = importWrites({ months, choices, categories: defaults, entries: [], budgetMonths: [], corrections: [] });
    expect(w.synonyms).toContainEqual({ categoryId: id('needs', 'Other needs'), synonyms: ['Čišćenje'] });
    // A word the import knows on its own is not saved.
    expect(w.synonyms.some((s) => s.categoryId === id('needs', 'Pharmacy'))).toBe(false);
  });
});
