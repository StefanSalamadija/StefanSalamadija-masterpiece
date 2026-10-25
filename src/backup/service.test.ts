import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allTables, createRecord, softDelete, updateRecord } from '../db/records';
import { openDb } from '../db/schema';
import type { MasterpieceDB } from '../db/schema';
import { getSettings, updateSettings } from '../db/settings';
import { createShip, deleteShip, listShips } from '../db/ships';
import { listSnapshots } from '../db/snapshots';
import { StorageFullError } from '../db/storage';
import { conflictKey } from '../domain/merge';
import { TABLE_NAMES } from '../domain/types';
import type { Certificate, ClockChange, CrewDraft, CrewImportMapping, CrewMember, ShipProfile, SyncRecord, TableName, Tables, Voyage } from '../domain/types';
import { DamagedFileError, NotABackupError, WrongPasswordError, openBackup, readHeader, sealBackup } from './envelope';
import type { BackupHeader } from './envelope';
import { applyImport, collectHandover, exportBackup, prepareImport, recordFullBackup } from './service';

const PW = 'pw-12345678';
const FAST = { iterations: 1000 };

const draft: CrewDraft = {
  surname: 'Petrović', givenNames: 'Ivan', rank: 'master', nationality: 'Slovenian', dateOfBirth: '1980-03-14',
  placeOfBirth: 'Split', passportNo: 'P1234567', passportExpiry: '2030-01-01', seamansBookNo: 'SB-998',
  seamansBookExpiry: '2030-01-01', signOnDate: '2026-06-01', signOnPort: 'Rijeka',
};

function freshDb(): MasterpieceDB {
  return openDb('t-' + crypto.randomUUID());
}

/** Moves the clock, so ordering and "changed since the last exchange" in a test never depend on how fast it runs. */
function at(iso: string): void {
  vi.setSystemTime(new Date(iso));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); // fake-indexeddb and WebCrypto need the real timers
  at('2026-10-25T08:00:00.000Z');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const emptyTables = (): Tables => ({ ships: [], crew: [], voyages: [], certificates: [], clockChanges: [] });

/** Device A as the tests use it: two ships, and on the first one crew (one of them deleted), a voyage, a certificate and a personal-scope record. */
async function deviceA() {
  const db = freshDb();
  await getSettings(db);
  at('2026-10-25T08:00:00.000Z');
  const ship = await createShip(db, 'M/V Ocean Star', 120);
  at('2026-10-25T08:01:00.000Z');
  const other = await createShip(db, 'Šibenik Express', -300);
  const crew = await createRecord<CrewMember>(db, 'crew', { shipId: ship.id, ...draft });
  const gone = await createRecord<CrewMember>(db, 'crew', { shipId: ship.id, ...draft, surname: 'Šašić' });
  await softDelete(db, 'crew', gone.id);
  const otherCrew = await createRecord<CrewMember>(db, 'crew', { shipId: other.id, ...draft, surname: 'O\'Brien' });
  const voyage = await createRecord<Voyage>(db, 'voyages', {
    shipId: ship.id, active: true, voyageNo: '12', lastPort: 'Rijeka', nextPort: 'Split', etaLocal: '2026-10-27T06:00',
    etaOffsetMinutes: 120, cargo: 'Containers', charterers: '', agents: '',
  });
  const cert = await createRecord<Certificate>(db, 'certificates', {
    shipId: ship.id, key: 'loadLine', name: 'International Load Line', number: 'LL-1', issuedBy: 'DNV',
    issueDate: '2024-03-15', expiryDate: '2029-03-14', nextSurveyDue: '2027-03-14', remarks: '',
  });
  const personal = await createRecord<CrewMember>(db, 'crew', { shipId: ship.id, ...draft, surname: 'Private' });
  await db.crew.put({ ...personal, scope: 'personal' });
  return { db, ship, other, crew, gone, otherCrew, voyage, cert, personal };
}

/** A fresh device B that already holds device A's full backup. */
async function deviceBSyncedWith(a: MasterpieceDB) {
  const b = freshDb();
  const { text } = await exportBackup(a, 'full', PW, { shipId: (await listShips(a))[0].id, ...FAST });
  await applyImport(b, await prepareImport(b, text, PW), { conflicts: {}, applyDeletions: true });
  return b;
}

describe('collectHandover', () => {
  const stamp = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'x', deleted: false };
  const rec = (id: string, extra: object, scope: 'ship' | 'personal' = 'ship', deleted = false): SyncRecord =>
    ({ id, ...stamp, deleted, scope, ...extra }) as unknown as SyncRecord;

  it('keeps one ship, its ship-scope records and its tombstones, and nothing else', () => {
    const t: Tables = {
      ships: [rec('s1', {}), rec('s2', {}), rec('s3', {}, 'personal')],
      crew: [rec('c1', { shipId: 's1' }), rec('c2', { shipId: 's2' }), rec('c3', { shipId: 's1' }, 'personal'), rec('c4', { shipId: 's1' }, 'ship', true)],
      voyages: [rec('v1', { shipId: 's1' }), rec('v2', { shipId: 's2' })],
      certificates: [rec('x1', { shipId: 's2' })],
      clockChanges: [rec('k1', { shipId: 's1' })],
    };
    const h = collectHandover(t, 's1');
    expect(h.ships.map((r) => r.id)).toEqual(['s1']);
    expect(h.crew.map((r) => r.id)).toEqual(['c1', 'c4']);
    expect(h.voyages.map((r) => r.id)).toEqual(['v1']);
    expect(h.certificates).toEqual([]);
    expect(h.clockChanges.map((r) => r.id)).toEqual(['k1']);
  });

  it('does not match a record of another table on its id, and leaves the input alone', () => {
    const t: Tables = { ...emptyTables(), ships: [rec('s1', {})], crew: [rec('s1', { shipId: 's2' })] };
    const before = structuredClone(t);
    expect(collectHandover(t, 's1').crew).toEqual([]);
    expect(t).toEqual(before);
  });

  it('is empty for an unknown ship', () => {
    expect(collectHandover({ ...emptyTables(), ships: [rec('s1', {})] }, 'nope')).toEqual(emptyTables());
  });
});

describe('exportBackup', () => {
  it('writes a full export of every ship and table, tombstones and personal records included', async () => {
    const a = await deviceA();
    at('2026-10-25T12:32:00.000Z');
    const { text } = await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST });
    const settings = await getSettings(a.db);
    expect(readHeader(text)).toEqual({
      format: 'masterpiece-backup', version: 1, kind: 'full', deviceId: settings.deviceId, deviceName: settings.deviceName,
      exportedAt: '2026-10-25T12:32:00.000Z',
    });
    expect(JSON.parse(text).kdf.iterations).toBe(1000);
    const { payload } = await openBackup(text, PW);
    expect(payload.tables).toEqual(await allTables(a.db));
    expect(payload.tables.ships).toHaveLength(2);
    expect(payload.tables.crew.some((c) => c.deleted)).toBe(true);
    expect(payload.tables.crew.some((c) => c.scope === 'personal')).toBe(true);
  });

  it("names the file after the chosen ship and that ship's own time", async () => {
    const a = await deviceA();
    at('2026-10-25T12:32:00.000Z');
    expect((await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST })).fileName)
      .toBe('masterpiece-full-m-v-ocean-star-2026-10-25-1432.mpbak'); // UTC+02:00
    expect((await exportBackup(a.db, 'handover', PW, { shipId: a.other.id, ...FAST })).fileName)
      .toBe('masterpiece-handover-sibenik-express-2026-10-25-0732.mpbak'); // UTC-05:00
  });

  it("ignores the ship's deleted clock changes when working out its time", async () => {
    const a = await deviceA();
    at('2026-10-25T12:00:00.000Z');
    const wrong = await createRecord<ClockChange>(a.db, 'clockChanges', { shipId: a.ship.id, effectiveAt: '2026-10-25T11:00:00.000Z', toOffsetMinutes: 600 });
    await softDelete(a.db, 'clockChanges', wrong.id);
    expect((await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST })).fileName).toContain('-2026-10-25-1400.mpbak');
  });

  it('returns the export time, the same one that is in the file header', async () => {
    const a = await deviceA();
    at('2026-10-25T12:32:00.000Z');
    const { text, exportedAt } = await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST });
    expect(exportedAt).toBe('2026-10-25T12:32:00.000Z');
    expect(readHeader(text).exportedAt).toBe(exportedAt);
  });

  it('writes no settings itself, for either kind: nothing has left the device yet', async () => {
    const a = await deviceA();
    const before = await getSettings(a.db);
    await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST });
    await exportBackup(a.db, 'handover', PW, { shipId: a.ship.id, ...FAST });
    expect(await getSettings(a.db)).toEqual(before);
    expect(before.lastExportAt).toBeUndefined();
    expect(before.firstExportDone).toBeUndefined();
  });

  it('holds only the chosen ship in a handover, with its ship-scope records and tombstones', async () => {
    const a = await deviceA();
    const h = await exportBackup(a.db, 'handover', 'relief-pass', { shipId: a.ship.id, ...FAST });
    expect(readHeader(h.text).kind).toBe('handover');
    const { payload } = await openBackup(h.text, 'relief-pass');
    expect(payload.tables.ships.map((s) => s.id)).toEqual([a.ship.id]);
    const all = Object.values(payload.tables).flat();
    expect(all.every((r) => r.scope === 'ship' && (r.id === a.ship.id || (r as { shipId?: string }).shipId === a.ship.id))).toBe(true);
    // the ship's data is all there, the deleted crew member too, but not the other ship's or the personal record
    expect(payload.tables.crew.map((c) => c.id).sort()).toEqual([a.crew.id, a.gone.id].sort());
    expect(payload.tables.voyages.map((v) => v.id)).toEqual([a.voyage.id]);
    expect(payload.tables.certificates.map((c) => c.id)).toEqual([a.cert.id]);
    expect(payload.tables.clockChanges).toHaveLength(1);
  });

  it('rejects a ship that is not there, and exports nothing', async () => {
    const a = await deviceA();
    await expect(exportBackup(a.db, 'full', PW, { shipId: 'nope', ...FAST })).rejects.toThrow(new Error('Ship not found: nope'));
    await expect(exportBackup(a.db, 'handover', PW, { shipId: 'nope', ...FAST })).rejects.toThrow(new Error('Ship not found: nope'));
  });

  it('rejects a ship that has been deleted', async () => {
    const a = await deviceA();
    await deleteShip(a.db, a.other.id);
    for (const kind of ['full', 'handover'] as const) {
      await expect(exportBackup(a.db, kind, PW, { shipId: a.other.id, ...FAST })).rejects.toThrow(new Error(`Ship not found: ${a.other.id}`));
    }
  });

  it('still names the file when the ship has no name in its particulars', async () => {
    const a = await deviceA();
    await a.db.ships.put({ ...a.ship, particulars: {} as ShipProfile['particulars'] });
    at('2026-10-25T12:32:00.000Z');
    expect((await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST })).fileName)
      .toBe('masterpiece-full-ship-2026-10-25-1432.mpbak');
  });

  it('rejects an out-of-range iteration count', async () => {
    const a = await deviceA();
    await expect(exportBackup(a.db, 'full', PW, { shipId: a.ship.id, iterations: 10 })).rejects.toThrow(RangeError);
  });

  describe('the password', () => {
    it.each(['full', 'handover'] as const)('must be at least 8 characters for a %s export', async (kind) => {
      const a = await deviceA();
      await expect(exportBackup(a.db, kind, '1234567', { shipId: a.ship.id, ...FAST })).rejects.toThrow(new Error('Use at least 8 characters.'));
      await expect(exportBackup(a.db, kind, '12345678', { shipId: a.ship.id, ...FAST })).resolves.toMatchObject({ text: expect.any(String) });
    });

    it('is counted in characters, not bytes', async () => {
      const a = await deviceA();
      await expect(exportBackup(a.db, 'full', 'šđčćžšđ', { shipId: a.ship.id, ...FAST })).rejects.toThrow('Use at least 8 characters.'); // 7
      await expect(exportBackup(a.db, 'full', 'šđčćžšđč', { shipId: a.ship.id, ...FAST })).resolves.toBeDefined(); // 8, 16 bytes
    });

    it('is checked before anything else, so a weak password is reported even with a bad ship', async () => {
      const a = await deviceA();
      await expect(exportBackup(a.db, 'full', 'short', { shipId: 'nope', ...FAST })).rejects.toThrow('Use at least 8 characters.');
    });
  });
});

describe('recordFullBackup', () => {
  it('sets lastExportAt and firstExportDone, which resets the reminder', async () => {
    const a = await deviceA();
    const before = await getSettings(a.db);
    await recordFullBackup(a.db, '2026-10-25T12:32:00.000Z');
    expect(await getSettings(a.db)).toEqual({ ...before, lastExportAt: '2026-10-25T12:32:00.000Z', firstExportDone: true });
  });

  it('is what a full export is followed by, and a handover is not', async () => {
    const a = await deviceA();
    const { exportedAt } = await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST });
    await recordFullBackup(a.db, exportedAt);
    const recorded = (await getSettings(a.db)).lastExportAt;
    expect(recorded).toBe(exportedAt);
    at('2026-10-26T08:00:00.000Z');
    await exportBackup(a.db, 'handover', 'relief-pass', { shipId: a.ship.id, ...FAST });
    expect((await getSettings(a.db)).lastExportAt).toBe(recorded);
  });
});

describe('prepareImport and applyImport between two devices', () => {
  it('copies a full backup onto an empty device and takes a snapshot first', async () => {
    const a = await deviceA();
    const b = freshDb();
    at('2026-10-25T09:00:00.000Z');
    const { text, exportedAt } = await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST });
    await recordFullBackup(a.db, exportedAt);
    const p = await prepareImport(b, text, PW);
    expect(p.header).toEqual(readHeader(text));
    expect(p.plan.summary).toMatchObject({ added: 9, updated: 0, deleted: 0, conflicts: 0 });
    at('2026-10-25T10:00:00.000Z');
    await applyImport(b, p, { conflicts: {}, applyDeletions: true });

    expect(await allTables(b)).toEqual(await allTables(a.db));
    expect((await getSettings(a.db)).lastExportAt).toBeDefined();
    expect((await getSettings(b)).lastSync[(await getSettings(a.db)).deviceId]).toBe(p.header.exportedAt);
    const snapshots = await listSnapshots(b);
    expect(snapshots[0].reason).toBe('before-import');
    expect(snapshots[0].counts).toEqual({ ships: 0, crew: 0, voyages: 0, certificates: 0, clockChanges: 0 });
  });

  it("carries a ship's crew import mapping, with the columns it ignores, through a backup", async () => {
    const a = await deviceA();
    const crewImportMapping: CrewImportMapping = {
      byHeader: { prezime: 'surname', rank: 'rank' }, dateFormat: 'year-first', ignored: ['dateofbirth', 'passportno'],
    };
    await updateRecord<ShipProfile>(a.db, 'ships', a.ship.id, { crewImportMapping });
    const b = freshDb();
    const { text } = await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST });
    const p = await prepareImport(b, text, PW);
    await applyImport(b, p, { conflicts: {}, applyDeletions: true });
    expect((await b.ships.get(a.ship.id))?.crewImportMapping).toEqual(crewImportMapping);
    expect((await prepareImport(b, text, PW)).plan.items).toEqual([]); // the same file again: nothing differs
  });

  it('shows zero changes, and creates no duplicates, when the same file is imported twice', async () => {
    const a = await deviceA();
    const b = freshDb();
    const { text } = await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST });
    await applyImport(b, await prepareImport(b, text, PW), { conflicts: {}, applyDeletions: true });
    const afterFirst = await allTables(b);

    const again = await prepareImport(b, text, PW);
    expect(again.plan.items).toEqual([]);
    expect(again.plan.summary).toEqual({ added: 0, updated: 0, deleted: 0, conflicts: 0 });
    const snapshots = await b.snapshots.count();
    await applyImport(b, again, { conflicts: {}, applyDeletions: true });
    expect(await allTables(b)).toEqual(afterFirst);
    expect(await b.snapshots.count()).toBe(snapshots); // nothing to change, so no snapshot to push an older one out
  });

  it('takes a snapshot only when something is written, but still records the exchange and repairs the active ship', async () => {
    const a = await deviceA();
    at('2026-10-25T09:00:00.000Z');
    const b = await deviceBSyncedWith(a.db);
    const snapshots = await b.snapshots.count();
    expect(snapshots).toBe(1);
    await updateSettings(b, { activeShipId: 'ghost' });
    at('2026-10-25T10:00:00.000Z');
    const { text, exportedAt } = await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST }); // nothing new
    const p = await prepareImport(b, text, PW);
    expect(p.plan.items).toEqual([]);
    await applyImport(b, p, { conflicts: {}, applyDeletions: true });
    expect(await b.snapshots.count()).toBe(snapshots);
    const settings = await getSettings(b);
    expect(settings.lastSync[(await getSettings(a.db)).deviceId]).toBe(exportedAt);
    expect(settings.activeShipId).toBe(a.ship.id);
  });

  it('takes no snapshot when the user declines every change in the plan', async () => {
    const a = await deviceA();
    at('2026-10-25T09:00:00.000Z');
    const b = await deviceBSyncedWith(a.db);
    const snapshots = await b.snapshots.count();
    at('2026-10-25T10:00:00.000Z');
    await softDelete(a.db, 'crew', a.crew.id);
    at('2026-10-25T11:00:00.000Z');
    const { text } = await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST });
    const p = await prepareImport(b, text, PW);
    expect(p.plan.summary.deleted).toBe(1);
    await applyImport(b, p, { conflicts: {}, applyDeletions: false });
    expect(await b.snapshots.count()).toBe(snapshots);
  });

  it('merges into what the device already has: the snapshot holds the old data and local-only records stay', async () => {
    const a = await deviceA();
    const b = freshDb();
    at('2026-10-25T07:00:00.000Z');
    const mine = await createShip(b, 'MV B-Only', 60);
    const before = await allTables(b);
    at('2026-10-25T09:00:00.000Z');
    const { text } = await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST });
    at('2026-10-25T10:00:00.000Z');
    await applyImport(b, await prepareImport(b, text, PW), { conflicts: {}, applyDeletions: true });

    const t = await allTables(b);
    expect(t.ships.map((s) => s.id).sort()).toEqual([mine.id, a.ship.id, a.other.id].sort());
    const [snap] = await b.snapshots.toArray();
    expect(snap.reason).toBe('before-import');
    expect(snap.data).toEqual(before);
  });

  it("merges the other device's id into lastSync without disturbing the others", async () => {
    const a = await deviceA();
    const c = await deviceA();
    const b = freshDb();
    await updateSettings(b, { lastSync: { 'some-old-device': '2026-01-01T00:00:00.000Z' } });
    for (const source of [a, c]) {
      const { text } = await exportBackup(source.db, 'full', PW, { shipId: source.ship.id, ...FAST });
      await applyImport(b, await prepareImport(b, text, PW), { conflicts: {}, applyDeletions: true });
    }
    const lastSync = (await getSettings(b)).lastSync;
    expect(Object.keys(lastSync).sort()).toEqual(
      ['some-old-device', (await getSettings(a.db)).deviceId, (await getSettings(c.db)).deviceId].sort(),
    );
    expect(lastSync['some-old-device']).toBe('2026-01-01T00:00:00.000Z');
  });

  it('never moves lastSync back when an older file from the same device is imported after a newer one', async () => {
    const a = await deviceA();
    at('2026-10-25T09:00:00.000Z');
    const older = await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST });
    at('2026-10-25T09:30:00.000Z');
    await updateRecord(a.db, 'crew', a.crew.id, { nationality: 'Croatian' });
    at('2026-10-25T10:00:00.000Z');
    const newer = await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST });
    const b = freshDb();
    const deviceId = (await getSettings(a.db)).deviceId;
    await applyImport(b, await prepareImport(b, newer.text, PW), { conflicts: {}, applyDeletions: true });
    expect((await getSettings(b)).lastSync[deviceId]).toBe(newer.exportedAt);

    const p = await prepareImport(b, older.text, PW);
    expect(p.plan.items).toEqual([]); // B already has the newer version of everything
    await applyImport(b, p, { conflicts: {}, applyDeletions: true });
    expect((await getSettings(b)).lastSync[deviceId]).toBe(newer.exportedAt);
    expect(await b.crew.get(a.crew.id)).toMatchObject({ nationality: 'Croatian' });
  });

  it('is an update, not a conflict, when only the other device changed a record since the last exchange', async () => {
    const a = await deviceA();
    at('2026-10-25T09:00:00.000Z');
    const b = await deviceBSyncedWith(a.db);
    at('2026-10-25T10:00:00.000Z');
    await updateRecord(a.db, 'crew', a.crew.id, { nationality: 'Croatian' });
    at('2026-10-25T11:00:00.000Z');
    const { text } = await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST });
    const p = await prepareImport(b, text, PW);
    expect(p.plan.summary).toEqual({ added: 0, updated: 1, deleted: 0, conflicts: 0 });
    await applyImport(b, p, { conflicts: {}, applyDeletions: true });
    expect(await b.crew.get(a.crew.id)).toMatchObject({ nationality: 'Croatian' });
  });

  describe('when both devices changed the same record', () => {
    async function conflict() {
      const a = await deviceA();
      at('2026-10-25T09:00:00.000Z');
      const b = await deviceBSyncedWith(a.db);
      at('2026-10-25T10:00:00.000Z');
      await updateRecord(a.db, 'crew', a.crew.id, { nationality: 'Croatian' });
      await updateRecord(b, 'crew', a.crew.id, { nationality: 'Montenegrin' });
      at('2026-10-25T11:00:00.000Z');
      const t2 = (await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST })).text;
      const p = await prepareImport(b, t2, PW);
      return { a, b, p, text: t2, key: `crew:${a.crew.id}`, deviceB: (await getSettings(b)).deviceId };
    }

    it('reports it for the user to decide', async () => {
      const { p, key } = await conflict();
      expect(p.plan.summary.conflicts).toBe(1);
      expect(conflictKey(p.plan.items[0])).toBe(key);
    });

    it('takes the incoming version when the user chooses it, stamped as a change made now on this device', async () => {
      const { b, p, key, a, deviceB } = await conflict();
      at('2026-10-25T12:00:00.000Z');
      await applyImport(b, p, { conflicts: { [key]: 'incoming' }, applyDeletions: true });
      expect(await b.crew.get(a.crew.id)).toMatchObject({ nationality: 'Croatian', updatedAt: '2026-10-25T12:00:00.000Z', updatedBy: deviceB });
    });

    it('keeps the local version when the user chooses it, stamped the same way so it reaches the other device', async () => {
      const { b, p, key, a, deviceB } = await conflict();
      at('2026-10-25T12:00:00.000Z');
      await applyImport(b, p, { conflicts: { [key]: 'local' }, applyDeletions: true });
      expect(await b.crew.get(a.crew.id)).toMatchObject({ nationality: 'Montenegrin', updatedAt: '2026-10-25T12:00:00.000Z', updatedBy: deviceB });
    });

    it.each(['local', 'incoming'] as const)('shows zero changes when the same file is prepared again after choosing %s', async (choice) => {
      const { b, p, text, key } = await conflict();
      expect(p.plan.summary.conflicts).toBe(1);
      at('2026-10-25T12:00:00.000Z');
      await applyImport(b, p, { conflicts: { [key]: choice }, applyDeletions: true });
      const again = await prepareImport(b, text, PW);
      expect(again.plan.items).toEqual([]);
      expect(again.plan.summary).toEqual({ added: 0, updated: 0, deleted: 0, conflicts: 0 });
    });

    it('refuses to apply while a conflict has no decision, and changes nothing, not even the snapshots', async () => {
      const { b, p } = await conflict();
      const tables = await allTables(b);
      const settings = await getSettings(b);
      const snapshots = await b.snapshots.count();
      await expect(applyImport(b, p, { conflicts: {}, applyDeletions: true })).rejects.toThrow(/Unresolved conflict/);
      expect(await allTables(b)).toEqual(tables);
      expect(await getSettings(b)).toEqual(settings);
      expect(await b.snapshots.count()).toBe(snapshots);
    });
  });

  describe('deletions', () => {
    async function deletion() {
      const a = await deviceA();
      at('2026-10-25T09:00:00.000Z');
      const b = await deviceBSyncedWith(a.db);
      at('2026-10-25T10:00:00.000Z');
      await softDelete(a.db, 'crew', a.crew.id);
      at('2026-10-25T11:00:00.000Z');
      const { text } = await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST });
      return { a, b, p: await prepareImport(b, text, PW) };
    }

    it('writes the tombstone over a live record when the user confirms deletions', async () => {
      const { a, b, p } = await deletion();
      expect(p.plan.summary).toEqual({ added: 0, updated: 0, deleted: 1, conflicts: 0 });
      await applyImport(b, p, { conflicts: {}, applyDeletions: true });
      expect(await b.crew.get(a.crew.id)).toMatchObject({ deleted: true });
      expect(await allTables(b)).toEqual(await allTables(a.db));
    });

    it('keeps the record when the user declines deletions', async () => {
      const { a, b, p } = await deletion();
      await applyImport(b, p, { conflicts: {}, applyDeletions: false });
      expect(await b.crew.get(a.crew.id)).toMatchObject({ deleted: false });
    });
  });

  describe('the active ship', () => {
    it('is set to the first live ship when there was none', async () => {
      const a = await deviceA();
      const b = freshDb();
      expect((await getSettings(b)).activeShipId).toBeUndefined();
      const { text } = await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST });
      await applyImport(b, await prepareImport(b, text, PW), { conflicts: {}, applyDeletions: true });
      expect((await getSettings(b)).activeShipId).toBe((await listShips(b))[0].id);
      expect((await getSettings(b)).activeShipId).toBe(a.ship.id);
    });

    it('is left alone when it already names a live ship', async () => {
      const a = await deviceA();
      const b = freshDb();
      at('2026-10-25T12:00:00.000Z');
      const mine = await createShip(b, 'MV B-Only', 60); // newer than A's ships, so not the first in the list
      const { text } = await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST });
      await applyImport(b, await prepareImport(b, text, PW), { conflicts: {}, applyDeletions: true });
      expect((await getSettings(b)).activeShipId).toBe(mine.id);
    });

    it('moves off a ship that does not exist', async () => {
      const a = await deviceA();
      const b = freshDb();
      await updateSettings(b, { activeShipId: 'ghost' });
      const { text } = await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST });
      await applyImport(b, await prepareImport(b, text, PW), { conflicts: {}, applyDeletions: true });
      expect((await getSettings(b)).activeShipId).toBe(a.ship.id);
    });

    /** B holds A's data; A then deletes its first ship (and the other one too, if asked) and exports. */
    async function activeShipDeletedByFile(alsoDeleteOther = false) {
      const a = await deviceA();
      at('2026-10-25T09:00:00.000Z');
      const b = await deviceBSyncedWith(a.db);
      expect((await getSettings(b)).activeShipId).toBe(a.ship.id);
      at('2026-10-25T10:00:00.000Z');
      await deleteShip(a.db, a.ship.id);
      at('2026-10-25T11:00:00.000Z');
      if (!alsoDeleteOther) {
        const { text } = await exportBackup(a.db, 'full', PW, { shipId: a.other.id, ...FAST });
        return { a, b, text };
      }
      // With every ship deleted, exportBackup has no ship to name the file after, so seal the file directly.
      await deleteShip(a.db, a.other.id);
      const { deviceId, deviceName } = await getSettings(a.db);
      const header: BackupHeader = { format: 'masterpiece-backup', version: 1, kind: 'full', deviceId, deviceName, exportedAt: new Date().toISOString() };
      return { a, b, text: await sealBackup(header, { tables: await allTables(a.db) }, PW, FAST) };
    }

    it('moves to the first remaining live ship when the file deletes it', async () => {
      const { a, b, text } = await activeShipDeletedByFile();
      await applyImport(b, await prepareImport(b, text, PW), { conflicts: {}, applyDeletions: true });
      expect((await getSettings(b)).activeShipId).toBe(a.other.id);
    });

    it('is cleared when the file deletes the last live ship', async () => {
      const { b, text } = await activeShipDeletedByFile(true);
      await applyImport(b, await prepareImport(b, text, PW), { conflicts: {}, applyDeletions: true });
      expect(await listShips(b)).toEqual([]);
      expect((await getSettings(b)).activeShipId).toBeUndefined();
    });

    it('stays on the ship when the user declines its deletion', async () => {
      const { a, b, text } = await activeShipDeletedByFile();
      await applyImport(b, await prepareImport(b, text, PW), { conflicts: {}, applyDeletions: false });
      expect((await getSettings(b)).activeShipId).toBe(a.ship.id);
    });
  });

  it('writes nothing and records no sync time when the write fails, but the snapshot is already safe', async () => {
    const a = await deviceA();
    const b = freshDb();
    const { text } = await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST });
    const p = await prepareImport(b, text, PW);
    vi.spyOn(b.crew, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    await expect(applyImport(b, p, { conflicts: {}, applyDeletions: true })).rejects.toThrow(StorageFullError);
    expect(await allTables(b)).toEqual(emptyTables());
    expect((await getSettings(b)).lastSync).toEqual({});
    expect((await getSettings(b)).activeShipId).toBeUndefined();
    expect((await listSnapshots(b))[0].reason).toBe('before-import');
  });
});

describe('prepareImport rejects what it cannot trust', () => {
  const header: BackupHeader = {
    format: 'masterpiece-backup', version: 1, kind: 'full', deviceId: 'dev-X', deviceName: 'X', exportedAt: '2026-10-25T10:00:00.000Z',
  };
  const base = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'dev-X', deleted: false, scope: 'ship' };
  const particulars = {
    name: 'MV X', imo: '', callSign: '', mmsi: '', flag: '', portOfRegistry: '', owners: '', managers: '', pandi: '', classSociety: '',
  };
  const valid: Record<TableName, object> = {
    ships: { ...base, id: 'ship-1', particulars },
    crew: { ...base, id: 'crew-1', shipId: 'ship-1', ...draft },
    voyages: { ...base, id: 'voy-1', shipId: 'ship-1', voyageNo: '1' },
    certificates: { ...base, id: 'cert-1', shipId: 'ship-1', key: 'loadLine' },
    clockChanges: { ...base, id: 'clk-1', shipId: 'ship-1', effectiveAt: '2026-01-01T00:00:00.000Z', toOffsetMinutes: 0 },
  };

  /** A correctly sealed file in which one record of `table` carries `patch`; a key set to undefined is left out of the file. */
  async function fileWith(table: TableName, patch: object): Promise<string> {
    const tables = emptyTables();
    for (const name of TABLE_NAMES) tables[name] = [valid[name] as SyncRecord];
    tables[table] = [valid[table] as SyncRecord, { ...valid[table], id: 'second', ...patch } as unknown as SyncRecord];
    return sealBackup(header, { tables }, PW, FAST);
  }

  it('accepts a file whose records are all well formed, personal ones included', async () => {
    const b = freshDb();
    const p = await prepareImport(b, await fileWith('crew', { scope: 'personal' }), PW);
    expect(p.plan.summary.added).toBe(6);
  });

  it.each([
    ['scope is neither ship nor personal', 'crew', { scope: 'team' }],
    ['scope is missing', 'crew', { scope: undefined }],
    ['deleted is not a boolean', 'crew', { deleted: 'false' }],
    ['deleted is missing', 'voyages', { deleted: undefined }],
    ['createdAt is missing', 'certificates', { createdAt: undefined }],
    ['createdAt is not a date', 'crew', { createdAt: 'yesterday' }],
    ['createdAt is a number', 'crew', { createdAt: 1761379200000 }],
    ['updatedAt is not a date', 'clockChanges', { updatedAt: 'not a time' }],
    ['a crew record has no shipId', 'crew', { shipId: undefined }],
    ['a voyage has no shipId', 'voyages', { shipId: undefined }],
    ['a certificate has no shipId', 'certificates', { shipId: undefined }],
    ['a clock change has no shipId', 'clockChanges', { shipId: undefined }],
    ['a shipId is not a string', 'crew', { shipId: 7 }],
    ['a ship has no particulars', 'ships', { particulars: undefined }],
    ['a ship has particulars that are not an object', 'ships', { particulars: 'MV X' }],
    ['a ship has null particulars', 'ships', { particulars: null }],
    ['a ship has particulars that are an array', 'ships', { particulars: [] }],
    ['a ship has a bad scope', 'ships', { scope: 'fleet' }],
  ] as [string, TableName, object][])('throws DamagedFileError when %s', async (_label, table, patch) => {
    const b = freshDb();
    await expect(prepareImport(b, await fileWith(table, patch), PW)).rejects.toThrow(DamagedFileError);
    expect(await allTables(b)).toEqual(emptyTables());
  });

  it('does not ask for a shipId on a ship', async () => {
    const b = freshDb();
    await expect(prepareImport(b, await fileWith('ships', { shipId: undefined }), PW)).resolves.toBeDefined();
  });

  it('passes the envelope errors through unchanged', async () => {
    const b = freshDb();
    const a = await deviceA();
    const { text } = await exportBackup(a.db, 'full', PW, { shipId: a.ship.id, ...FAST });
    await expect(prepareImport(b, text, 'wrong-password')).rejects.toThrow(WrongPasswordError);
    await expect(prepareImport(b, 'not a backup', PW)).rejects.toThrow(NotABackupError);
  });
});
