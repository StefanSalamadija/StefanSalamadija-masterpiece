import { addDays, addMonths, isValidIsoDate } from './dates';
import type { Band, Certificate, CrewDraft } from './types';

const BAND_RANK: Record<Band, number> = { none: 0, ok: 1, amber: 2, red: 3 };

const CREW_DOC_WINDOW = { months: 6 };
const CERTIFICATE_WINDOW = { days: 90 };

/**
 * Red if `expiry` is before `ref`; amber if it falls on or before `ref` plus the window
 * (a document expiring on `ref` is still valid, so amber); otherwise ok.
 * 'none' when there is no expiry, or it is not a valid date.
 */
export function expiryBand(expiry: string | undefined, ref: string, window: { months?: number; days?: number }): Band {
  if (!expiry || !isValidIsoDate(expiry)) return 'none';
  if (expiry < ref) return 'red';
  const limit = addDays(addMonths(ref, window.months ?? 0), window.days ?? 0);
  return expiry <= limit ? 'amber' : 'ok';
}

export function worstBand(...b: Band[]): Band {
  return b.reduce<Band>((worst, band) => (BAND_RANK[band] > BAND_RANK[worst] ? band : worst), 'none');
}

/** One crew document's band (a passport or a seaman's book), amber from 6 months out. */
export function crewDocExpiryBand(expiry: string | undefined, ref: string): Band {
  return expiryBand(expiry, ref, CREW_DOC_WINDOW);
}

/** One certificate date's band (an expiry or a next survey), amber from 90 days out. */
export function certificateExpiryBand(date: string | undefined, ref: string): Band {
  return expiryBand(date, ref, CERTIFICATE_WINDOW);
}

/** Worst of passport and seaman's book. */
export function crewDocBand(m: CrewDraft, ref: string): Band {
  return worstBand(crewDocExpiryBand(m.passportExpiry, ref), crewDocExpiryBand(m.seamansBookExpiry, ref));
}

/** Worst of expiry and next survey. */
export function certificateBand(c: Pick<Certificate, 'expiryDate' | 'nextSurveyDue'>, ref: string): Band {
  return worstBand(certificateExpiryBand(c.expiryDate, ref), certificateExpiryBand(c.nextSurveyDue, ref));
}
