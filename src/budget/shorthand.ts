import type { BudgetCategory, Cents } from '../domain/types';
import { parseMoney } from './money';

/*
 * Typed shorthand for quick add (v2 §3.6): `12.5 groceries lidl`, `fuel 60`, `kafa 3,20`.
 *
 *  - The first word that reads as an amount (`parseMoney`: `12.5`, `3,20`, `1.234,56`, `€12`) is the amount. Later
 *    numbers are part of the note.
 *  - Each other word is matched against the live, shown categories' names and synonyms, case and diacritics folded
 *    (as the library's search folds text; copied here so the budget does not load the library). A match is, best first:
 *      3: the whole name or a synonym is the word;
 *      2: a word of the name or of a synonym is the word;
 *      1: a word of the name or of a synonym starts with the word (of 3 letters or more).
 *    The best match over all the words wins, and that word leaves the note. When two different categories match
 *    equally well, it is `ambiguous`: no category, the word leaves the note too, and the category grid decides.
 *  - The rest, in its order, is the note.
 */

/** Letters that NFD does not take apart, folded to the letters a keyboard without them types. */
const FOLDS: Record<string, string> = { đ: 'd', ħ: 'h', ł: 'l', ø: 'o', ı: 'i', ß: 'ss', æ: 'ae', œ: 'oe' };

/** Lowercase, diacritics removed, and the letters in `FOLDS` folded. */
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/[đħłøıßæœ]/g, (c) => FOLDS[c]);
}

const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '');

function score(word: string, category: BudgetCategory): number {
  let best = 0;
  for (const label of [category.name, ...(category.synonyms ?? [])]) {
    const whole = words(label);
    if (whole.join(' ') === word) return 3;
    for (const w of whole) {
      if (w === word) best = Math.max(best, 2);
      else if (word.length >= 3 && w.startsWith(word)) best = Math.max(best, 1);
    }
  }
  return best;
}

export interface Shorthand { amount?: Cents; categoryId?: string; note?: string; ambiguous: boolean }

export function parseShorthand(text: string, categories: BudgetCategory[]): Shorthand {
  const tokens = text.trim().split(/\s+/).filter((t) => t !== '');
  const live = categories.filter((c) => !c.deleted && !c.hidden);
  let amount: Cents | undefined;
  let amountAt = -1;
  tokens.forEach((t, i) => {
    if (amountAt >= 0) return;
    const value = parseMoney(t);
    if (typeof value === 'number') { amount = value; amountAt = i; }
  });

  // The best match over all the words: its score, the word, and the categories that reach it.
  let best = { score: 0, at: -1, ids: new Set<string>() };
  tokens.forEach((t, i) => {
    if (i === amountAt) return;
    const word = words(t).join(' ');
    if (word === '') return;
    for (const c of live) {
      const s = score(word, c);
      if (s === 0 || s < best.score) continue;
      if (s > best.score) best = { score: s, at: i, ids: new Set([c.id]) };
      else best.ids.add(c.id);
    }
  });

  const ambiguous = best.ids.size > 1;
  const note = tokens.filter((_, i) => i !== amountAt && i !== best.at).join(' ');
  return {
    ...(amount !== undefined && { amount }),
    ...(best.ids.size === 1 && { categoryId: [...best.ids][0] }),
    ...(note !== '' && { note }),
    ambiguous,
  };
}
