import { afterEach, describe, expect, it, vi } from 'vitest';
import { shipOffsetAt } from '../domain/shipTime';
import type { ClockChange } from '../domain/types';
import { addClockChange, cancelScheduledChange, stepClock } from './clockChanges';
import { listForShip } from './records';
import { openDb } from './schema';
import { getSettings } from './settings';
import { createShip } from './ships';
import { StorageFullError } from './storage';

const START = new Date('2026-10-25T08:00:00.000Z');
const NOW = new Date('2026-10-25T09:00:00.000Z');

afterEach(() => {
  vi.restoreAllMocks();
});

/** A database with one ship whose clock was set to UTC+03:00 at 08:00Z. */
async function shipAt3() {
  const db = openDb('t-' + crypto.randomUUID());
  const ship = await createShip(db, 'MV OCEAN STAR', 180, START);
  return { db, shipId: ship.id };
}

const changesOf = (db: ReturnType<typeof openDb>, shipId: string) => db.clockChanges.where('shipId').equals(shipId).toArray();

describe('addClockChange', () => {
  it('writes a change of the ship, effective when asked, stamped by this device', async () => {
    const { db, shipId } = await shipAt3();
    const { deviceId } = await getSettings(db);
    const change = await addClockChange(db, shipId, 300, new Date('2026-10-25T22:00:00.000Z'));
    expect(change).toMatchObject({
      shipId, effectiveAt: '2026-10-25T22:00:00.000Z', toOffsetMinutes: 300, deleted: false, scope: 'ship', updatedBy: deviceId,
    });
    expect(await db.clockChanges.get(change.id)).toEqual(change);
  });
  it('refuses an offset a ship cannot have, and writes nothing', async () => {
    const { db, shipId } = await shipAt3();
    for (const bad of [845, 20, -735, 7.5, NaN]) {
      await expect(addClockChange(db, shipId, bad, NOW)).rejects.toThrow('UTC offset');
    }
    expect(await changesOf(db, shipId)).toHaveLength(1);
  });
});

describe('stepClock', () => {
  it('advances by an hour from the offset in effect, effective at the moment given', async () => {
    const { db, shipId } = await shipAt3();
    const change = await stepClock(db, shipId, 60, NOW);
    expect(change).toMatchObject({ shipId, toOffsetMinutes: 240, effectiveAt: NOW.toISOString() });
    expect(shipOffsetAt(await listForShip<ClockChange>(db, 'clockChanges', shipId), NOW)).toBe(240);
  });
  it('retards by an hour', async () => {
    const { db, shipId } = await shipAt3();
    expect((await stepClock(db, shipId, -60, NOW)).toOffsetMinutes).toBe(120);
  });
  it('stacks: each step starts from the one before, even when they were asked for at once', async () => {
    const { db, shipId } = await shipAt3();
    const at = (ms: number) => new Date(NOW.getTime() + ms);
    await Promise.all([stepClock(db, shipId, 60, at(0)), stepClock(db, shipId, 60, at(1))]);
    const changes = await listForShip<ClockChange>(db, 'clockChanges', shipId);
    expect(changes.map((c) => c.toOffsetMinutes).sort()).toEqual([180, 240, 300]);
    expect(shipOffsetAt(changes, at(1))).toBe(300);
  });
  it('stacks over a few steps in a row, advance and retard alike', async () => {
    const { db, shipId } = await shipAt3();
    const at = (n: number) => new Date(NOW.getTime() + n * 1000);
    await stepClock(db, shipId, 60, at(0));
    await stepClock(db, shipId, 60, at(1));
    await stepClock(db, shipId, -60, at(2));
    expect(shipOffsetAt(await listForShip<ClockChange>(db, 'clockChanges', shipId), at(3))).toBe(240);
  });
  it('steps from the offset in effect now, not from one that is only scheduled', async () => {
    const { db, shipId } = await shipAt3();
    await addClockChange(db, shipId, 420, new Date('2026-10-26T00:00:00.000Z'));
    expect((await stepClock(db, shipId, 60, NOW)).toOffsetMinutes).toBe(240);
  });
  it('does not count a cancelled change, or another ship\'s', async () => {
    const { db, shipId } = await shipAt3();
    const other = await createShip(db, 'MV OTHER', 540, START);
    const gone = await addClockChange(db, shipId, 600, new Date('2026-10-25T08:30:00.000Z'));
    await cancelScheduledChange(db, gone.id, START);
    expect((await stepClock(db, shipId, 60, NOW)).toOffsetMinutes).toBe(240);
    expect(await changesOf(db, other.id)).toHaveLength(1);
  });
  it('holds at the ends of the range: an hour from the last offset is the last offset, and the step is refused there', async () => {
    const { db, shipId } = await shipAt3();
    await addClockChange(db, shipId, 810, new Date('2026-10-25T08:30:00.000Z'));
    expect((await stepClock(db, shipId, 60, NOW)).toOffsetMinutes).toBe(840);
    await expect(stepClock(db, shipId, 60, new Date(NOW.getTime() + 1000))).rejects.toThrow('UTC+14:00');
    expect(await changesOf(db, shipId)).toHaveLength(3);
    const low = await shipAt3();
    await addClockChange(low.db, low.shipId, -720, new Date('2026-10-25T08:30:00.000Z'));
    await expect(stepClock(low.db, low.shipId, -60, NOW)).rejects.toThrow('UTC-12:00');
  });
  it('starts from UTC+00:00 for a ship with no clock changes yet', async () => {
    const db = openDb('t-' + crypto.randomUUID());
    expect((await stepClock(db, 'ship-without-changes', 60, NOW)).toOffsetMinutes).toBe(60);
  });
  it('writes nothing when the disk is full, and says so', async () => {
    const { db, shipId } = await shipAt3();
    vi.spyOn(db.clockChanges, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    await expect(stepClock(db, shipId, 60, NOW)).rejects.toBeInstanceOf(StorageFullError);
    expect(await changesOf(db, shipId)).toHaveLength(1);
  });
});

describe('cancelScheduledChange', () => {
  it('soft-deletes a change that has not happened yet, so the deletion reaches other devices', async () => {
    const { db, shipId } = await shipAt3();
    const { deviceId } = await getSettings(db);
    const scheduled = await addClockChange(db, shipId, 300, new Date('2026-10-25T22:00:00.000Z'));
    await cancelScheduledChange(db, scheduled.id, NOW);
    expect(await db.clockChanges.get(scheduled.id)).toMatchObject({ id: scheduled.id, deleted: true, updatedBy: deviceId });
    expect(await listForShip(db, 'clockChanges', shipId)).toHaveLength(1);
  });
  it('refuses a change that has taken effect, which stays in the history for good', async () => {
    const { db, shipId } = await shipAt3();
    const done = await addClockChange(db, shipId, 300, new Date('2026-10-25T08:30:00.000Z'));
    await expect(cancelScheduledChange(db, done.id, NOW)).rejects.toThrow('already taken effect');
    expect((await db.clockChanges.get(done.id))?.deleted).toBe(false);
  });
  it('treats a change taking effect this very moment as having taken effect', async () => {
    const { db, shipId } = await shipAt3();
    const edge = await addClockChange(db, shipId, 300, NOW);
    await expect(cancelScheduledChange(db, edge.id, NOW)).rejects.toThrow('already taken effect');
    expect((await db.clockChanges.get(edge.id))?.deleted).toBe(false);
  });
  it('does nothing for a change that is already cancelled or gone', async () => {
    const { db, shipId } = await shipAt3();
    const scheduled = await addClockChange(db, shipId, 300, new Date('2026-10-25T22:00:00.000Z'));
    await cancelScheduledChange(db, scheduled.id, NOW);
    const tombstone = await db.clockChanges.get(scheduled.id);
    await cancelScheduledChange(db, scheduled.id, NOW);
    await cancelScheduledChange(db, 'no-such-change', NOW);
    expect(await db.clockChanges.get(scheduled.id)).toEqual(tombstone);
  });
  it('leaves the change as it was when the disk is full', async () => {
    const { db, shipId } = await shipAt3();
    const scheduled = await addClockChange(db, shipId, 300, new Date('2026-10-25T22:00:00.000Z'));
    vi.spyOn(db.clockChanges, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    await expect(cancelScheduledChange(db, scheduled.id, NOW)).rejects.toBeInstanceOf(StorageFullError);
    expect((await db.clockChanges.get(scheduled.id))?.deleted).toBe(false);
  });
});
