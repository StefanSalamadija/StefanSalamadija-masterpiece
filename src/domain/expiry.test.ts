import { describe, expect, it } from 'vitest';
import { certificateBand, certificateExpiryBand, crewDocBand, crewDocExpiryBand, expiryBand, worstBand } from './expiry';
import type { CrewDraft } from './types';

const REF = '2026-10-25';

const draft: CrewDraft = {
  surname: 'PETROVIĆ', givenNames: 'Ivan', rank: 'master', nationality: 'Croatian',
  dateOfBirth: '1980-03-14', placeOfBirth: 'Split', passportNo: 'P1234567', passportExpiry: '2030-01-01',
  seamansBookNo: 'SB-998', seamansBookExpiry: '2030-01-01', signOnDate: '2026-06-01', signOnPort: 'Rijeka',
};

describe('expiryBand', () => {
  const crew = { months: 6 };

  it('is amber up to and including the end of the window', () => {
    expect(expiryBand('2027-04-25', REF, crew)).toBe('amber');
  });
  it('is ok beyond the window', () => {
    expect(expiryBand('2027-04-26', REF, crew)).toBe('ok');
  });
  it('treats a document expiring today as still valid (amber)', () => {
    expect(expiryBand('2026-10-25', REF, crew)).toBe('amber');
  });
  it('is red once past', () => {
    expect(expiryBand('2026-10-24', REF, crew)).toBe('red');
  });
  it('is none when there is no expiry', () => {
    expect(expiryBand(undefined, REF, crew)).toBe('none');
    expect(expiryBand('', REF, crew)).toBe('none');
  });
  it('is none for a value that is not a valid date', () => {
    expect(expiryBand('2026-02-30', REF, crew)).toBe('none');
  });
  it('supports a day window and a combined window', () => {
    expect(expiryBand('2027-01-23', REF, { days: 90 })).toBe('amber');
    expect(expiryBand('2027-01-24', REF, { days: 90 })).toBe('ok');
    expect(expiryBand('2027-05-25', REF, { months: 6, days: 30 })).toBe('amber');
    expect(expiryBand('2027-05-26', REF, { months: 6, days: 30 })).toBe('ok');
  });
});

describe('worstBand', () => {
  it('ranks red > amber > ok > none', () => {
    expect(worstBand('ok', 'red', 'amber')).toBe('red');
    expect(worstBand('none', 'amber', 'ok')).toBe('amber');
    expect(worstBand('none', 'ok')).toBe('ok');
    expect(worstBand('none', 'none')).toBe('none');
  });
  it('is none with no arguments', () => {
    expect(worstBand()).toBe('none');
  });
});

describe('certificateBand', () => {
  it('is amber when expiry is within 90 days (inclusive)', () => {
    expect(certificateBand({ expiryDate: '2027-01-23' }, REF)).toBe('amber');
  });
  it('is ok when expiry is 91 days away', () => {
    expect(certificateBand({ expiryDate: '2027-01-24' }, REF)).toBe('ok');
  });
  it('takes the worse of expiry and next survey', () => {
    expect(certificateBand({ expiryDate: '2030-01-01', nextSurveyDue: '2026-11-01' }, REF)).toBe('amber');
    expect(certificateBand({ expiryDate: '2030-01-01', nextSurveyDue: '2026-10-01' }, REF)).toBe('red');
  });
  it('is none when neither date is set', () => {
    expect(certificateBand({}, REF)).toBe('none');
  });
});

describe('crewDocBand', () => {
  it('is the worst of passport and seaman\'s book', () => {
    expect(crewDocBand({ ...draft, passportExpiry: '2030-01-01', seamansBookExpiry: '2026-01-01' }, REF)).toBe('red');
    expect(crewDocBand({ ...draft, passportExpiry: '2027-04-25', seamansBookExpiry: '2030-01-01' }, REF)).toBe('amber');
    expect(crewDocBand(draft, REF)).toBe('ok');
  });
  it('is none when neither document has an expiry', () => {
    expect(crewDocBand({ ...draft, passportExpiry: '', seamansBookExpiry: '' }, REF)).toBe('none');
  });
});

describe('crewDocExpiryBand and certificateExpiryBand', () => {
  it('give one date the band that the whole record is judged by', () => {
    expect(crewDocExpiryBand('2027-04-25', REF)).toBe('amber');
    expect(crewDocExpiryBand('2027-04-26', REF)).toBe('ok');
    expect(crewDocExpiryBand('2026-10-24', REF)).toBe('red');
    expect(crewDocExpiryBand('', REF)).toBe('none');
    expect(certificateExpiryBand('2027-01-23', REF)).toBe('amber');
    expect(certificateExpiryBand('2027-01-24', REF)).toBe('ok');
    expect(certificateExpiryBand('2026-10-24', REF)).toBe('red');
    expect(certificateExpiryBand(undefined, REF)).toBe('none');
  });
});
