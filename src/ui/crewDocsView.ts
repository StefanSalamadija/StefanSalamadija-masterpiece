import { addDays, isValidLocalDateTime } from '../domain/dates';
import type { ExpiringItem } from '../domain/crewDocs';
import type { CrewDocument, Voyage } from '../domain/types';

/** With no ETA to go by, the Expiring screen looks this many days ahead. */
export const EXPIRING_DAYS = 90;

export const NO_ETA_TEXT = `No next port ETA set — showing the next ${EXPIRING_DAYS} days.`;

/** How far the Expiring screen looks: up to the day `until` (`YYYY-MM-DD`), and the line that says why. */
export interface ExpiringWindow {
  until: string;
  text: string;
}

/**
 * The window of the Expiring screen. With an active voyage that has an ETA it is the date of the ETA, as the port wrote
 * it (the date part of `etaLocal`, whatever its UTC offset): "Next port Rotterdam, ETA 2027-01-05". Without a voyage, or
 * with no ETA (or one that is not a date and time), it is the next 90 days from `today`.
 */
export function expiringWindow(voyage: Voyage | undefined, today: string): ExpiringWindow {
  if (voyage && isValidLocalDateTime(voyage.etaLocal)) {
    const until = voyage.etaLocal.slice(0, 10);
    return { until, text: `Next port ${voyage.nextPort.trim() || '—'}, ETA ${until}` };
  }
  return { until: addDays(today, EXPIRING_DAYS), text: NO_ETA_TEXT };
}

/** What a row of the Expiring screen says beside the name: "Medical fitness certificate expires 2026-12-24", or "expired" once it has. */
export function expiringDetail({ what, expiryDate, band }: Pick<ExpiringItem, 'what' | 'expiryDate' | 'band'>): string {
  return `${what} ${band === 'red' ? 'expired' : 'expires'} ${expiryDate}`;
}

/** What a row of the Documents section says beside the label, for the parts that are filled in: "Master (unlimited)", "No. M-1", "Expires 2026-12-24". */
export function documentDetails(d: CrewDocument): string[] {
  const details: string[] = [];
  if (d.grade) details.push(d.grade);
  if (d.number) details.push(`No. ${d.number}`);
  if (d.expiryDate) details.push(`Expires ${d.expiryDate}`);
  return details;
}
