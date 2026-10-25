import { describe, expect, it } from 'vitest';
import type { Voyage } from '../domain/types';
import { blankVoyageForm, ETA_INVALID, VOYAGE_CONTROLS, voyageFieldsOf, voyageFormOf, voyageProblems } from './voyageForm';
import type { VoyageForm } from './voyageForm';

function voyage(over: Partial<Voyage> = {}): Voyage {
  return {
    id: 'v-1', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: 'device', deleted: false,
    scope: 'ship', shipId: 'ship-1', active: true, voyageNo: 'V-2611', lastPort: 'Santos', nextPort: 'Rotterdam',
    etaLocal: '2026-11-02T14:30', etaOffsetMinutes: 60, cargo: 'Soybeans', charterers: 'ADM', agents: 'Wilhelmsen', ...over,
  };
}

const form = (over: Partial<VoyageForm> = {}): VoyageForm => ({ ...voyageFormOf(voyage(), 180), ...over });

describe('the voyage form', () => {
  it('starts empty, with the ETA offset it is given', () => {
    const blank = blankVoyageForm(180);
    expect(blank).toEqual({
      voyageNo: '', lastPort: '', nextPort: '', etaLocal: '', etaOffsetMinutes: 180, cargo: '', charterers: '', agents: '',
    });
    expect(Object.keys(blank).sort()).toEqual([...VOYAGE_CONTROLS].sort());
  });

  describe('is filled from a voyage', () => {
    it('with what it says, the ETA offset included', () => {
      expect(voyageFormOf(voyage(), 180)).toEqual({
        voyageNo: 'V-2611', lastPort: 'Santos', nextPort: 'Rotterdam', etaLocal: '2026-11-02T14:30', etaOffsetMinutes: 60,
        cargo: 'Soybeans', charterers: 'ADM', agents: 'Wilhelmsen',
      });
    });
    it('with the fallback offset when the voyage has one a ship cannot have', () => {
      expect(voyageFormOf(voyage({ etaOffsetMinutes: 61 }), 180).etaOffsetMinutes).toBe(180);
      expect(voyageFormOf(voyage({ etaOffsetMinutes: NaN }), 180).etaOffsetMinutes).toBe(180);
    });
    it('keeping UTC+00:00, which is a real offset', () => {
      expect(voyageFormOf(voyage({ etaOffsetMinutes: 0 }), 180).etaOffsetMinutes).toBe(0);
    });
  });

  describe('gives the fields to save', () => {
    it('trimming the text and keeping the line breaks inside it', () => {
      const fields = voyageFieldsOf(form({
        voyageNo: '  V-1 ', lastPort: ' Santos ', nextPort: 'Rotterdam  ', cargo: ' Corn ', charterers: ' ADM ',
        agents: '  Wilhelmsen Rotterdam\n+31 10 555 0100\n ',
      }));
      expect(fields).toEqual({
        voyageNo: 'V-1', lastPort: 'Santos', nextPort: 'Rotterdam', etaLocal: '2026-11-02T14:30', etaOffsetMinutes: 60,
        cargo: 'Corn', charterers: 'ADM', agents: 'Wilhelmsen Rotterdam\n+31 10 555 0100',
      });
    });
    it('with an empty ETA as empty text, and the offset it has', () => {
      expect(voyageFieldsOf(form({ etaLocal: '' }))).toMatchObject({ etaLocal: '', etaOffsetMinutes: 60 });
    });
    it('and nothing else', () => {
      expect(Object.keys(voyageFieldsOf(form())).sort()).toEqual([...VOYAGE_CONTROLS].sort());
    });
  });

  describe('has a problem', () => {
    it('with an ETA that is not a date and time, at the ETA', () => {
      expect(voyageProblems(form({ etaLocal: '2026-13-45T99:00' }))).toEqual([
        { field: 'etaLocal', severity: 'error', message: ETA_INVALID },
      ]);
      expect(voyageProblems(form({ etaLocal: '2026-11-02' }))).toHaveLength(1);
    });
    it('with nothing else: no field is required, and an empty voyage is fine', () => {
      expect(voyageProblems(form())).toEqual([]);
      expect(voyageProblems(form({ etaLocal: '' }))).toEqual([]);
      expect(voyageProblems(blankVoyageForm(0))).toEqual([]);
    });
  });
});
