import { describe, expect, it } from 'vitest';
import { conflictKey, computeMerge } from '../domain/merge';
import type { MergeItem, MergePlan } from '../domain/merge';
import type { SyncRecord, TableName, Tables } from '../domain/types';
import {
  changedFields, conflictViews, deletionsLabel, deletionTitles, EMPTY_VALUE, fromLine, isTooBigForBackup,
  MAX_BACKUP_FILE_BYTES, MAX_DEVICE_NAME_SHOWN, plainText, recordTitle, summaryLine, unresolvedCount,
} from './importReview';

const stamp = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'device-a', deleted: false, scope: 'ship' as const };
const rec = (extra: object): SyncRecord => ({ id: 'r1', ...stamp, ...extra }) as unknown as SyncRecord;

const crew = (extra: object = {}): SyncRecord => rec({
  shipId: 's1', surname: 'PETROVIĆ', givenNames: 'Ivan', rank: 'master', nationality: 'Croatian', dateOfBirth: '1985-01-05',
  placeOfBirth: 'Split', passportNo: 'P1', passportExpiry: '2030-01-01', seamansBookNo: 'S1', seamansBookExpiry: '2030-01-01',
  signOnDate: '2026-06-01', signOnPort: 'Rijeka', ...extra,
});

const item = (kind: MergeItem['kind'], table: TableName, local: SyncRecord | undefined, incoming: SyncRecord): MergeItem =>
  ({ table, id: incoming.id, kind, ...(local && { local }), incoming });

const plan = (items: MergeItem[]): MergePlan => ({
  items, summary: { added: 0, updated: 0, deleted: 0, conflicts: items.filter((i) => i.kind === 'conflict').length },
});

describe('plainText', () => {
  it('leaves ordinary text, diacritics and markup characters exactly as they are: it is shown as text, never as HTML', () => {
    expect(plainText("Šašić's <b>laptop</b> & \"phone\"", 100)).toBe("Šašić's <b>laptop</b> & \"phone\"");
    expect(plainText('<img src=x onerror=alert(1)>', 100)).toBe('<img src=x onerror=alert(1)>');
  });

  it('turns tabs and line breaks into spaces', () => {
    expect(plainText('a\tb\nc\r\nd', 100)).toBe('a b c  d');
  });

  it('removes control characters and the characters that reorder or hide text', () => {
    expect(plainText('a\u0000b\u0007c‮def⁦g​h﻿i\u0085j', 100)).toBe('abcdefghij');
  });

  it('trims', () => {
    expect(plainText('  hello  ', 100)).toBe('hello');
  });

  it('cuts a longer text to the given number of characters and marks the cut', () => {
    expect(plainText('x'.repeat(100), 60)).toBe(`${'x'.repeat(60)}…`);
    expect(plainText('x'.repeat(60), 60)).toBe('x'.repeat(60));
  });

  it('counts characters, not code units, so that it never cuts a character in half', () => {
    expect(plainText('😀'.repeat(70), 60)).toBe(`${'😀'.repeat(60)}…`);
  });

  it('is empty for text that is only control characters', () => {
    expect(plainText('‮\u0000', 10)).toBe('');
  });
});

describe('fromLine', () => {
  it('says who exported the file and when, in UTC', () => {
    expect(fromLine({ deviceName: 'Bridge laptop', exportedAt: '2026-10-25T09:05:59.000Z' }))
      .toBe('From Bridge laptop, exported 2026-10-25 09:05 UTC');
  });

  it('shows at most 60 characters of the device name, which nobody has checked', () => {
    expect(MAX_DEVICE_NAME_SHOWN).toBe(60);
    const line = fromLine({ deviceName: 'N'.repeat(500), exportedAt: '2026-10-25T09:05:00.000Z' });
    expect(line).toBe(`From ${'N'.repeat(60)}…, exported 2026-10-25 09:05 UTC`);
  });

  it('shows a device name that is markup as text', () => {
    expect(fromLine({ deviceName: '<script>alert(1)</script>', exportedAt: '2026-10-25T09:05:00.000Z' }))
      .toBe('From <script>alert(1)</script>, exported 2026-10-25 09:05 UTC');
  });

  it('copes with a name that is empty, or only control characters', () => {
    expect(fromLine({ deviceName: '', exportedAt: '2026-10-25T09:05:00.000Z' })).toBe('From an unknown device, exported 2026-10-25 09:05 UTC');
    expect(fromLine({ deviceName: '‮', exportedAt: '2026-10-25T09:05:00.000Z' })).toBe('From an unknown device, exported 2026-10-25 09:05 UTC');
  });

  it('copes with an export time that cannot be read', () => {
    expect(fromLine({ deviceName: 'Tablet', exportedAt: 'whenever' })).toBe('From Tablet, exported at an unknown time');
  });
});

describe('summaryLine and deletionsLabel', () => {
  it('writes the four counts, always in the plural', () => {
    expect(summaryLine({ added: 3, updated: 0, deleted: 0, conflicts: 0 })).toBe('3 new · 0 updated · 0 deleted · 0 conflicts');
    expect(summaryLine({ added: 0, updated: 2, deleted: 1, conflicts: 1 })).toBe('0 new · 2 updated · 1 deleted · 1 conflicts');
  });

  it('names the deletions checkbox with their number', () => {
    expect(deletionsLabel(4)).toBe('Apply 4 deletions');
    expect(deletionsLabel(1)).toBe('Apply 1 deletions');
  });
});

describe('recordTitle', () => {
  it('names a record by what it is and what it is called', () => {
    expect(recordTitle('ships', rec({ particulars: { name: 'MV OCEAN STAR' } }))).toBe('Ship: MV OCEAN STAR');
    expect(recordTitle('crew', crew())).toBe('Crew: Ivan PETROVIĆ');
    expect(recordTitle('voyages', rec({ shipId: 's1', voyageNo: 'V-2611' }))).toBe('Voyage: V-2611');
    expect(recordTitle('certificates', rec({ shipId: 's1', name: 'International Load Line' }))).toBe('Certificate: International Load Line');
    expect(recordTitle('clockChanges', rec({ shipId: 's1', effectiveAt: '2026-10-25T09:00:00.000Z' }))).toBe('Clock change: 2026-10-25 09:00 UTC');
  });

  it('has a name for a record that has none', () => {
    expect(recordTitle('ships', rec({ particulars: {} }))).toBe('Ship: (no name)');
    expect(recordTitle('crew', rec({ shipId: 's1' }))).toBe('Crew: (no name)');
    expect(recordTitle('voyages', rec({ shipId: 's1', voyageNo: '' }))).toBe('Voyage: (no number)');
    expect(recordTitle('certificates', rec({ shipId: 's1' }))).toBe('Certificate: (no name)');
    expect(recordTitle('clockChanges', rec({ shipId: 's1', effectiveAt: 'later' }))).toBe('Clock change: (unknown time)');
  });

  it('shows what the file says as plain text, shortened', () => {
    expect(recordTitle('ships', rec({ particulars: { name: '<b>X</b>‮' } }))).toBe('Ship: <b>X</b>');
    expect(recordTitle('crew', crew({ surname: 'S'.repeat(300) }))).toBe(`Crew: Ivan ${'S'.repeat(80 - 5)}…`);
  });

  it('does not fail on values of the wrong type', () => {
    expect(recordTitle('crew', crew({ surname: { a: 1 }, givenNames: 7 }))).toBe('Crew: (no name)');
    expect(recordTitle('ships', rec({ particulars: { name: 12 } }))).toBe('Ship: (no name)');
  });
});

describe('changedFields', () => {
  it('lists the fields that differ by the words of the crew form, and no others', () => {
    expect(changedFields('crew', crew({ nationality: 'Croatian' }), crew({ nationality: 'Montenegrin', updatedAt: '2026-02-01T00:00:00.000Z' })))
      .toEqual([{ label: 'Nationality', local: 'Croatian', incoming: 'Montenegrin' }]);
  });

  it('leaves out the bookkeeping fields: id, times, who changed it, side, ship', () => {
    const a = crew();
    const b = crew({ updatedAt: '2026-05-05T00:00:00.000Z', updatedBy: 'device-b', signOnPort: 'Split' });
    expect(changedFields('crew', a, b)).toEqual([{ label: 'Sign-on port', local: 'Rijeka', incoming: 'Split' }]);
  });

  it('writes a rank by its name, a rank of its own as typed, and an empty value as a dash', () => {
    expect(changedFields('crew', crew({ rank: 'master' }), crew({ rank: 'chiefOfficer' })))
      .toEqual([{ label: 'Rank', local: 'Master', incoming: 'Chief Officer' }]);
    expect(changedFields('crew', crew({ rank: 'other', rankOther: 'Pilot' }), crew({ rank: 'other', rankOther: 'Supernumerary' })))
      .toEqual([{ label: 'Rank (other)', local: 'Pilot', incoming: 'Supernumerary' }]);
    expect(changedFields('crew', crew(), crew({ signOffDate: '2026-10-10', signOffPort: 'Santos' })))
      .toEqual([
        { label: 'Sign-off date', local: EMPTY_VALUE, incoming: '2026-10-10' },
        { label: 'Sign-off port', local: EMPTY_VALUE, incoming: 'Santos' },
      ]);
    expect(EMPTY_VALUE).toBe('—');
  });

  it('puts the fields in the order of the form, not of the file', () => {
    const labels = changedFields('crew', crew(), crew({ signOnPort: 'X', surname: 'Z', passportNo: 'Q' })).map((c) => c.label);
    expect(labels).toEqual(['Surname', 'Passport no.', 'Sign-on port']);
  });

  it('shows the particulars of a ship by the words of the particulars form', () => {
    const ship = (particulars: object): SyncRecord => rec({ particulars: { name: 'MV OCEAN STAR', imo: '9074729', gt: 32500, ...particulars } });
    expect(changedFields('ships', ship({}), ship({ name: 'MV SEA BREEZE', imo: '9074729', gt: 33000, classSociety: 'DNV' })))
      .toEqual([
        { label: 'Ship name', local: 'MV OCEAN STAR', incoming: 'MV SEA BREEZE' },
        { label: 'GT', local: '32500', incoming: '33000' },
        { label: 'Classification society', local: EMPTY_VALUE, incoming: 'DNV' },
      ]);
  });

  it('summarises the saved crew import settings of a ship instead of dumping them', () => {
    const ship = (mapping?: object): SyncRecord => rec({ particulars: { name: 'S' }, ...(mapping && { crewImportMapping: mapping }) });
    expect(changedFields('ships', ship(), ship({ byHeader: { a: 'surname', b: 'rank' }, dateFormat: 'day-first' })))
      .toEqual([{ label: 'Crew import settings', local: EMPTY_VALUE, incoming: '2 mapped columns' }]);
  });

  it('shows a certificate by the words of the certificate form', () => {
    const cert = (extra: object): SyncRecord => rec({
      shipId: 's1', key: 'loadLine', name: 'International Load Line', number: 'LL-1', issuedBy: 'DNV', issueDate: '2024-03-15',
      expiryDate: '2029-03-14', remarks: '', ...extra,
    });
    expect(changedFields('certificates', cert({}), cert({ expiryDate: '2030-03-14', nextSurveyDue: '2027-03-14', number: 'LL-2' })))
      .toEqual([
        { label: 'Number', local: 'LL-1', incoming: 'LL-2' },
        { label: 'Expiry date', local: '2029-03-14', incoming: '2030-03-14' },
        { label: 'Next survey due', local: EMPTY_VALUE, incoming: '2027-03-14' },
      ]);
  });

  it("shows a voyage by the words of the voyage form, with the ETA's offset as an offset and the date and time apart", () => {
    const voyage = (extra: object): SyncRecord => rec({
      shipId: 's1', active: true, voyageNo: '12', lastPort: 'Rijeka', nextPort: 'Split', etaLocal: '2026-10-27T06:00',
      etaOffsetMinutes: 120, cargo: 'Containers', charterers: '', agents: '', ...extra,
    });
    expect(changedFields('voyages', voyage({}), voyage({ etaLocal: '2026-10-28T07:30', etaOffsetMinutes: 180, active: false })))
      .toEqual([
        { label: 'ETA (local)', local: '2026-10-27 06:00', incoming: '2026-10-28 07:30' },
        { label: 'ETA UTC offset', local: 'UTC+02:00', incoming: 'UTC+03:00' },
        { label: 'Current voyage', local: 'Yes', incoming: 'No' },
      ]);
  });

  it('shows a clock change by its time in UTC and its offset', () => {
    const change = (extra: object): SyncRecord => rec({ shipId: 's1', effectiveAt: '2026-10-25T09:00:00.000Z', toOffsetMinutes: 180, ...extra });
    expect(changedFields('clockChanges', change({}), change({ effectiveAt: '2026-10-25T10:30:00.000Z', toOffsetMinutes: 240, note: 'Advance' })))
      .toEqual([
        { label: 'Change at (UTC)', local: '2026-10-25 09:00 UTC', incoming: '2026-10-25 10:30 UTC' },
        { label: 'New offset', local: 'UTC+03:00', incoming: 'UTC+04:00' },
        { label: 'Note', local: EMPTY_VALUE, incoming: 'Advance' },
      ]);
  });

  it('says so, first, when one side is deleted', () => {
    expect(changedFields('crew', crew(), crew({ deleted: true, nationality: 'Montenegrin' })))
      .toEqual([
        { label: 'Status', local: 'Active', incoming: 'Deleted' },
        { label: 'Nationality', local: 'Croatian', incoming: 'Montenegrin' },
      ]);
    expect(changedFields('crew', crew({ deleted: true }), crew())).toEqual([{ label: 'Status', local: 'Deleted', incoming: 'Active' }]);
  });

  it('names a field it has no words for by its name in the file, as plain text', () => {
    expect(changedFields('crew', crew(), crew({ tallyNo: '<i>7</i>' }))).toEqual([{ label: 'tallyNo', local: EMPTY_VALUE, incoming: '<i>7</i>' }]);
  });

  it('shows what the file says as plain text, and shortens a long value', () => {
    const [change] = changedFields('crew', crew(), crew({ nationality: `<b>${'x'.repeat(500)}</b>‮` }));
    expect(change.incoming.startsWith('<b>xxx')).toBe(true);
    expect(change.incoming.endsWith('…')).toBe(true);
    expect(change.incoming).not.toContain('‮');
    expect(Array.from(change.incoming).length).toBeLessThanOrEqual(201);
  });

  it('shows a value that is not text or a number without failing', () => {
    expect(changedFields('crew', crew(), crew({ nationality: { x: [1, 2] } }))).toEqual([{ label: 'Nationality', local: 'Croatian', incoming: '{"x":[1,2]}' }]);
    expect(changedFields('crew', crew(), crew({ nationality: true }))).toEqual([{ label: 'Nationality', local: 'Croatian', incoming: 'Yes' }]);
  });

  it('has nothing to show for records that only differ in what is left out', () => {
    expect(changedFields('crew', crew(), crew({ updatedBy: 'device-b' }))).toEqual([]);
  });

  it('does not take a certificate catalogue key for a change of its own: the name says it', () => {
    const cert = (extra: object): SyncRecord => rec({ shipId: 's1', key: 'loadLine', name: 'International Load Line', ...extra });
    expect(changedFields('certificates', cert({}), cert({ key: 'iopp', name: 'IOPP' })))
      .toEqual([{ label: 'Certificate name', local: 'International Load Line', incoming: 'IOPP' }]);
  });
});

describe('conflictViews', () => {
  it('has one view per conflict, with the title, the changed fields and the two choices', () => {
    const views = conflictViews(plan([
      item('add', 'crew', undefined, crew({ id: 'n1' })),
      item('conflict', 'crew', crew({ nationality: 'Croatian' }), crew({ nationality: 'Montenegrin' })),
      item('update', 'crew', crew({ id: 'u1' }), crew({ id: 'u1', signOnPort: 'Split' })),
    ]));
    expect(views).toEqual([{
      key: 'crew:r1', title: 'Crew: Ivan PETROVIĆ',
      changes: [{ label: 'Nationality', local: 'Croatian', incoming: 'Montenegrin' }],
      keepLabel: "Keep this device's version", useLabel: "Use the file's version",
    }]);
  });

  it("labels the file's version (deleted) when the file deleted the record", () => {
    const [view] = conflictViews(plan([item('conflict', 'crew', crew({ nationality: 'Croatian' }), crew({ deleted: true }))]));
    expect(view.useLabel).toBe("Use the file's version (deleted)");
    expect(view.keepLabel).toBe("Keep this device's version");
  });

  it("labels this device's version (deleted) when it is this device that deleted the record", () => {
    const [view] = conflictViews(plan([item('conflict', 'crew', crew({ deleted: true }), crew({ nationality: 'Montenegrin' }))]));
    expect(view.keepLabel).toBe("Keep this device's version (deleted)");
    expect(view.useLabel).toBe("Use the file's version");
  });

  it('keys each view the way the merge keys its decisions', () => {
    const conflict = item('conflict', 'voyages', rec({ shipId: 's1', voyageNo: '1' }), rec({ shipId: 's1', voyageNo: '2' }));
    expect(conflictViews(plan([conflict]))[0].key).toBe(conflictKey(conflict));
    expect(conflictKey(conflict)).toBe('voyages:r1');
  });

  it('names a conflict by this device\'s record', () => {
    const [view] = conflictViews(plan([item('conflict', 'crew', crew({ surname: 'LOCAL' }), crew({ surname: 'FILE' }))]));
    expect(view.title).toBe('Crew: Ivan LOCAL');
  });

  it('has none for a plan without conflicts', () => {
    expect(conflictViews(plan([item('add', 'crew', undefined, crew())]))).toEqual([]);
  });

  it('works on a plan the merge made', () => {
    const local: Tables = { ships: [], crew: [crew({ nationality: 'Croatian', updatedAt: '2026-03-01T00:00:00.000Z' })], voyages: [], certificates: [], clockChanges: [] };
    const incoming: Tables = { ships: [], crew: [crew({ nationality: 'Montenegrin', updatedAt: '2026-04-01T00:00:00.000Z' })], voyages: [], certificates: [], clockChanges: [] };
    const merged = computeMerge(local, incoming, undefined);
    expect(conflictViews(merged)).toHaveLength(1);
    expect(conflictViews(merged)[0].changes).toEqual([{ label: 'Nationality', local: 'Croatian', incoming: 'Montenegrin' }]);
  });
});

describe('deletionTitles', () => {
  it('lists what the file would delete here', () => {
    const titles = deletionTitles(plan([
      item('delete', 'crew', crew(), crew({ deleted: true })),
      item('delete', 'certificates', rec({ id: 'c1', shipId: 's1', name: 'IOPP' }), rec({ id: 'c1', shipId: 's1', name: 'IOPP', deleted: true })),
      item('update', 'crew', crew({ id: 'u1' }), crew({ id: 'u1', signOnPort: 'Split' })),
      item('conflict', 'crew', crew({ id: 'x1' }), crew({ id: 'x1', deleted: true })),
    ]));
    expect(titles).toEqual(['Crew: Ivan PETROVIĆ', 'Certificate: IOPP']);
  });

  it('is empty when there are none', () => {
    expect(deletionTitles(plan([]))).toEqual([]);
  });
});

describe('unresolvedCount', () => {
  const conflicts = conflictViews(plan([
    item('conflict', 'crew', crew({ id: 'a' }), crew({ id: 'a', nationality: 'X' })),
    item('conflict', 'crew', crew({ id: 'b' }), crew({ id: 'b', nationality: 'Y' })),
  ]));

  it('counts the conflicts that have no choice yet', () => {
    expect(unresolvedCount(conflicts, {})).toBe(2);
    expect(unresolvedCount(conflicts, { 'crew:a': 'local' })).toBe(1);
    expect(unresolvedCount(conflicts, { 'crew:a': 'local', 'crew:b': 'incoming' })).toBe(0);
  });

  it('does not count a choice for something that is not a conflict of this plan', () => {
    expect(unresolvedCount(conflicts, { 'crew:zzz': 'local', 'crew:a': 'incoming' })).toBe(1);
  });

  it('is zero without conflicts', () => {
    expect(unresolvedCount([], {})).toBe(0);
  });
});

describe('isTooBigForBackup', () => {
  it('turns away a file too big to be a backup, so that picking a video by mistake does not read it all into memory', () => {
    expect(MAX_BACKUP_FILE_BYTES).toBe(64 * 1024 * 1024);
    expect(isTooBigForBackup(0)).toBe(false);
    expect(isTooBigForBackup(5 * 1024 * 1024)).toBe(false);
    expect(isTooBigForBackup(MAX_BACKUP_FILE_BYTES)).toBe(false);
    expect(isTooBigForBackup(MAX_BACKUP_FILE_BYTES + 1)).toBe(true);
  });
});
