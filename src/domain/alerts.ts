import { fullName, onboardAt } from './crew';
import { certificateExpiryBand, crewDocExpiryBand } from './expiry';
import type { Band, Certificate, CrewMember } from './types';

/** What an alert is about. A new source of dates adds its kind here and a collector below. */
export type AlertKind = 'crewDoc' | 'certificate';

/** The two bands that warn; a date that is ok, or that is not there, makes no alert. */
type Warning = 'amber' | 'red';

/** One thing to look at on the Home screen. The dates in `detail` are shown as kept, year first. */
export interface Alert {
  kind: AlertKind;
  band: Warning;
  /** Who or what: a person's full name, a certificate's name. */
  title: string;
  /** What is wrong and when: `Passport expires 2027-01-10`, `Survey overdue 2026-10-02`. */
  detail: string;
  /** The screen that edits the record. */
  href: string;
}

/** An alert and the date it names, which only the order needs. */
interface Dated {
  alert: Alert;
  date: string;
}

/** A date of a record that warns, with the sentence it makes. */
interface Flag {
  date: string;
  band: Warning;
  detail: string;
}

/** The words that start the detail, for a date that is amber and for one that is red. */
type Words = Record<Warning, string>;

const PASSPORT: Words = { amber: 'Passport expires', red: 'Passport expired' };
const SEAMANS_BOOK: Words = { amber: "Seaman's book expires", red: "Seaman's book expired" };
const CERTIFICATE_EXPIRY: Words = { amber: 'Expires', red: 'Expired' };
const CERTIFICATE_SURVEY: Words = { amber: 'Survey due', red: 'Survey overdue' };

/** Red before amber. */
const WORSE_FIRST: Record<Warning, number> = { red: 0, amber: 1 };

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The flag for one date, or nothing when the date is not there or does not warn. */
function flag(date: string | undefined, band: Band, words: Words): Flag | undefined {
  if (!date || (band !== 'amber' && band !== 'red')) return undefined;
  return { date, band, detail: `${words[band]} ${date}` };
}

/**
 * The flag a record is shown by when it has several: the worse band, and between two of the same band the earlier date.
 * Of two that are alike in both, the first one listed is kept.
 */
function worstFlag(flags: (Flag | undefined)[]): Flag | undefined {
  let worst: Flag | undefined;
  for (const candidate of flags) {
    if (!candidate) continue;
    const better =
      !worst ||
      WORSE_FIRST[candidate.band] < WORSE_FIRST[worst.band] ||
      (candidate.band === worst.band && candidate.date < worst.date);
    if (better) worst = candidate;
  }
  return worst;
}

/** The alert for a record shown by `worst`, with the date it names; none when the record has nothing that warns. */
function alertFrom(worst: Flag | undefined, rest: Pick<Alert, 'kind' | 'title' | 'href'>): Dated[] {
  return worst ? [{ date: worst.date, alert: { ...rest, band: worst.band, detail: worst.detail } }] : [];
}

/** Passports and seaman's books of the crew onboard on `today`: one alert for each person who has either to look at. */
function crewDocAlerts(crew: CrewMember[], today: string): Dated[] {
  return onboardAt(crew, today).flatMap((m) =>
    alertFrom(
      worstFlag([
        flag(m.passportExpiry, crewDocExpiryBand(m.passportExpiry, today), PASSPORT),
        flag(m.seamansBookExpiry, crewDocExpiryBand(m.seamansBookExpiry, today), SEAMANS_BOOK),
      ]),
      { kind: 'crewDoc', title: fullName(m), href: `#/ship/crew/${encodeURIComponent(m.id)}` },
    ),
  );
}

/** Expiries and next surveys of the certificates that are not deleted: one alert for each certificate that has either to look at. */
function certificateAlerts(certificates: Certificate[], today: string): Dated[] {
  return certificates
    .filter((c) => !c.deleted)
    .flatMap((c) =>
      alertFrom(
        worstFlag([
          flag(c.expiryDate, certificateExpiryBand(c.expiryDate, today), CERTIFICATE_EXPIRY),
          flag(c.nextSurveyDue, certificateExpiryBand(c.nextSurveyDue, today), CERTIFICATE_SURVEY),
        ]),
        { kind: 'certificate', title: c.name, href: `#/ship/certificates/${encodeURIComponent(c.id)}` },
      ),
    );
}

/** Red first, then the earlier date; alerts alike in both are told apart by title and then by link, so the order is always the same. */
function compareDated(a: Dated, b: Dated): number {
  return (
    WORSE_FIRST[a.alert.band] - WORSE_FIRST[b.alert.band] ||
    compareText(a.date, b.date) ||
    a.alert.title.localeCompare(b.alert.title) ||
    compareText(a.alert.href, b.alert.href)
  );
}

/**
 * What needs looking at on `today` (the ship's date, `YYYY-MM-DD`), worst first: red before amber, and by date inside
 * each. A record with two dates that warn makes one alert, for the worse band, or the earlier date of the same band.
 * Crew who are not onboard on `today`, and deleted records, make none.
 */
export function collectAlerts(input: { crew: CrewMember[]; certificates: Certificate[]; today: string }): Alert[] {
  return [...crewDocAlerts(input.crew, input.today), ...certificateAlerts(input.certificates, input.today)]
    .sort(compareDated)
    .map(({ alert }) => alert);
}
