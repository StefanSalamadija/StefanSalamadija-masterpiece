import { describe, expect, it } from 'vitest';
import {
  carryOverDocuments, crewMemberBand, docBand, docLabel, expiringBefore, latestDocument, sortDocuments,
} from './crewDocs';
import type { CrewDocument, CrewMember } from './types';

const REF = '2026-10-25';

let seq = 0;
function doc(over: Partial<CrewDocument> = {}): CrewDocument {
  seq += 1;
  return {
    id: `doc-${seq}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'test-device',
    deleted: false, scope: 'ship', shipId: 'ship-1', crewId: 'c1', type: 'medical', grade: '', number: '', issuedBy: '',
    issueDate: '2025-01-01', remarks: '', ...over,
  };
}

function crew(over: Partial<CrewMember> = {}): CrewMember {
  seq += 1;
  return {
    id: `crew-${seq}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'test-device',
    deleted: false, scope: 'ship', shipId: 'ship-1', surname: 'PETROVIĆ', givenNames: 'Ivan', rank: 'master',
    nationality: 'Croatian', dateOfBirth: '1980-03-14', placeOfBirth: 'Split', passportNo: 'P1234567',
    passportExpiry: '2035-01-01', seamansBookNo: 'SB-998', seamansBookExpiry: '2035-01-01', signOnDate: '2026-06-01',
    signOnPort: 'Rijeka', ...over,
  };
}

const med = doc({ crewId: 'c1', type: 'medical', expiryDate: '2027-01-01' });
const bst = doc({ crewId: 'c1', type: 'bst' }); // no expiry
const visa = doc({ crewId: 'c1', type: 'usVisa', expiryDate: '2026-09-01' });
const gone = doc({ crewId: 'c1', type: 'ecdis', deleted: true });

describe('docLabel', () => {
  it('is the catalogue label of the type', () => {
    expect(docLabel(doc({ type: 'coc' }))).toBe('Certificate of Competency (CoC)');
    expect(docLabel(doc({ type: 'usVisa' }))).toBe('US C1/D visa');
    expect(docLabel(doc({ type: 'medical', typeOther: 'ignored' }))).toBe('Medical fitness certificate');
  });
  it('is the name typed for Other, trimmed, and "Other" while it has none', () => {
    expect(docLabel(doc({ type: 'other', typeOther: ' Tanker familiarisation ' }))).toBe('Tanker familiarisation');
    expect(docLabel(doc({ type: 'other', typeOther: '  ' }))).toBe('Other');
    expect(docLabel(doc({ type: 'other' }))).toBe('Other');
  });
  it('treats a type the catalogue does not have (a newer file) as Other, keeping its name', () => {
    expect(docLabel(doc({ type: 'futureType' as never, typeOther: 'Drone licence' }))).toBe('Drone licence');
    expect(docLabel(doc({ type: 'futureType' as never }))).toBe('Other');
  });
});

describe('docBand', () => {
  it('is amber from 90 days out, that day included, and ok after it', () => {
    expect(docBand(doc({ expiryDate: '2027-01-23' }), REF)).toBe('amber');
    expect(docBand(doc({ expiryDate: '2027-01-24' }), REF)).toBe('ok');
  });
  it('is red once expired, and amber on the day it expires', () => {
    expect(docBand(doc({ expiryDate: '2026-10-24' }), REF)).toBe('red');
    expect(docBand(doc({ expiryDate: REF }), REF)).toBe('amber');
  });
  it('is none without an expiry, or with one that is not a date', () => {
    expect(docBand(doc(), REF)).toBe('none');
    expect(docBand(doc({ expiryDate: '' }), REF)).toBe('none');
    expect(docBand(doc({ expiryDate: '2026-02-30' }), REF)).toBe('none');
  });
});

describe('crewMemberBand', () => {
  const ivan = crew({ id: 'c1', passportExpiry: '2030-01-01', seamansBookExpiry: '2030-01-01' });
  it('is the worst of the passport, the seaman\'s book and the documents', () => {
    expect(crewMemberBand(ivan, [med], REF)).toBe('amber');
    expect(crewMemberBand(ivan, [visa], REF)).toBe('red');
    expect(crewMemberBand(ivan, [med, visa], REF)).toBe('red');
    expect(crewMemberBand(crew({ id: 'c1', passportExpiry: '2026-10-01', seamansBookExpiry: '2030-01-01' }), [bst], REF)).toBe('red');
  });
  it('is the passport and book band alone without documents, with the 6-month window', () => {
    expect(crewMemberBand(ivan, [], REF)).toBe('ok');
    expect(crewMemberBand(crew({ id: 'c1', passportExpiry: '2027-04-25', seamansBookExpiry: '2030-01-01' }), [], REF)).toBe('amber');
  });
  it('leaves out deleted documents and the documents of other contracts', () => {
    const redButDeleted = doc({ crewId: 'c1', expiryDate: '2026-01-01', deleted: true });
    const redButOther = doc({ crewId: 'c2', expiryDate: '2026-01-01' });
    expect(crewMemberBand(ivan, [redButDeleted, redButOther, gone], REF)).toBe('ok');
  });
  it('is ok when only documents without an expiry are held', () => {
    expect(crewMemberBand(ivan, [bst], REF)).toBe('ok');
  });
});

describe('carryOverDocuments', () => {
  it('keeps the live documents of the contract that have no expiry or are valid on the sign-on day', () => {
    expect(carryOverDocuments([med, bst, visa, gone], 'c1', '2026-10-20').map((d) => d.type)).toEqual(['medical', 'bst']);
  });
  it('keeps a document that expires on the sign-on day, and drops one that expired the day before', () => {
    const onTheDay = doc({ expiryDate: '2026-11-01', type: 'bst' });
    const dayBefore = doc({ expiryDate: '2026-10-31', type: 'frb' });
    expect(carryOverDocuments([onTheDay, dayBefore], 'c1', '2026-11-01').map((d) => d.type)).toEqual(['bst']);
  });
  it('takes only the documents of the contract it is told', () => {
    const other = doc({ crewId: 'c2', type: 'sso' });
    expect(carryOverDocuments([other, med], 'c1', '2026-10-20').map((d) => d.type)).toEqual(['medical']);
    expect(carryOverDocuments([other, med], 'nobody', '2026-10-20')).toEqual([]);
  });
  it('copies what the paper says and nothing of the record, the contract or the optional keys it lacks', () => {
    const coc = doc({
      type: 'coc', grade: 'Master (unlimited)', number: 'CoC-123', issuedBy: 'Croatia', issueDate: '2024-05-01',
      expiryDate: '2029-05-01', remarks: 'Original sighted',
    });
    const [copy] = carryOverDocuments([coc, bst], 'c1', '2026-10-20');
    expect(copy).toEqual({
      shipId: 'ship-1', type: 'coc', grade: 'Master (unlimited)', number: 'CoC-123', issuedBy: 'Croatia',
      issueDate: '2024-05-01', expiryDate: '2029-05-01', remarks: 'Original sighted',
    });
    const [, noExpiry] = carryOverDocuments([coc, bst], 'c1', '2026-10-20');
    expect('expiryDate' in noExpiry).toBe(false);
    expect('typeOther' in noExpiry).toBe(false);
  });
  it('keeps the name of an Other document', () => {
    const other = doc({ type: 'other', typeOther: 'Tanker familiarisation' });
    expect(carryOverDocuments([other], 'c1', '2026-10-20')[0]).toMatchObject({ type: 'other', typeOther: 'Tanker familiarisation' });
  });
});

describe('expiringBefore', () => {
  const ivan = crew({
    id: 'c1', givenNames: 'Ivan', surname: 'PETROVIĆ', passportExpiry: '2026-12-01', seamansBookExpiry: '2030-01-01',
    signOnDate: '2026-06-01',
  });
  const coc = doc({ crewId: 'c1', type: 'coc', expiryDate: '2026-11-15' });

  it('lists what expires on or before the date, by expiry date', () => {
    const items = expiringBefore({ today: REF, until: '2027-01-10', crew: [ivan], docs: [med, bst, coc] });
    expect(items.map((i) => [i.what, i.expiryDate])).toEqual([
      ['Certificate of Competency (CoC)', '2026-11-15'], ['Passport', '2026-12-01'], ['Medical fitness certificate', '2027-01-01'],
    ]);
  });
  it('says who, with the rank and the band the paper is judged by', () => {
    const items = expiringBefore({ today: REF, until: '2027-01-10', crew: [ivan], docs: [med, coc] });
    expect(items[0]).toEqual({
      crewId: 'c1', name: 'Ivan PETROVIĆ', rank: 'Master', what: 'Certificate of Competency (CoC)', expiryDate: '2026-11-15',
      band: 'amber',
    });
    // The passport is judged by 6 months out, a document by 90 days.
    expect(items.find((i) => i.what === 'Passport')?.band).toBe('amber');
  });
  it('includes the day itself, and leaves out what expires later', () => {
    expect(expiringBefore({ today: REF, until: '2027-01-01', crew: [ivan], docs: [med] }).map((i) => i.what)).toContain('Medical fitness certificate');
    expect(expiringBefore({ today: REF, until: '2026-12-31', crew: [ivan], docs: [med] }).map((i) => i.what)).not.toContain('Medical fitness certificate');
  });
  it('lists the seaman\'s book too', () => {
    const book = crew({ id: 'c3', surname: 'BOOK', seamansBookExpiry: '2026-11-30', signOnDate: '2026-06-01' });
    expect(expiringBefore({ today: REF, until: '2026-12-31', crew: [book], docs: [] }).map((i) => [i.what, i.expiryDate])).toEqual([
      ["Seaman's book", '2026-11-30'],
    ]);
  });
  it('lists what has already expired, as red', () => {
    const items = expiringBefore({ today: REF, until: '2027-01-10', crew: [ivan], docs: [visa] });
    expect(items[0]).toMatchObject({ what: 'US C1/D visa', expiryDate: '2026-09-01', band: 'red' });
  });
  it('names a paper of its own by the name typed for it', () => {
    const own = doc({ crewId: 'c1', type: 'other', typeOther: 'Tanker familiarisation', expiryDate: '2026-11-01' });
    expect(expiringBefore({ today: REF, until: '2027-01-10', crew: [ivan], docs: [own] })[0].what).toBe('Tanker familiarisation');
  });
  it('leaves out documents without an expiry, deleted ones, and ones that are not a date', () => {
    const noDate = doc({ crewId: 'c1', type: 'sso', expiryDate: 'soon' });
    const items = expiringBefore({ today: REF, until: '2029-12-31', crew: [ivan], docs: [bst, gone, noDate] });
    expect(items.map((i) => i.what)).toEqual(['Passport']);
  });
  it('covers the crew onboard on the day only', () => {
    const left = crew({ id: 'c2', surname: 'GONE', passportExpiry: '2026-11-01', signOnDate: '2026-01-01', signOffDate: '2026-10-01' });
    const notYet = crew({ id: 'c4', surname: 'LATER', passportExpiry: '2026-11-01', signOnDate: '2026-12-01' });
    const deleted = crew({ id: 'c5', surname: 'DELETED', passportExpiry: '2026-11-01', deleted: true });
    const goneDoc = doc({ crewId: 'c2', expiryDate: '2026-11-01' });
    const items = expiringBefore({ today: REF, until: '2027-01-10', crew: [ivan, left, notYet, deleted], docs: [goneDoc] });
    expect(new Set(items.map((i) => i.crewId))).toEqual(new Set(['c1']));
  });
  it('leaves out the documents of a contract that is not onboard, even of the same person', () => {
    const old = crew({ id: 'old', surname: 'PETROVIĆ', passportExpiry: '2030-01-01', signOnDate: '2026-01-01', signOffDate: '2026-05-01' });
    const items = expiringBefore({ today: REF, until: '2027-01-10', crew: [old], docs: [doc({ crewId: 'old', expiryDate: '2026-11-01' })] });
    expect(items).toEqual([]);
  });
  it('orders the same day by name, then by what', () => {
    const ana = crew({ id: 'a', givenNames: 'Ana', surname: 'BOS', passportExpiry: '2026-12-01', signOnDate: '2026-06-01' });
    const items = expiringBefore({
      today: REF, until: '2026-12-31', crew: [ivan, ana],
      docs: [doc({ crewId: 'c1', type: 'sso', expiryDate: '2026-12-01' }), doc({ crewId: 'c1', type: 'bst', expiryDate: '2026-12-01' })],
    });
    expect(items.map((i) => `${i.name}: ${i.what}`)).toEqual([
      'Ana BOS: Passport', 'Ivan PETROVIĆ: Basic safety training', 'Ivan PETROVIĆ: Passport', 'Ivan PETROVIĆ: Ship security officer',
    ]);
  });
  it('is empty when nothing is near', () => {
    expect(expiringBefore({ today: REF, until: '2026-11-01', crew: [ivan], docs: [med] })).toEqual([]);
    expect(expiringBefore({ today: REF, until: '2027-01-10', crew: [], docs: [med] })).toEqual([]);
  });
});

describe('sortDocuments', () => {
  it('follows the catalogue, then the expiry date, then the issue date and the id; the argument is not changed', () => {
    const a = doc({ id: 'a', type: 'medical', expiryDate: '2027-01-01' });
    const b = doc({ id: 'b', type: 'coc', expiryDate: '2029-01-01' });
    const c = doc({ id: 'c', type: 'medical', expiryDate: '2026-11-01' });
    const d = doc({ id: 'd', type: 'other', typeOther: 'Zebra' });
    const e = doc({ id: 'e', type: 'other', typeOther: 'Alpha' });
    const list = [a, d, b, e, c];
    expect(sortDocuments(list).map((x) => x.id)).toEqual(['b', 'c', 'a', 'e', 'd']);
    expect(list.map((x) => x.id)).toEqual(['a', 'd', 'b', 'e', 'c']);
  });
  it('leaves out deleted documents', () => {
    expect(sortDocuments([gone, med])).toEqual([med]);
  });
});

describe('latestDocument', () => {
  const old = doc({ id: 'old', crewId: 'c1', type: 'coc', number: 'OLD', issueDate: '2020-01-01' });
  const recent = doc({ id: 'recent', crewId: 'c1', type: 'coc', number: 'NEW', issueDate: '2025-01-01' });
  it('is the one issued last', () => {
    expect(latestDocument([old, recent], 'c1', 'coc')?.id).toBe('recent');
    expect(latestDocument([recent, old], 'c1', 'coc')?.id).toBe('recent');
  });
  it('breaks a tie of issue dates by the time it was created, then by id', () => {
    const early = doc({ id: 'x1', crewId: 'c1', type: 'coc', issueDate: '2025-01-01', createdAt: '2026-01-01T00:00:00.000Z' });
    const late = doc({ id: 'x0', crewId: 'c1', type: 'coc', issueDate: '2025-01-01', createdAt: '2026-02-01T00:00:00.000Z' });
    expect(latestDocument([late, early], 'c1', 'coc')?.id).toBe('x0');
    const sameTime = doc({ id: 'x2', crewId: 'c1', type: 'coc', issueDate: '2025-01-01', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(latestDocument([early, sameTime], 'c1', 'coc')?.id).toBe('x2');
    expect(latestDocument([sameTime, early], 'c1', 'coc')?.id).toBe('x2');
  });
  it('counts a document with no issue date as the oldest', () => {
    const undated = doc({ id: 'undated', crewId: 'c1', type: 'coc', issueDate: '' });
    expect(latestDocument([undated, old], 'c1', 'coc')?.id).toBe('old');
  });
  it('is none for a type the contract has not got, deleted documents, and other contracts', () => {
    expect(latestDocument([old], 'c1', 'medical')).toBeUndefined();
    expect(latestDocument([doc({ crewId: 'c1', type: 'coc', deleted: true })], 'c1', 'coc')).toBeUndefined();
    expect(latestDocument([doc({ crewId: 'c2', type: 'coc' })], 'c1', 'coc')).toBeUndefined();
  });
});
