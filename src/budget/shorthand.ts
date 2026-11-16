import type { BudgetCategory, Cents } from '../domain/types';
import { parseMoney } from './money';

/*
 * Typed shorthand for quick add (v2 §3.6): `12.5 groceries lidl`, `fuel 60`, `kafa 3,20`.
 *
 *  - The first word that reads as an amount (`parseMoney`: `12.5`, `3,20`, `1.234,56`, `€12`) is the amount. Later
 *    numbers are part of the note.
 *  - The other words, alone or as a phrase of 2 or 3 words next to each other (not across the amount), are matched
 *    against the live, shown categories' names and synonyms, case and diacritics folded (as the library's search folds
 *    text; copied here so the budget does not load the library). A match is, best first:
 *      3: the whole name or a synonym is the phrase;
 *      2: the phrase is a word of the name or of a synonym, or (for 2 or 3 words) words next to each other in it;
 *      1: a single word that a word of the name or of a synonym starts with (of 3 letters or more).
 *    The longest phrase that matches wins, then the better match (`car repairs` is "Car repairs", not "Repairs";
 *    `travel flights` is "Travel – flights"), and its words leave the note. When two different categories match
 *    equally well, it is `ambiguous`: no category, the words leave the note too, and the category grid decides.
 *  - The rest, in its order, is the note (a lone `€`, as in `12 €`, is left out).
 */

/** Letters that NFD does not take apart, folded to the letters a keyboard without them types. */
const FOLDS: Record<string, string> = { đ: 'd', ħ: 'h', ł: 'l', ø: 'o', ı: 'i', ß: 'ss', æ: 'ae', œ: 'oe' };

/** Lowercase, diacritics removed, and the letters in `FOLDS` folded. */
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/[đħłøıßæœ]/g, (c) => FOLDS[c]);
}

const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '');

function score(phrase: string[], category: BudgetCategory): number {
  let best = 0;
  const text = phrase.join(' ');
  for (const label of [category.name, ...(category.synonyms ?? [])]) {
    const whole = words(label);
    if (whole.join(' ') === text) return 3;
    for (let i = 0; i + phrase.length <= whole.length; i += 1) {
      if (whole.slice(i, i + phrase.length).join(' ') === text) best = Math.max(best, 2);
    }
    if (phrase.length === 1 && text.length >= 3 && whole.some((w) => w.startsWith(text))) best = Math.max(best, 1);
  }
  return best;
}

const MAX_PHRASE = 3;

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

  // The best match over all the phrases: its length and score, where it is, and the categories that reach it.
  let best = { length: 0, score: 0, at: -1, ids: new Set<string>() };
  for (let at = 0; at < tokens.length; at += 1) {
    for (let length = 1; length <= MAX_PHRASE && at + length <= tokens.length; length += 1) {
      if (amountAt >= at && amountAt < at + length) break;
      const phrase = tokens.slice(at, at + length).flatMap(words);
      if (phrase.length === 0) continue;
      for (const c of live) {
        const s = score(phrase, c);
        if (s === 0 || length < best.length || (length === best.length && s < best.score)) continue;
        if (length > best.length || s > best.score) best = { length, score: s, at, ids: new Set([c.id]) };
        else best.ids.add(c.id);
      }
    }
  }

  const ambiguous = best.ids.size > 1;
  const used = (i: number) => i === amountAt || (i >= best.at && i < best.at + best.length);
  const note = tokens.filter((t, i) => !used(i) && t !== '€').join(' ');
  return {
    ...(amount !== undefined && { amount }),
    ...(best.ids.size === 1 && { categoryId: [...best.ids][0] }),
    ...(note !== '' && { note }),
    ambiguous,
  };
}
