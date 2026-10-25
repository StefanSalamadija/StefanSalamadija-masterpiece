import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Certificate, ClockChange, CrewDraft, CrewMember, ShipProfile, Voyage } from '../domain/types';
import { allTables, createRecord, listForShip, softDelete, updateRecord } from './records';
import { openDb } from './schema';
import { getSettings, updateSettings } from './settings';
import { copyShip, createShip, deleteShip, deleteSummary, listShips, liveActiveShipId } from './ships';
import { StorageFullError } from './storage';

const draft: CrewDraft = {
  surname: 'Petrović', givenNames: 'Ivan', rank: 'master', nationality: 'Croatian', dateOfBirth: '1980-03-14',
  placeOfBirth: 'Split', passportNo: 'P1234567', passportExpiry: '2030-01-01', seamansBookNo: 'SB-998',
  seamansBookExpiry: '2030-01-01', signOnDate: '2026-06-01', signOnPort: 'Rijeka',
};

const loadLine = (shipId: string) => ({
  shipId, key: 'loadLine', name: 'International Load Line', number: 'LL-1', issuedBy: 'DNV',
  issueDate: '2024-03-15', expiryDate: '2029-03-14', nextSurveyDue: '2027-03-14', remarks: 'Annual done',
});

function freshDb() {
  return openDb('t-' + crypto.randomUUID());
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createShip', () => {
  it('creates the ship with blank particulars and its first clock change', async () => {
    const db = freshDb();
    const { deviceId } = await getSettings(db);
    const ship = await createShip(db, 'MV OCEAN STAR', 180, new Date('2026-10-25T08:00:00Z'));
    expect(ship).toMatchObject({ deleted: false, scope: 'ship', updatedBy: deviceId });
    expect(ship.particulars).toEqual({
      name: 'MV OCEAN STAR', imo: '', callSign: '', mmsi: '', flag: '', portOfRegistry: '',
      owners: '', managers: '', pandi: '', classSociety: '',
    });
    const changes = await db.clockChanges.where('shipId').equals(ship.id).toArray();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ toOffsetMinutes: 180, effectiveAt: '2026-10-25T08:00:00.000Z', deleted: false });
    expect(await db.ships.get(ship.id)).toEqual(ship);
  });

  it('makes the first ship active and leaves the active ship alone after that', async () => {
    const db = freshDb();
    const first = await createShip(db, 'MV OCEAN STAR', 180);
    expect((await getSettings(db)).activeShipId).toBe(first.id);
    await createShip(db, 'MV SEA BREEZE', 0);
    expect((await getSettings(db)).activeShipId).toBe(first.id);
  });

  it('makes the new ship active when the active ship no longer exists or was deleted', async () => {
    const db = freshDb();
    await updateSettings(db, { activeShipId: 'never-existed' });
    const a = await createShip(db, 'A', 0);
    expect((await getSettings(db)).activeShipId).toBe(a.id);
    await softDelete(db, 'ships', a.id); // a direct delete, unlike deleteShip, leaves activeShipId pointing at it
    const b = await createShip(db, 'B', 0);
    expect((await getSettings(db)).activeShipId).toBe(b.id);
  });

  it('defaults the effective time of the first clock change to now', async () => {
    const db = freshDb();
    vi.useFakeTimers({ now: new Date('2026-12-01T10:30:00Z'), toFake: ['Date'] });
    const ship = await createShip(db, 'MV OCEAN STAR', -300);
    expect(await db.clockChanges.where('shipId').equals(ship.id).first()).toMatchObject({
      effectiveAt: '2026-12-01T10:30:00.000Z', toOffsetMinutes: -300,
    });
  });

  it('saves nothing when the clock change cannot be stored', async () => {
    const db = freshDb();
    vi.spyOn(db.clockChanges, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    await expect(createShip(db, 'MV OCEAN STAR', 180)).rejects.toBeInstanceOf(StorageFullError);
    expect(await listShips(db)).toEqual([]);
    expect((await getSettings(db)).activeShipId).toBeUndefined();
  });
});

describe('listShips', () => {
  it('lists live ships oldest first', async () => {
    const db = freshDb();
    vi.useFakeTimers({ now: new Date('2026-10-01T00:00:00Z'), toFake: ['Date'] });
    await createShip(db, 'B SHIP', 0);
    vi.setSystemTime(new Date('2026-10-02T00:00:00Z'));
    const gone = await createShip(db, 'GONE', 0);
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'));
    await createShip(db, 'A SHIP', 0);
    await softDelete(db, 'ships', gone.id);
    expect((await listShips(db)).map((s) => s.particulars.name)).toEqual(['A SHIP', 'B SHIP']);
  });
});

describe('deleteShip', () => {
  async function twoShips() {
    const db = freshDb();
    const a = await createShip(db, 'MV OCEAN STAR', 180);
    const b = await createShip(db, 'MV SEA BREEZE', 0);
    return { db, a, b };
  }

  it('counts what would be removed and then soft-deletes the ship and everything of it', async () => {
    const { db, a, b } = await twoShips();
    await createRecord(db, 'crew', { shipId: a.id, ...draft });
    expect(await deleteSummary(db, a.id)).toEqual({ crew: 1, certificates: 0, voyages: 0, clockChanges: 1 });
    await deleteShip(db, a.id);
    expect((await listShips(db)).map((s) => s.particulars.name)).toEqual(['MV SEA BREEZE']);
    expect((await getSettings(db)).activeShipId).toBe(b.id);
  });

  it('tombstones every record of the ship, stamped with the time and device, and nothing of other ships', async () => {
    const { db, a, b } = await twoShips();
    const { deviceId } = await getSettings(db);
    await createRecord(db, 'crew', { shipId: a.id, ...draft });
    await createRecord<Certificate>(db, 'certificates', loadLine(a.id));
    await createRecord<Voyage>(db, 'voyages', {
      shipId: a.id, active: true, voyageNo: '12', lastPort: 'Rijeka', nextPort: 'Trieste', etaLocal: '2026-10-27T06:00',
      etaOffsetMinutes: 60, cargo: '', charterers: '', agents: '',
    });
    await createRecord(db, 'crew', { shipId: b.id, ...draft });
    const otherBefore = await allTables(db);

    vi.useFakeTimers({ now: new Date('2026-11-05T09:00:00Z'), toFake: ['Date'] });
    await deleteShip(db, a.id);
    vi.useRealTimers();

    const t = await allTables(db);
    const ofA = (r: { id: string; shipId?: string }) => r.id === a.id || r.shipId === a.id;
    for (const name of ['ships', 'crew', 'voyages', 'certificates', 'clockChanges'] as const) {
      for (const r of t[name].filter(ofA)) {
        expect(r, name).toMatchObject({ deleted: true, updatedAt: '2026-11-05T09:00:00.000Z', updatedBy: deviceId });
      }
    }
    expect(t.ships.filter(ofA)).toHaveLength(1);
    expect(t.crew.filter(ofA)).toHaveLength(1);
    expect(t.certificates.filter(ofA)).toHaveLength(1);
    expect(t.voyages.filter(ofA)).toHaveLength(1);
    expect(t.clockChanges.filter(ofA)).toHaveLength(1);
    // The other ship and its records are exactly as they were.
    for (const name of ['ships', 'crew', 'voyages', 'certificates', 'clockChanges'] as const) {
      expect(t[name].filter((r) => !ofA(r))).toEqual(otherBefore[name].filter((r) => !ofA(r)));
    }
    expect(await deleteSummary(db, a.id)).toEqual({ crew: 0, certificates: 0, voyages: 0, clockChanges: 0 });
  });

  it('keeps the original deletion time of records that were already deleted', async () => {
    const { db, a } = await twoShips();
    const c = await createRecord<CrewMember>(db, 'crew', { shipId: a.id, ...draft });
    vi.useFakeTimers({ now: new Date('2026-10-30T00:00:00Z'), toFake: ['Date'] });
    await softDelete(db, 'crew', c.id);
    vi.setSystemTime(new Date('2026-11-05T09:00:00Z'));
    await deleteShip(db, a.id);
    expect((await db.crew.get(c.id))?.updatedAt).toBe('2026-10-30T00:00:00.000Z');
  });

  it('counts only live records in the summary', async () => {
    const { db, a } = await twoShips();
    const c = await createRecord(db, 'crew', { shipId: a.id, ...draft });
    await createRecord(db, 'crew', { shipId: a.id, ...draft });
    await softDelete(db, 'crew', c.id);
    expect((await deleteSummary(db, a.id)).crew).toBe(1);
  });

  it('keeps the active ship when another ship is deleted', async () => {
    const { db, a, b } = await twoShips();
    await deleteShip(db, b.id);
    expect((await getSettings(db)).activeShipId).toBe(a.id);
  });

  it('moves the active ship to the first remaining ship, oldest first', async () => {
    const db = freshDb();
    vi.useFakeTimers({ now: new Date('2026-10-01T00:00:00Z'), toFake: ['Date'] });
    const a = await createShip(db, 'A', 0);
    vi.setSystemTime(new Date('2026-10-02T00:00:00Z'));
    const b = await createShip(db, 'B', 0);
    vi.setSystemTime(new Date('2026-10-03T00:00:00Z'));
    await createShip(db, 'C', 0);
    await deleteShip(db, a.id);
    expect((await getSettings(db)).activeShipId).toBe(b.id);
  });

  it('also moves an active ship that already pointed at a ship that is gone', async () => {
    const { db, a, b } = await twoShips();
    await updateSettings(db, { activeShipId: 'never-existed' });
    await deleteShip(db, b.id);
    expect((await getSettings(db)).activeShipId).toBe(a.id);
  });

  it('leaves no active ship when the last ship is deleted', async () => {
    const db = freshDb();
    const a = await createShip(db, 'MV OCEAN STAR', 180);
    await deleteShip(db, a.id);
    expect(await listShips(db)).toEqual([]);
    expect((await getSettings(db)).activeShipId).toBeUndefined();
  });

  it('rejects a ship that does not exist and changes nothing', async () => {
    const { db } = await twoShips();
    const before = await allTables(db);
    await expect(deleteShip(db, 'missing')).rejects.toThrow(/missing/);
    expect(await allTables(db)).toEqual(before);
  });

  it('saves nothing when storage fills up halfway', async () => {
    const { db, a } = await twoShips();
    await createRecord(db, 'crew', { shipId: a.id, ...draft });
    const before = await allTables(db);
    vi.spyOn(db.clockChanges, 'bulkPut').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    await expect(deleteShip(db, a.id)).rejects.toBeInstanceOf(StorageFullError);
    expect(await allTables(db)).toEqual(before);
    expect((await getSettings(db)).activeShipId).toBe(a.id);
  });
});

describe('copyShip', () => {
  async function source() {
    const db = freshDb();
    const src = await createShip(db, 'MV OCEAN STAR', 180);
    await updateRecord<ShipProfile>(db, 'ships', src.id, { particulars: { ...src.particulars, imo: '9074729', loa: 229 } });
    await createRecord<Certificate>(db, 'certificates', loadLine(src.id));
    await createRecord(db, 'crew', { shipId: src.id, ...draft });
    return { db, src };
  }

  it('copies the particulars without the identity, the certificate names, and the current clock offset', async () => {
    const { db, src } = await source();
    const cp = await copyShip(db, src.id, 'MV OCEAN PEARL', { includeCertificates: true });
    expect(cp.id).not.toBe(src.id);
    expect(cp.particulars).toMatchObject({ name: 'MV OCEAN PEARL', imo: '', loa: 229 });
    expect((await listShips(db)).map((s) => s.particulars.name).sort()).toEqual(['MV OCEAN PEARL', 'MV OCEAN STAR']);
    expect(await listForShip(db, 'crew', cp.id)).toEqual([]);
    expect(await listForShip(db, 'voyages', cp.id)).toEqual([]);
    expect(await listForShip<Certificate>(db, 'certificates', cp.id)).toHaveLength(1);
    expect((await listForShip<Certificate>(db, 'certificates', cp.id))[0])
      .toMatchObject({ key: 'loadLine', name: 'International Load Line', number: '', issuedBy: '', issueDate: '', remarks: '', expiryDate: undefined, nextSurveyDue: undefined, shipId: cp.id });
    expect((await listForShip<ClockChange>(db, 'clockChanges', cp.id))[0].toOffsetMinutes).toBe(180);
  });

  it('leaves the source ship untouched', async () => {
    const { db, src } = await source();
    const before = await allTables(db);
    const cp = await copyShip(db, src.id, 'MV OCEAN PEARL', { includeCertificates: true });
    const after = await allTables(db);
    for (const name of ['ships', 'crew', 'voyages', 'certificates', 'clockChanges'] as const) {
      expect(after[name].filter((r) => r.id !== cp.id && (r as { shipId?: string }).shipId !== cp.id)).toEqual(before[name]);
    }
  });

  it('adds no certificates unless asked', async () => {
    const { db, src } = await source();
    const cp = await copyShip(db, src.id, 'MV OCEAN PEARL', { includeCertificates: false });
    expect(await listForShip(db, 'certificates', cp.id)).toEqual([]);
  });

  it('skips certificates that were deleted on the source', async () => {
    const { db, src } = await source();
    const extra = await createRecord<Certificate>(db, 'certificates', { ...loadLine(src.id), key: 'ism', name: 'ISM Certificate' });
    await softDelete(db, 'certificates', extra.id);
    const cp = await copyShip(db, src.id, 'MV OCEAN PEARL', { includeCertificates: true });
    expect((await listForShip<Certificate>(db, 'certificates', cp.id)).map((c) => c.key)).toEqual(['loadLine']);
  });

  it('never copies the crew import mapping or the clock history', async () => {
    const { db, src } = await source();
    await updateRecord<ShipProfile>(db, 'ships', src.id, {
      crewImportMapping: { byHeader: { Surname: 'surname' }, dateFormat: 'day-first' },
    });
    await createRecord<ClockChange>(db, 'clockChanges', {
      shipId: src.id, effectiveAt: '2020-01-01T00:00:00.000Z', toOffsetMinutes: 60,
    });
    const cp = await copyShip(db, src.id, 'MV OCEAN PEARL', { includeCertificates: false });
    expect(cp.crewImportMapping).toBeUndefined();
    expect((await db.ships.get(cp.id))?.crewImportMapping).toBeUndefined();
    expect(await listForShip<ClockChange>(db, 'clockChanges', cp.id)).toHaveLength(1);
  });

  it('takes the offset in force now, not the first, a scheduled or an undone one', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-01T00:00:00Z'), toFake: ['Date'] });
    const { db, src } = await source(); // first clock change: +180 from 2026-10-01
    vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
    await createRecord<ClockChange>(db, 'clockChanges', { shipId: src.id, effectiveAt: '2026-10-20T00:00:00.000Z', toOffsetMinutes: 120 });
    await createRecord<ClockChange>(db, 'clockChanges', { shipId: src.id, effectiveAt: '2026-11-01T00:00:00.000Z', toOffsetMinutes: 60 });
    const undone = await createRecord<ClockChange>(db, 'clockChanges', { shipId: src.id, effectiveAt: '2026-10-24T00:00:00.000Z', toOffsetMinutes: 330 });
    await softDelete(db, 'clockChanges', undone.id);
    const cp = await copyShip(db, src.id, 'MV OCEAN PEARL', { includeCertificates: false });
    const [change] = await listForShip<ClockChange>(db, 'clockChanges', cp.id);
    expect(change).toMatchObject({ toOffsetMinutes: 120, effectiveAt: '2026-10-25T12:00:00.000Z' });
  });

  it('rejects a source ship that does not exist or was deleted', async () => {
    const { db, src } = await source();
    await expect(copyShip(db, 'missing', 'X', { includeCertificates: true })).rejects.toThrow(/missing/);
    await deleteShip(db, src.id);
    await expect(copyShip(db, src.id, 'X', { includeCertificates: true })).rejects.toThrow(/ship/i);
    expect(await listShips(db)).toEqual([]);
  });

  it('makes the copy the active ship only when there was none', async () => {
    const { db, src } = await source();
    await copyShip(db, src.id, 'MV OCEAN PEARL', { includeCertificates: false });
    expect((await getSettings(db)).activeShipId).toBe(src.id);
    await updateSettings(db, { activeShipId: undefined });
    const cp = await copyShip(db, src.id, 'MV OCEAN GEM', { includeCertificates: false });
    expect((await getSettings(db)).activeShipId).toBe(cp.id);
  });

  it('makes the copy active when the active ship was deleted', async () => {
    const db = freshDb();
    const active = await createShip(db, 'MV OLD', 0);
    const src = await createShip(db, 'MV OCEAN STAR', 180);
    await softDelete(db, 'ships', active.id);
    const cp = await copyShip(db, src.id, 'MV OCEAN PEARL', { includeCertificates: false });
    expect((await getSettings(db)).activeShipId).toBe(cp.id);
  });

  it('saves nothing when storage fills up while copying the certificates', async () => {
    const { db, src } = await source();
    const before = await allTables(db);
    vi.spyOn(db.certificates, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    await expect(copyShip(db, src.id, 'MV OCEAN PEARL', { includeCertificates: true })).rejects.toBeInstanceOf(StorageFullError);
    expect(await allTables(db)).toEqual(before);
  });
});

describe('liveActiveShipId', () => {
  // only `id` is read, so bare records are enough
  const ships = (...ids: string[]) => ids.map((id) => ({ id }) as ShipProfile);

  it('keeps the active ship when it is in the list', () => {
    expect(liveActiveShipId('b', ships('a', 'b', 'c'))).toBe('b');
  });

  it('takes the first ship when none is active', () => {
    expect(liveActiveShipId(undefined, ships('a', 'b'))).toBe('a');
  });

  it('takes the first ship when the active one is not in the list (missing or deleted)', () => {
    expect(liveActiveShipId('gone', ships('a', 'b'))).toBe('a');
  });

  it('is undefined when there is no ship at all, whatever was active', () => {
    expect(liveActiveShipId(undefined, [])).toBeUndefined();
    expect(liveActiveShipId('gone', [])).toBeUndefined();
  });
});
