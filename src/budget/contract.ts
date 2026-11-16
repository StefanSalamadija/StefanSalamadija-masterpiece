import { contractEndDate } from '../domain/contracts';
import { latestContractByPassport } from '../domain/crew';
import { addDays, isValidIsoDate } from '../domain/dates';
import type { CrewMember, RotationSettings } from '../domain/types';

/*
 * "Use my contract from ‹ship›" (v2 §3.3): the user's own crew record gives a rotation period. The period copied from a
 * contract is marked with that crew record's id, so that a later change of the record is seen and offered as "Update
 * from contract", never copied silently.
 */

export type Period = RotationSettings['periods'][number];

/**
 * A contract as a rotation period: from the sign-on to its sign-off once there is one, else to the day before the
 * sign-on + the contract months (8 months from 15 June is 15 June to 14 February). None without either.
 */
export function contractPeriod(m: Pick<CrewMember, 'signOnDate' | 'signOffDate' | 'contractMonths'>): { signOn: string; signOff: string } | undefined {
  if (!isValidIsoDate(m.signOnDate)) return undefined;
  if (m.signOffDate !== undefined && isValidIsoDate(m.signOffDate) && m.signOffDate >= m.signOnDate) return { signOn: m.signOnDate, signOff: m.signOffDate };
  const end = contractEndDate(m);
  return end === undefined ? undefined : { signOn: m.signOnDate, signOff: addDays(end, -1) };
}

/** The latest live contract of the person marked as me: by passport number across every ship, else the record itself. */
export function myLatestContract(crew: CrewMember[], meCrewId: string | undefined): CrewMember | undefined {
  const me = meCrewId === undefined ? undefined : crew.find((c) => c.id === meCrewId && !c.deleted);
  if (!me) return undefined;
  return latestContractByPassport(crew, me.passportNo) ?? me;
}

/** Whether the period copied from the crew record `crewId` is in the plan, and the same as the record now gives. */
export function contractStatus(periods: Period[], crewId: string, period: { signOn: string; signOff: string }): 'missing' | 'same' | 'differs' {
  const held = periods.find((p) => p.crewId === crewId);
  if (!held) return 'missing';
  return held.signOn === period.signOn && held.signOff === period.signOff ? 'same' : 'differs';
}

/** The periods with the contract's: in place of the one copied from that record before, else added. */
export function applyContract(periods: Period[], crewId: string, period: { signOn: string; signOff: string }): Period[] {
  const copied = { signOn: period.signOn, signOff: period.signOff, crewId };
  return periods.some((p) => p.crewId === crewId) ? periods.map((p) => (p.crewId === crewId ? copied : p)) : [...periods, copied];
}
