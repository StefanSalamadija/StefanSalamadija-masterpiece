import { RANKS } from '../domain/catalogues';
import { FIELD_NAMES } from '../domain/fieldDictionary';
// Types only: the forms engine is loaded on demand (see `src/forms/load.ts`).
import type { FieldLink } from '../forms/types';

/*
 * What a field of a form can be filled in from, as the setup review offers it: the field dictionary's names, the time
 * sources, and the person of each rank (their name, their rank, or both). Each has a name a person reads, never the
 * dictionary name. A link is a select value (`link:<source>`, and `|<part>` for a person), so that one select holds
 * You fill, Leave empty and every link.
 */

export const LINK_GROUPS = ['Ship', 'Voyage', 'Date and time', 'Crew'] as const;
export type LinkGroup = (typeof LINK_GROUPS)[number];

export interface LinkOption {
  /** The select value: `link:vessel.name`, `link:crew.byRank.master|nameRank`. */
  value: string;
  label: string;
  group: LinkGroup;
}

/** The dictionary's names (and the time sources), with what they are called and where they are listed. */
const NAMES: Readonly<Record<string, { label: string; group: LinkGroup }>> = {
  'vessel.name': { label: 'Ship name', group: 'Ship' },
  'vessel.imo': { label: 'IMO number', group: 'Ship' },
  'vessel.callSign': { label: 'Call sign', group: 'Ship' },
  'vessel.mmsi': { label: 'MMSI', group: 'Ship' },
  'vessel.flag': { label: 'Flag', group: 'Ship' },
  'vessel.portOfRegistry': { label: 'Port of registry', group: 'Ship' },
  'vessel.gt': { label: 'Gross tonnage', group: 'Ship' },
  'vessel.nt': { label: 'Net tonnage', group: 'Ship' },
  'vessel.dwt': { label: 'Deadweight', group: 'Ship' },
  'vessel.loa': { label: 'Length overall', group: 'Ship' },
  'vessel.beam': { label: 'Beam', group: 'Ship' },
  'vessel.yearBuilt': { label: 'Year built', group: 'Ship' },
  'vessel.owners': { label: 'Owners', group: 'Ship' },
  'vessel.managers': { label: 'Managers', group: 'Ship' },
  'vessel.pandi': { label: 'P&I club', group: 'Ship' },
  'vessel.classSociety': { label: 'Class society', group: 'Ship' },
  'ship.timeZone': { label: "Ship's time zone", group: 'Ship' },
  'voyage.no': { label: 'Voyage number', group: 'Voyage' },
  'voyage.lastPort': { label: 'Last port', group: 'Voyage' },
  'voyage.nextPort': { label: 'Next port', group: 'Voyage' },
  'voyage.eta': { label: 'ETA', group: 'Voyage' },
  'voyage.etaTimeZone': { label: 'ETA time zone', group: 'Voyage' },
  'voyage.cargo': { label: 'Cargo', group: 'Voyage' },
  'voyage.charterers': { label: 'Charterers', group: 'Voyage' },
  'voyage.agents': { label: 'Agents', group: 'Voyage' },
  'time.date': { label: "The form's date", group: 'Date and time' },
  'time.time': { label: "Time now (ship's time)", group: 'Date and time' },
  'time.timeUtc': { label: 'Time now (UTC)', group: 'Date and time' },
  'time.month': { label: 'Month (October 2026)', group: 'Date and time' },
  'time.yearWeek': { label: 'Year / week (2026 / 44)', group: 'Date and time' },
  'time.weekRange': { label: 'Week, Monday to Sunday', group: 'Date and time' },
  today: { label: "Today's date on the ship", group: 'Date and time' },
  now: { label: "Date and time now (ship's time)", group: 'Date and time' },
  nowUtc: { label: 'Date and time now (UTC)', group: 'Date and time' },
  'crew.onboardCount': { label: 'Number of crew onboard', group: 'Crew' },
};

const TIME_SOURCES = ['time.date', 'time.time', 'time.timeUtc', 'time.month', 'time.yearWeek', 'time.weekRange'];

/** The dictionary names that give no value a field can hold: the list of people onboard. */
const NOT_LINKABLE: ReadonlySet<string> = new Set(['crew.onboard']);

const PARTS = [
  { part: 'name', label: 'name' },
  { part: 'rank', label: 'rank' },
  { part: 'nameRank', label: 'name / rank' },
] as const;
type Part = (typeof PARTS)[number]['part'];

const PERSON = /^crew\.byRank\.([A-Za-z]+)$/;

function rankName(key: string): string | undefined {
  return RANKS.find((r) => r.key === key && r.key !== 'other')?.label;
}

/** Every source a field can be linked to, grouped as `LINK_GROUPS` and in the order a person would look for them. */
export function linkOptions(): LinkOption[] {
  const plain = [...FIELD_NAMES.filter((name) => !NOT_LINKABLE.has(name)), ...TIME_SOURCES].map((source) => ({
    value: `link:${source}`, label: NAMES[source]?.label ?? source, group: NAMES[source]?.group ?? 'Ship',
  }));
  const people = RANKS.filter((r) => r.key !== 'other').flatMap(({ key, label }) =>
    PARTS.map(({ part, label: partLabel }): LinkOption => ({ value: `link:crew.byRank.${key}|${part}`, label: `${label}: ${partLabel}`, group: 'Crew' })));
  return LINK_GROUPS.flatMap((group) => [...plain, ...people].filter((o) => o.group === group));
}

/** The select value of a link; none for a field that is not linked (`{ source: 'none' }`). A person without a part gives their name. */
export function linkValue(link: FieldLink): string | undefined {
  if (link.source === 'none') return undefined;
  if (PERSON.test(link.source)) return `link:${link.source}|${('part' in link && link.part) || 'name'}`;
  return `link:${link.source}`;
}

/** The link a select value stands for; none for `you`, `empty` or anything that is not a link. */
export function linkFromValue(value: string): FieldLink | undefined {
  if (!value.startsWith('link:')) return undefined;
  const [source, part, ...rest] = value.slice('link:'.length).split('|');
  if (source === '' || source === 'none' || rest.length > 0) return undefined;
  if (part === undefined) return { source };
  if (!PERSON.test(source) || !PARTS.some((p) => p.part === part)) return undefined;
  return { source, part: part as Part };
}

/** What a link is called. A link this app does not offer (made on another device, say) is called by its source. */
export function linkName(link: FieldLink): string {
  const person = PERSON.exec(link.source);
  if (person) {
    const rank = rankName(person[1]);
    const part = PARTS.find((p) => p.part === (('part' in link && link.part) || 'name'));
    if (rank !== undefined && part !== undefined) return `${rank}: ${part.label}`;
  }
  return NAMES[link.source]?.label ?? link.source;
}
