import { describe, expect, it } from 'vitest';
import { FIELD_NAMES, resolveField, type FieldContext } from './fieldDictionary';
import type { Certificate, ClockChange, CrewDocument, CrewMember, ShipProfile, Voyage } from './types';

const base = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'test-device', deleted: false, scope: 'ship' as const, shipId: 'ship-1' };
let seq = 0;
const id = () => `id-${++seq}`;

const ship: ShipProfile = {
  ...base, id: 'ship-1',
  particulars: {
    name: 'MV OCEAN STAR', imo: '9074729', callSign: '9HAB2', mmsi: '249123000', flag: 'Malta', portOfRegistry: 'Valletta',
    gt: 32500, nt: 18000, dwt: 56000, loa: 189.9, beam: 32.2, yearBuilt: 2012,
    owners: 'Star Owners Ltd', managers: 'Star Management', pandi: 'Gard', classSociety: 'DNV',
  },
};

function crew(over: Partial<CrewMember>): CrewMember {
  return {
    ...base, id: id(), surname: 'X', givenNames: 'Y', rank: 'master', nationality: 'Croatian', dateOfBirth: '1980-03-14',
    placeOfBirth: 'Split', passportNo: 'P1', passportExpiry: '2030-01-01', seamansBookNo: 'SB1', seamansBookExpiry: '2030-01-01',
    signOnDate: '2026-01-01', signOnPort: 'Rijeka', ...over,
  };
}

const oldMaster = crew({ surname: 'Petrović', givenNames: 'Ivan', signOnDate: '2026-03-01', signOffDate: '2026-09-01' });
const newMaster = crew({ surname: 'Šašić', givenNames: 'Marko', signOnDate: '2026-09-01' });

const voyage: Voyage = {
  ...base, id: id(), active: true, voyageNo: 'V-12', lastPort: 'Santos', nextPort: 'Rotterdam',
  etaLocal: '2026-11-02T08:00', etaOffsetMinutes: 60, cargo: 'Soya', charterers: 'ACME', agents: 'Port Agents BV',
};

const loadLine: Certificate = {
  ...base, id: id(), key: 'loadLine', name: 'International Load Line', number: 'LL-77', issuedBy: 'DNV',
  issueDate: '2024-03-15', expiryDate: '2029-03-14', nextSurveyDue: '2027-03-14', remarks: 'Annual endorsed',
};

const clock: ClockChange = {
  ...base, id: id(), effectiveAt: '2026-10-01T00:00:00.000Z', toOffsetMinutes: 180,
};

function crewDoc(over: Partial<CrewDocument>): CrewDocument {
  return {
    ...base, id: id(), crewId: newMaster.id, type: 'coc', grade: 'Master (unlimited)', number: 'CoC-123', issuedBy: 'Croatia',
    issueDate: '2024-05-01', expiryDate: '2029-05-01', remarks: '', ...over,
  };
}

const coc = crewDoc({});
const ctx: FieldContext = {
  ship, crew: [oldMaster, newMaster], voyages: [voyage], certificates: [loadLine], clockChanges: [clock], crewDocuments: [],
  nowUtc: new Date('2026-10-25T22:30:00Z'),
};
const ctxWithDocs: FieldContext = { ...ctx, crewDocuments: [coc] };

describe('resolveField: vessel', () => {
  it('reads particulars', () => {
    expect(resolveField('vessel.name', ctx)).toBe('MV OCEAN STAR');
    expect(resolveField('vessel.gt', ctx)).toBe(32500);
    expect(resolveField('vessel.classSociety', ctx)).toBe('DNV');
  });
  it('resolves a particular that is not set to undefined', () => {
    const bare = { ...ship, particulars: { ...ship.particulars, gt: undefined } };
    expect(resolveField('vessel.gt', { ...ctx, ship: bare })).toBeUndefined();
  });
  it('is undefined for keys that are not particulars', () => {
    expect(resolveField('vessel.colour', ctx)).toBeUndefined();
    expect(resolveField('vessel.constructor', ctx)).toBeUndefined();
    expect(resolveField('vessel', ctx)).toBeUndefined();
  });
});

describe('resolveField: crew', () => {
  it('picks the master onboard at the reference date', () => {
    expect(resolveField('crew.byRank.master.fullName', ctx, { asAt: '2026-08-15' })).toBe('Ivan Petrović');
    expect(resolveField('crew.byRank.master.fullName', ctx, { asAt: '2026-09-02' })).toBe('Marko Šašić');
  });
  it('defaults the reference date to ship\'s today', () => {
    expect(resolveField('crew.byRank.master.fullName', ctx)).toBe('Marko Šašić');
    // Ship's today is already 2026-10-26 (UTC+03:00) while UTC is still the 25th.
    const signsOnTomorrowShip = crew({ rank: 'bosun', surname: 'Bos', givenNames: 'Ana', signOnDate: '2026-10-26' });
    expect(resolveField('crew.byRank.bosun.fullName', { ...ctx, crew: [signsOnTomorrowShip] })).toBe('Ana Bos');
  });
  it('reads any crew member field', () => {
    expect(resolveField('crew.byRank.master.passportNo', ctx, { asAt: '2026-08-15' })).toBe('P1');
    expect(resolveField('crew.byRank.master.signOnDate', ctx, { asAt: '2026-08-15' })).toBe('2026-03-01');
    expect(resolveField('crew.byRank.master.signOffDate', ctx, { asAt: '2026-08-15' })).toBe('2026-09-01');
    expect(resolveField('crew.byRank.master.rank', ctx)).toBe('master');
  });
  it('is undefined for unset fields, unknown fields, missing ranks and non-scalar fields', () => {
    expect(resolveField('crew.byRank.master.signOffDate', ctx)).toBeUndefined();
    expect(resolveField('crew.byRank.master.shoeSize', ctx)).toBeUndefined();
    expect(resolveField('crew.byRank.master.constructor', ctx)).toBeUndefined();
    expect(resolveField('crew.byRank.bosun.fullName', ctx)).toBeUndefined();
    expect(resolveField('crew.byRank.captain.fullName', ctx)).toBeUndefined();
    expect(resolveField('crew.byRank.master.deleted', ctx)).toBeUndefined();
    expect(resolveField('crew.byRank.master', ctx)).toBeUndefined();
  });
  it('counts and lists the people onboard', () => {
    expect(resolveField('crew.onboardCount', ctx, { asAt: '2026-09-01' })).toBe(2);
    expect(resolveField('crew.onboardCount', ctx, { asAt: '2026-08-15' })).toBe(1);
    const list = resolveField('crew.onboard', ctx, { asAt: '2026-09-01' });
    expect(list).toEqual([oldMaster, newMaster]);
  });
  it('never hands back the caller\'s own array', () => {
    const list = resolveField('crew.onboard', ctx, { asAt: '2026-09-01' });
    expect(list).not.toBe(ctx.crew);
  });
  it('ignores deleted crew', () => {
    const allDeleted = ctx.crew.map((c) => ({ ...c, deleted: true }));
    expect(resolveField('crew.byRank.master.fullName', { ...ctx, crew: allDeleted })).toBeUndefined();
    expect(resolveField('crew.onboardCount', { ...ctx, crew: allDeleted })).toBe(0);
  });
});

describe('resolveField: contract length, end and days onboard', () => {
  const chief = crew({
    rank: 'chiefOfficer', surname: 'Bos', givenNames: 'Ana', signOnDate: '2026-06-01', contractMonths: 6,
    reliefPlannedDate: '2026-11-05', reliefPlannedPort: 'Santos',
  });
  const withContract: FieldContext = { ...ctx, crew: [oldMaster, newMaster, chief] };

  it('gives the contract end date: the sign-on date plus the months', () => {
    expect(resolveField('crew.byRank.chiefOfficer.contractEndDate', withContract)).toBe('2026-12-01');
  });
  it('gives the days onboard as at the reference date', () => {
    expect(resolveField('crew.byRank.chiefOfficer.daysOnboard', withContract, { asAt: '2026-10-25' })).toBe(147);
    expect(resolveField('crew.byRank.chiefOfficer.daysOnboard', withContract, { asAt: '2026-06-01' })).toBe(1);
  });
  it("counts up to the ship's today when no date is given", () => {
    expect(resolveField('crew.byRank.chiefOfficer.daysOnboard', withContract)).toBe(148); // the ship's today is 2026-10-26
  });
  it('reads the length and the planned relief as stored', () => {
    expect(resolveField('crew.byRank.chiefOfficer.contractMonths', withContract)).toBe(6);
    expect(resolveField('crew.byRank.chiefOfficer.reliefPlannedDate', withContract)).toBe('2026-11-05');
    expect(resolveField('crew.byRank.chiefOfficer.reliefPlannedPort', withContract)).toBe('Santos');
  });
  it('has no end date without a contract length, but still counts the days', () => {
    expect(resolveField('crew.byRank.master.contractEndDate', withContract)).toBeUndefined();
    expect(resolveField('crew.byRank.master.daysOnboard', withContract, { asAt: '2026-09-02' })).toBe(2);
  });
  it('is undefined when nobody of that rank is onboard on the date', () => {
    expect(resolveField('crew.byRank.chiefOfficer.contractEndDate', withContract, { asAt: '2026-05-31' })).toBeUndefined();
    expect(resolveField('crew.byRank.chiefOfficer.daysOnboard', withContract, { asAt: '2026-05-31' })).toBeUndefined();
  });
});

describe('resolveField: crew documents', () => {
  it('reads a field of a document of the person of that rank', () => {
    expect(resolveField('crew.byRank.master.doc.coc.number', ctxWithDocs)).toBe('CoC-123');
    expect(resolveField('crew.byRank.master.doc.coc.grade', ctxWithDocs)).toBe('Master (unlimited)');
    expect(resolveField('crew.byRank.master.doc.coc.issuedBy', ctxWithDocs)).toBe('Croatia');
    expect(resolveField('crew.byRank.master.doc.coc.issueDate', ctxWithDocs)).toBe('2024-05-01');
    expect(resolveField('crew.byRank.master.doc.coc.expiryDate', ctxWithDocs)).toBe('2029-05-01');
  });
  it('takes the documents of the person onboard on the reference date', () => {
    const oldCoc = crewDoc({ crewId: oldMaster.id, number: 'OLD-1' });
    const both = { ...ctx, crewDocuments: [coc, oldCoc] };
    expect(resolveField('crew.byRank.master.doc.coc.number', both, { asAt: '2026-08-15' })).toBe('OLD-1');
    expect(resolveField('crew.byRank.master.doc.coc.number', both, { asAt: '2026-09-02' })).toBe('CoC-123');
  });
  it('takes the latest document of that type: by issue date, then by creation time', () => {
    const older = crewDoc({ number: 'OLDER', issueDate: '2019-05-01' });
    const newer = crewDoc({ number: 'NEWER', issueDate: '2025-05-01' });
    expect(resolveField('crew.byRank.master.doc.coc.number', { ...ctx, crewDocuments: [newer, older, coc] })).toBe('NEWER');
    const sameDay = crewDoc({ number: 'LATER-ENTRY', issueDate: '2024-05-01', createdAt: '2026-05-01T00:00:00.000Z' });
    expect(resolveField('crew.byRank.master.doc.coc.number', { ...ctx, crewDocuments: [sameDay, coc] })).toBe('LATER-ENTRY');
  });
  it('ignores deleted documents, other types and the documents of other people', () => {
    const deletedNewer = crewDoc({ number: 'DELETED', issueDate: '2026-01-01', deleted: true });
    expect(resolveField('crew.byRank.master.doc.coc.number', { ...ctx, crewDocuments: [coc, deletedNewer] })).toBe('CoC-123');
    expect(resolveField('crew.byRank.master.doc.medical.number', ctxWithDocs)).toBeUndefined();
    const bosunDoc = crewDoc({ crewId: 'nobody-here' });
    expect(resolveField('crew.byRank.master.doc.coc.number', { ...ctx, crewDocuments: [bosunDoc] })).toBeUndefined();
  });
  it('is undefined for a missing rank, a field that is unset, and names it does not know', () => {
    expect(resolveField('crew.byRank.bosun.doc.coc.number', ctxWithDocs)).toBeUndefined();
    expect(resolveField('crew.byRank.master.doc.coc.number', ctx)).toBeUndefined();
    const noExpiry = { ...ctx, crewDocuments: [crewDoc({ expiryDate: undefined })] };
    expect(resolveField('crew.byRank.master.doc.coc.expiryDate', noExpiry)).toBeUndefined();
    for (const field of ['remarks', 'id', 'type', 'crewId', 'constructor', 'deleted']) {
      expect(resolveField(`crew.byRank.master.doc.coc.${field}`, ctxWithDocs), field).toBeUndefined();
    }
    expect(resolveField('crew.byRank.master.doc.coc', ctxWithDocs)).toBeUndefined();
    expect(resolveField('crew.byRank.master.docs.coc.number', ctxWithDocs)).toBeUndefined();
    expect(resolveField('crew.byRank.master.doc.__proto__.number', ctxWithDocs)).toBeUndefined();
  });
});

describe('resolveField: certificates', () => {
  it('reads the certificate with that key', () => {
    expect(resolveField('cert.loadLine.expiryDate', ctx)).toBe('2029-03-14');
    expect(resolveField('cert.loadLine.number', ctx)).toBe('LL-77');
    expect(resolveField('cert.loadLine.issuedBy', ctx)).toBe('DNV');
    expect(resolveField('cert.loadLine.issueDate', ctx)).toBe('2024-03-15');
    expect(resolveField('cert.loadLine.nextSurveyDue', ctx)).toBe('2027-03-14');
  });
  it('is undefined for missing, deleted or unset certificate data', () => {
    expect(resolveField('cert.iopp.expiryDate', ctx)).toBeUndefined();
    expect(resolveField('cert.loadLine.expiryDate', { ...ctx, certificates: [{ ...loadLine, deleted: true }] })).toBeUndefined();
    expect(resolveField('cert.loadLine.expiryDate', { ...ctx, certificates: [{ ...loadLine, expiryDate: undefined }] })).toBeUndefined();
    expect(resolveField('cert.loadLine.constructor', ctx)).toBeUndefined();
    expect(resolveField('cert.loadLine.id', ctx)).toBeUndefined();
  });
});

describe('resolveField: voyage', () => {
  it('reads the active voyage', () => {
    expect(resolveField('voyage.nextPort', ctx)).toBe('Rotterdam');
    expect(resolveField('voyage.no', ctx)).toBe('V-12');
    expect(resolveField('voyage.lastPort', ctx)).toBe('Santos');
    expect(resolveField('voyage.eta', ctx)).toBe('2026-11-02T08:00');
    // The ETA is local time at the destination (+01:00), which is not the ship's +03:00.
    expect(resolveField('voyage.etaTimeZone', ctx)).toBe('UTC+01:00');
    expect(resolveField('voyage.cargo', ctx)).toBe('Soya');
    expect(resolveField('voyage.charterers', ctx)).toBe('ACME');
    expect(resolveField('voyage.agents', ctx)).toBe('Port Agents BV');
  });
  it('is undefined with no active, non-deleted voyage', () => {
    expect(resolveField('voyage.nextPort', { ...ctx, voyages: [] })).toBeUndefined();
    expect(resolveField('voyage.etaTimeZone', { ...ctx, voyages: [] })).toBeUndefined();
    expect(resolveField('voyage.etaTimeZone', { ...ctx, voyages: [{ ...voyage, active: false }] })).toBeUndefined();
    expect(resolveField('voyage.nextPort', { ...ctx, voyages: [{ ...voyage, active: false }] })).toBeUndefined();
    expect(resolveField('voyage.nextPort', { ...ctx, voyages: [{ ...voyage, deleted: true }] })).toBeUndefined();
  });
  it('skips inactive voyages to find the active one', () => {
    const past = { ...voyage, id: id(), active: false, nextPort: 'Hamburg' };
    expect(resolveField('voyage.nextPort', { ...ctx, voyages: [past, voyage] })).toBe('Rotterdam');
  });
  it('is undefined for unknown voyage fields', () => {
    expect(resolveField('voyage.etaOffsetMinutes', ctx)).toBeUndefined();
    expect(resolveField('voyage.id', ctx)).toBeUndefined();
  });
});

describe('resolveField: time', () => {
  it('gives ship\'s today, or the reference date when one is passed', () => {
    expect(resolveField('today', ctx)).toBe('2026-10-26');
    expect(resolveField('today', ctx, { asAt: '2026-08-15' })).toBe('2026-08-15');
  });
  it('now and nowUtc are always the real current time, whatever the reference date', () => {
    expect(resolveField('now', ctx)).toBe('2026-10-26T01:30');
    expect(resolveField('now', ctx, { asAt: '2026-08-15' })).toBe('2026-10-26T01:30');
    expect(resolveField('nowUtc', ctx)).toBe('2026-10-25T22:30:00.000Z');
    expect(resolveField('nowUtc', ctx, { asAt: '2026-08-15' })).toBe('2026-10-25T22:30:00.000Z');
  });
  it('names the ship\'s current time zone', () => {
    expect(resolveField('ship.timeZone', ctx)).toBe('UTC+03:00');
    expect(resolveField('ship.timeZone', { ...ctx, clockChanges: [] })).toBe('UTC+00:00');
  });
});

describe('resolveField: unknown names', () => {
  it('are undefined', () => {
    for (const name of ['', 'nope', 'crew', 'crew.byRank', 'crew.byRank.master', 'cert.loadLine', 'voyage', 'ship', 'today.x']) {
      expect(resolveField(name, ctx)).toBeUndefined();
    }
  });
});

describe('FIELD_NAMES', () => {
  it('lists every vessel and voyage name plus the time and crew-list names', () => {
    expect(FIELD_NAMES).toEqual([
      'vessel.name', 'vessel.imo', 'vessel.callSign', 'vessel.mmsi', 'vessel.flag', 'vessel.portOfRegistry',
      'vessel.gt', 'vessel.nt', 'vessel.dwt', 'vessel.loa', 'vessel.beam', 'vessel.yearBuilt',
      'vessel.owners', 'vessel.managers', 'vessel.pandi', 'vessel.classSociety',
      'voyage.no', 'voyage.lastPort', 'voyage.nextPort', 'voyage.eta', 'voyage.etaTimeZone', 'voyage.cargo', 'voyage.charterers', 'voyage.agents',
      'today', 'now', 'nowUtc', 'ship.timeZone', 'crew.onboard', 'crew.onboardCount',
    ]);
  });
  it('resolves every listed name without throwing', () => {
    for (const name of FIELD_NAMES) expect(() => resolveField(name, ctx)).not.toThrow();
    for (const name of FIELD_NAMES.filter((n) => n.startsWith('vessel.') && n !== 'vessel.gt')) {
      expect(resolveField(name, ctx)).toBeDefined();
    }
  });
});
