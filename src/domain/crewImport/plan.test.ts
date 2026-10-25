import { describe, expect, it } from 'vitest';
import type { CrewDraft, CrewMember } from '../types';
import { crewPatch, importPlan, isImportable } from './plan';
import type { PreviewRow } from './preview';

function member(over: Partial<CrewMember> = {}): CrewMember {
  return {
    id: 'crew-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'test-device',
    deleted: false, scope: 'ship', shipId: 'ship-1', surname: 'PETROVIĆ', givenNames: 'Ivan', rank: 'chiefOfficer',
    nationality: 'Croatian', dateOfBirth: '1985-01-05', placeOfBirth: 'Split', passportNo: '012 345 678',
    passportExpiry: '2030-01-01', seamansBookNo: 'sb 998', seamansBookExpiry: '2030-02-02', signOnDate: '2026-06-01',
    signOnPort: 'Rijeka', ...over,
  };
}

const DRAFT: CrewDraft = {
  surname: 'ŠAŠIĆ', givenNames: 'Marko', rank: 'master', nationality: '', dateOfBirth: '', placeOfBirth: '', passportNo: 'P77',
  passportExpiry: '', seamansBookNo: '', seamansBookExpiry: '', signOnDate: '2026-10-25', signOnPort: '',
};

function row(over: Partial<PreviewRow> = {}): PreviewRow {
  return { rowNumber: 5, status: 'new', draft: DRAFT, changes: [], errors: [], skip: false, ...over };
}

describe('isImportable', () => {
  it('is true for a new row, and for an update that changes something', () => {
    expect(isImportable(row())).toBe(true);
    expect(isImportable(row({ status: 'update', existingId: 'crew-1', changes: [{ field: 'rank', from: 'ab', to: 'master' }] }))).toBe(true);
  });

  it('is false for an update without changes, an error row and a skipped row', () => {
    expect(isImportable(row({ status: 'update', existingId: 'crew-1' }))).toBe(false);
    expect(isImportable(row({ status: 'error', errors: [{ field: 'rank', message: 'Rank is required.', severity: 'error' }] }))).toBe(false);
    expect(isImportable(row({ skip: true }))).toBe(false);
  });
});

describe('crewPatch', () => {
  it('holds the new value of each changed field and nothing else', () => {
    const patch = crewPatch(member(), [
      { field: 'passportExpiry', from: '2030-01-01', to: '2031-01-01' },
      { field: 'signOnPort', from: 'Rijeka', to: 'Split' },
    ]);
    expect(patch).toEqual({ passportExpiry: '2031-01-01', signOnPort: 'Split' });
  });

  it('keeps an emptied text field as an empty text, and removes an optional field that was emptied', () => {
    const signedOff = member({ signOffDate: '2026-09-01', signOffPort: 'Koper' });
    const patch = crewPatch(signedOff, [
      { field: 'nationality', from: 'Croatian', to: '' },
      { field: 'signOffDate', from: '2026-09-01', to: '' },
      { field: 'signOffPort', from: 'Koper', to: '' },
    ]);
    expect(patch).toEqual({ nationality: '', signOffDate: undefined, signOffPort: undefined });
    expect(Object.keys(patch)).toContain('signOffDate'); // present with undefined: updateRecord removes the key
  });

  it('clears the rank text of a record that stops being rank "other"', () => {
    const pumpman = member({ rank: 'other', rankOther: 'Pumpman' });
    expect(crewPatch(pumpman, [{ field: 'rank', from: 'other', to: 'fitter' }])).toEqual({ rank: 'fitter', rankOther: undefined });
  });

  it('keeps the rank text of a record that stays "other", and takes a changed one', () => {
    const pumpman = member({ rank: 'other', rankOther: 'Pumpman' });
    expect(crewPatch(pumpman, [{ field: 'passportNo', from: '012 345 678', to: 'X1' }])).toEqual({ passportNo: 'X1' });
    expect(crewPatch(pumpman, [{ field: 'rankOther', from: 'Pumpman', to: 'Pump man' }])).toEqual({ rankOther: 'Pump man' });
  });

  it('does not touch a rank text a record never had', () => {
    expect(crewPatch(member(), [{ field: 'rank', from: 'chiefOfficer', to: 'master' }])).toEqual({ rank: 'master' });
  });
});

describe('importPlan', () => {
  const existing = [member()];

  it('creates the new rows and updates the matched ones with their changes, in the order of the sheet', () => {
    const update = row({
      rowNumber: 3, status: 'update', existingId: 'crew-1', draft: { ...DRAFT, passportNo: '012345678' },
      changes: [{ field: 'rank', from: 'chiefOfficer', to: 'master' }],
    });
    const plan = importPlan([update, row({ rowNumber: 4 }), row({ rowNumber: 6, draft: { ...DRAFT, surname: 'HORVAT' } })], existing);
    expect(plan.updates).toEqual([{ id: 'crew-1', patch: { rank: 'master' } }]);
    expect(plan.creates.map(draft => draft.surname)).toEqual(['ŠAŠIĆ', 'HORVAT']);
    expect(plan.creates[0]).toEqual(DRAFT);
  });

  it('leaves out skipped rows, error rows and updates with no changes', () => {
    const plan = importPlan([
      row({ rowNumber: 3, skip: true }),
      row({ rowNumber: 4, status: 'error', errors: [{ field: 'rank', message: 'Rank is required.', severity: 'error' }] }),
      row({ rowNumber: 5, status: 'update', existingId: 'crew-1' }),
    ], existing);
    expect(plan).toEqual({ creates: [], updates: [] });
  });

  it('fails for an update of a record that is not among the existing crew, rather than skipping it', () => {
    const update = row({ status: 'update', existingId: 'gone', changes: [{ field: 'rank', from: 'ab', to: 'master' }] });
    expect(() => importPlan([update], existing)).toThrow(/gone/);
  });
});
