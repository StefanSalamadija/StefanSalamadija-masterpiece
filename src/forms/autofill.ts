import { rankLabel } from '../domain/catalogues';
import { isValidIsoDate, isoWeek } from '../domain/dates';
import { resolveField } from '../domain/fieldDictionary';
import type { FieldContext } from '../domain/fieldDictionary';
import { shipOffsetAt, toShipLocal } from '../domain/shipTime';
import type { RankKey } from '../domain/types';
import { formatDate } from './format';
import { formatHintOf, normaliseLabel } from './labels';
import type { FieldDef, FieldLink, FormSchema } from './types';

/*
 * Auto-fill (spec section 6): suggest where each field of a form is filled in from, and work out what it says.
 *
 * Every link is a suggestion. `suggestLinks` makes them at import from the label of a field, the person can change
 * them in the setup, and `autoValues` reads whatever links the setup holds. A value that is filled in can be edited in
 * the draft.
 *
 * What a link's `source` can be (see `FieldLink`):
 * - a dictionary name (`vessel.name`, `voyage.nextPort`, `cert.loadLine.number`, ...), read with `resolveField`;
 * - `crew.byRank.<RankKey>`, the person of that rank onboard on the draft's date, with `part` `name` (the default),
 *   `rank` or `nameRank` (`<full name> / <rank>`);
 * - `time.date` (the draft's ship date), `time.time` (the ship's time now), `time.timeUtc` (UTC now), `time.month`
 *   (`October 2026`), `time.yearWeek` (`2026 / 44`), `time.weekRange` (`26-OCT-2026 - 01-NOV-2026`), and
 *   `time.weekStart` and `time.weekEnd` (the ISO Monday and Sunday of the draft date's week, as dates; R20).
 *
 * Group columns. `suggestLinks` also links the columns of a row group (their ids are the field ids of the columns,
 * `g1.c2` in Word and `<sheet>!g1.C` in Excel), and a link of a column applies to every row. `autoValues` gives the
 * values of the top-level fields only: the rows of a group are filled by the helpers and the fill screen, which read
 * the column links themselves.
 */

/** One row of the synonym table: the labels (as a person would write them), what they link to, and for a person which ranks. */
interface Synonym {
  labels: string[];
  source: string;
  part?: 'name' | 'rank' | 'nameRank';
}

/**
 * The synonym table (spec section 6). Labels are written the way a form writes them: they go through `normaliseLabel`
 * (R11) when the table is built, so `I.M.O. No.` is stored as `i m o no`, and a label from a form is matched the same way.
 *
 * | Data | Labels | Source |
 * |---|---|---|
 * | Ship | Vessel, Ship name, Name of ship, M/V, MV | vessel.name |
 * | | IMO, IMO Number, IMO No., I.M.O. No. | vessel.imo |
 * | | Call sign, Distinctive letters | vessel.callSign |
 * | | Flag | vessel.flag |
 * | | MMSI | vessel.mmsi |
 * | | GT, NT, DWT (and their long names), LOA, Beam | vessel.gt, vessel.nt, vessel.dwt, vessel.loa, vessel.beam |
 * | | Owner | vessel.owners |
 * | | ISM Company (the dictionary has the managers) | vessel.managers |
 * | | Type | no source: left unlinked |
 * | | Date of construction, Year built (the dictionary has the year) | vessel.yearBuilt |
 * | | Port of registry | vessel.portOfRegistry |
 * | Time | Date, Dated, Date of submission | time.date |
 * | | Time | time.time (time.timeUtc when the label or hint says `(24:00 UTC)`) |
 * | | Month | time.month |
 * | | Year / Week No. | time.yearWeek |
 * | | Date (from to) | time.weekRange; two date fields under one period label: time.weekStart and time.weekEnd (R20) |
 * | Voyage | Port, Arrival port, Next port (a bare `Port` is taken to be the one the ship is going to) | voyage.nextPort |
 * | | Last port | voyage.lastPort |
 * | | ETA | voyage.eta |
 * | | Voyage no. | voyage.no |
 * | | Agent | voyage.agents |
 * | People | Master | crew.byRank.master |
 * | | Chief Officer, C/O, Ch. Officer, Person in charge, Responsible Officer, Prepared by | crew.byRank.chiefOfficer |
 * | | Chief Engineer, C/E | crew.byRank.chiefEngineer |
 *
 * A person's label also matches with `name`, `rank`, `name / rank`, `name and rank` or `rank and name` after it, or `name of` before it.
 */
const SYNONYMS: Synonym[] = [
  { labels: ['Vessel', 'Vessel name', 'Name of vessel', 'Ship', 'Ship name', 'Name of ship', 'M/V', 'MV', 'M/V name'], source: 'vessel.name' },
  { labels: ['IMO', 'IMO Number', 'IMO No.', 'I.M.O. No.', 'I.M.O. Number', 'IMO Number (7 digits)'], source: 'vessel.imo' },
  { labels: ['Call sign', 'Callsign', 'Distinctive letters', 'Call sign / distinctive letters', 'Distinctive number or letters'], source: 'vessel.callSign' },
  { labels: ['Flag', 'Flag state'], source: 'vessel.flag' },
  { labels: ['MMSI', 'MMSI No.', 'MMSI Number'], source: 'vessel.mmsi' },
  { labels: ['GT', 'Gross tonnage', 'Gross tonnage (GT)'], source: 'vessel.gt' },
  { labels: ['NT', 'Net tonnage', 'Net tonnage (NT)'], source: 'vessel.nt' },
  { labels: ['DWT', 'Deadweight', 'Deadweight (DWT)'], source: 'vessel.dwt' },
  { labels: ['LOA', 'Length overall'], source: 'vessel.loa' },
  { labels: ['Beam', 'Breadth'], source: 'vessel.beam' },
  { labels: ['Owner', 'Owners', 'Ship owner', 'Shipowner', 'Registered owner'], source: 'vessel.owners' },
  { labels: ['ISM Company', 'ISM Manager', 'Company', 'Management company', 'Ship manager', 'Manager', 'Managers'], source: 'vessel.managers' },
  { labels: ['Date of construction', 'Year built', 'Year of build', 'Built'], source: 'vessel.yearBuilt' },
  { labels: ['Port of registry', 'Home port'], source: 'vessel.portOfRegistry' },
  { labels: ['Classification society', 'Class'], source: 'vessel.classSociety' },

  { labels: ['Date', 'Dated', 'Date of submission'], source: 'time.date' },
  { labels: ['Time'], source: 'time.time' },
  { labels: ['Month'], source: 'time.month' },
  { labels: ['Year / Week No.', 'Year/Week No', 'Year / Week', 'Year/Week', 'Year / Week Number'], source: 'time.yearWeek' },
  { labels: ['Date (from to)', 'Date (from - to)', 'Date (from – to)', 'Date from to', 'Date from – to'], source: 'time.weekRange' },

  { labels: ['Port', 'Arrival port', 'Port of arrival', 'Next port', 'Next port of call', 'Destination'], source: 'voyage.nextPort' },
  { labels: ['Last port', 'Last port of call', 'Previous port', 'Departure port', 'Port of departure'], source: 'voyage.lastPort' },
  { labels: ['ETA', 'ETA (local)'], source: 'voyage.eta' },
  { labels: ['Voyage no.', 'Voyage number', 'Voyage'], source: 'voyage.no' },
  { labels: ['Agent', 'Agents', 'Port agent'], source: 'voyage.agents' },
  { labels: ['Cargo'], source: 'voyage.cargo' },
  { labels: ['Charterer', 'Charterers'], source: 'voyage.charterers' },
];

/** The people labels: each stands for the person of that rank. */
const PEOPLE: { labels: string[]; rank: RankKey }[] = [
  { labels: ['Master'], rank: 'master' },
  { labels: ['Chief Officer', 'C/O', 'Ch. Officer', 'Person in charge', 'Responsible Officer', 'Prepared by'], rank: 'chiefOfficer' },
  { labels: ['Chief Engineer', 'Ch. Engineer', 'C/E'], rank: 'chiefEngineer' },
];

/** What may follow a person's label, or precede it (`Name of Master`), for the same person. */
const PERSON_SUFFIXES = ['', 'name', 'rank', 'name / rank', 'name and rank', 'name & rank', 'rank and name'];
const PERSON_PREFIXES = ['name of'];

/**
 * A label for matching: `normaliseLabel`, then with dashes as spaces and no space around a slash, so that
 * `Year / Week`, `Year/Week` and `Date (from - to)`, `Date (from-to)` are each one label.
 */
function canon(label: string): string {
  return normaliseLabel(label).replace(/[-‐-―]/g, ' ').replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();
}

/**
 * True when a label names a person by rank, as auto-fill links it (`Master`, `Chief Engineer`, `Name of Master`): word
 * detection keeps rows named so as fields of their own, each linked to its person.
 */
export function isPersonLabel(label: string): boolean {
  return TABLE.get(canon(labelWithoutHint(label)))?.source.startsWith('crew.byRank.') ?? false;
}

/** A link to a source (not `none`). */
type SourceLink = { source: string; part?: 'name' | 'rank' | 'nameRank' };

/** Table built once: matching key to its link. The first label to claim a key keeps it. */
const TABLE: ReadonlyMap<string, SourceLink> = (() => {
  const table = new Map<string, SourceLink>();
  const add = (label: string, link: SourceLink) => {
    const key = canon(label);
    if (!table.has(key)) table.set(key, link);
  };
  for (const row of SYNONYMS) for (const label of row.labels) add(label, { source: row.source });
  for (const person of PEOPLE) {
    for (const label of person.labels) {
      for (const suffix of PERSON_SUFFIXES) add(`${label} ${suffix}`, { source: `crew.byRank.${person.rank}`, part: 'name' });
      for (const prefix of PERSON_PREFIXES) add(`${prefix} ${label}`, { source: `crew.byRank.${person.rank}`, part: 'name' });
    }
  }
  return table;
})();

const UTC_HINT = /24:00\s*UTC/i;
const RANK_WORD = /\brank\b/i;

/** The label of a field without the date or time format written in it: `Date (dd/MMM/yyyy)` is `Date`. */
function labelWithoutHint(label: string): string {
  const hint = formatHintOf(label);
  return hint === undefined ? label : label.replace(hint, ' ');
}

/** True when the form asks for this field in UTC: `(24:00 UTC)` is in its format hint or its label. */
function asksUtc(field: FieldDef): boolean {
  return UTC_HINT.test(field.formatHint ?? '') || UTC_HINT.test(field.label);
}

/** The kinds a value can be suggested for: a signature, a tick box and a photo are not filled in by themselves. */
function suggestible(field: FieldDef): boolean {
  return !field.leftEmpty && (field.kind === 'text' || field.kind === 'number' || field.kind === 'date' || field.kind === 'time');
}

/** Sources that give text only (`2026 / 44`, `26-OCT-2026 - 01-NOV-2026`): a date or time field cannot take them. */
const TEXT_ONLY = new Set(['time.yearWeek', 'time.weekRange']);
/** Sources that can give a time of day: a `time` field takes nothing from any other (a date is no value for it). */
const GIVES_TIME = new Set(['time.time', 'time.timeUtc', 'now', 'nowUtc', 'voyage.eta']);

function suggest(field: FieldDef, inGroup: boolean): FieldLink | undefined {
  if (!suggestible(field)) return undefined;
  const link = TABLE.get(canon(labelWithoutHint(field.label)));
  if (link === undefined) return undefined;
  // `Date (from to): [from] - [to]` is two date fields: the week's range is no value for either.
  if (TEXT_ONLY.has(link.source) && (field.kind === 'date' || field.kind === 'time')) return undefined;
  if (field.kind === 'time' && !GIVES_TIME.has(link.source)) return undefined;
  const time = link.source === 'time.time';
  // Each row of a group has its own time (a reading, a visit), so a column is never filled with the time now.
  if (inGroup && time) return undefined;
  if (time && asksUtc(field)) return { source: 'time.timeUtc' };
  if (link.part !== undefined && RANK_WORD.test(labelWithoutHint(field.label))) return { source: link.source, part: 'nameRank' };
  return { ...link };
}

/**
 * The links to suggest for a form, by field id: the fields, and the columns of the row groups (by the column's own id).
 * Only fields that match the synonym table are in the result. A signature, a tick box and a photo never are, and
 * neither is a date or time field whose label names a source that gives text only (`time.yearWeek`, `time.weekRange`),
 * nor a time field whose label names a source that gives no time (a time named `Date`).
 * The two date fields that detection marked as the first and the last day of one period (`FieldDef.range`, such as
 * `Date (from to): [from] - [to]`) are linked to `time.weekStart` and `time.weekEnd` (R20).
 */
export function suggestLinks(schema: FormSchema): Record<string, FieldLink> {
  const links: Record<string, FieldLink> = {};
  for (const field of schema.fields) {
    const link = suggest(field, false);
    if (link) links[field.id] = link;
  }
  // R20: the two date fields that detection marked as the first and the last day of one period.
  for (const field of schema.fields) {
    if (field.kind !== 'date' || field.leftEmpty || field.range === undefined) continue;
    links[field.id] = { source: field.range === 'start' ? 'time.weekStart' : 'time.weekEnd' };
  }
  for (const group of schema.rowGroups) {
    for (const column of group.columns) {
      const link = suggest(column, true);
      if (link) links[column.id] = link;
    }
  }
  return links;
}

/** What a source gives, in the parts a field can take: a date (ISO), a time (`HH:mm`), or text. */
interface Candidate {
  text?: string;
  date?: string;
  time?: string;
}

/** A person with nobody of that rank onboard. */
interface Nobody {
  missing: string;
}

const DATE_NAMES = /(?:Date|Due)$/;

function nonEmpty(s: string): string | undefined {
  return s.trim() === '' ? undefined : s;
}

function person(key: string, part: 'name' | 'rank' | 'nameRank', ctx: FieldContext, date: string): Candidate | Nobody {
  const name = resolveField(`crew.byRank.${key}.fullName`, ctx, { asAt: date });
  if (typeof name !== 'string' || name.trim() === '') return { missing: `No ${rankLabel({ rank: key as RankKey })} onboard` };
  const other = resolveField(`crew.byRank.${key}.rankOther`, ctx, { asAt: date });
  const rank = rankLabel({ rank: key as RankKey, rankOther: typeof other === 'string' ? other : undefined });
  return { text: part === 'rank' ? rank : part === 'nameRank' ? `${name} / ${rank}` : name };
}

/** Splits a `YYYY-MM-DDTHH:mm` (or longer) instant into its date and time; nothing for text that is not one. */
function dateTime(s: string): Candidate | undefined {
  const date = s.slice(0, 10);
  if (!isValidIsoDate(date)) return undefined;
  return s.length >= 16 && s[10] === 'T' ? { date, time: s.slice(11, 16) } : { date };
}

function candidate(link: SourceLink, field: FieldDef, ctx: FieldContext, date: string): Candidate | Nobody | undefined {
  const { source } = link;
  const hint = field.formatHint ?? formatHintOf(field.label);
  const dateOk = isValidIsoDate(date);
  switch (source) {
    case 'time.date': return dateOk ? { date } : undefined;
    case 'time.time': return { time: toShipLocal(ctx.nowUtc, shipOffsetAt(ctx.clockChanges, ctx.nowUtc)).time };
    case 'time.timeUtc': return { time: ctx.nowUtc.toISOString().slice(11, 16) };
    case 'time.month': return dateOk ? { text: formatDate(date, 'MMMM yyyy'), date: `${date.slice(0, 7)}-01` } : undefined;
    case 'time.yearWeek': {
      if (!dateOk) return undefined;
      const { year, week } = isoWeek(date);
      return { text: `${year} / ${week}` };
    }
    case 'time.weekRange': {
      if (!dateOk) return undefined;
      const { monday, sunday } = isoWeek(date);
      return { text: `${formatDate(monday, hint)} - ${formatDate(sunday, hint)}` };
    }
    case 'time.weekStart': return dateOk ? { date: isoWeek(date).monday } : undefined;
    case 'time.weekEnd': return dateOk ? { date: isoWeek(date).sunday } : undefined;
  }
  const parts = source.split('.');
  if (parts.length === 3 && parts[0] === 'crew' && parts[1] === 'byRank') return person(parts[2], link.part ?? 'name', ctx, date);

  const value = resolveField(source, ctx, { asAt: dateOk ? date : undefined });
  if (typeof value === 'number') return { text: String(value) };
  if (typeof value !== 'string' || nonEmpty(value) === undefined) return undefined;
  if (source === 'now' || source === 'nowUtc' || source === 'voyage.eta') return dateTime(value);
  if (source === 'today' || DATE_NAMES.test(source)) return isValidIsoDate(value) ? { date: value } : undefined;
  return { text: value };
}

/** What goes into `field` from a candidate, or nothing when the candidate has no part the field can take. */
function fit(field: FieldDef, c: Candidate): string | undefined {
  const hint = field.formatHint ?? formatHintOf(field.label);
  switch (field.kind) {
    case 'date': return c.date;
    case 'time': return c.time;
    case 'text':
    case 'number': {
      if (c.text !== undefined) return c.text;
      if (c.date !== undefined) return c.time === undefined ? formatDate(c.date, hint) : `${formatDate(c.date, hint)} ${c.time}`;
      return c.time;
    }
    case 'choice': {
      const wanted = c.text?.trim().toLowerCase();
      return wanted === undefined ? undefined : field.options?.find((o) => o.trim().toLowerCase() === wanted);
    }
    default: return undefined;
  }
}

/**
 * The values the links give for the form's own fields (not the columns of its row groups: see the note at the top), as
 * the draft holds them (R2): a `date` field gets `YYYY-MM-DD`, a `time` field `HH:mm`, and a `text` field linked to a date
 * gets the date as its format hint asks, else `DD-MMM-YYYY`. A field with no link, a link of `none`, an unknown source,
 * a source with no value, or a value the field cannot take has no entry.
 *
 * `date` is the draft's ship date (`YYYY-MM-DD`). It is the day for `time.date`, `time.month`, `time.yearWeek`,
 * `time.weekRange`, `time.weekStart`, `time.weekEnd` and for who is onboard. The time is the ship's time at `ctx.nowUtc`; a field that asks for
 * `(24:00 UTC)` in its format hint or label gets UTC, whichever of the two time sources it is linked to.
 *
 * `missing` has a sentence for a person field with nobody of that rank onboard on `date`: `No Master onboard`. The
 * field has no value then.
 */
export function autoValues(
  schema: FormSchema, links: Record<string, FieldLink>, ctx: FieldContext, date: string,
): { values: Record<string, string>; missing: Record<string, string> } {
  const values: Record<string, string> = {};
  const missing: Record<string, string> = {};
  for (const field of schema.fields) {
    const link = links[field.id];
    if (link === undefined || link.source === 'none' || field.leftEmpty) continue;
    const effective: SourceLink = link.source === 'time.time' && asksUtc(field) ? { source: 'time.timeUtc' } : link;
    const found = candidate(effective, field, ctx, date);
    if (found === undefined) continue;
    if ('missing' in found) {
      missing[field.id] = found.missing;
      continue;
    }
    const value = fit(field, found);
    if (value !== undefined && value !== '') values[field.id] = value;
  }
  return { values, missing };
}
