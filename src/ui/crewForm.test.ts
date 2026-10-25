import { describe, expect, it } from 'vitest';
import type { CrewMember } from '../domain/types';
import {
  blankCrewForm, CONTROL_ORDER, crewFieldsOf, crewFormOf, crewFormProblems, crewPatchOf, problemsByControl,
  rejoinProblem, signOffProblem,
} from './crewForm';
import type { CrewForm } from './crewForm';

const TODAY = '2026-10-25';

function member(over: Partial<CrewMember> = {}): CrewMember {
  return {
    id: 'crew-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'device',
    deleted: false, scope: 'ship', shipId: 'ship-1', surname: 'PETROVIĆ', givenNames: 'Ivan', rank: 'master',
    nationality: 'Croatian', dateOfBirth: '1985-01-05', placeOfBirth: 'Split', passportNo: 'P123', passportExpiry: '2030-01-01',
    seamansBookNo: 'SB1', seamansBookExpiry: '2030-01-01', signOnDate: '2026-06-01', signOnPort: 'Rijeka', ...over,
  };
}

function form(over: Partial<CrewForm> = {}): CrewForm {
  return { ...crewFormOf(member()), ...over };
}

describe('the crew form', () => {
  it('starts empty, with no rank chosen', () => {
    const blank = blankCrewForm();
    expect(blank.rank).toBe('');
    expect(Object.values(blank).every((v) => v === '')).toBe(true);
    expect(Object.keys(blank).sort()).toEqual([...CONTROL_ORDER].sort());
  });

  it('is filled from a member, with an empty box for a missing rank text', () => {
    const f = crewFormOf(member({ signOffDate: '2026-10-10' }));
    expect(f).toMatchObject({ surname: 'PETROVIĆ', givenNames: 'Ivan', rank: 'master', rankOther: '', signOnDate: '2026-06-01' });
    expect('signOffDate' in f).toBe(false); // sign-off is not edited here
    expect(crewFormOf(member({ rank: 'other', rankOther: 'Pumpman' })).rankOther).toBe('Pumpman');
  });

  it('is read back with the text trimmed', () => {
    const fields = crewFieldsOf(form({ surname: '  PETROVIĆ ', givenNames: ' Ivan Marko', signOnPort: 'Rijeka  ' }));
    expect(fields).toMatchObject({ surname: 'PETROVIĆ', givenNames: 'Ivan Marko', signOnPort: 'Rijeka' });
  });
  it('keeps the rank text only for Other', () => {
    expect('rankOther' in crewFieldsOf(form({ rankOther: 'Pumpman' }))!).toBe(false);
    expect(crewFieldsOf(form({ rank: 'other', rankOther: ' Pumpman ' }))).toMatchObject({ rank: 'other', rankOther: 'Pumpman' });
  });
  it('has no fields while no rank is chosen', () => {
    expect(crewFieldsOf(form({ rank: '' }))).toBeUndefined();
  });

  describe('as a change to a saved member', () => {
    const fieldsOf = (f: CrewForm) => crewFieldsOf(f)!;

    it('is the fields of the form, and nothing about the sign-off', () => {
      const patch = crewPatchOf(fieldsOf(form({ nationality: 'Italian' })), member({ signOffDate: '2026-10-10', signOffPort: 'Santos' }));
      expect(patch.nationality).toBe('Italian');
      expect('signOffDate' in patch).toBe(false);
      expect('signOffPort' in patch).toBe(false);
    });
    it('clears the rank text when the rank is no longer Other', () => {
      const saved = member({ rank: 'other', rankOther: 'Pumpman' });
      expect(crewPatchOf(fieldsOf(form({ rank: 'ab' })), saved)).toHaveProperty('rankOther', undefined);
      expect(crewPatchOf(fieldsOf(form({ rank: 'other', rankOther: 'Fitter' })), saved)).toMatchObject({ rankOther: 'Fitter' });
    });
    it('does not add a rank text that was never there', () => {
      expect('rankOther' in crewPatchOf(fieldsOf(form()), member())).toBe(false);
    });
  });
});

describe('crewFormProblems', () => {
  it('has none for a complete form', () => {
    expect(crewFormProblems(form(), TODAY)).toEqual([]);
  });
  it('reports the empty required fields of a blank form', () => {
    const problems = crewFormProblems(blankCrewForm(), TODAY);
    expect(problems.map((p) => [p.field, p.message])).toEqual([
      ['surname', 'Surname is required.'],
      ['signOnDate', 'Sign-on date is required.'],
      ['rank', 'Rank is required.'],
    ]);
  });
  it('reports a date of birth that is not in the past', () => {
    expect(crewFormProblems(form({ dateOfBirth: '2027-01-01' }), TODAY).map((p) => p.message)).toEqual(['Date of birth must be in the past.']);
    expect(crewFormProblems(form({ dateOfBirth: TODAY }), TODAY)).toHaveLength(1);
  });
  it('asks for the text when the rank is Other', () => {
    expect(crewFormProblems(form({ rank: 'other', rankOther: '  ' }), TODAY).map((p) => [p.field, p.message])).toEqual([
      ['rank', 'Rank is required.'],
    ]);
  });
  it('checks a sign-off date that the form does not show against the new sign-on', () => {
    expect(crewFormProblems(form({ signOnDate: '2026-11-01' }), TODAY, '2026-10-10').map((p) => p.field)).toEqual(['signOffDate']);
    expect(crewFormProblems(form({ signOnDate: '2026-10-10' }), TODAY, '2026-10-10')).toEqual([]);
  });
});

describe('problemsByControl', () => {
  it('puts a problem at the control of its field', () => {
    const byControl = problemsByControl(crewFormProblems(blankCrewForm(), TODAY), blankCrewForm());
    expect([...byControl.keys()]).toEqual(['surname', 'signOnDate', 'rank']);
  });
  it('puts the missing rank text at the Rank (other) box once Other is chosen', () => {
    const f = form({ rank: 'other' });
    expect([...problemsByControl(crewFormProblems(f, TODAY), f).keys()]).toEqual(['rankOther']);
  });
  it('puts a sign-off problem at the sign-on date, the only date it can be fixed with', () => {
    const f = form({ signOnDate: '2026-11-01' });
    const byControl = problemsByControl(crewFormProblems(f, TODAY, '2026-10-10'), f);
    expect(byControl.get('signOnDate')?.message).toBe("Sign-off can't be before sign-on.");
  });
  it('lets an error win over a warning, and the first of the same kind stay', () => {
    const byControl = problemsByControl([
      { field: 'surname', severity: 'warning', message: 'first' },
      { field: 'surname', severity: 'error', message: 'second' },
      { field: 'surname', severity: 'error', message: 'third' },
    ], form());
    expect(byControl.get('surname')?.message).toBe('second');
  });
});

describe('the order of the controls', () => {
  it('is the order of the form, for moving the focus to the first problem', () => {
    expect(CONTROL_ORDER).toEqual([
      'surname', 'givenNames', 'rank', 'rankOther', 'nationality', 'dateOfBirth', 'placeOfBirth', 'passportNo',
      'passportExpiry', 'seamansBookNo', 'seamansBookExpiry', 'signOnDate', 'signOnPort',
    ]);
  });
});

describe('signOffProblem', () => {
  const m = member({ signOnDate: '2026-06-01' });
  it('has none for a date on or after the sign-on', () => {
    expect(signOffProblem(m, '2026-10-10', TODAY)).toBeUndefined();
    expect(signOffProblem(m, '2026-06-01', TODAY)).toBeUndefined();
  });
  it('refuses a date before the sign-on', () => {
    expect(signOffProblem(m, '2026-05-31', TODAY)).toMatchObject({ field: 'signOffDate', message: "Sign-off can't be before sign-on." });
  });
  it('wants a date, and a real one', () => {
    expect(signOffProblem(m, '', TODAY)?.message).toBe('Sign-off date is required.');
    expect(signOffProblem(m, '2026-02-30', TODAY)?.message).toBe('Enter a valid date.');
  });
  it('does not mind problems that are not about the sign-off', () => {
    expect(signOffProblem(member({ surname: '', dateOfBirth: '2099-01-01' }), '2026-10-10', TODAY)).toBeUndefined();
  });
});

describe('rejoinProblem', () => {
  const m = member({ signOffDate: '2026-10-10' });
  it('has none for a sign-on after the sign-off', () => {
    expect(rejoinProblem(m, '2026-10-11', TODAY)).toBeUndefined();
  });
  it('names the sign-off date when the sign-on is not after it', () => {
    const message = 'Sign-on must be after the sign-off date (2026-10-10).';
    expect(rejoinProblem(m, '2026-10-10', TODAY)).toMatchObject({ field: 'signOnDate', severity: 'error', message });
    expect(rejoinProblem(m, '2026-09-01', TODAY)?.message).toBe(message);
  });
  it('wants a date, and a real one', () => {
    expect(rejoinProblem(m, '', TODAY)?.message).toBe('Sign-on date is required.');
    expect(rejoinProblem(m, '2026-13-01', TODAY)?.message).toBe('Enter a valid date.');
  });
  it('has no sign-off date to hold the new sign-on to when the contract is not signed off', () => {
    expect(rejoinProblem(member(), '2020-01-01', TODAY)).toBeUndefined();
  });
});
