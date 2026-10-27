import { contractBand, contractEndDate, daysOnboard, onboardLimitBand } from '../domain/contracts';
import { onboardAt } from '../domain/crew';
import type { Band, CrewMember } from '../domain/types';

/** A crew member onboard on the day the list is made for, with what the Reliefs screen says about the contract. */
export interface ReliefRow {
  member: CrewMember;
  daysOnboard: number;
  /** The day the contract ends; none when it has no length. */
  contractEnd: string | undefined;
  contractBand: Band;
  limitBand: Band;
}

/** Contracts that end first come first; the contracts with no end are after all of those. */
function compareRows(a: ReliefRow, b: ReliefRow): number {
  if (a.contractEnd !== b.contractEnd) {
    if (a.contractEnd === undefined) return 1;
    if (b.contractEnd === undefined) return -1;
    return a.contractEnd < b.contractEnd ? -1 : 1;
  }
  // Alike in the end: the one who joined first has been onboard longest, so is nearer the onboard limit.
  return a.member.signOnDate < b.member.signOnDate ? -1 : a.member.signOnDate > b.member.signOnDate ? 1 : 0;
}

/**
 * The crew onboard on `today` (the ship's date) as the Reliefs screen lists them: by the day the contract ends, the
 * earliest first, then those with no contract length. Among the same end, or none, the earlier sign-on comes first,
 * and then the order of the crew list (rank, then surname). `maxMonths` is the ship's limit on the months onboard.
 */
export function reliefRows(crew: CrewMember[], today: string, maxMonths: number): ReliefRow[] {
  return onboardAt(crew, today)
    .map((member) => ({
      member,
      daysOnboard: daysOnboard(member, today),
      contractEnd: contractEndDate(member),
      contractBand: contractBand(member, today),
      limitBand: onboardLimitBand(member, today, maxMonths),
    }))
    .sort(compareRows);
}

/**
 * What a row says about the contract, line by line: "Onboard 147 days", "Contract ends 2026-12-01" or "No contract
 * length", and "Relief 2026-11-05 Santos" when a relief is planned. Dates are shown as kept, year first.
 */
export function reliefDetails({ member, daysOnboard: days, contractEnd }: ReliefRow): string[] {
  const details = [`Onboard ${days} ${days === 1 ? 'day' : 'days'}`, contractEnd ? `Contract ends ${contractEnd}` : 'No contract length'];
  const relief = [member.reliefPlannedDate, member.reliefPlannedPort].filter(Boolean).join(' ');
  if (relief) details.push(`Relief ${relief}`);
  return details;
}
