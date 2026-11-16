import { addDays } from '../../../domain/dates';
import { parseMoney } from '../../../budget/money';
import type { BudgetCategory, BudgetEntry, Cents, IncomeSource } from '../../../domain/types';

/*
 * The pure parts of quick add (v2 §3.6): what the amount pad types, which categories come first, the date chips.
 */

/** The 6 shown first while the last 30 days hold too few expenses: everyday spending, by its seeded ids. */
export const DEFAULT_TOP: readonly string[] = [
  'budget-cat:needs:groceries-food-drink', 'budget-cat:needs:fuel-parking', 'budget-cat:wants:cafes-restaurants',
  'budget-cat:needs:pharmacy', 'budget-cat:wants:shopping', 'budget-cat:needs:public-transport-taxi',
];

const MAX_WHOLE_DIGITS = 7;

/**
 * The pad's text after a key: a digit, `,` (the decimal key) or `back`. One decimal comma, two decimals at most, no
 * leading zeros, and at most 7 whole digits (€9,999,999), so that a held key cannot make an amount 100× too big.
 */
export function padPress(text: string, key: string): string {
  if (key === 'back') return text.slice(0, -1);
  // A dot typed on a keyboard is the decimal separator too.
  const comma = text.search(/[.,]/);
  if (key === ',') return comma >= 0 ? text : `${text === '' ? '0' : text},`;
  if (!/^\d$/.test(key)) return text;
  if (comma >= 0) return text.length - comma > 2 ? text : text + key;
  if (text === '0') return key;
  return text.length >= MAX_WHOLE_DIGITS ? text : text + key;
}

/**
 * What is typed or pasted into the amount field on a keyboard: the digits, `.` and `,` and a minus are kept (so that a
 * minus can be refused with a message, never dropped), anything else (`€`, spaces, letters) is dropped. The text is
 * read by `readAmount`, by the `parseMoney` rules, not key by key: `1.234,56` and `1,234.56` are €1,234.56 and `1.234`
 * is €1,234.00.
 */
export function normaliseAmount(typed: string): string {
  return typed.replace(/[^\d.,\-−]/g, '').replace(/−/g, '-');
}

/** The most the field takes: 7 whole digits (€9,999,999.99), as on the pad. */
const MAX_CENTS = 10 ** MAX_WHOLE_DIGITS * 100 - 1;

/**
 * The amount the field's text stands for, by the `parseMoney` rules; a trailing separator (`12,`, as the pad leaves
 * it while typing) reads as `12`. `cents` is set only for an amount above zero; `error` says why a text is refused.
 */
export function readAmount(text: string): { cents?: Cents; error?: string } {
  if (text === '') return {};
  if (/[-−]/.test(text)) return { error: 'An amount can’t be below zero. For money that came back, choose Income.' };
  const value = parseMoney(text.replace(/[.,]$/, ''));
  if (value === 'invalid') return { error: 'Not an amount. Type it like 1234,56 or 1.234,56.' };
  if (value === undefined || value <= 0) return {};
  if (value > MAX_CENTS) return { error: 'At most €9,999,999.99.' };
  return { cents: value };
}

/**
 * The field's text in the pad's form (`1.234,56` → `1234,56`) once it reads as an amount; text already in the pad's
 * form (`18,` while typing) and text that is refused are kept as they are.
 */
export function tidyAmount(text: string): string {
  if (/^\d*(,\d{0,2})?$/.test(text)) return text;
  const { cents } = readAmount(text);
  return cents === undefined ? text : padText(cents);
}

/** The sources of income, with their exact labels (base §3.4). */
export const INCOME_SOURCES: readonly { id: IncomeSource; label: string }[] = [
  { id: 'salary', label: 'Salary' }, { id: 'property', label: 'Sale of property' }, { id: 'sales', label: 'Other sales' },
  { id: 'jobs', label: 'Other jobs' }, { id: 'other', label: 'Other' },
];

/** What an entry is called in a message or a list: its category, or its source of income. */
export function entryLabel(entry: BudgetEntry, category: BudgetCategory | undefined): string {
  if (entry.kind === 'income') return INCOME_SOURCES.find((s) => s.id === (entry.incomeSource ?? 'other'))!.label;
  return category?.name ?? 'No category';
}

/** Cents as the pad types them: `3,20`, `60`, `0,05`. */
export function padText(cents: Cents): string {
  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? String(euros) : `${euros},${String(rest).padStart(2, '0')}`;
}

/**
 * The categories shown first: the live, shown ones most used by actual expenses in the 30 days up to `today` (a tie
 * goes to the one used last), then the defaults in `DEFAULT_TOP`, up to `count`.
 */
export function topCategories(categories: BudgetCategory[], entries: BudgetEntry[], today: string, count = 6): BudgetCategory[] {
  const shown = new Map(categories.filter((c) => !c.deleted && !c.hidden).map((c) => [c.id, c]));
  const from = addDays(today, -29);
  // Each category's count, and when it was last used (its latest date, then the latest saved on that date).
  const use = new Map<string, { n: number; last: string }>();
  for (const e of entries) {
    if (e.deleted || e.kind !== 'expense' || e.status !== 'actual' || e.categoryId === undefined || !shown.has(e.categoryId)) continue;
    if (e.date < from || e.date > today) continue;
    const held = use.get(e.categoryId) ?? { n: 0, last: '' };
    const when = `${e.date} ${e.createdAt}`;
    use.set(e.categoryId, { n: held.n + 1, last: when > held.last ? when : held.last });
  }
  const used = [...use].sort(([, a], [, b]) => b.n - a.n || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0)).map(([id]) => id);
  const ids = [...used, ...DEFAULT_TOP.filter((id) => shown.has(id) && !use.has(id))].slice(0, count);
  return ids.map((id) => shown.get(id)!);
}

/** The actual expense saved last (by when it was saved, not its date). */
export function lastExpense(entries: BudgetEntry[]): BudgetEntry | undefined {
  let last: BudgetEntry | undefined;
  for (const e of entries) {
    if (e.deleted || e.kind !== 'expense' || e.status !== 'actual') continue;
    if (!last || e.createdAt > last.createdAt) last = e;
  }
  return last;
}

/** The date chips before Pick: today, yesterday and 2 days ago, in ship's time. */
export function dateChips(today: string): { label: string; date: string }[] {
  return [{ label: 'Today', date: today }, { label: 'Yesterday', date: addDays(today, -1) }, { label: '2 days ago', date: addDays(today, -2) }];
}

export { monthLabel } from '../../../budget/months';
