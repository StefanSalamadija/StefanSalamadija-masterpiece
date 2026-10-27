import { describe, expect, it } from 'vitest';
import { collectAlerts } from './alerts';
import { certificateBand, crewDocBand } from './expiry';
import type { Certificate, CrewMember } from './types';

const TODAY = '2026-10-25';

let seq = 0;
function crew(over: Partial<CrewMember> = {}): CrewMember {
  seq += 1;
  return {
    id: `crew-${seq}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'test-device', deleted: false, scope: 'ship', shipId: 'ship-1',
    surname: 'PETROVIĆ', givenNames: 'Ivan', rank: 'master', nationality: 'Croatian',
    dateOfBirth: '1980-03-14', placeOfBirth: 'Split', passportNo: 'P1234567', passportExpiry: '2035-01-01',
    seamansBookNo: 'SB-998', seamansBookExpiry: '2035-01-01', signOnDate: '2026-06-01', signOnPort: 'Rijeka',
    ...over,
  };
}

function cert(over: Partial<Certificate> = {}): Certificate {
  seq += 1;
  return {
    id: `cert-${seq}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'test-device', deleted: false, scope: 'ship', shipId: 'ship-1', key: 'other', name: 'Certificate',
    number: '', issuedBy: '', issueDate: '2026-01-01', remarks: '', ...over,
  };
}

const alerts = (crewList: CrewMember[], certificates: Certificate[] = [], maxMonthsOnboard = 11) =>
  collectAlerts({ crew: crewList, certificates, today: TODAY, maxMonthsOnboard });

describe('collectAlerts', () => {
  it('lists the red alerts first, then the amber ones, each by date', () => {
    const a = collectAlerts({
      today: TODAY,
      maxMonthsOnboard: 11,
      crew: [
        crew({ givenNames: 'Ivan', surname: 'PETROVIĆ', passportExpiry: '2027-01-10', signOnDate: '2026-06-01' }),
        crew({ givenNames: 'Old', surname: 'GONE', passportExpiry: '2026-01-01', signOnDate: '2026-01-01', signOffDate: '2026-05-01' }),
      ],
      certificates: [
        cert({ name: 'International Load Line', expiryDate: '2026-10-01' }),
        cert({ name: 'IOPP', expiryDate: '2030-01-01', nextSurveyDue: '2026-12-01' }),
        cert({ name: 'ISSC', expiryDate: '2026-09-01', deleted: true }),
      ],
    });
    expect(a.map((x) => [x.band, x.title])).toEqual([['red', 'International Load Line'], ['amber', 'IOPP'], ['amber', 'Ivan PETROVIĆ']]);
    expect(a[1].detail).toBe('Survey due 2026-12-01');
    expect(a[2].detail).toBe('Passport expires 2027-01-10');
    expect(a[0].detail).toBe('Expired 2026-10-01');
  });

  it('has nothing to say when nothing is near its date', () => {
    expect(alerts([crew()], [cert({ expiryDate: '2030-01-01' }), cert({ name: 'No dates' })])).toEqual([]);
    expect(alerts([], [])).toEqual([]);
  });

  it('says what each alert is, links it to its edit screen, and names the kind', () => {
    const member = crew({ id: 'c-1', givenNames: 'Ivan', surname: 'PETROVIĆ', passportExpiry: '2026-11-30' });
    const certificate = cert({ id: 'k-1', name: 'IOPP', expiryDate: '2026-12-01' });
    expect(alerts([member], [certificate])).toEqual([
      { key: 'crewDoc:c-1', kind: 'crewDoc', band: 'amber', title: 'Ivan PETROVIĆ', detail: 'Passport expires 2026-11-30', href: '#/ship/crew/c-1' },
      { key: 'certificate:k-1', kind: 'certificate', band: 'amber', title: 'IOPP', detail: 'Expires 2026-12-01', href: '#/ship/certificates/k-1' },
    ]);
  });

  it('puts crew and certificates in one list, by band and then by date', () => {
    const a = alerts(
      [crew({ surname: 'AMBER-EARLY', givenNames: 'A', passportExpiry: '2026-11-01' }), crew({ surname: 'RED-EARLY', givenNames: 'R', seamansBookExpiry: '2026-09-01' })],
      [cert({ name: 'Red late', expiryDate: '2026-10-20' }), cert({ name: 'Amber late', expiryDate: '2026-12-31' })],
    );
    expect(a.map((x) => [x.band, x.title])).toEqual([
      ['red', 'R RED-EARLY'], ['red', 'Red late'], ['amber', 'A AMBER-EARLY'], ['amber', 'Amber late'],
    ]);
  });

  describe('crew documents', () => {
    it("says expired instead of expires when the document is past, for the passport and the seaman's book", () => {
      const a = alerts([
        crew({ surname: 'P', givenNames: 'P', passportExpiry: '2026-10-24' }),
        crew({ surname: 'S', givenNames: 'S', seamansBookExpiry: '2026-10-23' }),
      ]);
      expect(a.map((x) => x.detail)).toEqual(["Seaman's book expired 2026-10-23", 'Passport expired 2026-10-24']);
      expect(a.every((x) => x.band === 'red')).toBe(true);
    });

    it("says expires for the seaman's book when it is amber", () => {
      expect(alerts([crew({ seamansBookExpiry: '2027-02-01' })])[0].detail).toBe("Seaman's book expires 2027-02-01");
    });

    it('is amber from six months out, up to and including the limit', () => {
      expect(alerts([crew({ passportExpiry: '2027-04-25' })]).map((x) => x.band)).toEqual(['amber']);
      expect(alerts([crew({ passportExpiry: '2027-04-26' })])).toEqual([]);
    });

    it('treats a document that expires today as still valid, so amber', () => {
      const [alert] = alerts([crew({ passportExpiry: TODAY })]);
      expect([alert.band, alert.detail]).toEqual(['amber', 'Passport expires 2026-10-25']);
    });

    it('uses the worse band when both documents are flagged', () => {
      // Passport is amber and earlier; the seaman's book is red, so it is the one that is named.
      const [alert] = alerts([crew({ passportExpiry: '2026-11-01', seamansBookExpiry: '2026-10-01' })]);
      expect([alert.band, alert.detail]).toEqual(['red', "Seaman's book expired 2026-10-01"]);
      const [other] = alerts([crew({ passportExpiry: '2026-10-01', seamansBookExpiry: '2026-11-01' })]);
      expect([other.band, other.detail]).toEqual(['red', 'Passport expired 2026-10-01']);
    });

    it('uses the earlier date when both documents have the same band', () => {
      expect(alerts([crew({ passportExpiry: '2026-12-01', seamansBookExpiry: '2026-11-01' })])[0].detail).toBe("Seaman's book expires 2026-11-01");
      expect(alerts([crew({ passportExpiry: '2026-11-01', seamansBookExpiry: '2026-12-01' })])[0].detail).toBe('Passport expires 2026-11-01');
      expect(alerts([crew({ passportExpiry: '2026-09-01', seamansBookExpiry: '2026-08-01' })])[0].detail).toBe("Seaman's book expired 2026-08-01");
    });

    it("names the passport when both documents expire on the same day", () => {
      expect(alerts([crew({ passportExpiry: '2026-11-01', seamansBookExpiry: '2026-11-01' })])[0].detail).toBe('Passport expires 2026-11-01');
    });

    it('makes one alert for a person, not one per document', () => {
      expect(alerts([crew({ passportExpiry: '2026-11-01', seamansBookExpiry: '2026-12-01' })])).toHaveLength(1);
    });

    it('leaves out crew who are not onboard on the day', () => {
      const flagged = { passportExpiry: '2026-01-01' };
      const a = alerts([
        crew({ ...flagged, surname: 'SIGNED-OFF', signOffDate: '2026-10-24' }),
        crew({ ...flagged, surname: 'JOINS-TOMORROW', signOnDate: '2026-10-26' }),
        crew({ ...flagged, surname: 'JOINS-LATER', signOnDate: '2027-01-01' }),
        crew({ ...flagged, surname: 'DELETED', deleted: true }),
        crew({ ...flagged, surname: 'ONBOARD' }),
      ]);
      expect(a.map((x) => x.title)).toEqual(['Ivan ONBOARD']);
    });

    it('counts the day of sign-on and the day of sign-off as onboard', () => {
      const a = alerts([
        crew({ passportExpiry: '2026-01-01', surname: 'JOINS-TODAY', signOnDate: TODAY }),
        crew({ passportExpiry: '2026-01-01', surname: 'LEAVES-TODAY', signOnDate: '2026-06-01', signOffDate: TODAY }),
      ]);
      expect(a.map((x) => x.title).sort()).toEqual(['Ivan JOINS-TODAY', 'Ivan LEAVES-TODAY']);
    });

    it('does not warn about a document with no date or a date that is not one', () => {
      expect(alerts([crew({ passportExpiry: '', seamansBookExpiry: '2026-02-30' })])).toEqual([]);
    });
  });

  describe('certificates', () => {
    it('says Expires or Survey due when amber', () => {
      const a = alerts([], [
        cert({ name: 'A', expiryDate: '2026-12-01' }),
        cert({ name: 'B', expiryDate: '2030-01-01', nextSurveyDue: '2026-12-02' }),
      ]);
      expect(a.map((x) => x.detail)).toEqual(['Expires 2026-12-01', 'Survey due 2026-12-02']);
    });

    it('says Expired or Survey overdue when red', () => {
      const a = alerts([], [
        cert({ name: 'A', expiryDate: '2026-10-01' }),
        cert({ name: 'B', expiryDate: '2030-01-01', nextSurveyDue: '2026-10-02' }),
      ]);
      expect(a.map((x) => [x.band, x.detail])).toEqual([['red', 'Expired 2026-10-01'], ['red', 'Survey overdue 2026-10-02']]);
    });

    it('is amber up to 90 days out, inclusive', () => {
      expect(alerts([], [cert({ expiryDate: '2027-01-23' })]).map((x) => x.band)).toEqual(['amber']);
      expect(alerts([], [cert({ expiryDate: '2027-01-24' })])).toEqual([]);
    });

    it('uses the worse band when both dates are flagged', () => {
      const [overdue] = alerts([], [cert({ expiryDate: '2026-11-01', nextSurveyDue: '2026-10-01' })]);
      expect([overdue.band, overdue.detail]).toEqual(['red', 'Survey overdue 2026-10-01']);
      const [expired] = alerts([], [cert({ expiryDate: '2026-10-01', nextSurveyDue: '2026-11-01' })]);
      expect([expired.band, expired.detail]).toEqual(['red', 'Expired 2026-10-01']);
    });

    it('uses the earlier date when both dates have the same band', () => {
      expect(alerts([], [cert({ expiryDate: '2026-12-01', nextSurveyDue: '2026-11-01' })])[0].detail).toBe('Survey due 2026-11-01');
      expect(alerts([], [cert({ expiryDate: '2026-11-01', nextSurveyDue: '2026-12-01' })])[0].detail).toBe('Expires 2026-11-01');
      expect(alerts([], [cert({ expiryDate: '2026-09-01', nextSurveyDue: '2026-08-01' })])[0].detail).toBe('Survey overdue 2026-08-01');
    });

    it('names the expiry when both dates are the same day', () => {
      expect(alerts([], [cert({ expiryDate: '2026-11-01', nextSurveyDue: '2026-11-01' })])[0].detail).toBe('Expires 2026-11-01');
    });

    it('makes one alert for a certificate, not one per date', () => {
      expect(alerts([], [cert({ expiryDate: '2026-11-01', nextSurveyDue: '2026-12-01' })])).toHaveLength(1);
    });

    it('leaves out deleted certificates', () => {
      expect(alerts([], [cert({ expiryDate: '2026-09-01', deleted: true })])).toEqual([]);
    });

    it('does not warn about a certificate with no dates', () => {
      expect(alerts([], [cert({})])).toEqual([]);
    });
  });

  describe('contracts', () => {
    const on = (today: string, over: Partial<CrewMember> = {}, maxMonthsOnboard = 11) =>
      collectAlerts({ today, maxMonthsOnboard, certificates: [], crew: [crew({ id: 'c-9', signOnDate: '2026-06-01', contractMonths: 6, ...over })] });

    it('says Contract ends when the end is within 30 days, and links to the reliefs', () => {
      expect(on('2026-11-15')).toEqual([
        { key: 'contract:c-9', kind: 'contract', band: 'amber', title: 'Ivan PETROVIĆ', detail: 'Contract ends 2026-12-01', href: '#/ship/reliefs' },
      ]);
    });
    it('is amber from 30 days before the end, up to and including the last day', () => {
      expect(on('2026-11-01').map((x) => x.band)).toEqual(['amber']);
      expect(on('2026-12-01').map((x) => [x.band, x.detail])).toEqual([['amber', 'Contract ends 2026-12-01']]);
      expect(on('2026-10-31')).toEqual([]);
    });
    it('says the relief is overdue once the contract has ended', () => {
      expect(on('2026-12-02')).toEqual([
        { key: 'contract:c-9', kind: 'contract', band: 'red', title: 'Ivan PETROVIĆ', detail: 'Contract ended 2026-12-01 — relief overdue', href: '#/ship/reliefs' },
      ]);
    });
    it('has nothing to say about a contract with no length', () => {
      expect(on('2026-12-02', { contractMonths: undefined })).toEqual([]);
    });
    it('leaves out crew who are not onboard on the day', () => {
      const ended = { contractMonths: 1 };
      const a = alerts([
        crew({ ...ended, surname: 'SIGNED-OFF', signOnDate: '2026-06-01', signOffDate: '2026-10-24' }),
        crew({ ...ended, surname: 'JOINS-TOMORROW', signOnDate: '2026-10-26' }),
        crew({ ...ended, surname: 'DELETED', signOnDate: '2026-06-01', deleted: true }),
        crew({ ...ended, surname: 'ONBOARD', signOnDate: '2026-06-01' }),
      ]);
      expect(a.map((x) => [x.kind, x.title])).toEqual([['contract', 'Ivan ONBOARD']]);
    });
  });

  describe('the onboard limit', () => {
    const on = (today: string, maxMonthsOnboard: number, over: Partial<CrewMember> = {}) =>
      collectAlerts({ today, maxMonthsOnboard, certificates: [], crew: [crew({ id: 'c-8', signOnDate: '2026-01-01', ...over })] });

    it('says when the limit will be reached, from 30 days before', () => {
      expect(on('2026-11-01', 11)).toEqual([
        { key: 'onboardLimit:c-8', kind: 'onboardLimit', band: 'amber', title: 'Ivan PETROVIĆ', detail: 'Reaches 11-month onboard limit 2026-12-01', href: '#/ship/reliefs' },
      ]);
      expect(on('2026-10-31', 11)).toEqual([]);
    });
    it('says since when the limit has been passed, from the day it is reached', () => {
      expect(on('2026-12-01', 11)).toEqual([
        { key: 'onboardLimit:c-8', kind: 'onboardLimit', band: 'red', title: 'Ivan PETROVIĆ', detail: 'Over 11-month onboard limit since 2026-12-01', href: '#/ship/reliefs' },
      ]);
      expect(on('2027-02-01', 11)[0].detail).toBe('Over 11-month onboard limit since 2026-12-01');
    });
    it("uses the ship's own limit, and names it", () => {
      expect(on('2026-10-25', 9).map((x) => [x.band, x.detail])).toEqual([['red', 'Over 9-month onboard limit since 2026-10-01']]);
      expect(on('2026-09-15', 9).map((x) => [x.band, x.detail])).toEqual([['amber', 'Reaches 9-month onboard limit 2026-10-01']]);
      expect(on('2026-10-25', 11)).toEqual([]);
    });
    it('uses 11 months for a limit that is not whole months from 1 to 11, and still lists the alerts', () => {
      for (const months of [6.5, '9', 0, 12, -3, 'abc', Number.NaN] as unknown[]) {
        expect(on('2026-12-01', months as number).map((x) => [x.band, x.detail]), String(months))
          .toEqual([['red', 'Over 11-month onboard limit since 2026-12-01']]);
        expect(on('2026-11-01', months as number).map((x) => x.detail), String(months)).toEqual(['Reaches 11-month onboard limit 2026-12-01']);
        expect(on('2026-10-31', months as number), String(months)).toEqual([]);
      }
    });
    it('counts the months of a person with no contract length too', () => {
      expect(on('2026-12-01', 11, { contractMonths: undefined })).toHaveLength(1);
    });
    it('leaves out crew who are not onboard on the day', () => {
      const a = alerts([
        crew({ surname: 'SIGNED-OFF', signOnDate: '2025-01-01', signOffDate: '2026-10-24' }),
        crew({ surname: 'DELETED', signOnDate: '2025-01-01', deleted: true }),
        crew({ surname: 'ONBOARD', signOnDate: '2025-01-01' }),
      ]);
      expect(a.map((x) => [x.kind, x.title])).toEqual([['onboardLimit', 'Ivan ONBOARD']]);
    });
    it('is a second alert of the same person when the contract is near its end too', () => {
      const a = on('2026-11-15', 11, { contractMonths: 11 }); // both fall on 2026-12-01
      expect(a.map((x) => [x.kind, x.band, x.detail])).toEqual([
        ['contract', 'amber', 'Contract ends 2026-12-01'],
        ['onboardLimit', 'amber', 'Reaches 11-month onboard limit 2026-12-01'],
      ]);
    });
    it('is in the list with the other alerts, red before amber', () => {
      const a = alerts(
        [crew({ surname: 'AMBER', signOnDate: '2026-01-01', passportExpiry: '2026-11-01' }), crew({ surname: 'LIMIT', signOnDate: '2025-10-01' })],
        [cert({ name: 'Late', expiryDate: '2026-10-20' })],
      );
      expect(a.map((x) => [x.band, x.kind, x.title])).toEqual([
        ['red', 'onboardLimit', 'Ivan LIMIT'], ['red', 'certificate', 'Late'], ['amber', 'crewDoc', 'Ivan AMBER'],
      ]);
    });
  });

  describe('the key', () => {
    it('is the kind and the id of the record, so two people with the same name and dates have two', () => {
      const a = crew({ id: 'c-1', passportExpiry: '2026-11-01' });
      const b = crew({ id: 'c-2', passportExpiry: '2026-11-01' });
      const k = cert({ id: 'k-1', expiryDate: '2026-11-01' });
      const found = alerts([a, b], [k]);
      expect(found.map((x) => x.key).sort()).toEqual(['certificate:k-1', 'crewDoc:c-1', 'crewDoc:c-2']);
      expect(found.map((x) => x.title)).toContain('Ivan PETROVIĆ');
    });
    it('tells the contract and the onboard limit of one person apart, and every alert has its own', () => {
      const found = collectAlerts({
        today: '2026-11-15', maxMonthsOnboard: 11, certificates: [], crew: [crew({ id: 'c-1', signOnDate: '2026-01-01', contractMonths: 11, passportExpiry: '2026-11-20' })],
      });
      expect(found.map((x) => x.key).sort()).toEqual(['contract:c-1', 'crewDoc:c-1', 'onboardLimit:c-1']);
    });
    it('does not depend on the order the records came in', () => {
      const members = [crew({ id: 'c-1', passportExpiry: '2026-11-01' }), crew({ id: 'c-2', passportExpiry: '2026-11-01' })];
      expect(alerts(members).map((x) => x.key)).toEqual(alerts([...members].reverse()).map((x) => x.key));
    });
  });

  describe('order', () => {
    it('sorts each band by date, the earliest first', () => {
      const a = alerts([], [
        cert({ name: 'C', expiryDate: '2026-10-03' }), cert({ name: 'A', expiryDate: '2026-10-01' }), cert({ name: 'B', expiryDate: '2026-10-02' }),
        cert({ name: 'F', expiryDate: '2026-12-03' }), cert({ name: 'D', expiryDate: '2026-12-01' }), cert({ name: 'E', expiryDate: '2026-12-02' }),
      ]);
      expect(a.map((x) => x.title)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    });

    it('sorts by the date the alert names, not by the other date of the record', () => {
      const a = alerts([], [
        cert({ name: 'Survey is near', expiryDate: '2026-12-20', nextSurveyDue: '2026-11-01' }),
        cert({ name: 'Expiry is nearer', expiryDate: '2026-11-15' }),
      ]);
      expect(a.map((x) => x.title)).toEqual(['Survey is near', 'Expiry is nearer']);
    });

    it('breaks a tie of band and date by title, then by link, whatever order the records came in', () => {
      const records = [
        cert({ id: 'k-3', name: 'Zulu', expiryDate: '2026-12-01' }),
        cert({ id: 'k-2', name: 'Alpha', expiryDate: '2026-12-01' }),
        cert({ id: 'k-1', name: 'Alpha', expiryDate: '2026-12-01' }),
        cert({ id: 'k-4', name: 'Mike', expiryDate: '2026-12-01' }),
      ];
      const expected = ['k-1', 'k-2', 'k-4', 'k-3'].map((id) => `#/ship/certificates/${id}`);
      expect(alerts([], records).map((x) => x.href)).toEqual(expected);
      expect(alerts([], [...records].reverse()).map((x) => x.href)).toEqual(expected);
      expect(alerts([], [records[2], records[0], records[3], records[1]]).map((x) => x.href)).toEqual(expected);
    });

    it('breaks a tie between a person and a certificate by title too', () => {
      const a = alerts(
        [crew({ id: 'c-1', givenNames: 'Zed', surname: 'LAST', passportExpiry: '2026-12-01' })],
        [cert({ id: 'k-1', name: 'Alpha', expiryDate: '2026-12-01' })],
      );
      expect(a.map((x) => x.title)).toEqual(['Alpha', 'Zed LAST']);
    });
  });

  it('agrees with the warning each list shows for the same record', () => {
    const members = [
      crew({ passportExpiry: '2026-10-24' }), crew({ passportExpiry: '2026-11-01', seamansBookExpiry: '2026-10-01' }),
      crew({ passportExpiry: '2027-04-25' }), crew({ passportExpiry: '2027-04-26' }), crew({ passportExpiry: '' }),
    ];
    const certificates = [
      cert({ expiryDate: '2026-10-24' }), cert({ expiryDate: '2026-11-01', nextSurveyDue: '2026-10-01' }),
      cert({ expiryDate: '2027-01-23' }), cert({ expiryDate: '2027-01-24' }), cert({}),
    ];
    const warned = (band: string) => band === 'amber' || band === 'red';
    const found = alerts(members, certificates);
    expect(found.filter((x) => x.kind === 'crewDoc').map((x) => x.band).sort())
      .toEqual(members.map((m) => crewDocBand(m, TODAY)).filter(warned).sort());
    expect(found.filter((x) => x.kind === 'certificate').map((x) => x.band).sort())
      .toEqual(certificates.map((c) => certificateBand(c, TODAY)).filter(warned).sort());
  });

  it('does not change its input', () => {
    const members = [crew({ passportExpiry: '2026-12-01' }), crew({ passportExpiry: '2026-11-01' })];
    const before = JSON.stringify(members);
    alerts(members);
    expect(JSON.stringify(members)).toBe(before);
  });
});
