import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VoyageFields } from '../domain/voyage';
import type { Voyage } from '../domain/types';
import { createRecord, listForShip } from './records';
import { openDb } from './schema';
import { getSettings } from './settings';
import { StorageFullError } from './storage';
import { saveCurrentVoyage, startNewVoyage } from './voyages';

afterEach(() => {
  vi.restoreAllMocks();
});

const fields = (over: Partial<VoyageFields> = {}): VoyageFields => ({
  voyageNo: 'V-2611', lastPort: 'Santos', nextPort: 'Rotterdam', etaLocal: '2026-11-02T14:30', etaOffsetMinutes: 60,
  cargo: 'Soybeans', charterers: 'ADM', agents: 'Wilhelmsen Rotterdam', ...over,
});

const freshDb = () => openDb('t-' + crypto.randomUUID());
const voyagesOf = (db: ReturnType<typeof openDb>, shipId: string) => db.voyages.where('shipId').equals(shipId).toArray();

describe('saveCurrentVoyage', () => {
  it('creates an active voyage when the ship has none', async () => {
    const db = freshDb();
    const { deviceId } = await getSettings(db);
    const saved = await saveCurrentVoyage(db, 'ship-1', fields());
    expect(saved).toMatchObject({ shipId: 'ship-1', active: true, deleted: false, scope: 'ship', updatedBy: deviceId, ...fields() });
    expect(await voyagesOf(db, 'ship-1')).toEqual([saved]);
  });
  it('updates the active voyage when there is one, and does not add another', async () => {
    const db = freshDb();
    const first = await saveCurrentVoyage(db, 'ship-1', fields());
    const second = await saveCurrentVoyage(db, 'ship-1', fields({ nextPort: 'Hamburg', etaLocal: '' }));
    expect(second).toMatchObject({ id: first.id, createdAt: first.createdAt, active: true, nextPort: 'Hamburg', etaLocal: '' });
    expect(await voyagesOf(db, 'ship-1')).toEqual([second]);
  });
  it('does not touch the ended voyages or the voyages of another ship', async () => {
    const db = freshDb();
    const ended = await createRecord<Voyage>(db, 'voyages', { shipId: 'ship-1', active: false, ...fields({ voyageNo: 'V-1' }) });
    const other = await createRecord<Voyage>(db, 'voyages', { shipId: 'ship-2', active: true, ...fields({ voyageNo: 'X-1' }) });
    const saved = await saveCurrentVoyage(db, 'ship-1', fields({ voyageNo: 'V-2' }));
    expect(saved.id).not.toBe(ended.id);
    expect(await db.voyages.get(ended.id)).toEqual(ended);
    expect(await db.voyages.get(other.id)).toEqual(other);
  });
  it('creates one voyage, not two, when two saves race on a ship that has none', async () => {
    const db = freshDb();
    await Promise.all([saveCurrentVoyage(db, 'ship-1', fields()), saveCurrentVoyage(db, 'ship-1', fields({ cargo: 'Corn' }))]);
    const stored = await voyagesOf(db, 'ship-1');
    expect(stored).toHaveLength(1);
    expect(stored[0].cargo).toBe('Corn');
  });
  it('writes nothing when the disk is full, and says so', async () => {
    const db = freshDb();
    vi.spyOn(db.voyages, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    await expect(saveCurrentVoyage(db, 'ship-1', fields())).rejects.toBeInstanceOf(StorageFullError);
    expect(await voyagesOf(db, 'ship-1')).toEqual([]);
  });
});

describe('startNewVoyage', () => {
  it('ends the active voyage and begins a blank one, with the ETA offset given', async () => {
    const db = freshDb();
    const old = await saveCurrentVoyage(db, 'ship-1', fields());
    const next = await startNewVoyage(db, 'ship-1', 180);
    expect(next).toMatchObject({
      shipId: 'ship-1', active: true, deleted: false, voyageNo: '', lastPort: '', nextPort: '', etaLocal: '',
      etaOffsetMinutes: 180, cargo: '', charterers: '', agents: '',
    });
    expect(next.id).not.toBe(old.id);
    const stored = await voyagesOf(db, 'ship-1');
    expect(stored).toHaveLength(2);
    expect(stored.find((v) => v.id === old.id)).toMatchObject({ active: false, deleted: false, ...fields() });
    expect(stored.filter((v) => v.active).map((v) => v.id)).toEqual([next.id]);
  });
  it('ends every active voyage of the ship, so that one is left', async () => {
    const db = freshDb();
    await createRecord<Voyage>(db, 'voyages', { shipId: 'ship-1', active: true, ...fields({ voyageNo: 'A' }) });
    await createRecord<Voyage>(db, 'voyages', { shipId: 'ship-1', active: true, ...fields({ voyageNo: 'B' }) });
    const next = await startNewVoyage(db, 'ship-1', 0);
    const stored = await listForShip<Voyage>(db, 'voyages', 'ship-1');
    expect(stored).toHaveLength(3);
    expect(stored.filter((v) => v.active)).toEqual([next]);
  });
  it('only begins one when there is no active voyage', async () => {
    const db = freshDb();
    const next = await startNewVoyage(db, 'ship-1', 60);
    expect(await voyagesOf(db, 'ship-1')).toEqual([next]);
  });
  it('leaves another ship\'s voyage alone', async () => {
    const db = freshDb();
    const other = await createRecord<Voyage>(db, 'voyages', { shipId: 'ship-2', active: true, ...fields() });
    await startNewVoyage(db, 'ship-1', 0);
    expect(await db.voyages.get(other.id)).toEqual(other);
  });
  it('is all or nothing: if the new voyage cannot be written, the old one stays active', async () => {
    const db = freshDb();
    const old = await saveCurrentVoyage(db, 'ship-1', fields());
    const put = db.voyages.put.bind(db.voyages);
    // The first write (ending the old voyage) goes through; the second (the new one) fails.
    vi.spyOn(db.voyages, 'put')
      .mockImplementationOnce(put)
      .mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    await expect(startNewVoyage(db, 'ship-1', 180)).rejects.toBeInstanceOf(StorageFullError);
    expect(await voyagesOf(db, 'ship-1')).toEqual([old]);
  });
});
