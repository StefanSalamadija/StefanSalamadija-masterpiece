import { RANKS } from './catalogues';
import { isValidIsoDate } from './dates';
import type { CrewDraft, CrewMember } from './types';

/**
 * True when the contract covers `date` (`YYYY-MM-DD`): sign-on on or before it, and no sign-off or a sign-off on or after it.
 * Dates only; whether the record is deleted is `onboardAt`'s concern.
 */
export function isOnboardAt(m: CrewMember, date: string): boolean {
  return m.signOnDate <= date && (!m.signOffDate || m.signOffDate >= date);
}

function rankOrder(m: CrewMember): number {
  const i = RANKS.findIndex((r) => r.key === m.rank);
  return i < 0 ? RANKS.length : i;
}

/** Rank order, then sign-on date, then surname. */
function compareCrew(a: CrewMember, b: CrewMember): number {
  return (
    rankOrder(a) - rankOrder(b) ||
    (a.signOnDate < b.signOnDate ? -1 : a.signOnDate > b.signOnDate ? 1 : 0) ||
    a.surname.localeCompare(b.surname)
  );
}

/** Non-deleted crew onboard at `date`, as a new array sorted by rank order, then sign-on date, then surname. */
export function onboardAt(crew: CrewMember[], date: string): CrewMember[] {
  return crew.filter((m) => !m.deleted && isOnboardAt(m, date)).sort(compareCrew);
}

/** Which contracts the crew list shows: those onboard at a date, or every one. */
export type CrewView = 'onboard' | 'all';

/** What the crew list shows: `onboardAt(crew, asAt)`, or every non-deleted contract in the same order, whatever the date. */
export function visibleCrew(crew: CrewMember[], view: CrewView, asAt: string): CrewMember[] {
  return view === 'onboard' ? onboardAt(crew, asAt) : crew.filter((m) => !m.deleted).sort(compareCrew);
}

export function fullName(m: Pick<CrewMember, 'givenNames' | 'surname'>): string {
  return `${m.givenNames} ${m.surname}`.trim();
}

/** Uppercase with all whitespace removed, so `p 123 45` and `P12345` match. */
export function normalisePassport(s: string): string {
  return s.replace(/\s+/g, '').toUpperCase();
}

/** The non-deleted contract with the latest sign-on date for this passport number; a blank number matches nothing. */
export function latestContractByPassport(crew: CrewMember[], passportNo: string): CrewMember | undefined {
  const wanted = normalisePassport(passportNo);
  if (!wanted) return undefined;
  let latest: CrewMember | undefined;
  for (const m of crew) {
    if (m.deleted || normalisePassport(m.passportNo) !== wanted) continue;
    if (!latest || m.signOnDate > latest.signOnDate) latest = m;
  }
  return latest;
}

/** A new contract for a returning crew member: their details carried over, a new sign-on, and no sign-off. */
export function rejoinDraft(m: CrewMember, signOnDate: string, signOnPort: string): CrewDraft {
  return {
    surname: m.surname,
    givenNames: m.givenNames,
    rank: m.rank,
    ...(m.rankOther !== undefined && { rankOther: m.rankOther }),
    nationality: m.nationality,
    dateOfBirth: m.dateOfBirth,
    placeOfBirth: m.placeOfBirth,
    passportNo: m.passportNo,
    passportExpiry: m.passportExpiry,
    seamansBookNo: m.seamansBookNo,
    seamansBookExpiry: m.seamansBookExpiry,
    signOnDate,
    signOnPort,
  };
}

/** Upper case with the spaces tidied, so `Petrović  Ivan` and `PETROVIĆ ivan` match. */
function normaliseName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Who a contract belongs to: the passport number (spaces and case ignored) when there is one, else the surname, given
 * names and date of birth, but only when all three are filled in. `undefined` when neither can be had: such a
 * contract is not linked to any other.
 */
export function personKey(m: Pick<CrewMember, 'passportNo' | 'surname' | 'givenNames' | 'dateOfBirth'>): string | undefined {
  const passport = normalisePassport(m.passportNo);
  if (passport) return `passport:${passport}`;
  const surname = normaliseName(m.surname);
  const givenNames = normaliseName(m.givenNames);
  const dateOfBirth = m.dateOfBirth.trim();
  return surname && givenNames && dateOfBirth ? `name:${surname}|${givenNames}|${dateOfBirth}` : undefined;
}

type ContractSpan = Pick<CrewMember, 'passportNo' | 'surname' | 'givenNames' | 'dateOfBirth' | 'signOnDate' | 'signOffDate'>;

/** True when two contracts share a day. Both end days count, and a contract without a sign-off has no end. */
function overlaps(a: Pick<CrewMember, 'signOnDate' | 'signOffDate'>, b: Pick<CrewMember, 'signOnDate' | 'signOffDate'>): boolean {
  return (!b.signOffDate || a.signOnDate <= b.signOffDate) && (!a.signOffDate || b.signOnDate <= a.signOffDate);
}

/**
 * The contract of the same person that `candidate` runs into, if any: the one that started first among them. One
 * person's contracts on a ship must never overlap. `candidate.id` (when it is a saved contract) and deleted contracts
 * are left out. Nothing is found while the sign-on date is empty or not a date, since there is no span to check.
 */
export function overlappingContract(candidate: ContractSpan & { id?: string }, crew: CrewMember[]): CrewMember | undefined {
  const key = personKey(candidate);
  if (!key || !isValidIsoDate(candidate.signOnDate)) return undefined;
  let first: CrewMember | undefined;
  for (const m of crew) {
    if (m.deleted || m.id === candidate.id || personKey(m) !== key || !overlaps(candidate, m)) continue;
    if (!first || m.signOnDate < first.signOnDate) first = m;
  }
  return first;
}

/**
 * Whether the contract `m` can be followed by a new one: it is signed off, it is the person's latest (by sign-on), and
 * none of the person's contracts is open. A contract that cannot be linked to anyone stands alone.
 */
export function canRejoin(m: CrewMember, crew: CrewMember[]): boolean {
  if (!m.signOffDate) return false;
  const key = personKey(m);
  if (!key) return true;
  // A contract of the same person that is still open, or that starts later.
  const sameLater = (other: CrewMember): boolean =>
    !other.deleted && other.id !== m.id && personKey(other) === key && (!other.signOffDate || other.signOnDate > m.signOnDate);
  return !crew.some(sameLater);
}
