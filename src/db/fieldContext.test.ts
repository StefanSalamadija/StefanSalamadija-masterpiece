import { describe, expect, it } from 'vitest';
import { resolveField } from '../domain/fieldDictionary';
import type { BaseRecord, Certificate, ClockChange, CrewDocument, CrewMember, Voyage } from '../domain/types';
import { loadFieldContext } from './fieldContext';
import { createRecord, softDelete } from './records';
import { openDb } from './schema';
import { createShip } from './ships';

const freshDb = () => openDb('t-' + crypto.randomUUID());
const NOW = new Date('2026-10-28T09:05:00Z');

const member = (shipId: string, over: Partial<CrewMember> = {}): Omit<CrewMember, keyof BaseRecord> => ({
  shipId, surname: 'Horvat', givenNames: 'Luka', rank: 'master', nationality: 'Croatian', dateOfBirth: '1980-03-14',
  placeOfBirth: 'Split', passportNo: 'P1', passportExpiry: '2030-01-01', seamansBookNo: 'SB1', seamansBookExpiry: '2030-01-01',
  signOnDate: '2026-09-01', signOnPort: 'Rijeka', ...over,
});

const voyageFields = (shipId: string, over: Partial<Voyage> = {}) => ({
  shipId, active: true, voyageNo: 'V-1', lastPort: 'Santos', nextPort: 'Rotterdam', etaLocal: '2026-11-02T08:00', etaOffsetMinutes: 60,
  cargo: 'Soya', charterers: 'ACME', agents: 'Port Agents BV', ...over,
});

describe('loadFieldContext', () => {
  it('reads the ship, its crew, voyages, certificates, crew documents and clock changes, and takes the time it is given', async () => {
    const db = freshDb();
    const ship = await createShip(db, 'MV TEST', 120, new Date('2026-01-01T00:00:00Z'));
    const crew = await createRecord<CrewMember>(db, 'crew', member(ship.id));
    const voyage = await createRecord<Voyage>(db, 'voyages', voyageFields(ship.id));
    const cert = await createRecord<Certificate>(db, 'certificates', {
      shipId: ship.id, key: 'loadLine', name: 'Load Line', number: 'LL-1', issuedBy: 'DNV', issueDate: '2024-03-15', remarks: '',
    });
    const doc = await createRecord<CrewDocument>(db, 'crewDocuments', {
      shipId: ship.id, crewId: crew.id, type: 'coc', grade: 'Master', number: 'C1', issuedBy: 'HR', issueDate: '2024-01-01', remarks: '',
    });

    const ctx = await loadFieldContext(db, ship.id, NOW);

    expect(ctx.ship.id).toBe(ship.id);
    expect(ctx.crew).toEqual([crew]);
    expect(ctx.voyages).toEqual([voyage]);
    expect(ctx.certificates).toEqual([cert]);
    expect(ctx.crewDocuments).toEqual([doc]);
    expect(ctx.clockChanges).toHaveLength(1);
    expect(ctx.clockChanges[0].toOffsetMinutes).toBe(120);
    expect(ctx.nowUtc).toBe(NOW);
    expect(resolveField('vessel.name', ctx)).toBe('MV TEST');
    expect(resolveField('crew.byRank.master.fullName', ctx, { asAt: '2026-10-28' })).toBe('Luka Horvat');
    expect(resolveField('voyage.nextPort', ctx)).toBe('Rotterdam');
  });

  it('leaves out deleted records', async () => {
    const db = freshDb();
    const ship = await createShip(db, 'MV TEST', 0, NOW);
    const gone = await createRecord<CrewMember>(db, 'crew', member(ship.id, { surname: 'Gone' }));
    const kept = await createRecord<CrewMember>(db, 'crew', member(ship.id, { rank: 'bosun', surname: 'Kept' }));
    const oldVoyage = await createRecord<Voyage>(db, 'voyages', voyageFields(ship.id, { voyageNo: 'OLD' }));
    await softDelete(db, 'crew', gone.id);
    await softDelete(db, 'voyages', oldVoyage.id);

    const ctx = await loadFieldContext(db, ship.id, NOW);

    expect(ctx.crew).toEqual([kept]);
    expect(ctx.voyages).toEqual([]);
    expect(resolveField('crew.byRank.master.fullName', ctx, { asAt: '2026-10-28' })).toBeUndefined();
  });

  it('keeps to the ship asked for', async () => {
    const db = freshDb();
    const one = await createShip(db, 'MV ONE', 0, NOW);
    const two = await createShip(db, 'MV TWO', 0, NOW);
    await createRecord<CrewMember>(db, 'crew', member(one.id, { surname: 'One' }));
    await createRecord<CrewMember>(db, 'crew', member(two.id, { surname: 'Two' }));
    await createRecord<Voyage>(db, 'voyages', voyageFields(two.id));

    const ctx = await loadFieldContext(db, one.id, NOW);

    expect(ctx.ship.particulars.name).toBe('MV ONE');
    expect(ctx.crew.map((m) => m.surname)).toEqual(['One']);
    expect(ctx.voyages).toEqual([]);
    expect(ctx.clockChanges.every((c: ClockChange) => c.shipId === one.id)).toBe(true);
  });

  it('refuses a ship that does not exist or is deleted', async () => {
    const db = freshDb();
    const ship = await createShip(db, 'MV TEST', 0, NOW);
    await expect(loadFieldContext(db, 'nope', NOW)).rejects.toThrow(/no ship/i);
    await softDelete(db, 'ships', ship.id);
    await expect(loadFieldContext(db, ship.id, NOW)).rejects.toThrow(/no ship/i);
  });
});
