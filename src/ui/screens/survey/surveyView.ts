import { looksLikeThousands, parseDecimal } from '../../../domain/numbers';
import type { DraftSurvey, DraftSurveyShip, HydroRow, SurveyKind, SurveyOperation } from '../../../domain/types';
import type { SurveyFields } from '../../../db/survey';
import { calcOutcome, calcSheet, sheetFor } from '../../../survey/calc';
import type { Outcome, SheetResult } from '../../../survey/calc';

/*
 * The survey screens' pure parts: what the form's text means as a survey, the figures worked out from it, and how they
 * are written on screen. The calculation itself is the engine's (src/survey), used as it is.
 */

export const KIND_TITLES: Record<SurveyKind, string> = {
  initial: 'Initial survey', interim: 'Interim survey', final: 'Final survey', constant: 'Constant check',
};

/** Said when the drafts went the other way for the survey's operation: the cargo came out negative. */
export const WRONG_WAY = 'Drafts move opposite to the operation, check the readings';
export const NUMBER_ERROR = 'Enter a number, e.g. 4,25.';
export const INITIAL_MISSING = 'The initial survey this one is worked against has been deleted.';

const MINUS = '−';

/** `x` with `digits` decimals, a real minus sign, and never "−0.000". */
export function fixed(x: number, digits: number): string {
  const text = x.toFixed(digits);
  if (/^-0\.?0*$/.test(text)) return text.slice(1);
  return text.replace('-', MINUS);
}

/** `fixed`, with a `+` on a positive number: a difference. */
export function signed(x: number, digits: number): string {
  const text = fixed(x, digits);
  return /^[1-9]|^0\.0*[1-9]/.test(text) ? `+${text}` : text;
}

/** The compared quantity's name: the shore scale when loading, the B/L figure when discharging (FINAL Y37). */
export function comparedName(operation: SurveyOperation): string {
  return operation === 'loading' ? 'Shore scale' : 'B/L figure';
}

// ---------------------------------------------------------------------------------------------------------------------
// The form

export const DRAFT_KEYS = ['fP', 'fS', 'mP', 'mS', 'aP', 'aS'] as const;
export const DEDUCTIBLE_KEYS = ['ballast', 'freshWater', 'vlsfo', 'lsmgo', 'lubOil', 'other'] as const;
/** Tonnes: a thousands-like entry (`1,250`) is read as a decimal, but the field says how it was read. */
const TONNE_KEYS = [...DEDUCTIBLE_KEYS, 'comparedQty', 'blQty'] as const;
export const NUMBER_KEYS = [...DRAFT_KEYS, 'density', ...TONNE_KEYS, 'windBft', 'swell'] as const;
export const TEXT_KEYS = ['port', 'terminal', 'cargo', 'holds', 'date', 'timeFrom', 'timeTill', 'remarks', 'surveyor', 'chiefOfficer'] as const;

export type NumberKey = (typeof NUMBER_KEYS)[number];
export type TextKey = (typeof TEXT_KEYS)[number];
/** What is typed in the survey form: every field as text, numbers included, and the operation. */
export type SurveyDraft = Record<NumberKey | TextKey, string> & { operation: SurveyOperation };

const text = (x: number | undefined) => (x === undefined ? '' : String(x));

/** The form's text for a stored survey. */
export function toDraft(s: DraftSurvey): SurveyDraft {
  const numbers: Record<NumberKey, number | undefined> = {
    ...s.drafts, ...s.deductibles, density: s.density, comparedQty: s.comparedQty, blQty: s.blQty, windBft: s.windBft, swell: s.swell,
  } as Record<NumberKey, number | undefined>;
  const draft = { operation: s.operation } as SurveyDraft;
  for (const key of NUMBER_KEYS) draft[key] = text(numbers[key]);
  for (const key of TEXT_KEYS) draft[key] = s[key] ?? '';
  return draft;
}

export interface Problem { severity: 'error' | 'warning'; message: string }

/**
 * The survey a draft stands for, on top of `base` (its kind and link), and the problems in what was typed. A number
 * that can't be read is left out, as an empty one is, so that the result waits for it; text is trimmed.
 */
export function fromDraft(base: Pick<DraftSurvey, 'kind' | 'initialId'>, draft: SurveyDraft): { fields: SurveyFields; problems: Partial<Record<NumberKey, Problem>> } {
  const problems: Partial<Record<NumberKey, Problem>> = {};
  const n = {} as Record<NumberKey, number | undefined>;
  for (const key of NUMBER_KEYS) {
    const value = parseDecimal(draft[key]);
    if (value === 'invalid') problems[key] = { severity: 'error', message: NUMBER_ERROR };
    else if (typeof value === 'number' && (TONNE_KEYS as readonly string[]).includes(key) && looksLikeThousands(draft[key])) {
      problems[key] = { severity: 'warning', message: `Read as ${value} t. Write thousands without a separator.` };
    }
    n[key] = typeof value === 'number' ? value : undefined;
  }
  const fields: SurveyFields = {
    kind: base.kind, initialId: base.initialId, operation: draft.operation,
    drafts: { fP: n.fP, fS: n.fS, mP: n.mP, mS: n.mS, aP: n.aP, aS: n.aS },
    density: n.density,
    deductibles: { ballast: n.ballast, freshWater: n.freshWater, vlsfo: n.vlsfo, lsmgo: n.lsmgo, lubOil: n.lubOil, other: n.other },
    comparedQty: n.comparedQty, blQty: n.blQty, windBft: n.windBft, swell: n.swell,
  };
  for (const key of TEXT_KEYS) {
    const value = draft[key].trim();
    if (value !== '') fields[key] = value;
  }
  return { fields, problems };
}

// ---------------------------------------------------------------------------------------------------------------------
// The figures

export interface Worked {
  /** The figures of the survey's own sheet: INITIAL for an initial survey or constant check, FINAL for the others. */
  sheet: SheetResult;
  /** For an interim or final survey, the initial survey's INITIAL sheet (its nett displacement is the start). */
  initial?: SheetResult;
  outcome: Outcome;
  /** The operation the outcome follows: an interim or final survey follows its initial survey's (FINAL takes it from INITIAL). */
  operation: SurveyOperation;
  /** The cargo came out negative: the drafts moved the other way for the operation. */
  wrongWay: boolean;
}

/** A survey's figures, or why there are none. An interim or final survey is worked against `initial`. */
export function workOut(ship: DraftSurveyShip, hydro: readonly HydroRow[], survey: DraftSurvey, initial?: DraftSurvey): Worked | { error: string } {
  const sheet = sheetFor(survey);
  const own = calcSheet(ship, hydro, survey, sheet);
  if ('error' in own) return own;
  if (sheet === 'initial') return { sheet: own, outcome: calcOutcome(own, undefined, ship, survey), operation: survey.operation, wrongWay: false };
  if (!initial) return { error: INITIAL_MISSING };
  const start = calcSheet(ship, hydro, initial, 'initial');
  if ('error' in start) return { error: `The initial survey: ${start.error}` };
  const outcome = calcOutcome(start, own, ship, { ...survey, operation: initial.operation });
  return { sheet: own, initial: start, outcome, operation: initial.operation, wrongWay: (outcome.cargo ?? 0) < 0 };
}

/** The result in one line, for the list of surveys: "Constant −2674.542 t", "Cargo loaded 12610.742 t". */
export function resultLine(worked: Worked | { error: string }): string {
  if ('error' in worked) return 'No result yet';
  const { outcome } = worked;
  if (outcome.constant !== undefined) return `${outcome.constantLabel ?? 'Constant'} ${fixed(outcome.constant, 3)} t`;
  return `Cargo ${outcome.cargoLabel} ${fixed(outcome.cargo ?? 0, 3)} t`;
}

/** One line of the calculation: the workbook's label, the value as written, and the cell it is on the sheet. */
export interface Line { label: string; value: string }

const m4 = (x: number) => `${fixed(x, 4)} m`;
const t3 = (x: number) => `${fixed(x, 3)} t`;

/**
 * Every intermediate line, each after the figures it is worked from: the sheet's drafts block (rows 15 to 23), then its
 * left column of hydrostatics (I25 to I34), then its right column of displacements (Y25 to Y34). Rows 20 to 23 are in
 * dependency order, not the sheet's strict column order: the apparent trim and the means (right column) first, then
 * the list and the deflection (left column), which are worked from them. The three marks' lines are `marks` (forward,
 * midships, aft); the rest are `lines`.
 */
export function calculationLines(ship: DraftSurveyShip, worked: Worked): { marks: { label: string; values: [string, string, string] }[]; lines: Line[] } {
  const r = worked.sheet;
  const mark = (label: string, v: { F: number; M: number; A: number }) => ({ label, values: [fixed(v.F, 4), fixed(v.M, 4), fixed(v.A, 4)] as [string, string, string] });
  const lines: Line[] = [
    { label: 'Apparent Trim', value: m4(r.apparentTrim) },
    { label: 'Fore to Aft Mean', value: m4(r.foreAftMean) },
    { label: 'Mean of Means', value: m4(r.meanOfMeans) },
    { label: 'Quarter Mean', value: m4(r.quarterMean) },
    { label: 'List', value: `${r.list.side} ${fixed(r.list.deg, 2)}°` },
    { label: 'Deflection', value: `${r.deflection.kind} ${fixed(r.deflection.cm, 1)} cm` },
    { label: 'Actual Trim', value: m4(r.trim) },
    { label: 'TPC', value: t3(r.tpc) },
    { label: 'LCF', value: `${fixed(r.lcf, 3)} m` },
    { label: 'LBP', value: `${ship.lbp} m` },
    { label: '1st Trim Correction', value: t3(r.trimCorr1) },
    { label: 'MTC+0.5', value: t3(r.mtcPlus) },
    { label: 'MTC−0.5', value: t3(r.mtcMinus) },
    { label: 'dMdZ', value: t3(r.dMdZ) },
    { label: '2nd Trim Correction', value: t3(r.trimCorr2) },
    { label: 'Q/M Displacement', value: t3(r.qmDisplacement) },
    { label: 'Displ corr’d for trim', value: t3(r.displCorrected) },
    { label: 'Density', value: `${fixed(r.density, 4)} t/m³` },
    { label: 'Gross Displacement', value: t3(r.gross) },
    { label: 'Deductibles', value: t3(r.deductibles) },
    { label: 'Nett Displacement', value: t3(r.nett) },
  ];
  const { outcome } = worked;
  if (outcome.constant !== undefined) {
    lines.push({ label: 'Light Ship', value: t3(ship.lightShip) }, { label: outcome.constantLabel ?? 'Constant', value: t3(outcome.constant) });
  } else if (worked.initial) {
    lines.push({ label: 'Initial Nett Displacement', value: t3(worked.initial.nett) }, { label: `Cargo ${outcome.cargoLabel}`, value: t3(outcome.cargo ?? 0) });
  }
  return {
    marks: [mark('Mean', r.means), mark('Perp. Corr.', r.perp), mark('Corrected Drafts', r.corrected)],
    lines,
  };
}
