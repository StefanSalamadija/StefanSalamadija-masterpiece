import { describe, expect, it } from 'vitest';
import { FAKE_FINAL, FAKE_INITIAL, makeSurveyWorkbook } from '../../../../e2e/fixtures/makeSurveyWorkbook';
import type { DraftSurvey, DraftSurveyShip } from '../../../domain/types';
import { OUT_OF_RANGE } from '../../../survey/calc';
import { readSurveyWorkbook } from '../../../survey/workbook/read';
import { calculationLines, fixed, fromDraft, INITIAL_MISSING, NUMBER_ERROR, resultLine, signed, toDraft, workOut } from './surveyView';
import type { Worked } from './surveyView';

const book = readSurveyWorkbook(makeSurveyWorkbook());
if ('error' in book) throw new Error(book.error);
const ship: DraftSurveyShip = { ...book.ship, id: 'survey-ship:s1', shipId: 's1', createdAt: '', updatedAt: '', updatedBy: '', deleted: false, scope: 'ship' };
const base = { shipId: 's1', createdAt: '', updatedAt: '', updatedBy: '', deleted: false, scope: 'ship' as const };
const initial: DraftSurvey = { ...base, id: 'i', kind: 'initial', operation: 'loading', drafts: FAKE_INITIAL.drafts, density: FAKE_INITIAL.density, deductibles: FAKE_INITIAL.deductibles };
const final: DraftSurvey = { ...base, id: 'f', kind: 'final', initialId: 'i', operation: 'loading', drafts: FAKE_FINAL.drafts, density: FAKE_FINAL.density, deductibles: FAKE_FINAL.deductibles, comparedQty: 12600 };
const ok = (w: Worked | { error: string }): Worked => {
  if ('error' in w) throw new Error(w.error);
  return w;
};

describe('fixed and signed', () => {
  it('write a real minus sign, never a negative zero, and a plus on a positive difference', () => {
    expect(fixed(-2674.542, 3)).toBe('−2674.542');
    expect(fixed(-0.0001, 3)).toBe('0.000');
    expect(fixed(12610.742000000001, 3)).toBe('12610.742');
    expect(signed(10.742, 3)).toBe('+10.742');
    expect(signed(0.0004, 3)).toBe('0.000');
    expect(signed(-1.5, 3)).toBe('−1.500');
  });
});

describe('fromDraft', () => {
  it('reads decimal commas, trims text, and leaves out what is empty or not a number', () => {
    const draft = { ...toDraft({ ...initial, drafts: {}, deductibles: {} }), fP: '3,1', fS: '3.14', mP: '3,6,1', density: '1,02', port: ' Portville ', terminal: '  ' };
    const { fields, problems } = fromDraft(initial, draft);
    expect(fields.drafts).toMatchObject({ fP: 3.1, fS: 3.14, mP: undefined });
    expect(fields.density).toBe(1.02);
    expect(fields.port).toBe('Portville');
    expect(fields.terminal).toBeUndefined();
    expect(problems.mP).toEqual({ severity: 'error', message: NUMBER_ERROR });
  });

  it('says how a thousands-like tonnage was read', () => {
    const { fields, problems } = fromDraft(initial, { ...toDraft(initial), ballast: '1,250' });
    expect(fields.deductibles.ballast).toBe(1.25);
    expect(problems.ballast?.severity).toBe('warning');
  });

  it('gives back what toDraft was given', () => {
    const { fields } = fromDraft(final, toDraft(final));
    expect(fields).toMatchObject({ kind: 'final', initialId: 'i', drafts: FAKE_FINAL.drafts, density: FAKE_FINAL.density, comparedQty: 12600 });
  });
});

describe('workOut', () => {
  it('gives the constant of an initial survey, with every line', () => {
    const w = ok(workOut(ship, book.hydro, initial));
    expect(resultLine(w)).toBe('Constant −2674.542 t');
    const { marks, lines } = calculationLines(ship, w);
    expect(marks.map((m) => m.label)).toEqual(['Mean', 'Perp. Corr.', 'Corrected Drafts']);
    expect(lines.find((l) => l.label === 'Quarter Mean')?.value).toBe('3.6276 m');
    expect(lines.at(-1)).toEqual({ label: 'Constant', value: '−2674.542 t' });
  });

  it('gives the cargo of a final survey against its initial, following the initial survey’s operation', () => {
    const w = ok(workOut(ship, book.hydro, { ...final, operation: 'discharging' }, initial));
    expect(w.operation).toBe('loading');
    expect(resultLine(w)).toBe('Cargo loaded 12610.742 t');
    expect(w.wrongWay).toBe(false);
    expect(w.outcome.differenceT).toBeCloseTo(10.742, 9);
  });

  it('flags a cargo that came out negative', () => {
    const w = ok(workOut(ship, book.hydro, final, { ...initial, operation: 'discharging' }));
    expect(w.outcome.cargo).toBeLessThan(0);
    expect(w.wrongWay).toBe(true);
  });

  it('gives no result outside the table, or without the initial survey', () => {
    expect(workOut(ship, book.hydro, { ...initial, drafts: { ...initial.drafts, mP: 9.5, mS: 9.5 } })).toEqual({ error: OUT_OF_RANGE });
    expect(workOut(ship, book.hydro, final, undefined)).toEqual({ error: INITIAL_MISSING });
  });
});
