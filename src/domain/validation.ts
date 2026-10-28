import { isValidMaxMonths, MAX_MONTHS_ONBOARD_LIMIT } from './contracts';
import { isValidIsoDate } from './dates';
import type { Certificate, CrewDraft, FieldError, Particulars } from './types';

const MSG_DATE = 'Enter a valid date.';
const MSG_POSITIVE = 'Must be a positive number.';
const MSG_CONTRACT_MONTHS = 'Enter whole months between 1 and 24.';
const MSG_MAX_MONTHS_ONBOARD = `Enter a number from 1 to ${MAX_MONTHS_ONBOARD_LIMIT}.`;
const MAX_CONTRACT_MONTHS = 24;

/** Strips whitespace and a leading `IMO` prefix. */
export function normaliseImo(s: string): string {
  return s.replace(/\s+/g, '').replace(/^imo/i, '');
}

/** Seven digits whose last digit equals (d1×7 + d2×6 + d3×5 + d4×4 + d5×3 + d6×2) mod 10. */
export function isValidImo(s: string): boolean {
  const imo = normaliseImo(s);
  if (!/^\d{7}$/.test(imo)) return false;
  const sum = [7, 6, 5, 4, 3, 2].reduce((acc, weight, i) => acc + weight * Number(imo[i]), 0);
  return sum % 10 === Number(imo[6]);
}

export function isValidMmsi(s: string): boolean {
  return /^\d{9}$/.test(s.trim());
}

const error = (field: string, message: string): FieldError => ({ field, message, severity: 'error' });

/** Returns the date when it is filled in and real. An empty one is fine (undefined); a bad one adds an error. */
function checkDate(field: string, value: string | undefined, out: FieldError[]): string | undefined {
  if (!value) return undefined;
  if (!isValidIsoDate(value)) {
    out.push(error(field, MSG_DATE));
    return undefined;
  }
  return value;
}

/** Nothing is required. Empty IMO/MMSI are skipped. A bad IMO check digit is only a warning. */
export function validateParticulars(p: Particulars): FieldError[] {
  const out: FieldError[] = [];
  if (normaliseImo(p.imo) !== '' && !isValidImo(p.imo)) {
    out.push({ field: 'imo', severity: 'warning', message: "IMO check digit doesn't match — please re-check the number." });
  }
  if (p.mmsi.trim() !== '' && !isValidMmsi(p.mmsi)) out.push(error('mmsi', 'MMSI must be 9 digits.'));
  for (const field of ['gt', 'nt', 'dwt', 'loa', 'beam'] as const) {
    const value = p[field];
    if (value !== undefined && !(value > 0)) out.push(error(field, MSG_POSITIVE));
  }
  return out;
}

/** Owns every required-field and date check for a crew record. Findings follow the field order of CrewDraft. */
export function validateCrewMember(m: CrewDraft, today: string): FieldError[] {
  const out: FieldError[] = [];
  if (m.surname.trim() === '') out.push(error('surname', 'Surname is required.'));
  if (m.rank === 'other' && !m.rankOther?.trim()) out.push(error('rank', 'Rank is required.'));
  const dateOfBirth = checkDate('dateOfBirth', m.dateOfBirth, out);
  if (dateOfBirth && dateOfBirth >= today) out.push(error('dateOfBirth', 'Date of birth must be in the past.'));
  checkDate('passportExpiry', m.passportExpiry, out);
  checkDate('seamansBookExpiry', m.seamansBookExpiry, out);
  const signOn = checkDate('signOnDate', m.signOnDate, out);
  if (!m.signOnDate) out.push(error('signOnDate', 'Sign-on date is required.'));
  const signOff = checkDate('signOffDate', m.signOffDate, out);
  if (signOn && signOff && signOff < signOn) out.push(error('signOffDate', "Sign-off can't be before sign-on."));
  const months = m.contractMonths;
  if (months !== undefined && !(Number.isInteger(months) && months >= 1 && months <= MAX_CONTRACT_MONTHS)) {
    out.push(error('contractMonths', MSG_CONTRACT_MONTHS));
  }
  const relief = checkDate('reliefPlannedDate', m.reliefPlannedDate, out);
  if (signOn && relief && relief < signOn) out.push(error('reliefPlannedDate', "Planned relief can't be before sign-on."));
  return out;
}

/**
 * The ship's limit on the months a crew member stays onboard: blank (undefined) means the default; otherwise whole
 * months from 1 to 11, the most the Maritime Labour Convention allows. Text that is not a number is given as NaN.
 */
export function validateMaxMonthsOnboard(months: number | undefined): FieldError | undefined {
  if (months === undefined) return undefined;
  return isValidMaxMonths(months) ? undefined : error('maxMonthsOnboard', MSG_MAX_MONTHS_ONBOARD);
}

/** The name is required; dates are optional but must be real, and expiry can't precede issue. */
export function validateCertificate(
  c: Pick<Certificate, 'issueDate' | 'expiryDate' | 'nextSurveyDue' | 'name'>,
): FieldError[] {
  const out: FieldError[] = [];
  if (c.name.trim() === '') out.push(error('name', 'Certificate name is required.'));
  const issue = checkDate('issueDate', c.issueDate, out);
  const expiry = checkDate('expiryDate', c.expiryDate, out);
  if (issue && expiry && expiry < issue) out.push(error('expiryDate', "Expiry date can't be before the issue date."));
  checkDate('nextSurveyDue', c.nextSurveyDue, out);
  return out;
}

/**
 * A crew document: one has to be chosen, and Other needs its name; dates are optional but must be real, and expiry
 * can't precede issue. `type` is the catalogue key, or empty while none is chosen.
 */
export function validateCrewDocument(
  d: { type: string; typeOther?: string; issueDate: string; expiryDate?: string },
): FieldError[] {
  const out: FieldError[] = [];
  if (d.type === '') out.push(error('type', 'Document is required.'));
  else if (d.type === 'other' && !d.typeOther?.trim()) out.push(error('typeOther', 'Document name is required.'));
  const issue = checkDate('issueDate', d.issueDate, out);
  const expiry = checkDate('expiryDate', d.expiryDate, out);
  if (issue && expiry && expiry < issue) out.push(error('expiryDate', "Expiry date can't be before the issue date."));
  return out;
}
