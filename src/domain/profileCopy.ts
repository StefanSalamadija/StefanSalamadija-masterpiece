import { isValidMaxMonths } from './contracts';
import type { BaseRecord, Certificate, Particulars, ShipProfile } from './types';

/** Particulars for a sister ship: everything is kept except the identity (IMO, call sign, MMSI), which must be entered again. */
export function copyParticulars(p: Particulars, newName: string): Particulars {
  return { ...p, name: newName, imo: '', callSign: '', mmsi: '' };
}

/**
 * The crew policy of a sister ship: the source's limit on the months onboard, which is the company's rule and not one
 * ship's. A ship on the default has none to copy, and a damaged stored limit is not copied.
 */
export function copyCrewPolicy(source: Pick<ShipProfile, 'maxMonthsOnboard'>): Pick<ShipProfile, 'maxMonthsOnboard'> {
  return isValidMaxMonths(source.maxMonthsOnboard) ? { maxMonthsOnboard: source.maxMonthsOnboard } : {};
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
