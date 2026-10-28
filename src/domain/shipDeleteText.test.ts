import { describe, expect, it } from 'vitest';
import { shipDeleteText } from './shipDeleteText';

const none = { crew: 0, certificates: 0, voyages: 0, crewDocuments: 0, clockChanges: 0 };

describe('shipDeleteText', () => {
  it('says what deleting removes, crew documents and clock changes included, and that a backup still has it', () => {
    expect(shipDeleteText({ crew: 1, certificates: 2, voyages: 0, crewDocuments: 3, clockChanges: 1 })).toBe(
      'This removes 1 crew, 2 certificates, 0 voyages, 3 crew documents and 1 clock change from this device. A backup made earlier still contains them.',
    );
    expect(shipDeleteText(none)).toBe(
      'This removes 0 crew, 0 certificates, 0 voyages, 0 crew documents and 0 clock changes from this device. A backup made earlier still contains them.',
    );
    expect(shipDeleteText({ crew: 21, certificates: 14, voyages: 3, crewDocuments: 60, clockChanges: 4 })).toBe(
      'This removes 21 crew, 14 certificates, 3 voyages, 60 crew documents and 4 clock changes from this device. A backup made earlier still contains them.',
    );
  });

  it('uses the singular for exactly one of a certificate, a voyage, a crew document or a clock change, and never changes "crew"', () => {
    expect(shipDeleteText({ crew: 1, certificates: 1, voyages: 1, crewDocuments: 1, clockChanges: 1 })).toBe(
      'This removes 1 crew, 1 certificate, 1 voyage, 1 crew document and 1 clock change from this device. A backup made earlier still contains them.',
    );
    expect(shipDeleteText({ ...none, crew: 2, certificates: 1 })).toContain('2 crew, 1 certificate, 0 voyages');
    expect(shipDeleteText({ ...none, crewDocuments: 2, clockChanges: 1 })).toContain('2 crew documents and 1 clock change from');
    expect(shipDeleteText({ ...none, crewDocuments: 1, clockChanges: 2 })).toContain('1 crew document and 2 clock changes from');
  });
});
