import { describe, expect, it } from 'vitest';
import { category } from '../test/budgetRecords';
import { parseShorthand } from './shorthand';

const CATEGORIES = [
  category('cat-groc', 'needs', { name: 'Groceries, food & drink' }),
  category('cat-fuel', 'needs', { name: 'Fuel & parking' }),
  category('cat-cafe', 'wants', { name: 'Cafés & restaurants', synonyms: ['kafa', 'coffee'] }),
  category('cat-flights', 'wants', { name: 'Travel – flights' }),
  category('cat-stay', 'wants', { name: 'Travel – accommodation' }),
  category('cat-repairs', 'needs', { name: 'Repairs' }),
  category('cat-car-repairs', 'needs', { name: 'Car repairs' }),
  category('cat-old', 'wants', { name: 'Lidl', deleted: true }),
  category('cat-hidden', 'wants', { name: 'Hobbies', hidden: true }),
];

describe('parseShorthand', () => {
  it('reads the amount, the category and the note: 12.5 groceries lidl', () => {
    expect(parseShorthand('12.5 groceries lidl', CATEGORIES)).toEqual({ amount: 1250, categoryId: 'cat-groc', note: 'lidl', ambiguous: false });
  });

  it('takes the number wherever it is: fuel 60', () => {
    expect(parseShorthand('fuel 60', CATEGORIES)).toEqual({ amount: 6000, categoryId: 'cat-fuel', ambiguous: false });
  });

  it('matches a synonym, with a decimal comma: kafa 3,20', () => {
    expect(parseShorthand('kafa 3,20', CATEGORIES)).toEqual({ amount: 320, categoryId: 'cat-cafe', ambiguous: false });
  });

  it('folds diacritics and case on both sides', () => {
    expect(parseShorthand('CAFES 4', CATEGORIES)).toMatchObject({ amount: 400, categoryId: 'cat-cafe' });
    const cats = [category('cat-dj', 'needs', { name: 'Dječji vrtić', synonyms: ['Ključ'] })];
    expect(parseShorthand('djecji 100', cats)).toMatchObject({ categoryId: 'cat-dj' });
    expect(parseShorthand('kljuc 5', cats)).toMatchObject({ categoryId: 'cat-dj' });
    expect(parseShorthand('5 Đak', [category('cat-dak', 'needs', { name: 'dak' })])).toMatchObject({ categoryId: 'cat-dak' });
  });

  it('gives ambiguous for two equally good matches, and no category', () => {
    expect(parseShorthand('travel 120 ryanair', CATEGORIES)).toEqual({ amount: 12000, note: 'ryanair', ambiguous: true });
  });

  it('prefers the better match: a whole name over a word of a name', () => {
    expect(parseShorthand('repairs 80', CATEGORIES)).toMatchObject({ categoryId: 'cat-repairs', ambiguous: false });
  });

  it('matches the start of a word of three letters or more', () => {
    expect(parseShorthand('groc 9', CATEGORIES)).toMatchObject({ categoryId: 'cat-groc' });
    expect(parseShorthand('gr 9', CATEGORIES)).toEqual({ amount: 900, note: 'gr', ambiguous: false });
  });

  it('has no amount without a number, and keeps only the first number as the amount', () => {
    expect(parseShorthand('groceries lidl', CATEGORIES)).toEqual({ categoryId: 'cat-groc', note: 'lidl', ambiguous: false });
    expect(parseShorthand('7 fuel 2 cans', CATEGORIES)).toEqual({ amount: 700, categoryId: 'cat-fuel', note: '2 cans', ambiguous: false });
    expect(parseShorthand('€12 fuel', CATEGORIES)).toMatchObject({ amount: 1200 });
  });

  it('skips deleted and hidden categories', () => {
    expect(parseShorthand('10 lidl', CATEGORIES)).toEqual({ amount: 1000, note: 'lidl', ambiguous: false });
    expect(parseShorthand('10 hobbies', CATEGORIES)).toEqual({ amount: 1000, note: 'hobbies', ambiguous: false });
  });

  it('gives nothing for an empty line', () => {
    expect(parseShorthand('   ', CATEGORIES)).toEqual({ ambiguous: false });
  });
});
