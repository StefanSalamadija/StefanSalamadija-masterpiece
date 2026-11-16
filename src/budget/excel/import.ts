import { readSpreadsheet } from '../../domain/crewImport/readSpreadsheet';
import type { Cell } from '../../domain/crewImport/readSpreadsheet';
import type { BaseRecord, BudgetAccount, BudgetCategory, BudgetCorrection, BudgetDebt, BudgetEntry, BudgetMonth, Cents, PotId, Ym } from '../../domain/types';
import { POTS } from '../catalog';
import { correctionChanges } from '../corrections';
import { parseMoney } from '../money';
import { setPlannedIncome, setPotTarget, storedMonths } from '../targets';
import type { MonthChanges, NewBudgetMonth } from '../targets';

/*
 * Reading the user's budget workbook (base §3.9, v2 §3.9.3). Each month is a sheet named `<Month> <YYYY>`, with a
 * Serbian or English month name. Everything is found by its label, never by a fixed row, because the row counts vary
 * between sheets:
 *  - the pot amounts: POTREBE, INVESTICIJE, ŽELJE, DUGOVANJA and CRNI FOND in column A, amounts in C; the sheet's own
 *    spent totals in the column headed "UKUPNO POTROŠENO", on the same rows;
 *  - the blocks, each under its heading with its labels in the heading's column and the amounts two columns to the
 *    right: PRIMANJA (income: the first line is the planned income), POTREBE (Needs: a label with no amount is a group
 *    heading), ŠTEDNJE I INVESTICIJE (savings; its CRNI FOND line goes to the Emergency fund), ŽELJE (Wants: free text)
 *    and DUGOVANJA (debts). A block ends at its "Komentari i napomene" heading;
 *  - the month-end balances: a STANJA block in columns W–Z, with INVESTICIJE, DUGOVANJA and CRNI FOND (and a bank
 *    line, which the export writes);
 *  - the notes: the row below each "Komentari i napomene" heading.
 * Values are read as the sheet saved them: formulas are never run, since the app works its totals out itself.
 *
 * The rest is pure: the mapping of labels to categories, the preview, and the records an import writes. Each entry
 * keeps where it came from in `importKey` (`xlsx:<ym>:<cell>`), so importing a month again replaces its imported
 * entries and never one added in the app.
 */

export type Area = 'income' | 'needs' | 'savings' | 'wants' | 'debts';
/** One line of a block: its label, its amount, the cell of the amount, and (Needs) the group heading above it. */
export interface SheetLine { area: Area; label: string; amount: Cents; cell: string; group?: string }
export interface SheetBalances { investments?: Cents; debts?: Cents; emergency?: Cents; bank?: Cents }
/** What one month's sheet says. */
export interface SheetMonth {
  sheet: string; ym: Ym; plannedIncome?: Cents; potTargets: Partial<Record<PotId, Cents>>;
  /** The sheet's own spent total per pot (its "UKUPNO POTROŠENO"). */
  sheetSpent: Partial<Record<PotId, Cents>>;
  /** The income lines after the first, and every expense line, in sheet order. */
  lines: SheetLine[];
  balances: SheetBalances; notes?: string;
}

/** A label's category: one that exists, or a new one to make. */
export type Choice = { categoryId: string } | { newCategory: { pot: PotId; name: string; group?: string } };
/** The areas whose labels are mapped one by one. Wants lines are free text: they go to one chosen category. */
export type MappedArea = 'needs' | 'savings' | 'debts';
export interface LabelMapping { key: string; area: MappedArea; label: string; group?: string; choice: Choice; known: boolean; lines: number }
export interface ImportChoices {
  /** By `key` (see `LabelMapping`). */
  mapping: Record<string, Choice>;
  /** Where a Wants line goes that names no Wants category. */
  wants: Choice;
  /** The debt STANJA's DUGOVANJA is the balance of; `new` makes one. None: the debt balance is not imported. */
  debtId?: string | 'new';
  /** The bank balance the user gave, at the end of a month. */
  bank?: { ym: Ym; balance: Cents };
}

/** A label as compared: no accents, lower case, only letters and digits split by single spaces. */
export function norm(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const MONTHS: Record<string, number> = {
  januar: 1, january: 1, februar: 2, february: 2, mart: 3, march: 3, april: 4, maj: 5, may: 5, jun: 6, june: 6, juni: 6,
  jul: 7, july: 7, juli: 7, avgust: 8, august: 8, septembar: 9, september: 9, oktobar: 10, october: 10, novembar: 11, november: 11,
  decembar: 12, december: 12,
};

/** `Avgust 2026` → `2026-08`; undefined for a sheet that is not named after a month. */
export function sheetYm(name: string): Ym | undefined {
  const match = /^([a-z]+) (\d{4})$/.exec(norm(name));
  const month = match ? MONTHS[match[1]] : undefined;
  return month === undefined ? undefined : `${match![2]}-${String(month).padStart(2, '0')}`;
}

const POT_ROWS: Record<string, PotId> = { potrebe: 'needs', investicije: 'savings', zelje: 'wants', dugovanja: 'debts', 'crni fond': 'emergency' };
const BLOCKS: { area: Exclude<Area, 'income'>; heading: string }[] = [
  { area: 'needs', heading: 'potrebe' }, { area: 'savings', heading: 'stednje i investicije' }, { area: 'wants', heading: 'zelje' }, { area: 'debts', heading: 'dugovanja' },
];
const BLOCK_NAMES: Record<Area, string> = { income: 'Income', needs: 'Needs', savings: 'Savings & investments', wants: 'Wants', debts: 'Debts' };
const NOTES = 'komentari i napomene';
const EMERGENCY_LINE = 'crni fond';
/** Columns W to Z, where the STANJA block is (and AA, which its values may spill into). */
const STANJA_FIRST = 22;
const STANJA_LAST = 26;
const STANJA_LINES: Record<string, keyof SheetBalances> = {
  investicije: 'investments', dugovanja: 'debts', 'crni fond': 'emergency', banka: 'bank', bank: 'bank', 'banka i gotovina': 'bank',
};

function column(c: number): string {
  let name = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Reads one month's sheet; undefined when the sheet is not named after a month. */
export function parseBudgetSheet(name: string, rows: Cell[][]): SheetMonth | undefined {
  const ym = sheetYm(name);
  if (ym === undefined) return undefined;
  const at = (r: number, c: number): Cell => rows[r]?.[c] ?? null;
  const text = (r: number, c: number): string => {
    const v = at(r, c);
    return typeof v === 'string' ? v.trim() : '';
  };
  const amount = (r: number, c: number): Cents | undefined => {
    const v = at(r, c);
    if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 100);
    if (typeof v === 'string') {
      const parsed = parseMoney(v, { negative: true });
      return typeof parsed === 'number' ? parsed : undefined;
    }
    return undefined;
  };
  const width = rows.reduce((w, row) => Math.max(w, row.length), 0);
  /** The first cell, row by row, whose label is `label`, in columns `from` to `to`. */
  const find = (label: string, from: number, to: number): { r: number; c: number } | undefined => {
    for (let r = 0; r < rows.length; r++) for (let c = from; c <= Math.min(to, width - 1); c++) if (norm(text(r, c)) === label) return { r, c };
    return undefined;
  };

  const month: SheetMonth = { sheet: name, ym, potTargets: {}, sheetSpent: {}, lines: [], balances: {} };
  const income = find('primanja', 0, 0);
  const spentAt = find('ukupno potroseno', 0, STANJA_FIRST - 1);
  for (let r = 0; r < (income?.r ?? rows.length); r++) {
    const pot = POT_ROWS[norm(text(r, 0))];
    if (pot === undefined || month.potTargets[pot] !== undefined) continue;
    const target = amount(r, 2);
    if (target !== undefined) month.potTargets[pot] = target;
    const spent = spentAt ? amount(r, spentAt.c) : undefined;
    if (spent !== undefined) month.sheetSpent[pot] = spent;
  }

  const headings = new Map<number, Area>();
  const block = (area: Area, head: { r: number; c: number }) => {
    headings.set(head.c, area);
    let group: string | undefined;
    let first = true;
    for (let r = head.r + 1; r < rows.length; r++) {
      const label = text(r, head.c);
      if (norm(label) === NOTES) break;
      const value = amount(r, head.c + 2);
      if (area === 'income' && first && (label !== '' || value !== undefined)) {
        // The first line is the planned income, even when it has no amount (then there is none).
        if (value !== undefined) month.plannedIncome = value;
        first = false;
        continue;
      }
      if (value === undefined) {
        if (area === 'needs' && label !== '') group = label;
        continue;
      }
      if (value === 0) continue;
      month.lines.push({ area, label, amount: value, cell: `${column(head.c + 2)}${r + 1}`, ...(area === 'needs' && group !== undefined && { group }) });
    }
  };
  if (income) block('income', income);
  for (const { area, heading } of BLOCKS) {
    const head = find(heading, 1, STANJA_FIRST - 1);
    if (head) block(area, head);
  }
  // Lines in sheet order: by block, then row.
  month.lines.sort((a, b) => order(a.area) - order(b.area));

  const stanja = find('stanja', STANJA_FIRST, STANJA_FIRST + 3);
  if (stanja) {
    for (let r = stanja.r + 1; r <= stanja.r + 8 && r < rows.length; r++) {
      let label = '';
      let value: Cents | undefined;
      for (let c = STANJA_FIRST; c <= STANJA_LAST; c++) {
        if (label === '' && text(r, c) !== '') label = norm(text(r, c));
        else value = amount(r, c) ?? value;
      }
      if (label === '' && value === undefined) break;
      const account = STANJA_LINES[label];
      if (account !== undefined && value !== undefined && month.balances[account] === undefined) month.balances[account] = value;
    }
  }

  const notes: { area?: Area; text: string }[] = [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < Math.min(width, STANJA_FIRST); c++) {
      if (norm(text(r, c)) === NOTES && text(r + 1, c) !== '') notes.push({ area: headings.get(c), text: text(r + 1, c) });
    }
  }
  if (notes.length === 1) month.notes = notes[0].text;
  else if (notes.length > 1) month.notes = notes.map((n) => (n.area ? `${BLOCK_NAMES[n.area]}: ${n.text}` : n.text)).join('\n');
  return month;
}

const AREA_ORDER: Area[] = ['income', 'needs', 'savings', 'wants', 'debts'];
const order = (area: Area) => AREA_ORDER.indexOf(area);

/** Reads a workbook's month sheets, in month order (a month on two sheets: the first). `skipped`: the other sheets. */
export async function readBudgetWorkbook(data: ArrayBuffer, fileName = 'budget.xlsx'): Promise<{ months: SheetMonth[]; skipped: string[] }> {
  const sheets = await readSpreadsheet(fileName, data);
  const months: SheetMonth[] = [];
  const skipped: string[] = [];
  for (const sheet of sheets) {
    const month = parseBudgetSheet(sheet.name, sheet.rows);
    if (month === undefined) skipped.push(sheet.name);
    else if (!months.some((m) => m.ym === month.ym)) months.push(month);
  }
  months.sort((a, b) => (a.ym < b.ym ? -1 : 1));
  return { months, skipped };
}

/* ── Mapping ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** The pots a label of an area may go to. */
const AREA_POTS: Record<Exclude<Area, 'income'>, PotId[]> = { needs: ['needs'], savings: ['savings', 'emergency'], wants: ['wants'], debts: ['debts'] };

/**
 * Words of the workbook's language the import knows, and the default category each one means: a line whose label is,
 * or holds, one of them goes there unless a category's own name or synonym matches first.
 */
const KNOWN_WORDS: { area: MappedArea; words: string[]; category: string; pot?: PotId }[] = [
  { area: 'needs', words: ['kirija', 'stanarina', 'najam', 'zakup', 'hipoteka'], category: 'Rent / mortgage' },
  { area: 'needs', words: ['struja', 'voda', 'racuni', 'komunalije', 'grijanje', 'grejanje', 'infostan', 'smece'], category: 'Utilities & bills' },
  { area: 'needs', words: ['telefon', 'internet', 'mobilni', 'kablovska'], category: 'Phone & internet' },
  { area: 'needs', words: ['osiguranje stana', 'osiguranje kuce'], category: 'Home insurance' },
  { area: 'needs', words: ['porez na imovinu'], category: 'Property tax' },
  { area: 'needs', words: ['odrzavanje'], category: 'Maintenance' },
  { area: 'needs', words: ['hrana', 'namirnice', 'market'], category: 'Groceries, food & drink' },
  { area: 'needs', words: ['apoteka', 'lijekovi', 'lekovi'], category: 'Pharmacy' },
  { area: 'needs', words: ['doktor', 'ljekar', 'lekar', 'zubar', 'stomatolog'], category: 'Doctors & dentist' },
  { area: 'needs', words: ['gorivo', 'benzin', 'dizel', 'parking'], category: 'Fuel & parking' },
  { area: 'needs', words: ['servis'], category: 'Regular service' },
  { area: 'needs', words: ['registracija', 'osiguranje auta', 'kasko'], category: 'Registration & insurance' },
  { area: 'needs', words: ['prevoz', 'taksi', 'autobus'], category: 'Public transport & taxi' },
  { area: 'needs', words: ['vrtic', 'skola', 'skolarina'], category: 'Kindergarten / school' },
  { area: 'needs', words: ['ljubimac', 'veterinar'], category: 'Pet food & vet' },
  { area: 'needs', words: ['frizer', 'kozmetika'], category: 'Haircut & personal care' },
  { area: 'needs', words: ['odjeca', 'odeca', 'obuca', 'garderoba'], category: 'Clothing & shoes' },
  { area: 'needs', words: ['teretana', 'trening'], category: 'Training / gym' },
  { area: 'needs', words: ['ostalo', 'razno'], category: 'Other needs' },
  { area: 'savings', words: ['crni fond', 'hitni fond'], category: 'Emergency fund', pot: 'emergency' },
  { area: 'savings', words: ['etf', 's p 500', 'sp500', 'indeksni fond'], category: 'Index funds / ETFs (e.g. S&P 500)' },
  { area: 'savings', words: ['penzija', 'penzioni', 'mirovina'], category: 'Pension' },
  { area: 'debts', words: ['vanredna', 'dodatna', 'prijevremena', 'prevremena'], category: 'Extra loan payment' },
  { area: 'debts', words: ['kartica'], category: 'Credit card' },
  { area: 'debts', words: ['rata', 'kredit', 'kredita'], category: 'Loan instalment' },
  { area: 'debts', words: ['dug', 'pozajmica'], category: 'Personal debts' },
];

/** The category a blank label (an amount with no name) goes to. */
const FALLBACK: Record<MappedArea, string> = { needs: 'Other needs', savings: 'Other investments', debts: 'Personal debts' };

const hasWord = (label: string, word: string) => ` ${label} `.includes(` ${word} `);

/** The live category of `pots` that `label` names: by its name, else a synonym; then (for a mapped area) a known word. */
function matchCategory(label: string, area: Exclude<Area, 'income'>, categories: BudgetCategory[]): string | undefined {
  const key = norm(label);
  const live = categories.filter((c) => !c.deleted && AREA_POTS[area].includes(c.pot));
  const byName = (name: string, pot?: PotId) => live.find((c) => norm(c.name) === norm(name) && (pot === undefined || c.pot === pot));
  if (key === '') return area === 'wants' ? undefined : byName(FALLBACK[area])?.id;
  const named = live.find((c) => norm(c.name) === key) ?? live.find((c) => (c.synonyms ?? []).some((s) => norm(s) === key));
  if (named || area === 'wants') return named?.id;
  for (const known of KNOWN_WORDS) {
    if (known.area === area && known.words.some((w) => hasWord(key, w))) {
      const found = byName(known.category, known.pot ?? (area === 'savings' ? 'savings' : area));
      if (found) return found.id;
    }
  }
  return undefined;
}

const keyOf = (area: Area, label: string) => `${area}|${norm(label)}`;

/** Each label of Needs, savings and debts in the months, with the category it matches, or a new one to make. */
export function mappingFor(months: SheetMonth[], categories: BudgetCategory[]): LabelMapping[] {
  const out = new Map<string, LabelMapping>();
  for (const m of months) {
    for (const line of m.lines) {
      if (line.area === 'income' || line.area === 'wants') continue;
      const key = keyOf(line.area, line.label);
      const held = out.get(key);
      if (held) {
        held.lines += 1;
        continue;
      }
      const categoryId = matchCategory(line.label, line.area, categories);
      const pot: PotId = line.area === 'savings' && norm(line.label) === EMERGENCY_LINE ? 'emergency' : line.area;
      const name = line.label === '' ? FALLBACK[line.area] : line.label;
      out.set(key, {
        key, area: line.area, label: line.label, ...(line.group !== undefined && { group: line.group }), lines: 1, known: categoryId !== undefined,
        choice: categoryId !== undefined ? { categoryId } : { newCategory: { pot, name, ...(pot === 'needs' && { group: line.group ?? 'Other' }) } },
      });
    }
  }
  return [...out.values()];
}

/** The choices an import starts with: every label as matched, Wants to "Other wants", the debt when there is one. */
export function defaultChoices(months: SheetMonth[], categories: BudgetCategory[], debts: BudgetDebt[]): ImportChoices {
  const mapping = Object.fromEntries(mappingFor(months, categories).map((m) => [m.key, m.choice]));
  const wants = categories.filter((c) => !c.deleted && c.pot === 'wants');
  const otherWants = wants.find((c) => norm(c.name) === 'other wants') ?? wants[wants.length - 1];
  const live = debts.filter((d) => !d.deleted);
  const debtBalances = months.some((m) => (m.balances.debts ?? 0) !== 0);
  return {
    mapping,
    wants: otherWants ? { categoryId: otherWants.id } : { newCategory: { pot: 'wants', name: 'Other wants' } },
    ...(live.length === 1 ? { debtId: live[0].id } : live.length === 0 && debtBalances ? { debtId: 'new' } : {}),
  };
}

/** The id a line goes to: a category's, or `new:<key>` for a category still to make. */
function lineCategory(line: SheetLine, choices: ImportChoices, categories: BudgetCategory[]): { id: string; pot: PotId } {
  const choice: Choice | undefined = line.area === 'wants'
    ? (() => { const id = matchCategory(line.label, 'wants', categories); return id ? { categoryId: id } : choices.wants; })()
    : choices.mapping[keyOf(line.area, line.label)];
  if (choice && 'categoryId' in choice) {
    const pot = categories.find((c) => c.id === choice.categoryId)?.pot ?? (line.area as PotId);
    return { id: choice.categoryId, pot };
  }
  return { id: `new:${line.area === 'wants' ? 'wants' : keyOf(line.area, line.label)}`, pot: choice?.newCategory.pot ?? (line.area as PotId) };
}

const importPrefix = (ym: Ym) => `xlsx:${ym}:`;

/* ── Preview ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

export interface PotPreview { pot: PotId; total: Cents; sheet?: Cents; difference?: Cents }
export interface MonthPreview { ym: Ym; sheet: string; plannedIncome?: Cents; pots: PotPreview[]; entries: number; replaces: number }

/** Each month: its planned income, its totals per pot next to the sheet's own, its entries, and the imported entries it replaces. */
export function previewImport(months: SheetMonth[], choices: ImportChoices, categories: BudgetCategory[], entries: BudgetEntry[]): MonthPreview[] {
  return months.map((m) => {
    const totals = new Map<PotId, Cents>();
    for (const line of m.lines) {
      if (line.area === 'income') continue;
      const { pot } = lineCategory(line, choices, categories);
      totals.set(pot, (totals.get(pot) ?? 0) + line.amount);
    }
    const pots = POTS.map(({ id }) => {
      const total = totals.get(id) ?? 0;
      const sheet = m.sheetSpent[id];
      return sheet === undefined ? { pot: id, total } : { pot: id, total, sheet, difference: total - sheet };
    });
    const replaces = entries.filter((e) => !e.deleted && e.importKey?.startsWith(importPrefix(m.ym))).length;
    return { ym: m.ym, sheet: m.sheet, ...(m.plannedIncome !== undefined && { plannedIncome: m.plannedIncome }), pots, entries: m.lines.length, replaces };
  });
}

/* ── Writes ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

export type NewEntry = Omit<BudgetEntry, keyof BaseRecord>;
export interface ImportWrites {
  /** The live entries imported before into the months imported now. */
  deleteEntryIds: string[];
  entries: NewEntry[];
  months: MonthChanges;
  corrections: { create: { account: BudgetAccount; ym: Ym; balance: Cents }[]; update: { id: string; balance: Cents }[] };
  /** Categories that a label was mapped to by hand: their synonyms, the label added, so that the next import matches it. */
  synonyms: { categoryId: string; synonyms: string[] }[];
}

const STAMP: Omit<BaseRecord, 'id'> = { createdAt: '', updatedAt: '', updatedBy: '', deleted: false, scope: 'personal' };

/** Notes already in a month, and the imported ones added once. */
function mergedNotes(held: string | undefined, imported: string | undefined): string | undefined {
  if (imported === undefined || imported === '') return held;
  if (held === undefined || held.trim() === '') return imported;
  return held.includes(imported) ? held : `${held}\n\n${imported}`;
}

/** The plan of one imported month: its planned income and pot amounts "from this month on", and its notes. */
function monthChanges(stored: BudgetMonth | undefined, m: SheetMonth): MonthChanges {
  let current: BudgetMonth | undefined = stored;
  const apply = (changes: MonthChanges) => {
    if (changes.create[0]) current = { ...STAMP, id: '', ...changes.create[0] } as BudgetMonth;
    else if (changes.update[0]) current = changes.update[0];
  };
  const list = () => (current ? [current] : []);
  if (m.plannedIncome !== undefined) apply(setPlannedIncome(list(), m.ym, m.plannedIncome, 'fromOn'));
  for (const { id } of POTS) {
    const value = m.potTargets[id];
    if (value !== undefined) apply(setPotTarget(list(), m.ym, id, { kind: 'amount', value }, 'fromOn'));
  }
  const notes = mergedNotes(stored?.notes, m.notes);
  if (!stored) {
    if (!current && notes === undefined) return { create: [], update: [] };
    const base: NewBudgetMonth = current ?? { ym: m.ym, potTargets: {}, categoryTargets: {} };
    const fields: NewBudgetMonth = { ym: m.ym, potTargets: base.potTargets, categoryTargets: base.categoryTargets };
    if (base.plannedIncome !== undefined) fields.plannedIncome = base.plannedIncome;
    if (notes !== undefined) fields.notes = notes;
    return { create: [fields], update: [] };
  }
  const changed = current !== stored || notes !== stored.notes;
  return { create: [], update: changed ? [{ ...current!, ...(notes !== undefined && { notes }) }] : [] };
}

/**
 * What importing `months` writes, against what is held: the month's imported entries replaced, the new entries, the
 * months' plans and notes, the STANJA balances and the bank balance as corrections, and the synonyms learnt. A choice of
 * a new category gives its lines the id `new:<key>`; the caller makes the categories first and passes their ids instead.
 */
export function importWrites(input: {
  months: SheetMonth[]; choices: ImportChoices; categories: BudgetCategory[]; entries: BudgetEntry[]; budgetMonths: BudgetMonth[];
  corrections: BudgetCorrection[];
  /** The current month: a later month's lines come in as planned items to confirm, and its balances are not taken. */
  currentYm?: Ym;
}): ImportWrites {
  const { months, choices, categories } = input;
  const yms = new Set(months.map((m) => m.ym));
  const deleteEntryIds = input.entries
    .filter((e) => !e.deleted && e.importKey !== undefined && yms.has(e.importKey.split(':')[1]) && e.importKey.startsWith('xlsx:'))
    .map((e) => e.id);

  const entries: NewEntry[] = [];
  const future = (ym: Ym) => input.currentYm !== undefined && ym > input.currentYm;
  for (const m of months) {
    const date = `${m.ym}-01`;
    const status = future(m.ym) ? 'planned' : 'actual';
    for (const line of m.lines) {
      const importKey = `${importPrefix(m.ym)}${line.cell}`;
      if (line.area === 'income') {
        entries.push({ kind: 'income', date, amount: line.amount, incomeSource: 'other', ...(line.label !== '' && { note: line.label }), status, importKey });
        continue;
      }
      const { id } = lineCategory(line, choices, categories);
      entries.push({ kind: 'expense', date, amount: line.amount, categoryId: id, ...(line.area === 'wants' && line.label !== '' && { note: line.label }), status, importKey });
    }
  }

  const live = storedMonths(input.budgetMonths);
  const planChanges: MonthChanges = { create: [], update: [] };
  for (const m of months) {
    const changes = monthChanges(live.find((b) => b.ym === m.ym), m);
    planChanges.create.push(...changes.create);
    planChanges.update.push(...changes.update);
  }

  const corrections: ImportWrites['corrections'] = { create: [], update: [] };
  const add = (changes: ReturnType<typeof correctionChanges>) => {
    corrections.create.push(...changes.create);
    corrections.update.push(...changes.update);
  };
  for (const m of months) {
    if (future(m.ym)) continue;
    const values: Partial<Record<BudgetAccount, Cents>> = {};
    if (m.balances.investments !== undefined) values.investments = m.balances.investments;
    if (m.balances.emergency !== undefined) values.emergency = m.balances.emergency;
    if (m.balances.debts !== undefined && choices.debtId !== undefined) values[`debt:${choices.debtId}`] = m.balances.debts;
    add(correctionChanges(input.corrections, m.ym, values));
  }
  if (choices.bank) add(correctionChanges(input.corrections, choices.bank.ym, { bank: choices.bank.balance }));

  const auto = new Map(mappingFor(months, categories).map((m) => [m.key, m]));
  const learnt = new Map<string, string[]>();
  for (const [key, choice] of Object.entries(choices.mapping)) {
    const found = auto.get(key);
    if (!found || !('categoryId' in choice) || found.label === '') continue;
    if ('categoryId' in found.choice && found.choice.categoryId === choice.categoryId) continue;
    const target = categories.find((c) => c.id === choice.categoryId);
    if (!target) continue;
    const held = learnt.get(target.id) ?? target.synonyms ?? [];
    if (norm(target.name) === norm(found.label) || held.some((s) => norm(s) === norm(found.label))) continue;
    learnt.set(target.id, [...held, found.label]);
  }
  const synonyms = [...learnt].map(([categoryId, list]) => ({ categoryId, synonyms: list }));

  return { deleteEntryIds, entries, months: planChanges, corrections, synonyms };
}
