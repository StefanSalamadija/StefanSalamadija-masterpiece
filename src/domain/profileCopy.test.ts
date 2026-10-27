import { describe, expect, it } from 'vitest';
import { certificateShell, copyCrewPolicy, copyParticulars } from './profileCopy';
import type { Certificate, Particulars } from './types';

const particulars: Particulars = {
  name: 'MV OCEAN STAR', imo: '9074729', callSign: '9HAB7', mmsi: '215123000', flag: 'Malta', portOfRegistry: 'Valletta',
  gt: 42000, nt: 25000, dwt: 75000, loa: 229, beam: 32.2, yearBuilt: 2012,
  owners: 'Star Shipping Ltd', managers: 'Star Ship Management', pandi: 'Gard', classSociety: 'DNV',
};

const certificate: Certificate = {
  id: 'c-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'dev', deleted: false, scope: 'ship',
  shipId: 'ship-1', key: 'loadLine', name: 'International Load Line', number: 'LL-1', issuedBy: 'DNV',
  issueDate: '2024-03-15', expiryDate: '2029-03-14', nextSurveyDue: '2027-03-14', remarks: 'Annual survey done',
};

describe('copyParticulars', () => {
  it('sets the new name, clears the identity fields and keeps everything else', () => {
    expect(copyParticulars(particulars, 'MV OCEAN PEARL')).toEqual({
      ...particulars, name: 'MV OCEAN PEARL', imo: '', callSign: '', mmsi: '',
    });
  });

  it('does not change the source', () => {
    const before = structuredClone(particulars);
    copyParticulars(particulars, 'MV OCEAN PEARL');
    expect(particulars).toEqual(before);
  });
});

describe('copyCrewPolicy', () => {
  it("keeps the ship's limit on the months onboard: it is the company's policy, like the rest of what a sister ship shares", () => {
    expect(copyCrewPolicy({ maxMonthsOnboard: 9 })).toEqual({ maxMonthsOnboard: 9 });
  });

  it('has nothing to copy for a ship on the default, so the copy stays on the default too', () => {
    expect(copyCrewPolicy({})).toEqual({});
    expect('maxMonthsOnboard' in copyCrewPolicy({ maxMonthsOnboard: undefined })).toBe(false);
  });

  it('does not copy a stored limit that is damaged', () => {
    for (const months of [0, 12, 6.5, '9', Number.NaN] as unknown[]) {
      expect(copyCrewPolicy({ maxMonthsOnboard: months as number }), String(months)).toEqual({});
    }
  });
});

describe('certificateShell', () => {
  it('keeps the key and name and clears everything that belongs to one certificate', () => {
    const shell = certificateShell(certificate);
    expect(shell).toEqual({ key: 'loadLine', name: 'International Load Line', number: '', issuedBy: '', issueDate: '', remarks: '' });
    // The cleared optional dates are present as undefined, so a saved copy reads back with them explicitly empty.
    expect(Object.keys(shell).sort()).toEqual(
      ['expiryDate', 'issueDate', 'issuedBy', 'key', 'name', 'nextSurveyDue', 'number', 'remarks'],
    );
  });

  it('carries no record fields or ship id', () => {
    const shell = certificateShell(certificate) as Record<string, unknown>;
    for (const field of ['id', 'createdAt', 'updatedAt', 'updatedBy', 'deleted', 'scope', 'shipId']) {
      expect(shell).not.toHaveProperty(field);
    }
  });
});
