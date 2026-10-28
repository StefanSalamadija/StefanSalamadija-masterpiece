import { describe, expect, it } from 'vitest';
import type { CrewDocument, Voyage } from '../domain/types';
import {
  documentDetails, EXPIRING_DAYS, expiringDetail, expiringWindow, NO_ETA_TEXT,
} from './crewDocsView';

const TODAY = '2026-10-25';

function voyage(over: Partial<Voyage> = {}): Voyage {
  return {
    id: 'v-1', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: 'device', deleted: false,
    scope: 'ship', shipId: 'ship-1', active: true, voyageNo: 'V-12', lastPort: 'Santos', nextPort: 'Rotterdam',
    etaLocal: '2027-01-05T08:00', etaOffsetMinutes: 60, cargo: '', charterers: '', agents: '', ...over,
  };
}

function document(over: Partial<CrewDocument> = {}): CrewDocument {
  return {
    id: 'doc-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'device', deleted: false,
    scope: 'ship', shipId: 'ship-1', crewId: 'crew-1', type: 'medical', grade: '', number: 'M-1', issuedBy: '', issueDate: '',
    expiryDate: '2026-12-24', remarks: '', ...over,
  };
}

describe('expiringWindow', () => {
  it('runs to the date of the next port ETA, and says so', () => {
    expect(expiringWindow(voyage(), TODAY)).toEqual({ until: '2027-01-05', text: 'Next port Rotterdam, ETA 2027-01-05' });
  });

  it('takes the date part of the ETA as the port wrote it, whatever its UTC offset', () => {
    expect(expiringWindow(voyage({ etaLocal: '2027-01-05T00:30', etaOffsetMinutes: 840 }), TODAY).until).toBe('2027-01-05');
    expect(expiringWindow(voyage({ etaLocal: '2027-01-05T23:45', etaOffsetMinutes: -720 }), TODAY).until).toBe('2027-01-05');
  });

  it('trims the port, and shows a dash for a port that is not named', () => {
    expect(expiringWindow(voyage({ nextPort: '  Rotterdam ' }), TODAY).text).toBe('Next port Rotterdam, ETA 2027-01-05');
    expect(expiringWindow(voyage({ nextPort: '' }), TODAY).text).toBe('Next port —, ETA 2027-01-05');
  });

  it('shows the next 90 days when there is no voyage', () => {
    expect(expiringWindow(undefined, TODAY)).toEqual({ until: '2027-01-23', text: 'No next port ETA set — showing the next 90 days.' });
    expect(EXPIRING_DAYS).toBe(90);
    expect(NO_ETA_TEXT).toBe('No next port ETA set — showing the next 90 days.');
  });

  it('shows the next 90 days when the voyage has no ETA, or an ETA that is not a date and time', () => {
    for (const etaLocal of ['', '2027-01-05', '2027-01-05T25:00', '2027-02-30T08:00', 'soon']) {
      expect(expiringWindow(voyage({ etaLocal }), TODAY), etaLocal).toEqual({ until: '2027-01-23', text: NO_ETA_TEXT });
    }
  });

  describe('with an ETA that has already passed', () => {
    it('falls back to the next 90 days, and says the ETA has passed', () => {
      expect(expiringWindow(voyage({ etaLocal: '2026-10-20T08:00' }), TODAY)).toEqual({
        until: '2027-01-23', text: 'ETA 2026-10-20 has passed — showing the next 90 days.',
      });
      expect(expiringWindow(voyage({ etaLocal: '2026-10-24T23:59' }), TODAY).text).toBe('ETA 2026-10-24 has passed — showing the next 90 days.');
    });

    it('does not for an ETA today, which has not passed yet', () => {
      expect(expiringWindow(voyage({ etaLocal: '2026-10-25T06:00' }), TODAY)).toEqual({
        until: '2026-10-25', text: 'Next port Rotterdam, ETA 2026-10-25',
      });
    });

    it('measures the 90 days from the ship\'s today, not from the ETA', () => {
      expect(expiringWindow(voyage({ etaLocal: '2026-01-01T00:00' }), '2026-12-01')).toEqual({
        until: '2027-03-01', text: 'ETA 2026-01-01 has passed — showing the next 90 days.',
      });
    });

    it('says the ETA as the port wrote it, whatever the port is called', () => {
      expect(expiringWindow(voyage({ etaLocal: '2026-10-20T08:00', nextPort: '' }), TODAY).text).toBe('ETA 2026-10-20 has passed — showing the next 90 days.');
    });
  });

  it('counts the 90 days from the date it is given', () => {
    expect(expiringWindow(undefined, '2026-12-01').until).toBe('2027-03-01');
  });
});

describe('expiringDetail', () => {
  const item = { what: 'Medical fitness certificate', expiryDate: '2026-12-24' };
  it('says what expires and when, with expires for what is still valid and expired for what is not', () => {
    expect(expiringDetail({ ...item, band: 'amber' })).toBe('Medical fitness certificate expires 2026-12-24');
    expect(expiringDetail({ ...item, band: 'ok' })).toBe('Medical fitness certificate expires 2026-12-24');
    expect(expiringDetail({ ...item, band: 'red' })).toBe('Medical fitness certificate expired 2026-12-24');
  });
});

describe('documentDetails', () => {
  it('lists the number and the expiry, as the certificate list does', () => {
    expect(documentDetails(document())).toEqual(['No. M-1', 'Expires 2026-12-24']);
  });
  it('leaves out what the document has not got', () => {
    expect(documentDetails(document({ number: '', expiryDate: undefined }))).toEqual([]);
    expect(documentDetails(document({ expiryDate: undefined }))).toEqual(['No. M-1']);
  });
  it('names the grade of a graded paper', () => {
    expect(documentDetails(document({ type: 'coc', grade: 'Master (unlimited)' }))).toEqual(['Master (unlimited)', 'No. M-1', 'Expires 2026-12-24']);
  });
});
