import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportPlan } from '../domain/crewImport/plan';
import type { CrewDraft, CrewImportMapping, CrewMember, ShipProfile } from '../domain/types';
import { importCrew } from './crewImport';
import { createRecord, listForShip } from './records';
import { openDb } from './schema';
import { createShip } from './ships';
import { listSnapshots } from './snapshots';
import { StorageFullError } from './storage';

const draft: CrewDraft = {
  surname: 'Petrović', givenNames: 'Ivan', rank: 'master', nationality: 'Croatian', dateOfBirth: '1980-03-14',
  placeOfBirth: 'Split', passportNo: 'P1234567', passportExpiry: '2030-01-01', seamansBookNo: 'SB-998',
  seamansBookExpiry: '2030-01-01', signOnDate: '2026-06-01', signOnPort: 'Rijeka',
};
const mapping: CrewImportMapping = { byHeader: { surname: 'surname', givennames: 'givenNames' }, dateFormat: 'day-first' };

function freshDb() {
  return openDb('t-' + crypto.randomUUID());
}

async function setup() {
  const db = freshDb();
  const ship = await createShip(db, 'MV OCEAN STAR', 0);
  const ivan = await createRecord<CrewMember>(db, 'crew', { shipId: ship.id, ...draft, signOffDate: '2026-09-01', signOffPort: 'Koper' });
  return { db, ship, ivan };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('importCrew', () => {
  it('takes a before-import snapshot of the crew as it was, named after the file, then writes', async () => {
    const { db, ship } = await setup();
    const plan: ImportPlan = { creates: [{ ...draft, surname: 'Šašić', passportNo: 'P77' }], updates: [] };
    await importCrew(db, ship, plan, mapping, 'crew.xlsx');
    const [snapshot] = await listSnapshots(db);
    expect(snapshot).toMatchObject({ reason: 'before-import', note: 'crew.xlsx', counts: { crew: 1 } });
    expect((await db.crew.toArray())).toHaveLength(2);
  });

  it('creates the new contracts on the ship, as ordinary records', async () => {
    const { db, ship } = await setup();
    await importCrew(db, ship, { creates: [{ ...draft, surname: 'Šašić', passportNo: 'P77' }, { ...draft, surname: "O'Brien", passportNo: 'X1' }], updates: [] }, mapping, 'crew.xlsx');
    const crew = await listForShip<CrewMember>(db, 'crew', ship.id);
    expect(crew.map(m => m.surname).sort()).toEqual(["O'Brien", 'Petrović', 'Šašić']);
    expect(crew.find(m => m.surname === 'Šašić')).toMatchObject({ shipId: ship.id, deleted: false, scope: 'ship', passportNo: 'P77' });
  });

  it('updates the changed fields only and stamps the record', async () => {
    const { db, ship, ivan } = await setup();
    await importCrew(db, ship, { creates: [], updates: [{ id: ivan.id, patch: { passportExpiry: '2031-01-01', signOffDate: undefined } }] }, mapping, 'crew.xlsx');
    const saved = await db.crew.get(ivan.id);
    const { signOffDate: _removed, ...rest } = ivan;
    expect(saved).toEqual({ ...rest, passportExpiry: '2031-01-01', updatedAt: saved?.updatedAt });
    expect(saved).not.toHaveProperty('signOffDate');
    expect(saved?.signOffPort).toBe('Koper');
    expect(saved?.updatedAt).not.toBe(ivan.updatedAt);
  });

  it('saves the mapping with the ship, keeping the rest of the ship record', async () => {
    const { db, ship } = await setup();
    await importCrew(db, ship, { creates: [], updates: [] }, mapping, 'crew.xlsx');
    const saved = await db.ships.get(ship.id) as ShipProfile;
    expect(saved).toEqual({ ...ship, crewImportMapping: mapping, updatedAt: saved.updatedAt });
  });

  it('writes nothing at all when one write fails: no new contracts, no changes, no mapping', async () => {
    const { db, ship, ivan } = await setup();
    const plan: ImportPlan = {
      creates: [{ ...draft, surname: 'Šašić', passportNo: 'P77' }],
      updates: [{ id: ivan.id, patch: { rank: 'ab' } }, { id: 'missing', patch: { rank: 'ab' } }],
    };
    await expect(importCrew(db, ship, plan, mapping, 'crew.xlsx')).rejects.toThrow(/missing/);
    expect(await db.crew.toArray()).toEqual([ivan]);
    expect(await db.ships.get(ship.id)).toEqual(ship);
  });

  it('keeps the snapshot when the writes fail, so the user still has the state before the attempt', async () => {
    const { db, ship } = await setup();
    await expect(importCrew(db, ship, { creates: [], updates: [{ id: 'missing', patch: {} }] }, mapping, 'crew.xlsx')).rejects.toThrow();
    expect(await listSnapshots(db)).toHaveLength(1);
  });

  it('reports a full disk as such, and writes nothing', async () => {
    const { db, ship, ivan } = await setup();
    vi.spyOn(db.crew, 'put').mockRejectedValue(Object.assign(new Error('full'), { name: 'QuotaExceededError' }));
    await expect(importCrew(db, ship, { creates: [{ ...draft, passportNo: 'P77' }], updates: [] }, mapping, 'crew.xlsx')).rejects.toBeInstanceOf(StorageFullError);
    expect(await db.crew.toArray()).toEqual([ivan]);
  });

  it('returns how many contracts it wrote', async () => {
    const { db, ship, ivan } = await setup();
    const count = await importCrew(db, ship, { creates: [{ ...draft, passportNo: 'P77' }], updates: [{ id: ivan.id, patch: { rank: 'ab' } }] }, mapping, 'crew.xlsx');
    expect(count).toBe(2);
  });
});
