import type { Alert, AlertKind } from '../domain/alerts';
import { daysBetween, shortDate } from '../domain/dates';

export { daysBetween, shortDate };

/** What the Due list says when nothing is due. */
export const NOTHING_DUE = '✓ Nothing due';

/** The alerts of the crew's own papers: passports, seaman's books and documents. */
export const CREW_DOC_KINDS: readonly AlertKind[] = ['crewDoc', 'crewCertificate'];

/** `in 14 d`, `today` or `5 d over`: the days from `today` to `due`, in words, so that the chip never relies on its colour. */
export function dueChipText(due: string, today: string): string {
  const days = daysBetween(today, due);
  return days > 0 ? `in ${days} d` : days === 0 ? 'today' : `${-days} d over`;
}

/** One row of a Due list: a title, a meta line and a chip. `tone` is the status style (overdue filled, due soon outlined). */
export interface DueRowView {
  key: string;
  href: string;
  tone: 'warn' | 'danger';
  title: string;
  meta: string;
  chip: string;
}

/**
 * An alert as a Due row. A crew alert is titled by what is due and whose (`Passport · 2nd Officer R. EXAMPLE`), with a
 * meta line that suits it: `Expired 12 Nov` or `Expires 12 Dec` for a paper, `Relief planned 5 Dec` or `Relief not planned`
 * for a contract, `Reached 3 Nov` or `Reaches 3 Dec` for the onboard limit. A ship certificate keeps its title, and its meta
 * is what and when (`Ship certificate · 1 Dec`).
 */
export function dueRow(alert: Alert, today: string): DueRowView {
  const { key, href, band, kind, what, due, person, reliefPlanned } = alert;
  const red = band === 'red';
  const date = shortDate(due, today);
  let title = alert.title;
  let meta = `${what} · ${date}`;
  if (person) {
    title = `${what} · ${[person.rank, person.name].filter(Boolean).join(' ')}`;
    if (kind === 'contract') meta = reliefPlanned ? `Relief planned ${shortDate(reliefPlanned, today)}` : 'Relief not planned';
    else if (kind === 'onboardLimit') meta = `${red ? 'Reached' : 'Reaches'} ${date}`;
    else meta = `${red ? 'Expired' : 'Expires'} ${date}`;
  }
  return { key, href, tone: red ? 'danger' : 'warn', title, meta, chip: dueChipText(due, today) };
}

/** The alerts split into overdue (red) and due soon (amber), each in the order given. */
export function groupDue(alerts: Alert[]): { overdue: Alert[]; soon: Alert[] } {
  return { overdue: alerts.filter((a) => a.band === 'red'), soon: alerts.filter((a) => a.band === 'amber') };
}
