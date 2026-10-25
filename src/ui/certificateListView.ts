import { certificateBand } from '../domain/expiry';
import type { Band, Certificate } from '../domain/types';

/** A certificate with the warning it has on the day the list is made for. */
export interface CertificateRow {
  certificate: Certificate;
  band: Band;
}

/** Red first, then amber, then the rest (a certificate with nothing to warn about, or no dates). */
const BAND_ORDER: Record<Band, number> = { red: 0, amber: 1, ok: 2, none: 2 };

/**
 * The register as it is listed: overdue certificates first, then those due soon, then the rest, and by name inside
 * each of the three (as the alphabet of the device has it, ignoring case). `today` is the ship's date.
 */
export function certificateRows(certificates: Certificate[], today: string): CertificateRow[] {
  return certificates
    .map((certificate) => ({ certificate, band: certificateBand(certificate, today) }))
    .sort((a, b) => BAND_ORDER[a.band] - BAND_ORDER[b.band] || a.certificate.name.localeCompare(b.certificate.name));
}

/**
 * What a row says about a certificate beside its name, for the parts that are filled in: "No. LL-1", "Expires
 * 2026-12-24", "Next survey 2026-11-01". Dates are shown as kept, year first; the print format is for print only.
 */
export function certificateDetails(c: Certificate): string[] {
  const details: string[] = [];
  if (c.number) details.push(`No. ${c.number}`);
  if (c.expiryDate) details.push(`Expires ${c.expiryDate}`);
  if (c.nextSurveyDue) details.push(`Next survey ${c.nextSurveyDue}`);
  return details;
}
