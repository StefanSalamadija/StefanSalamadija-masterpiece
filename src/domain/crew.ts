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

/**
 * A new contract for a returning crew member: their details carried over, a new sign-on, and no sign-off. The contract
 * length is carried over too; the planned relief is not, since it was planned for the contract that ended.
 */
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
    ...(m.contractMonths !== undefined && { contractMonths: m.contractMonths }),
  };
}

type PersonFields = Pick<CrewMember, 'passportNo' | 'surname' | 'givenNames' | 'dateOfBirth'>;

/** What a contract is known by: its passport number and its name with date of birth, each only when it has one. */
interface Identity {
  passport?: string;
  name?: string;
}

/** Letters that no combining mark can be taken off, as an ICAO passport spells them without the letter. */
const SPELLED_PLAIN: Readonly<Record<string, string>> = {
  Đ: 'D', Ð: 'D', Ł: 'L', Ø: 'O', Æ: 'AE', Œ: 'OE', Ħ: 'H',
};

/**
 * A name to compare, so that the spellings of one name on different papers meet:
 * - accents and other combining marks are dropped (`Petrović`, `Petrovic` and `Petrovic` + a combining acute are one);
 * - the case is folded, which also turns ß into SS and the dotless ı into I;
 * - the letters that have no combining mark are spelled plain (Đ, Ð to D; Ł, Ø, Æ, Œ, Ħ), and DJ is D, because
 *   passports write Đ as DJ (`Đorđević`, `Djordjević`, `DJORDJEVIC` and `Dordevic` are one name);
 * - any run of white space (a no-break space too) is one space.
 * It is only ever used together with the date of birth, which keeps names that fold alike from being taken for one person.
 */
function foldName(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
    .replace(/[ĐÐŁØÆŒĦ]/gu, (letter) => SPELLED_PLAIN[letter])
    .replace(/DJ/gu, 'D')
    .replace(/\s+/gu, ' ').trim();
}

function identityOf(m: PersonFields): Identity {
  const passport = normalisePassport(m.passportNo);
  const surname = foldName(m.surname);
  const givenNames = foldName(m.givenNames);
  const dateOfBirth = m.dateOfBirth.trim();
  return {
    ...(passport && { passport }),
    ...(surname && givenNames && dateOfBirth && { name: `${surname}|${givenNames}|${dateOfBirth}` }),
  };
}

const isKnown = (who: Identity): boolean => who.passport !== undefined || who.name !== undefined;

/** Either the passport number or the name with date of birth is the same, so a renewed passport does not part them. */
function linked(a: Identity, b: Identity): boolean {
  return (a.passport !== undefined && a.passport === b.passport) || (a.name !== undefined && a.name === b.name);
}

/**
 * Whether two contracts are the same person's. They are when their passport numbers are the same (spaces and case
 * ignored, and not both blank), or when their surname, given names and date of birth are all filled in and the same
 * (accents and case ignored). Either is enough, so a passport that was renewed, added or lost between contracts does
 * not part them. A contract with neither is not linked to any other.
 */
export function samePerson(a: PersonFields, b: PersonFields): boolean {
  return linked(identityOf(a), identityOf(b));
}

type ContractSpan = PersonFields & Pick<CrewMember, 'signOnDate' | 'signOffDate'>;

/** True when two contracts share a day. Both end days count, and a contract without a sign-off has no end. */
function overlaps(a: Pick<CrewMember, 'signOnDate' | 'signOffDate'>, b: Pick<CrewMember, 'signOnDate' | 'signOffDate'>): boolean {
  return (!b.signOffDate || a.signOnDate <= b.signOffDate) && (!a.signOffDate || b.signOnDate <= a.signOffDate);
}

/** The live contracts of a crew, found by what they are known by. It is made once, so that many lookups do not each go through every contract. */
interface PeopleIndex {
  live: CrewMember[];
  byPassport: Map<string, number[]>;
  byName: Map<string, number[]>;
}

function pushTo(index: Map<string, number[]>, key: string | undefined, at: number): void {
  if (key === undefined) return;
  const found = index.get(key);
  if (found) found.push(at);
  else index.set(key, [at]);
}

function indexPeople(crew: CrewMember[]): PeopleIndex {
  const live = crew.filter((m) => !m.deleted);
  const index: PeopleIndex = { live, byPassport: new Map(), byName: new Map() };
  live.forEach((m, at) => {
    const { passport, name } = identityOf(m);
    pushTo(index.byPassport, passport, at);
    pushTo(index.byName, name, at);
  });
  return index;
}

/** The positions in `index.live` of the contracts linked to `who`, each once: those linked by the passport number first, then those that only the name links. */
function linkedTo(index: PeopleIndex, who: Identity): number[] {
  const byPassport = (who.passport !== undefined && index.byPassport.get(who.passport)) || [];
  const byName = (who.name !== undefined && index.byName.get(who.name)) || [];
  if (byName.length === 0) return byPassport;
  if (byPassport.length === 0) return byName;
  const known = new Set(byPassport); // a contract with both the passport and the name is in both lists
  return [...byPassport, ...byName.filter((at) => !known.has(at))];
}

/** The problem text for a contract that `overlapFinder` found: its person's name and its dates. */
export function overlapMessage(other: Pick<CrewMember, 'surname' | 'givenNames' | 'signOnDate' | 'signOffDate'>): string {
  const span = other.signOffDate ? `from ${other.signOnDate} to ${other.signOffDate}` : `from ${other.signOnDate} (still onboard)`;
  return `This overlaps ${fullName(other)}'s contract ${span}.`;
}

/**
 * `overlappingContract` for many candidates against one crew: the contracts are indexed once by passport number and by
 * name with date of birth, so each lookup only looks at the contracts that could be the same person's.
 */
export function overlapFinder(crew: CrewMember[]): (candidate: ContractSpan & { id?: string }) => CrewMember | undefined {
  const index = indexPeople(crew);
  return (candidate) => {
    const who = identityOf(candidate);
    if (!isKnown(who) || !isValidIsoDate(candidate.signOnDate)) return undefined;
    let first: number | undefined;
    for (const at of linkedTo(index, who)) {
      const m = index.live[at];
      if (m.id === candidate.id || !overlaps(candidate, m)) continue;
      if (first === undefined) first = at;
      else {
        const known = index.live[first].signOnDate;
        if (m.signOnDate < known || (m.signOnDate === known && at < first)) first = at;
      }
    }
    return first === undefined ? undefined : index.live[first];
  };
}

/**
 * The contract of the same person that `candidate` runs into, if any: the one that started first among them. One
 * person's contracts on a ship must never overlap. `candidate.id` (when it is a saved contract) and deleted contracts
 * are left out. Nothing is found while the sign-on date is empty or not a date, since there is no span to check.
 */
export function overlappingContract(candidate: ContractSpan & { id?: string }, crew: CrewMember[]): CrewMember | undefined {
  return overlapFinder(crew)(candidate);
}

/**
 * For many contracts against one crew: the live contract of the same person (linked as `samePerson` does) that starts
 * after the given one, and the latest of them if there are several. Nothing for a contract that is the person's latest.
 */
export function laterContractFinder(crew: CrewMember[]): (m: PersonFields & Pick<CrewMember, 'signOnDate'>) => CrewMember | undefined {
  const index = indexPeople(crew);
  return (m) => {
    let latest: CrewMember | undefined;
    for (const at of linkedTo(index, identityOf(m))) {
      const other = index.live[at];
      if (other.signOnDate > m.signOnDate && (!latest || other.signOnDate > latest.signOnDate)) latest = other;
    }
    return latest;
  };
}

/**
 * The ids of the contracts that can be followed by a new one: signed off, and with no other contract of the same
 * person that is open or starts later (so only the person's latest, and never while one is open). A contract that
 * cannot be linked to anyone stands alone. Deleted contracts are not counted and are never in the set. It is made for
 * the whole crew at once, in one pass over the contracts, so that a list can ask it once and not once per row.
 */
export function rejoinableIds(crew: CrewMember[]): Set<string> {
  const live = crew.filter((m) => !m.deleted);
  const who = live.map(identityOf);
  const byPassport = new Map<string, number[]>();
  const byName = new Map<string, number[]>();
  const add = (index: Map<string, number[]>, key: string | undefined, at: number): void => {
    if (key !== undefined) index.set(key, [...(index.get(key) ?? []), at]);
  };
  who.forEach((identity, at) => {
    add(byPassport, identity.passport, at);
    add(byName, identity.name, at);
  });

  const ids = new Set<string>();
  live.forEach((m, at) => {
    if (!m.signOffDate) return;
    const { passport, name } = who[at];
    const sameAsM = [...(passport === undefined ? [] : byPassport.get(passport) ?? []), ...(name === undefined ? [] : byName.get(name) ?? [])];
    const followed = sameAsM.some((other) => other !== at && (!live[other].signOffDate || live[other].signOnDate > m.signOnDate));
    if (!followed) ids.add(m.id);
  });
  return ids;
}
