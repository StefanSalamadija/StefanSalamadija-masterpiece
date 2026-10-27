import { describe, expect, it } from 'vitest';
import type { CrewMember } from '../domain/types';
import {
  blankCrewForm, CONTROL_ORDER, crewFieldsOf, crewFormOf, crewFormProblems, crewPatchOf, overlapProblem,
  problemsByControl, rejoinProblem, signOffProblem,
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

  describe('the contract length and the planned relief', () => {
    const planned = member({ contractMonths: 9, reliefPlannedDate: '2026-11-05', reliefPlannedPort: 'Santos' });
    const fieldsOf = (f: CrewForm) => crewFieldsOf(f)!;

    it('are filled from a member as text, and empty boxes when there are none', () => {
      expect(crewFormOf(planned)).toMatchObject({ contractMonths: '9', reliefPlannedDate: '2026-11-05', reliefPlannedPort: 'Santos' });
      expect(crewFormOf(member())).toMatchObject({ contractMonths: '', reliefPlannedDate: '', reliefPlannedPort: '' });
    });
    it('are read back as a number and trimmed text', () => {
      expect(crewFieldsOf(form({ contractMonths: ' 9 ', reliefPlannedDate: '2026-11-05', reliefPlannedPort: ' Santos ' })))
        .toMatchObject({ contractMonths: 9, reliefPlannedDate: '2026-11-05', reliefPlannedPort: 'Santos' });
    });
    it('are left out of the fields when empty, not kept as empty text', () => {
      const fields = crewFieldsOf(form({ contractMonths: '  ', reliefPlannedDate: '', reliefPlannedPort: '   ' }))!;
      for (const key of ['contractMonths', 'reliefPlannedDate', 'reliefPlannedPort']) expect(key in fields).toBe(false);
    });
    it('give text that is not a number as NaN, and a fraction as it is, for validation to refuse', () => {
      for (const text of ['abc', '-3', '1e1']) expect(crewFieldsOf(form({ contractMonths: text }))?.contractMonths).toBeNaN();
      expect(crewFieldsOf(form({ contractMonths: '6.5' }))?.contractMonths).toBe(6.5);
    });
    it('are cleared in the saved member when the boxes are emptied', () => {
      const patch = crewPatchOf(fieldsOf(form({ contractMonths: '', reliefPlannedDate: '', reliefPlannedPort: '' })), planned);
      expect(patch).toMatchObject({ contractMonths: undefined, reliefPlannedDate: undefined, reliefPlannedPort: undefined });
      for (const key of ['contractMonths', 'reliefPlannedDate', 'reliefPlannedPort']) expect(key in patch).toBe(true);
    });
    it('are changed in the saved member when the boxes are changed', () => {
      const patch = crewPatchOf(fieldsOf(form({ contractMonths: '6', reliefPlannedDate: '2026-12-01', reliefPlannedPort: 'Rotterdam' })), planned);
      expect(patch).toMatchObject({ contractMonths: 6, reliefPlannedDate: '2026-12-01', reliefPlannedPort: 'Rotterdam' });
    });
    it('are not added to the change of a member that never had them', () => {
      const patch = crewPatchOf(fieldsOf(form()), member());
      for (const key of ['contractMonths', 'reliefPlannedDate', 'reliefPlannedPort']) expect(key in patch).toBe(false);
    });
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
    expect(crewFormProblems(form({ signOnDate: '2026-11-01' }), TODAY, { signOffDate: '2026-10-10' }).map((p) => p.field)).toEqual(['signOffDate']);
    expect(crewFormProblems(form({ signOnDate: '2026-10-10' }), TODAY, { signOffDate: '2026-10-10' })).toEqual([]);
  });

  describe('the contract length', () => {
    it('is fine when empty or from 1 to 24 whole months', () => {
      for (const text of ['', '1', '6', ' 24 ', '06']) expect(crewFormProblems(form({ contractMonths: text }), TODAY)).toEqual([]);
    });
    it('gives the same message as validation for anything else, typed as text', () => {
      for (const text of ['0', '25', '6.5', '6,5', 'abc', '-3', '1e1', '6 months']) {
        expect(crewFormProblems(form({ contractMonths: text }), TODAY)).toEqual([
          { field: 'contractMonths', severity: 'error', message: 'Enter whole months between 1 and 24.' },
        ]);
      }
    });
  });
  describe('the planned relief', () => {
    it("can't be before the sign-on, and is shown at the planned relief date", () => {
      const f = form({ signOnDate: '2026-06-01', reliefPlannedDate: '2026-05-31' });
      const problems = crewFormProblems(f, TODAY);
      expect(problems).toEqual([{ field: 'reliefPlannedDate', severity: 'error', message: "Planned relief can't be before sign-on." }]);
      expect(problemsByControl(problems, f).get('reliefPlannedDate')?.message).toBe("Planned relief can't be before sign-on.");
    });
    it('needs a real date when filled in, and is fine empty', () => {
      expect(crewFormProblems(form({ reliefPlannedDate: '2026-02-30' }), TODAY).map((p) => p.message)).toEqual(['Enter a valid date.']);
      expect(crewFormProblems(form({ reliefPlannedDate: '', reliefPlannedPort: 'Santos' }), TODAY)).toEqual([]);
    });
  });

  describe('against the other contracts of the ship', () => {
    const earlier = member({ id: 'earlier', givenNames: 'Ivan', signOnDate: '2026-01-01', signOffDate: '2026-05-31' });

    it('refuses a sign-on that runs into a contract of the same person, at the sign-on date', () => {
      const problems = crewFormProblems(form({ signOnDate: '2026-05-31' }), TODAY, { crew: [earlier] });
      expect(problems).toEqual([{
        field: 'signOnDate', severity: 'error', message: "This overlaps Ivan PETROVIĆ's contract from 2026-01-01 to 2026-05-31.",
      }]);
    });
    it('accepts a sign-on the day after the other contract ended', () => {
      expect(crewFormProblems(form({ signOnDate: '2026-06-01' }), TODAY, { crew: [earlier] })).toEqual([]);
    });
    it('does not count the contract being edited, and keeps its own sign-off in the span', () => {
      const saved = member({ id: 'saved', signOnDate: '2026-06-01', signOffDate: '2026-10-10' });
      expect(crewFormProblems(crewFormOf(saved), TODAY, { id: 'saved', signOffDate: '2026-10-10', crew: [earlier, saved] })).toEqual([]);
      const later = member({ id: 'later', signOnDate: '2026-10-05' });
      expect(crewFormProblems(crewFormOf(saved), TODAY, { id: 'saved', signOffDate: '2026-10-10', crew: [saved, later] })
        .map((p) => p.message)).toEqual(["This overlaps Ivan PETROVIĆ's contract from 2026-10-05 (still onboard)."]);
    });
    it('knows a new person by the passport number typed in the form', () => {
      const someone = member({ id: 'someone', passportNo: 'AB 123', surname: 'KOVAČ', givenNames: 'Marko', dateOfBirth: '1970-02-02', signOnDate: '2026-03-01' });
      const f = form({ surname: 'Different', givenNames: 'Name', dateOfBirth: '1999-09-09', passportNo: 'ab123', signOnDate: '2026-04-01' });
      expect(crewFormProblems(f, TODAY, { crew: [someone] }).map((p) => p.message))
        .toEqual(["This overlaps Marko KOVAČ's contract from 2026-03-01 (still onboard)."]);
    });
    it('is left out while the sign-on date is missing, which has its own message', () => {
      expect(crewFormProblems(form({ signOnDate: '' }), TODAY, { crew: [earlier] }).map((p) => p.message)).toEqual(['Sign-on date is required.']);
    });
  });
});

describe('overlapProblem', () => {
  const open = member({ id: 'open', signOnDate: '2026-10-15' });
  const candidate = { ...member({ signOnDate: '2026-06-01' }), signOffDate: '2026-10-15' };

  it('names the contract it runs into, with its dates', () => {
    expect(overlapProblem(candidate, [open], 'signOffDate')).toEqual({
      field: 'signOffDate', severity: 'error', message: "This overlaps Ivan PETROVIĆ's contract from 2026-10-15 (still onboard).",
    });
    const closed = member({ id: 'closed', givenNames: 'Ivo', surname: 'PETROVIĆ', signOnDate: '2026-10-01', signOffDate: '2026-12-01' });
    expect(overlapProblem(candidate, [closed], 'signOnDate')?.message).toBe("This overlaps Ivo PETROVIĆ's contract from 2026-10-01 to 2026-12-01.");
  });
  it('is nothing when the dates keep clear', () => {
    expect(overlapProblem({ ...candidate, signOffDate: '2026-10-14' }, [open], 'signOffDate')).toBeUndefined();
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
    const byControl = problemsByControl(crewFormProblems(f, TODAY, { signOffDate: '2026-10-10' }), f);
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
      'contractMonths', 'reliefPlannedDate', 'reliefPlannedPort',
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
  it('refuses a date on or after the sign-on of a later contract of the same person', () => {
    const later = member({ id: 'later', signOnDate: '2026-10-15' });
    const message = "This overlaps Ivan PETROVIĆ's contract from 2026-10-15 (still onboard).";
    expect(signOffProblem(m, '2026-10-14', TODAY, [m, later])).toBeUndefined();
    expect(signOffProblem(m, '2026-10-15', TODAY, [m, later])).toMatchObject({ field: 'signOffDate', message });
    expect(signOffProblem(m, '2026-12-01', TODAY, [m, later])?.message).toBe(message);
  });
  it('puts the date problems before the overlap', () => {
    const later = member({ id: 'later', signOnDate: '2026-03-01' });
    expect(signOffProblem(m, '2026-05-01', TODAY, [m, later])?.message).toBe("Sign-off can't be before sign-on.");
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
  it('refuses a new contract, open to the end, that meets a later contract of the same person', () => {
    const later = member({ id: 'later', signOnDate: '2026-12-01', signOffDate: '2026-12-31' });
    expect(rejoinProblem(m, '2026-10-20', TODAY, [m, later])).toMatchObject({
      field: 'signOnDate', message: "This overlaps Ivan PETROVIĆ's contract from 2026-12-01 to 2026-12-31.",
    });
    expect(rejoinProblem(m, '2027-01-01', TODAY, [m, later])).toBeUndefined();
  });
  it('keeps the sign-off rule first', () => {
    const later = member({ id: 'later', signOnDate: '2026-10-01' });
    expect(rejoinProblem(m, '2026-10-10', TODAY, [m, later])?.message).toBe('Sign-on must be after the sign-off date (2026-10-10).');
  });
});
