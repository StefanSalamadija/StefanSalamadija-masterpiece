import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES, POTS } from './catalog';

describe('the pots', () => {
  it('are the five pots, with their exact labels', () => {
    expect(POTS).toEqual([
      { id: 'needs', label: 'Needs' },
      { id: 'savings', label: 'Savings & investments' },
      { id: 'wants', label: 'Wants' },
      { id: 'debts', label: 'Debts' },
      { id: 'emergency', label: 'Emergency fund' },
    ]);
  });
});

describe('the default categories', () => {
  it('are the default list, by pot and group', () => {
    const byGroup = new Map<string, string[]>();
    for (const c of DEFAULT_CATEGORIES) {
      const key = `${c.pot}/${c.group ?? '-'}`;
      byGroup.set(key, [...(byGroup.get(key) ?? []), c.name]);
    }
    expect(Object.fromEntries(byGroup)).toEqual({
      'needs/Housing': ['Rent / mortgage', 'Utilities & bills', 'Phone & internet', 'Home insurance', 'Property tax', 'Maintenance', 'Repairs'],
      'needs/Food': ['Groceries, food & drink'],
      'needs/Health': ['Pharmacy', 'Doctors & dentist'],
      'needs/Car & transport': ['Fuel & parking', 'Regular service', 'Car repairs', 'Registration & insurance', 'Public transport & taxi'],
      'needs/Family': ['Kindergarten / school', "Children's needs"],
      'needs/Pets': ['Pet food & vet'],
      'needs/Personal': ['Haircut & personal care', 'Clothing & shoes', 'Training / gym'],
      'needs/Other': ['Other needs', 'Unallocated'],
      'wants/-': [
        'Cafés & restaurants', 'Travel – flights', 'Travel – accommodation', 'Travel – eSIM & extras', 'Subscriptions', 'Shopping',
        'Gifts & celebrations', 'Beauty & wellness', 'Books, toys & hobbies', 'Entertainment & outings', 'Other wants',
      ],
      'savings/-': ['Index funds / ETFs (e.g. S&P 500)', 'Other investments', 'Pension', 'Savings goals'],
      'emergency/-': ['Emergency fund'],
      'debts/-': ['Loan instalment', 'Extra loan payment', 'Personal debts', 'Credit card'],
    });
  });

  it('has no name twice', () => {
    const names = DEFAULT_CATEGORIES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
