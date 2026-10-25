import { describe, expect, it } from 'vitest';
import { currentVoyage, previousVoyages, voyageSummary } from './voyage';
import type { Voyage } from './types';

let seq = 0;
function voyage(over: Partial<Voyage> = {}): Voyage {
  seq += 1;
  return {
    id: `v-${String(seq).padStart(3, '0')}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'device', deleted: false, scope: 'ship', shipId: 'ship-1', active: false, voyageNo: '', lastPort: '',
    nextPort: '', etaLocal: '', etaOffsetMinutes: 180, cargo: '', charterers: '', agents: '', ...over,
  };
}

describe('currentVoyage', () => {
  it('is the active voyage', () => {
    const ended = voyage({ voyageNo: 'V-1' });
    const active = voyage({ voyageNo: 'V-2', active: true });
    expect(currentVoyage([ended, active])).toBe(active);
  });
  it('is none when no voyage is active, or there are none', () => {
    expect(currentVoyage([voyage(), voyage()])).toBeUndefined();
    expect(currentVoyage([])).toBeUndefined();
  });
  it('ignores a deleted voyage', () => {
    expect(currentVoyage([voyage({ active: true, deleted: true })])).toBeUndefined();
  });
  it('is the one begun last when two devices each began one, whatever the order', () => {
    const first = voyage({ active: true, createdAt: '2026-10-01T00:00:00.000Z' });
    const second = voyage({ active: true, createdAt: '2026-10-02T00:00:00.000Z' });
    expect(currentVoyage([first, second])).toBe(second);
    expect(currentVoyage([second, first])).toBe(second);
  });
  it('is decided by id when they were begun at the same time', () => {
    const a = voyage({ active: true, id: 'aaa' });
    const b = voyage({ active: true, id: 'bbb' });
    expect(currentVoyage([a, b])).toBe(b);
    expect(currentVoyage([b, a])).toBe(b);
  });
});

describe('previousVoyages', () => {
  it('lists the voyages that are not the current one, newest first', () => {
    const old = voyage({ voyageNo: 'V-1', createdAt: '2026-08-01T00:00:00.000Z' });
    const newer = voyage({ voyageNo: 'V-2', createdAt: '2026-09-01T00:00:00.000Z' });
    const active = voyage({ voyageNo: 'V-3', createdAt: '2026-10-01T00:00:00.000Z', active: true });
    expect(previousVoyages([old, active, newer])).toEqual([newer, old]);
  });
  it('is everything, newest first, when no voyage is active', () => {
    const old = voyage({ createdAt: '2026-08-01T00:00:00.000Z' });
    const newer = voyage({ createdAt: '2026-09-01T00:00:00.000Z' });
    expect(previousVoyages([old, newer])).toEqual([newer, old]);
  });
  it('leaves out deleted voyages', () => {
    expect(previousVoyages([voyage({ deleted: true })])).toEqual([]);
  });
  it('keeps an extra active voyage (begun on another device) in the list, so that it is not lost from view', () => {
    const first = voyage({ active: true, voyageNo: 'A', createdAt: '2026-10-01T00:00:00.000Z' });
    const second = voyage({ active: true, voyageNo: 'B', createdAt: '2026-10-02T00:00:00.000Z' });
    expect(previousVoyages([first, second])).toEqual([first]);
  });
  it('does not change the list it is given', () => {
    const list = [voyage({ createdAt: '2026-08-01T00:00:00.000Z' }), voyage({ createdAt: '2026-09-01T00:00:00.000Z' })];
    const copy = [...list];
    previousVoyages(list);
    expect(list).toEqual(copy);
  });
});

describe('voyageSummary', () => {
  it('is the voyage number and the ports', () => {
    expect(voyageSummary(voyage({ voyageNo: 'V-2611', lastPort: 'Santos', nextPort: 'Rotterdam' }))).toBe('V-2611 · Santos → Rotterdam');
  });
  it('marks a missing port with a dash', () => {
    expect(voyageSummary(voyage({ voyageNo: 'V-2611', nextPort: 'Rotterdam' }))).toBe('V-2611 · — → Rotterdam');
    expect(voyageSummary(voyage({ voyageNo: 'V-2611', lastPort: 'Santos' }))).toBe('V-2611 · Santos → —');
  });
  it('leaves the ports out when neither is known', () => {
    expect(voyageSummary(voyage({ voyageNo: 'V-2611' }))).toBe('V-2611');
  });
  it('says so when there is no voyage number', () => {
    expect(voyageSummary(voyage({ lastPort: 'Santos', nextPort: 'Rotterdam' }))).toBe('No voyage no. · Santos → Rotterdam');
    expect(voyageSummary(voyage())).toBe('No voyage no.');
  });
});
