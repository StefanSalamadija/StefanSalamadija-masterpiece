import { describe, expect, it } from 'vitest';
import { shipDeleteText } from './shipDeleteText';

describe('shipDeleteText', () => {
  it('says what deleting removes, and that a backup still has it', () => {
    expect(shipDeleteText({ crew: 0, certificates: 0, voyages: 0 })).toBe(
      'This removes 0 crew, 0 certificates and 0 voyages from this device. A backup made earlier still contains them.',
    );
    expect(shipDeleteText({ crew: 21, certificates: 14, voyages: 3 })).toBe(
      'This removes 21 crew, 14 certificates and 3 voyages from this device. A backup made earlier still contains them.',
    );
  });

  it('uses the singular for one certificate or one voyage, and never changes "crew"', () => {
    expect(shipDeleteText({ crew: 1, certificates: 1, voyages: 1 })).toBe(
      'This removes 1 crew, 1 certificate and 1 voyage from this device. A backup made earlier still contains them.',
    );
    expect(shipDeleteText({ crew: 2, certificates: 1, voyages: 0 })).toContain('2 crew, 1 certificate and 0 voyages');
  });

  it('ignores the clock-change count of a deleteSummary result', () => {
    const summary = { crew: 0, certificates: 0, voyages: 0, clockChanges: 4 }; // what `deleteSummary` returns
    expect(shipDeleteText(summary)).toContain('0 crew, 0 certificates and 0 voyages');
  });
});
