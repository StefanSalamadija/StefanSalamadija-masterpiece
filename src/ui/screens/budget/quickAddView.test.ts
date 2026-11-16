import { describe, expect, it } from 'vitest';
import type { BudgetCategory, BudgetEntry } from '../../../domain/types';
import {
  dateChips, DEFAULT_TOP, entryLabel, lastExpense, monthLabel, normaliseAmount, padPress, padText, topCategories,
} from './quickAddView';

const stamp = { createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: 'd', deleted: false, scope: 'personal' as const };
const cat = (id: string, extra: Partial<BudgetCategory> = {}): BudgetCategory => ({ ...stamp, id, pot: 'needs', name: id, order: 0, hidden: false, ...extra });
let n = 0;
const entry = (categoryId: string, date: string, extra: Partial<BudgetEntry> = {}): BudgetEntry => ({
  ...stamp, id: `e${n += 1}`, kind: 'expense', date, amount: 100, categoryId, status: 'actual', ...extra,
});

describe('padPress', () => {
  it('types digits, one decimal comma and at most two decimals', () => {
    let text = '';
    for (const k of ['1', '2', ',', '5', '0', '7']) text = padPress(text, k);
    expect(text).toBe('12,50');
  });
  it('starts a decimal with 0, ignores a second comma and leading zeros', () => {
    expect(padPress('', ',')).toBe('0,');
    expect(padPress('3,', ',')).toBe('3,');
    expect(padPress('0', '0')).toBe('0');
    expect(padPress('0', '7')).toBe('7');
  });
  it('takes a dot typed on a keyboard as the decimal separator', () => {
    expect(padPress('12.5', ',')).toBe('12.5');
    expect(padPress('12.5', '0')).toBe('12.50');
    expect(padPress('12.50', '1')).toBe('12.50');
  });
  it('deletes the last character', () => {
    expect(padPress('12,5', 'back')).toBe('12,');
    expect(padPress('', 'back')).toBe('');
  });
  it('stops at 7 whole digits, so an amount never reaches a 100× mistake by a held key', () => {
    expect(padPress('1234567', '8')).toBe('1234567');
    expect(padPress('1234567,', '8')).toBe('1234567,8');
  });
});

describe('normaliseAmount', () => {
  it('holds keyboard typing to the pad rules', () => {
    expect(normaliseAmount('12.5')).toBe('12,5');
    expect(normaliseAmount('12.345')).toBe('12,34');
    expect(normaliseAmount('123456789')).toBe('1234567');
    expect(normaliseAmount('€ 1,5x')).toBe('1,5');
    expect(normaliseAmount('')).toBe('');
  });
});

describe('padText', () => {
  it('writes cents the way the pad types them', () => {
    expect(padText(320)).toBe('3,20');
    expect(padText(6000)).toBe('60');
    expect(padText(5)).toBe('0,05');
  });
});

describe('topCategories', () => {
  const categories = [cat('a'), cat('b'), cat('c'), cat('hidden', { hidden: true }), ...DEFAULT_TOP.map((id) => cat(id))];
  it('puts the most used of the last 30 days first, then the most recent, padded with the defaults to 6', () => {
    const list = [entry('b', '2026-10-20'), entry('b', '2026-10-21'), entry('a', '2026-10-24'), entry('c', '2026-09-01')];
    expect(topCategories(categories, list, '2026-10-25').map((c) => c.id)).toEqual(['b', 'a', ...DEFAULT_TOP.slice(0, 4)]);
  });
  it('counts the 30 days up to today, and only actual expenses that are live', () => {
    const list = [
      entry('a', '2026-09-26'), entry('c', '2026-09-25'), entry('b', '2026-10-25', { status: 'planned' }),
      entry('b', '2026-10-25', { kind: 'income' }), entry('b', '2026-10-25', { deleted: true }), entry('hidden', '2026-10-25'),
    ];
    expect(topCategories(categories, list, '2026-10-25').map((c) => c.id)).toEqual(['a', ...DEFAULT_TOP.slice(0, 5)]);
  });
  it('a tie goes to the one used last', () => {
    const list = [entry('a', '2026-10-20'), entry('b', '2026-10-22')];
    expect(topCategories(categories, list, '2026-10-25').slice(0, 2).map((c) => c.id)).toEqual(['b', 'a']);
  });
});

describe('lastExpense', () => {
  it('is the actual expense saved last', () => {
    const older = entry('a', '2026-10-25', { createdAt: '2026-10-25T08:00:00.000Z' });
    const newer = entry('b', '2026-10-20', { createdAt: '2026-10-25T09:00:00.000Z' });
    const planned = entry('c', '2026-10-25', { createdAt: '2026-10-25T10:00:00.000Z', status: 'planned' });
    const gone = entry('c', '2026-10-25', { createdAt: '2026-10-25T10:00:00.000Z', deleted: true });
    expect(lastExpense([older, newer, planned, gone])?.id).toBe(newer.id);
    expect(lastExpense([])).toBeUndefined();
  });
});

describe('dateChips', () => {
  it('offers today, yesterday and 2 days ago in ship time, across a month end', () => {
    expect(dateChips('2026-11-01')).toEqual([
      { label: 'Today', date: '2026-11-01' }, { label: 'Yesterday', date: '2026-10-31' }, { label: '2 days ago', date: '2026-10-30' },
    ]);
  });
});

describe('monthLabel', () => {
  it('names the month', () => {
    expect(monthLabel('2026-10')).toBe('October 2026');
  });
});

describe('entryLabel', () => {
  it('is the category of an expense and the source of an income', () => {
    expect(entryLabel(entry('a', '2026-10-01'), cat('a', { name: 'Pharmacy' }))).toBe('Pharmacy');
    expect(entryLabel(entry('a', '2026-10-01'), undefined)).toBe('No category');
    expect(entryLabel(entry('a', '2026-10-01', { kind: 'income', categoryId: undefined, incomeSource: 'property' }), undefined)).toBe('Sale of property');
    expect(entryLabel(entry('a', '2026-10-01', { kind: 'income', categoryId: undefined }), undefined)).toBe('Other');
  });
});
