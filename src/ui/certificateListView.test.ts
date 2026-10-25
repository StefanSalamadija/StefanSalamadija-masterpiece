import { describe, expect, it } from 'vitest';
import type { Certificate } from '../domain/types';
import { certificateDetails, certificateRows } from './certificateListView';

const TODAY = '2026-10-25';

function certificate(over: Partial<Certificate> = {}): Certificate {
  return {
    id: 'cert-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'device',
    deleted: false, scope: 'ship', shipId: 'ship-1', key: 'loadLine', name: 'International Load Line', number: 'LL-1',
    issuedBy: 'DNV', issueDate: '2026-01-01', remarks: '', ...over,
  };
}

const names = (certificates: Certificate[]) => certificateRows(certificates, TODAY).map((row) => row.certificate.name);

describe('certificateRows', () => {
  it('puts overdue certificates first, then those due soon, then the rest', () => {
    const rows = certificateRows([
      certificate({ id: 'a', name: 'Alpha', expiryDate: '2030-01-01' }),
      certificate({ id: 'b', name: 'Bravo', expiryDate: '2026-12-24' }),
      certificate({ id: 'c', name: 'Charlie', expiryDate: '2026-10-01' }),
      certificate({ id: 'd', name: 'Delta' }),
    ], TODAY);
    expect(rows.map((row) => [row.certificate.name, row.band])).toEqual([
      ['Charlie', 'red'], ['Bravo', 'amber'], ['Alpha', 'ok'], ['Delta', 'none'],
    ]);
  });

  it('mixes the certificates with no warning and those with no dates, by name', () => {
    expect(names([
      certificate({ id: 'a', name: 'Delta' }),
      certificate({ id: 'b', name: 'Alpha', expiryDate: '2030-01-01' }),
      certificate({ id: 'c', name: 'Charlie' }),
      certificate({ id: 'd', name: 'Bravo', expiryDate: '2031-01-01' }),
    ])).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
  });

  it('sorts by name inside a band, ignoring case', () => {
    expect(names([
      certificate({ id: 'a', name: 'Zeta', expiryDate: '2026-10-01' }),
      certificate({ id: 'b', name: 'alpha', expiryDate: '2026-10-02' }),
      certificate({ id: 'c', name: 'Beta', expiryDate: '2026-10-03' }),
    ])).toEqual(['alpha', 'Beta', 'Zeta']);
  });

  it('sorts names with accents by the alphabet, not by code point', () => {
    expect(names([
      certificate({ id: 'a', name: 'Zeta' }),
      certificate({ id: 'b', name: 'Šifra' }),
      certificate({ id: 'c', name: 'Sertifikat' }),
    ])).toEqual(['Sertifikat', 'Šifra', 'Zeta']);
  });

  it('takes the worse of the expiry and the next survey', () => {
    const rows = certificateRows([
      certificate({ id: 'a', name: 'Survey late', expiryDate: '2030-01-01', nextSurveyDue: '2026-10-24' }),
      certificate({ id: 'b', name: 'Survey soon', expiryDate: '2030-01-01', nextSurveyDue: '2026-11-30' }),
      certificate({ id: 'c', name: 'Expiry soon', expiryDate: '2026-11-30', nextSurveyDue: '2030-01-01' }),
    ], TODAY);
    expect(rows.map((row) => [row.certificate.name, row.band])).toEqual([
      ['Survey late', 'red'], ['Expiry soon', 'amber'], ['Survey soon', 'amber'],
    ]);
  });

  it('measures the bands against the date given, with today still valid and 90 days out still due soon', () => {
    const rows = (today: string) =>
      certificateRows([
        certificate({ id: 'a', name: 'Today', expiryDate: '2026-10-25' }),
        certificate({ id: 'b', name: 'In 90 days', expiryDate: '2027-01-23' }),
        certificate({ id: 'c', name: 'In 91 days', expiryDate: '2027-01-24' }),
      ], today).map((row) => [row.certificate.name, row.band]);
    expect(rows('2026-10-25')).toEqual([['In 90 days', 'amber'], ['Today', 'amber'], ['In 91 days', 'ok']]);
    expect(rows('2026-10-26')).toEqual([['Today', 'red'], ['In 90 days', 'amber'], ['In 91 days', 'amber']]);
  });

  it('leaves the list it was given as it was', () => {
    const given = [certificate({ id: 'a', name: 'Zeta' }), certificate({ id: 'b', name: 'Alpha', expiryDate: '2026-10-01' })];
    certificateRows(given, TODAY);
    expect(given.map((c) => c.name)).toEqual(['Zeta', 'Alpha']);
  });

  it('is empty for no certificates', () => {
    expect(certificateRows([], TODAY)).toEqual([]);
  });
});

describe('certificateDetails', () => {
  it('names the number, the expiry and the next survey', () => {
    expect(certificateDetails(certificate({ number: 'LL-1', expiryDate: '2026-12-24', nextSurveyDue: '2026-11-01' }))).toEqual([
      'No. LL-1', 'Expires 2026-12-24', 'Next survey 2026-11-01',
    ]);
  });
  it('leaves out what is not filled in', () => {
    expect(certificateDetails(certificate({ number: '', expiryDate: '2026-12-24' }))).toEqual(['Expires 2026-12-24']);
    expect(certificateDetails(certificate({ number: 'LL-1' }))).toEqual(['No. LL-1']);
    expect(certificateDetails(certificate({ number: '', nextSurveyDue: '2026-11-01' }))).toEqual(['Next survey 2026-11-01']);
    expect(certificateDetails(certificate({ number: '' }))).toEqual([]);
  });
  it('shows dates as they are kept, year first, not in the print format', () => {
    expect(certificateDetails(certificate({ number: '', expiryDate: '2026-01-05' }))).toEqual(['Expires 2026-01-05']);
  });
});
