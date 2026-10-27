import { describe, expect, it } from 'vitest';
import { computeMerge, conflictKey, deepEqual, resolveMerge, sameContent } from './merge';
import type { Certificate, CrewMember, SyncRecord, Tables } from './types';

const L = '2026-10-20T00:00:00.000Z';

/** `YYYY-MM-DD` is shorthand for midnight UTC; anything longer is already a full instant. */
const iso = (s: string): string => (s.length === 10 ? `${s}T00:00:00.000Z` : s);

function rec(id: string, updatedAt: string, patch: Partial<CrewMember> = {}): CrewMember {
  return {
    id, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: iso(updatedAt), updatedBy: 'dev-A', deleted: false, scope: 'ship',
    shipId: 'ship-1', surname: 'Petrović', givenNames: 'Ivan', rank: 'master', nationality: 'Filipino',
    dateOfBirth: '1980-03-14', placeOfBirth: 'Split', passportNo: 'P1234567', passportExpiry: '2030-01-01',
    seamansBookNo: 'SB-998', seamansBookExpiry: '2030-01-01', signOnDate: '2026-06-01', signOnPort: 'Rijeka',
    ...patch,
  };
}

function cert(id: string, updatedAt: string, patch: Partial<Certificate> = {}): Certificate {
  return {
    id, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: iso(updatedAt), updatedBy: 'dev-A', deleted: false, scope: 'ship',
    shipId: 'ship-1', key: 'safety-construction', name: 'Safety Construction', number: 'SC-1', issuedBy: 'Class',
    issueDate: '2025-01-01', remarks: '',
    ...patch,
  };
}

const EMPTY: Tables = { ships: [], crew: [], voyages: [], certificates: [], clockChanges: [] };
const T = (crew: SyncRecord[]): Tables => ({ ...EMPTY, crew });

describe('computeMerge', () => {
  it('adds a record that exists only in the file', () => {
    const plan = computeMerge(T([]), T([rec('a', '2026-10-22')]), L);
    expect(plan.summary).toEqual({ added: 1, updated: 0, deleted: 0, conflicts: 0 });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({ table: 'crew', id: 'a', kind: 'add' });
    expect(plan.items[0].local).toBeUndefined();
  });

  it('adds an incoming tombstone that is not present locally, without counting it as added', () => {
    const tomb = computeMerge(T([]), T([rec('a', '2026-10-22', { deleted: true })]), L);
    expect(tomb.items[0].kind).toBe('add');
    expect(tomb.summary.added).toBe(0);
    expect(tomb.summary).toEqual({ added: 0, updated: 0, deleted: 0, conflicts: 0 });
  });

  it('produces no item for a record that exists only locally', () => {
    expect(computeMerge(T([rec('a', '2026-10-22')]), T([]), L).items).toEqual([]);
  });

  it('skips records whose content is identical even when updatedAt differs', () => {
    expect(computeMerge(T([rec('a', '2026-10-19')]), T([rec('a', '2026-10-22')]), L).items).toEqual([]);
  });

  it('updates when only the file changed since lastSync', () => {
    const upd = computeMerge(T([rec('a', '2026-10-19')]), T([rec('a', '2026-10-22', { nationality: 'Croatian' })]), L);
    expect(upd.items[0]).toMatchObject({ table: 'crew', id: 'a', kind: 'update' });
    expect(upd.items[0].local).toMatchObject({ nationality: 'Filipino' });
    expect(upd.items[0].incoming).toMatchObject({ nationality: 'Croatian' });
    expect(upd.summary).toEqual({ added: 0, updated: 1, deleted: 0, conflicts: 0 });
  });

  it('keeps the local record when only the local side changed since lastSync', () => {
    expect(
      computeMerge(T([rec('a', '2026-10-22', { nationality: 'Croatian' })]), T([rec('a', '2026-10-19')]), L).items,
    ).toEqual([]);
  });

  it('flags a conflict when both sides changed since lastSync', () => {
    const plan = computeMerge(
      T([rec('a', '2026-10-21', { nationality: 'A' })]),
      T([rec('a', '2026-10-22', { nationality: 'B' })]),
      L,
    );
    expect(plan.items[0]).toMatchObject({ table: 'crew', id: 'a', kind: 'conflict' });
    expect(plan.items[0].local).toMatchObject({ nationality: 'A' });
    expect(plan.items[0].incoming).toMatchObject({ nationality: 'B' });
    expect(plan.summary).toEqual({ added: 0, updated: 0, deleted: 0, conflicts: 1 });
  });

  it('lets the newer updatedAt win when neither side changed since lastSync', () => {
    const newerIncoming = computeMerge(
      T([rec('a', '2026-10-18', { nationality: 'A' })]),
      T([rec('a', '2026-10-19', { nationality: 'B' })]),
      L,
    );
    expect(newerIncoming.items[0].kind).toBe('update');
    const newerLocal = computeMerge(
      T([rec('a', '2026-10-19', { nationality: 'A' })]),
      T([rec('a', '2026-10-18', { nationality: 'B' })]),
      L,
    );
    expect(newerLocal.items).toEqual([]);
  });

  it('keeps the local record when neither side changed and the timestamps tie', () => {
    expect(
      computeMerge(
        T([rec('a', '2026-10-19', { nationality: 'A' })]),
        T([rec('a', '2026-10-19', { nationality: 'B' })]),
        L,
      ).items,
    ).toEqual([]);
  });

  it('classifies an incoming tombstone over a live local record as a delete', () => {
    const del = computeMerge(T([rec('a', '2026-10-19')]), T([rec('a', '2026-10-22', { deleted: true })]), L);
    expect(del.items[0].kind).toBe('delete');
    expect(del.summary).toEqual({ added: 0, updated: 0, deleted: 1, conflicts: 0 });
  });

  it('treats a changed tombstone over an already deleted local record as an update, not a deletion', () => {
    const plan = computeMerge(
      T([rec('a', '2026-10-19', { deleted: true })]),
      T([rec('a', '2026-10-22', { deleted: true, signOffPort: 'Split' })]),
      L,
    );
    expect(plan.items[0].kind).toBe('update');
    expect(plan.summary.deleted).toBe(0);
  });

  it('updates a locally deleted record when the file has it live and newer', () => {
    const plan = computeMerge(T([rec('a', '2026-10-19', { deleted: true })]), T([rec('a', '2026-10-22')]), L);
    expect(plan.items[0].kind).toBe('update');
  });

  it('flags a conflict when one side deleted and the other edited, both since lastSync', () => {
    const plan = computeMerge(
      T([rec('a', '2026-10-21', { nationality: 'A' })]),
      T([rec('a', '2026-10-22', { deleted: true })]),
      L,
    );
    expect(plan.items[0].kind).toBe('conflict');
  });

  it('treats both sides as changed when lastSync is undefined', () => {
    const plan = computeMerge(
      T([rec('a', '2026-10-19', { nationality: 'A' })]),
      T([rec('a', '2026-10-18', { nationality: 'B' })]),
      undefined,
    );
    expect(plan.items[0].kind).toBe('conflict');
  });

  it('treats an unparseable lastSync like a missing one', () => {
    const plan = computeMerge(
      T([rec('a', '2026-10-19', { nationality: 'A' })]),
      T([rec('a', '2026-10-18', { nationality: 'B' })]),
      'not a date',
    );
    expect(plan.items[0].kind).toBe('conflict');
  });

  it('still adds new records and skips identical ones when lastSync is undefined', () => {
    const plan = computeMerge(
      T([rec('same', '2026-10-19')]),
      T([rec('same', '2026-10-22'), rec('new', '2026-10-22')]),
      undefined,
    );
    expect(plan.items.map((i) => [i.id, i.kind])).toEqual([['new', 'add']]);
  });

  it('compares timestamps as instants, not as strings', () => {
    // Local 2026-10-20T01:00+02:00 is 2026-10-19T23:00Z: before lastSync, although it sorts after it as a string.
    const plan = computeMerge(
      T([rec('a', '2026-10-20T01:00:00+02:00', { nationality: 'A' })]),
      T([rec('a', '2026-10-20T00:30:00.000Z', { nationality: 'B' })]),
      L,
    );
    expect(plan.items[0].kind).toBe('update');
  });

  it('does not count a side as changed when updatedAt equals lastSync', () => {
    const plan = computeMerge(
      T([rec('a', L, { nationality: 'A' })]),
      T([rec('a', '2026-10-22', { nationality: 'B' })]),
      L,
    );
    expect(plan.items[0].kind).toBe('update');
  });

  it('flags a conflict rather than guessing when an updatedAt cannot be parsed', () => {
    const plan = computeMerge(
      T([rec('a', 'garbage', { nationality: 'A' })]),
      T([rec('a', '2026-10-22', { nationality: 'B' })]),
      L,
    );
    expect(plan.items[0].kind).toBe('conflict');
  });

  it('orders items by table, then by the incoming order', () => {
    const local: Tables = { ...EMPTY, crew: [rec('b', '2026-10-19')] };
    const incoming: Tables = {
      ...EMPTY,
      certificates: [cert('k1', '2026-10-22')],
      crew: [rec('c', '2026-10-22'), rec('a', '2026-10-22'), rec('b', '2026-10-22', { nationality: 'Croatian' })],
    };
    const plan = computeMerge(local, incoming, L);
    expect(plan.items.map((i) => `${i.table}:${i.id}:${i.kind}`)).toEqual([
      'crew:c:add',
      'crew:a:add',
      'crew:b:update',
      'certificates:k1:add',
    ]);
  });

  it('treats a table key missing from either side as empty', () => {
    const incomingOnlyCrew = { crew: [rec('a', '2026-10-22')] } as unknown as Tables;
    const localOnlyCrew = { crew: [rec('b', '2026-10-22')] } as unknown as Tables;
    expect(computeMerge(localOnlyCrew, incomingOnlyCrew, L).items.map((i) => i.id)).toEqual(['a']);
    const withCerts: Tables = { ...EMPTY, certificates: [cert('k1', '2026-10-22')] };
    const plan = computeMerge({ crew: [] } as unknown as Tables, withCerts, L);
    expect(plan.items.map((i) => `${i.table}:${i.id}`)).toEqual(['certificates:k1']);
    expect(computeMerge(EMPTY, {} as unknown as Tables, L).items).toEqual([]);
  });

  it('is idempotent: merging a file whose content is already applied yields no items', () => {
    const file = T([rec('a', '2026-10-22'), rec('b', '2026-10-22', { deleted: true })]);
    const first = computeMerge(T([]), file, L);
    expect(first.items).toHaveLength(2);
    const applied = T(resolveMerge(first, { conflicts: {}, applyDeletions: true }, 'x', 'd').map((r) => r.record));
    expect(computeMerge(applied, file, L).items).toEqual([]);
  });

  it('does not mutate its inputs', () => {
    const local = T([rec('a', '2026-10-21', { nationality: 'A' })]);
    const incoming = T([rec('a', '2026-10-22', { nationality: 'B' }), rec('n', '2026-10-22')]);
    const before = JSON.stringify([local, incoming]);
    computeMerge(local, incoming, L);
    expect(JSON.stringify([local, incoming])).toBe(before);
  });
});

describe('sameContent', () => {
  it('ignores updatedAt and updatedBy', () => {
    expect(sameContent(rec('a', '2026-10-19'), { ...rec('a', '2026-10-22'), updatedBy: 'dev-B' })).toBe(true);
  });

  it('detects a difference in any other field', () => {
    expect(sameContent(rec('a', '2026-10-19'), rec('a', '2026-10-19', { nationality: 'Croatian' }))).toBe(false);
    expect(sameContent(rec('a', '2026-10-19'), rec('a', '2026-10-19', { deleted: true }))).toBe(false);
    expect(sameContent(rec('a', '2026-10-19'), rec('a', '2026-10-19', { createdAt: '2026-02-01T00:00:00.000Z' }))).toBe(false);
  });

  it('does not depend on property order', () => {
    const a = rec('a', '2026-10-19');
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as unknown as CrewMember;
    expect(Object.keys(reordered)[0]).not.toBe(Object.keys(a)[0]);
    expect(sameContent(a, reordered)).toBe(true);
  });

  it('counts an undefined property the same as an absent one', () => {
    const a = rec('a', '2026-10-19');
    expect(sameContent(a, { ...a, signOffDate: undefined })).toBe(true);
    expect(sameContent({ ...a, rankOther: undefined }, a)).toBe(true);
    expect(sameContent(a, { ...a, signOffDate: '2026-12-01' })).toBe(false);
    expect(sameContent(a, { ...a, signOffDate: '' })).toBe(false);
  });

  it('compares nested objects and arrays deeply', () => {
    const ship = (particulars: object, mapping?: object) =>
      ({
        id: 's', createdAt: iso('2026-01-01'), updatedAt: iso('2026-10-19'), updatedBy: 'd', deleted: false, scope: 'ship',
        particulars, crewImportMapping: mapping,
      }) as unknown as SyncRecord;
    const p1 = { name: 'Ocean Star', imo: '1234567', gt: 5000 };
    expect(sameContent(ship(p1), ship({ gt: 5000, imo: '1234567', name: 'Ocean Star' }))).toBe(true);
    expect(sameContent(ship(p1), ship({ ...p1, gt: 5001 }))).toBe(false);
    expect(sameContent(ship(p1), ship({ ...p1, nt: undefined }))).toBe(true);
    expect(sameContent(ship(p1, { byHeader: { a: 'surname' } }), ship(p1, { byHeader: { a: 'rank' } }))).toBe(false);
    expect(sameContent(ship({ ...p1, tags: ['a', 'b'] }), ship({ ...p1, tags: ['a', 'b'] }))).toBe(true);
    expect(sameContent(ship({ ...p1, tags: ['a', 'b'] }), ship({ ...p1, tags: ['b', 'a'] }))).toBe(false);
    expect(sameContent(ship({ ...p1, tags: ['a'] }), ship({ ...p1, tags: { 0: 'a' } }))).toBe(false);
  });
});

describe('deepEqual', () => {
  it('compares objects whatever the order of their keys, and arrays by position', () => {
    expect(deepEqual({ a: 1, b: { c: [1, 2], d: 'x' } }, { b: { d: 'x', c: [1, 2] }, a: 1 })).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it('takes a missing key for one that is undefined, and tells values of different types apart', () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(deepEqual('1', 1)).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual(undefined, undefined)).toBe(true);
  });
});

describe('conflictKey', () => {
  it('is table:id', () => {
    const plan = computeMerge(T([rec('a', '2026-10-21', { nationality: 'A' })]), T([rec('a', '2026-10-22', { nationality: 'B' })]), L);
    expect(conflictKey(plan.items[0])).toBe('crew:a');
  });
});

describe('resolveMerge', () => {
  const NOW = '2026-10-25T10:00:00.000Z';
  const cp = computeMerge(
    T([rec('a', '2026-10-21', { nationality: 'A' })]),
    T([rec('a', '2026-10-22', { nationality: 'B' })]),
    L,
  );
  const del = computeMerge(T([rec('a', '2026-10-19')]), T([rec('a', '2026-10-22', { deleted: true })]), L);

  it('keeps the local side of a conflict, stamped with now and this device', () => {
    const out = resolveMerge(cp, { conflicts: { 'crew:a': 'local' }, applyDeletions: false }, NOW, 'dev-B');
    expect(out).toHaveLength(1);
    expect(out[0].table).toBe('crew');
    expect(out[0].record).toMatchObject({ id: 'a', nationality: 'A', updatedAt: NOW, updatedBy: 'dev-B' });
  });

  it('takes the incoming side of a conflict, stamped with now and this device', () => {
    const out = resolveMerge(cp, { conflicts: { 'crew:a': 'incoming' }, applyDeletions: false }, NOW, 'dev-B');
    expect(out[0].record).toMatchObject({ id: 'a', nationality: 'B', updatedAt: NOW, updatedBy: 'dev-B' });
  });

  it('does not mutate the plan when stamping a conflict', () => {
    const before = JSON.stringify(cp);
    resolveMerge(cp, { conflicts: { 'crew:a': 'local' }, applyDeletions: true }, NOW, 'dev-B');
    resolveMerge(cp, { conflicts: { 'crew:a': 'incoming' }, applyDeletions: true }, NOW, 'dev-B');
    expect(JSON.stringify(cp)).toBe(before);
    expect(cp.items[0].local?.updatedAt).toBe(iso('2026-10-21'));
    expect(cp.items[0].incoming.updatedAt).toBe(iso('2026-10-22'));
  });

  it('returns the incoming record unchanged for add, update and delete', () => {
    const plan = computeMerge(
      T([rec('u', '2026-10-19'), rec('d', '2026-10-19')]),
      T([rec('n', '2026-10-22'), rec('u', '2026-10-22', { nationality: 'Croatian' }), rec('d', '2026-10-22', { deleted: true })]),
      L,
    );
    expect(plan.items.map((i) => i.kind)).toEqual(['add', 'update', 'delete']);
    const out = resolveMerge(plan, { conflicts: {}, applyDeletions: true }, NOW, 'dev-B');
    expect(out).toEqual(plan.items.map((i) => ({ table: 'crew', record: i.incoming })));
    expect(out[0].record.updatedAt).toBe(iso('2026-10-22'));
    expect(out[0].record.updatedBy).toBe('dev-A');
  });

  it('leaves deletions out unless applyDeletions is set', () => {
    expect(resolveMerge(del, { conflicts: {}, applyDeletions: false }, 'x', 'd')).toEqual([]);
    expect(resolveMerge(del, { conflicts: {}, applyDeletions: true }, 'x', 'd')).toHaveLength(1);
  });

  it('keeps adds and updates when deletions are left out', () => {
    const plan = computeMerge(
      T([rec('u', '2026-10-19'), rec('d', '2026-10-19')]),
      T([rec('n', '2026-10-22'), rec('u', '2026-10-22', { nationality: 'Croatian' }), rec('d', '2026-10-22', { deleted: true })]),
      L,
    );
    const out = resolveMerge(plan, { conflicts: {}, applyDeletions: false }, NOW, 'dev-B');
    expect(out.map((o) => o.record.id)).toEqual(['n', 'u']);
  });

  it('applies the chosen conflict side even when it is a tombstone and deletions are left out', () => {
    const plan = computeMerge(
      T([rec('a', '2026-10-21', { nationality: 'A' })]),
      T([rec('a', '2026-10-22', { deleted: true })]),
      L,
    );
    const out = resolveMerge(plan, { conflicts: { 'crew:a': 'incoming' }, applyDeletions: false }, NOW, 'dev-B');
    expect(out[0].record).toMatchObject({ deleted: true, updatedAt: NOW, updatedBy: 'dev-B' });
  });

  it('throws on an unresolved conflict', () => {
    expect(() => resolveMerge(cp, { conflicts: {}, applyDeletions: true }, 'x', 'd')).toThrow('Unresolved conflict: crew:a');
    expect(() => resolveMerge(cp, { conflicts: { 'crew:other': 'local' }, applyDeletions: true }, 'x', 'd')).toThrow(
      'Unresolved conflict: crew:a',
    );
  });

  it('returns nothing for an empty plan', () => {
    const empty = computeMerge(EMPTY, EMPTY, L);
    expect(empty).toEqual({ items: [], summary: { added: 0, updated: 0, deleted: 0, conflicts: 0 } });
    expect(resolveMerge(empty, { conflicts: {}, applyDeletions: true }, NOW, 'd')).toEqual([]);
  });
});
