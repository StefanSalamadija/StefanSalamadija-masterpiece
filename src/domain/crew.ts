import { RANKS } from './catalogues';
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

/** Non-deleted crew onboard at `date`, as a new array sorted by rank order, then sign-on date, then surname. */
export function onboardAt(crew: CrewMember[], date: string): CrewMember[] {
  return crew
    .filter((m) => !m.deleted && isOnboardAt(m, date))
    .sort(
      (a, b) =>
        rankOrder(a) - rankOrder(b) ||
        (a.signOnDate < b.signOnDate ? -1 : a.signOnDate > b.signOnDate ? 1 : 0) ||
        a.surname.localeCompare(b.surname),
    );
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
