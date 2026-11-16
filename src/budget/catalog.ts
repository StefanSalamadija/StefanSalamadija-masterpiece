import type { PotId } from '../domain/types';

export type { PotId };

/** The five pots, in the order the budget shows them, with their exact labels. */
export const POTS: readonly { id: PotId; label: string }[] = [
  { id: 'needs', label: 'Needs' },
  { id: 'savings', label: 'Savings & investments' },
  { id: 'wants', label: 'Wants' },
  { id: 'debts', label: 'Debts' },
  { id: 'emergency', label: 'Emergency fund' },
];

const needs = (group: string, names: string[]) => names.map((name) => ({ pot: 'needs' as const, group, name }));
const ungrouped = (pot: PotId, names: string[]) => names.map((name) => ({ pot, name }));

/**
 * The categories a new budget starts with: the default list of the budget design, in its order. Sub-categories are one
 * level deep: a Needs category sits under a group heading; the other pots have none. Each one can be renamed (the pet
 * one with the pet's name, say), hidden, reordered or moved later.
 */
export const DEFAULT_CATEGORIES: readonly { pot: PotId; group?: string; name: string }[] = [
  ...needs('Housing', ['Rent / mortgage', 'Utilities & bills', 'Phone & internet', 'Home insurance', 'Property tax', 'Maintenance', 'Repairs']),
  ...needs('Food', ['Groceries, food & drink']),
  ...needs('Health', ['Pharmacy', 'Doctors & dentist']),
  ...needs('Car & transport', ['Fuel & parking', 'Regular service', 'Car repairs', 'Registration & insurance', 'Public transport & taxi']),
  ...needs('Family', ['Kindergarten / school', "Children's needs"]),
  ...needs('Pets', ['Pet food & vet']),
  ...needs('Personal', ['Haircut & personal care', 'Clothing & shoes', 'Training / gym']),
  ...needs('Other', ['Other needs', 'Unallocated']),
  ...ungrouped('wants', [
    'Cafés & restaurants', 'Travel – flights', 'Travel – accommodation', 'Travel – eSIM & extras', 'Subscriptions', 'Shopping',
    'Gifts & celebrations', 'Beauty & wellness', 'Books, toys & hobbies', 'Entertainment & outings', 'Other wants',
  ]),
  ...ungrouped('savings', ['Index funds / ETFs (e.g. S&P 500)', 'Other investments', 'Pension', 'Savings goals']),
  ...ungrouped('emergency', ['Emergency fund']),
  ...ungrouped('debts', ['Loan instalment', 'Extra loan payment', 'Personal debts', 'Credit card']),
];
