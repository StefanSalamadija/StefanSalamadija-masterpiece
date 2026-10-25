import type { BaseRecord, Certificate, Particulars } from './types';

/** Particulars for a sister ship: everything is kept except the identity (IMO, call sign, MMSI), which must be entered again. */
export function copyParticulars(p: Particulars, newName: string): Particulars {
  return { ...p, name: newName, imo: '', callSign: '', mmsi: '' };
}

/**
 * A certificate reduced to its name: what a sister ship needs to be listed, with nothing that belongs to one issued
 * certificate. The cleared dates are present as `undefined`, so a saved shell reads back with them explicitly empty.
 */
export function certificateShell(c: Certificate): Omit<Certificate, keyof BaseRecord | 'shipId'> {
  return {
    key: c.key, name: c.name,
    number: '', issuedBy: '', issueDate: '', expiryDate: undefined, nextSurveyDue: undefined, remarks: '',
  };
}
