import { contractBand, contractEndDate, onboardLimitBand, onboardLimitDate, validMaxMonths } from './contracts';
import { fullName, onboardAt } from './crew';
import { docBand, docLabel } from './crewDocs';
import { certificateExpiryBand, crewDocExpiryBand } from './expiry';
import type { Band, Certificate, CrewDocument, CrewMember } from './types';

/** What an alert is about. A new source of dates adds its kind here and a collector below. */
export type AlertKind = 'crewDoc' | 'certificate' | 'crewCertificate' | 'contract' | 'onboardLimit';

/** The two bands that warn; a date that is ok, or that is not there, makes no alert. */
type Warning = 'amber' | 'red';

/** One thing to look at on the Home screen. The dates in `detail` are shown as kept, year first. */
export interface Alert {
  /** Tells the alert from every other, whoever else has the same name and dates: the kind and the id of the record (`contract:<crew id>`, `crewCertificate:<document id>`). */
  key: string;
  kind: AlertKind;
  band: Warning;
  /** Who or what: a person's full name (also for their documents), a certificate's name. */
  title: string;
  /** What is wrong and when: `Passport expires 2027-01-10`, `Survey overdue 2026-10-02`, `Contract ends 2026-12-01`, `Medical fitness certificate expired 2026-09-01`. */
  detail: string;
  /** The screen that edits the record; for a contract or an onboard limit, the reliefs, where the crew to relieve are listed. */
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
const CONTRACT: Words = { amber: 'Contract ends', red: 'Contract ended' };
const RELIEF_OVERDUE = ' — relief overdue';
const RELIEFS = '#/ship/reliefs';

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
function alertFrom(worst: Flag | undefined, rest: Pick<Alert, 'key' | 'kind' | 'title' | 'href'>): Dated[] {
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
      { key: `crewDoc:${m.id}`, kind: 'crewDoc', title: fullName(m), href: `#/ship/crew/${encodeURIComponent(m.id)}` },
    ),
  );
}

/**
 * Documents (CoC, medical, courses, visas) of the crew onboard on `today`: one alert for each document that expires
 * within 90 days or has expired, named by the person and the document (`Medical fitness certificate expires 2026-12-24`).
 */
function crewCertificateAlerts(crew: CrewMember[], docs: CrewDocument[], today: string): Dated[] {
  const onboard = new Map(onboardAt(crew, today).map((m) => [m.id, m]));
  return docs
    .filter((d) => !d.deleted)
    .flatMap((d) => {
      const member = onboard.get(d.crewId);
      if (!member) return [];
      const words: Words = { amber: `${docLabel(d)} expires`, red: `${docLabel(d)} expired` };
      return alertFrom(flag(d.expiryDate, docBand(d, today), words), {
        key: `crewCertificate:${d.id}`, kind: 'crewCertificate', title: fullName(member), href: `#/ship/crew/${encodeURIComponent(member.id)}`,
      });
    });
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
        { key: `certificate:${c.id}`, kind: 'certificate', title: c.name, href: `#/ship/certificates/${encodeURIComponent(c.id)}` },
      ),
    );
}

/**
 * Contracts of the crew onboard on `today` that end within 30 days or have ended: one alert for each, which says the
 * relief is overdue once the end is past. A contract with no length has no end and makes none.
 */
function contractAlerts(crew: CrewMember[], today: string): Dated[] {
  return onboardAt(crew, today).flatMap((m) => {
    const end = contractEndDate(m);
    const found = flag(end, contractBand(m, today), CONTRACT);
    const worst = found && (found.band === 'red' ? { ...found, detail: `${found.detail}${RELIEF_OVERDUE}` } : found);
    return alertFrom(worst, { key: `contract:${m.id}`, kind: 'contract', title: fullName(m), href: RELIEFS });
  });
}

/**
 * The limit on the months onboard (`maxMonths`, the ship's) for the crew onboard on `today`: one alert for each who
 * reaches it within 30 days or has reached it, whether or not their contract has a length. A limit that is not whole
 * months from 1 to 11 (a damaged ship record) is the default, in the words as in the dates.
 */
function onboardLimitAlerts(crew: CrewMember[], today: string, maxMonths: number): Dated[] {
  const months = validMaxMonths(maxMonths);
  const words: Words = { amber: `Reaches ${months}-month onboard limit`, red: `Over ${months}-month onboard limit since` };
  return onboardAt(crew, today).flatMap((m) => {
    const band = onboardLimitBand(m, today, months);
    // The date is only worked out for a band that warns: the sign-on of a damaged record may not be a date.
    const date = band === 'amber' || band === 'red' ? onboardLimitDate(m, months) : undefined;
    return alertFrom(flag(date, band, words), { key: `onboardLimit:${m.id}`, kind: 'onboardLimit', title: fullName(m), href: RELIEFS });
  });
}

/**
 * Red first, then the earlier date; alerts alike in both are told apart by title, then by link, then by detail, so the
 * order is always the same.
 */
function compareDated(a: Dated, b: Dated): number {
  return (
    WORSE_FIRST[a.alert.band] - WORSE_FIRST[b.alert.band] ||
    compareText(a.date, b.date) ||
    a.alert.title.localeCompare(b.alert.title) ||
    compareText(a.alert.href, b.alert.href) ||
    compareText(a.alert.detail, b.alert.detail)
  );
}

/**
 * What needs looking at on `today` (the ship's date, `YYYY-MM-DD`), worst first: red before amber, and by date inside
 * each. A record with two dates that warn makes one alert, for the worse band, or the earlier date of the same band;
 * the exception is a crew member's contract end and onboard limit (`maxMonthsOnboard`, the ship's), which are two alerts.
 * Each crew document has an alert of its own. Crew who are not onboard on `today` (nor their documents), and deleted
 * records, make none.
 */
export function collectAlerts(
  input: { crew: CrewMember[]; certificates: Certificate[]; crewDocuments: CrewDocument[]; today: string; maxMonthsOnboard: number },
): Alert[] {
  const { crew, certificates, crewDocuments, today, maxMonthsOnboard } = input;
  return [
    ...crewDocAlerts(crew, today),
    ...crewCertificateAlerts(crew, crewDocuments, today),
    ...certificateAlerts(certificates, today),
    ...contractAlerts(crew, today),
    ...onboardLimitAlerts(crew, today, maxMonthsOnboard),
  ]
    .sort(compareDated)
    .map(({ alert }) => alert);
}
