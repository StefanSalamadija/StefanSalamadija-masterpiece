import { describe, expect, it } from 'vitest';
import {
  isValidImo, isValidMmsi, normaliseImo, validateCertificate, validateCrewMember, validateMaxMonthsOnboard,
  validateParticulars,
} from './validation';
import type { CrewDraft, Particulars } from './types';

const TODAY = '2026-10-25';

const emptyParticulars: Particulars = {
  name: '', imo: '', callSign: '', mmsi: '', flag: '', portOfRegistry: '',
  owners: '', managers: '', pandi: '', classSociety: '',
};

const draft: CrewDraft = {
  surname: 'PETROVIĆ', givenNames: 'Ivan', rank: 'master', nationality: 'Croatian',
  dateOfBirth: '1980-03-14', placeOfBirth: 'Split', passportNo: 'P1234567', passportExpiry: '2030-01-01',
  seamansBookNo: 'SB-998', seamansBookExpiry: '2030-01-01', signOnDate: '2026-06-01', signOnPort: 'Rijeka',
};

describe('IMO', () => {
  it('normaliseImo strips a leading IMO and whitespace', () => {
    expect(normaliseImo('IMO 9074729')).toBe('9074729');
    expect(normaliseImo('imo9074729')).toBe('9074729');
    expect(normaliseImo('  907 4729 ')).toBe('9074729');
    expect(normaliseImo('')).toBe('');
  });

  it('accepts a number whose check digit matches', () => {
    expect(isValidImo('9074729')).toBe(true);
    expect(isValidImo('IMO 9074729')).toBe(true);
  });

  it('rejects a wrong check digit, wrong length and non-digits', () => {
    for (const bad of ['9074728', '907472', '90747290', 'abcdefg', '']) expect(isValidImo(bad)).toBe(false);
  });
});

describe('MMSI', () => {
  it('needs exactly 9 digits', () => {
    expect(isValidMmsi('247123456')).toBe(true);
    expect(isValidMmsi('24712345')).toBe(false);
    expect(isValidMmsi('24712345a')).toBe(false);
    expect(isValidMmsi('2471234567')).toBe(false);
  });
});

describe('validateParticulars', () => {
  it('has no findings for empty particulars (nothing is required here)', () => {
    expect(validateParticulars(emptyParticulars)).toEqual([]);
  });

  it('warns, but does not error, on a failed IMO check digit', () => {
    expect(validateParticulars({ ...emptyParticulars, imo: '9074728' }))
      .toEqual([{ field: 'imo', severity: 'warning', message: "IMO check digit doesn't match — please re-check the number." }]);
  });

  it('accepts a valid IMO, with or without the IMO prefix', () => {
    expect(validateParticulars({ ...emptyParticulars, imo: '9074729' })).toEqual([]);
    expect(validateParticulars({ ...emptyParticulars, imo: 'IMO 9074729' })).toEqual([]);
  });

  it('skips IMO and MMSI that are blank', () => {
    expect(validateParticulars({ ...emptyParticulars, imo: '  ', mmsi: ' ' })).toEqual([]);
  });

  it('errors on a bad MMSI', () => {
    expect(validateParticulars({ ...emptyParticulars, mmsi: '123' })[0])
      .toMatchObject({ field: 'mmsi', severity: 'error', message: 'MMSI must be 9 digits.' });
    expect(validateParticulars({ ...emptyParticulars, mmsi: '247123456' })).toEqual([]);
  });

  it('errors on non-positive size figures', () => {
    expect(validateParticulars({ ...emptyParticulars, gt: -5 })[0])
      .toMatchObject({ field: 'gt', severity: 'error', message: 'Must be a positive number.' });
    for (const field of ['gt', 'nt', 'dwt', 'loa', 'beam'] as const) {
      expect(validateParticulars({ ...emptyParticulars, [field]: 0 })).toEqual([
        { field, severity: 'error', message: 'Must be a positive number.' },
      ]);
    }
    expect(validateParticulars({ ...emptyParticulars, loa: Number.NaN })[0]).toMatchObject({ field: 'loa' });
  });

  it('accepts positive figures', () => {
    expect(validateParticulars({ ...emptyParticulars, gt: 35000, nt: 18000, dwt: 58000, loa: 190.5, beam: 32.2, yearBuilt: 2012 })).toEqual([]);
  });

  it('lists findings in the field order of Particulars', () => {
    const found = validateParticulars({ ...emptyParticulars, beam: -1, gt: -1, mmsi: '1', imo: '9074728' });
    expect(found.map(f => f.field)).toEqual(['imo', 'mmsi', 'gt', 'beam']);
  });
});

describe('validateCrewMember', () => {
  it('has no findings for a valid draft', () => {
    expect(validateCrewMember(draft, TODAY)).toEqual([]);
  });

  it('requires date of birth to be in the past', () => {
    expect(validateCrewMember({ ...draft, dateOfBirth: '2027-01-01' }, TODAY)[0])
      .toMatchObject({ field: 'dateOfBirth', severity: 'error', message: 'Date of birth must be in the past.' });
    expect(validateCrewMember({ ...draft, dateOfBirth: TODAY }, TODAY)[0]).toMatchObject({ field: 'dateOfBirth' });
    expect(validateCrewMember({ ...draft, dateOfBirth: '2026-10-24' }, TODAY)).toEqual([]);
  });

  it('rejects sign-off before sign-on, allows the same day', () => {
    expect(validateCrewMember({ ...draft, signOnDate: '2026-06-01', signOffDate: '2026-05-01' }, TODAY)[0])
      .toMatchObject({ field: 'signOffDate', message: "Sign-off can't be before sign-on." });
    expect(validateCrewMember({ ...draft, signOnDate: '2026-06-01', signOffDate: '2026-06-01' }, TODAY)).toEqual([]);
  });

  it('flags a non-existent date', () => {
    expect(validateCrewMember({ ...draft, passportExpiry: '2026-02-30' }, TODAY)[0])
      .toMatchObject({ field: 'passportExpiry', message: 'Enter a valid date.' });
  });

  it('does not treat empty optional dates as errors', () => {
    expect(validateCrewMember({
      ...draft, dateOfBirth: '', passportExpiry: '', seamansBookExpiry: '', signOffDate: '', signOffPort: '',
    }, TODAY)).toEqual([]);
    expect(validateCrewMember({ ...draft, signOffDate: undefined }, TODAY)).toEqual([]);
  });

  it('flags invalid optional dates when they are filled in', () => {
    for (const field of ['dateOfBirth', 'passportExpiry', 'seamansBookExpiry', 'signOffDate'] as const) {
      expect(validateCrewMember({ ...draft, [field]: 'garbage' }, TODAY)).toEqual([
        { field, severity: 'error', message: 'Enter a valid date.' },
      ]);
    }
  });

  it('requires a surname', () => {
    expect(validateCrewMember({ ...draft, surname: '' }, TODAY)[0])
      .toMatchObject({ field: 'surname', severity: 'error', message: 'Surname is required.' });
    expect(validateCrewMember({ ...draft, surname: '   ' }, TODAY)[0]).toMatchObject({ field: 'surname' });
  });

  it('requires the rank text when rank is Other', () => {
    expect(validateCrewMember({ ...draft, rank: 'other', rankOther: '' }, TODAY))
      .toEqual([{ field: 'rank', severity: 'error', message: 'Rank is required.' }]);
    expect(validateCrewMember({ ...draft, rank: 'other' }, TODAY)[0]).toMatchObject({ field: 'rank', message: 'Rank is required.' });
    expect(validateCrewMember({ ...draft, rank: 'other', rankOther: '  ' }, TODAY)[0]).toMatchObject({ field: 'rank' });
    expect(validateCrewMember({ ...draft, rank: 'other', rankOther: 'Pumpman' }, TODAY)).toEqual([]);
    expect(validateCrewMember({ ...draft, rank: 'master', rankOther: '' }, TODAY)).toEqual([]);
  });

  it('requires a sign-on date, and a valid one', () => {
    expect(validateCrewMember({ ...draft, signOnDate: '' }, TODAY))
      .toEqual([{ field: 'signOnDate', severity: 'error', message: 'Sign-on date is required.' }]);
    expect(validateCrewMember({ ...draft, signOnDate: '2026-02-30' }, TODAY))
      .toEqual([{ field: 'signOnDate', severity: 'error', message: 'Enter a valid date.' }]);
  });

  it('skips the sign-off comparison when sign-on is missing or invalid', () => {
    const found = validateCrewMember({ ...draft, signOnDate: '', signOffDate: '2026-05-01' }, TODAY);
    expect(found.map(f => f.field)).toEqual(['signOnDate']);
  });

  it('lists findings in the field order of CrewDraft', () => {
    const found = validateCrewMember({
      ...draft, signOffDate: 'x', signOnDate: '', seamansBookExpiry: 'x', passportExpiry: 'x',
      dateOfBirth: '2999-01-01', rank: 'other', surname: '', contractMonths: 25, reliefPlannedDate: 'x',
    }, TODAY);
    expect(found.map(f => f.field)).toEqual([
      'surname', 'rank', 'dateOfBirth', 'passportExpiry', 'seamansBookExpiry', 'signOnDate', 'signOffDate',
      'contractMonths', 'reliefPlannedDate',
    ]);
  });

  describe('the contract length', () => {
    it('is optional, and takes whole months from 1 to 24', () => {
      expect(validateCrewMember({ ...draft, contractMonths: undefined }, TODAY)).toEqual([]);
      for (const months of [1, 6, 9, 24]) expect(validateCrewMember({ ...draft, contractMonths: months }, TODAY)).toEqual([]);
    });
    it('refuses anything else, with one message', () => {
      for (const months of [0, 25, -1, 6.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(validateCrewMember({ ...draft, contractMonths: months }, TODAY)).toEqual([
          { field: 'contractMonths', severity: 'error', message: 'Enter whole months between 1 and 24.' },
        ]);
      }
    });
  });

  describe('the planned relief', () => {
    it('is optional, and its date must be a real one', () => {
      expect(validateCrewMember({ ...draft, reliefPlannedDate: undefined, reliefPlannedPort: undefined }, TODAY)).toEqual([]);
      expect(validateCrewMember({ ...draft, reliefPlannedDate: '', reliefPlannedPort: '' }, TODAY)).toEqual([]);
      expect(validateCrewMember({ ...draft, reliefPlannedDate: '2026-02-30' }, TODAY))
        .toEqual([{ field: 'reliefPlannedDate', severity: 'error', message: 'Enter a valid date.' }]);
      expect(validateCrewMember({ ...draft, reliefPlannedDate: 'soon' }, TODAY)[0]).toMatchObject({ field: 'reliefPlannedDate' });
    });
    it("can't be before the sign-on, and can be on the same day", () => {
      expect(validateCrewMember({ ...draft, signOnDate: '2026-06-01', reliefPlannedDate: '2026-05-31' }, TODAY))
        .toEqual([{ field: 'reliefPlannedDate', severity: 'error', message: "Planned relief can't be before sign-on." }]);
      expect(validateCrewMember({ ...draft, signOnDate: '2026-06-01', reliefPlannedDate: '2026-06-01' }, TODAY)).toEqual([]);
      expect(validateCrewMember({ ...draft, signOnDate: '2026-06-01', reliefPlannedDate: '2026-11-05' }, TODAY)).toEqual([]);
    });
    it('skips the comparison when the sign-on is missing or not a date', () => {
      const found = validateCrewMember({ ...draft, signOnDate: '', reliefPlannedDate: '2026-05-31' }, TODAY);
      expect(found.map(f => f.field)).toEqual(['signOnDate']);
    });
  });
});

describe('validateMaxMonthsOnboard', () => {
  it('has nothing to say about a blank limit, which means the default', () => {
    expect(validateMaxMonthsOnboard(undefined)).toBeUndefined();
  });
  it('takes whole months from 1 to 11', () => {
    for (const months of [1, 9, 11]) expect(validateMaxMonthsOnboard(months)).toBeUndefined();
  });
  it('refuses anything else, with one message', () => {
    for (const months of [0, 12, -1, 6.5, Number.NaN]) {
      expect(validateMaxMonthsOnboard(months)).toEqual({
        field: 'maxMonthsOnboard', severity: 'error', message: 'Enter a number from 1 to 11.',
      });
    }
  });
});

describe('validateCertificate', () => {
  const cert = { name: 'Load Line', issueDate: '2026-05-01' };

  it('rejects expiry before issue', () => {
    expect(validateCertificate({ ...cert, expiryDate: '2026-04-01' })[0])
      .toMatchObject({ field: 'expiryDate', severity: 'error', message: "Expiry date can't be before the issue date." });
  });

  it('accepts expiry on or after issue, and no expiry at all', () => {
    expect(validateCertificate({ ...cert, expiryDate: '2026-05-01' })).toEqual([]);
    expect(validateCertificate({ ...cert, expiryDate: '2031-04-30', nextSurveyDue: '2027-05-01' })).toEqual([]);
    expect(validateCertificate(cert)).toEqual([]);
  });

  it('does not require an issue date', () => {
    expect(validateCertificate({ name: 'Fumigation exemption', issueDate: '', expiryDate: '2026-10-01' })).toEqual([]);
  });

  it('requires a certificate name', () => {
    expect(validateCertificate({ ...cert, name: '  ' }))
      .toEqual([{ field: 'name', severity: 'error', message: 'Certificate name is required.' }]);
  });

  it('flags invalid dates and skips the order check when one is invalid', () => {
    expect(validateCertificate({ ...cert, expiryDate: '2026-02-30' }))
      .toEqual([{ field: 'expiryDate', severity: 'error', message: 'Enter a valid date.' }]);
    expect(validateCertificate({ ...cert, issueDate: 'bad', expiryDate: '2026-04-01', nextSurveyDue: 'bad' }).map(f => f.field))
      .toEqual(['issueDate', 'nextSurveyDue']);
  });
});
