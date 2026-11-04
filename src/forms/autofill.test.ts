import { describe, expect, it } from 'vitest';
import type { FieldContext } from '../domain/fieldDictionary';
import type { Certificate, ClockChange, CrewMember, ShipProfile, Voyage } from '../domain/types';
import { autoValues, suggestLinks } from './autofill';
import { normaliseLabel } from './labels';
import { readPackage } from './package';
import { permitDocx, shortDatesDocx, toolboxTalkDocx, weeklyJobsDotx } from './testing/wordFixtures';
import type { FieldDef, FieldKind, FieldLink, FormSchema } from './types';
import { detectWord } from './word/detect';

const base = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'test-device', deleted: false, scope: 'ship' as const, shipId: 'ship-1' };
let seq = 0;
const id = () => `id-${++seq}`;

const ship: ShipProfile = {
  ...base, id: 'ship-1',
  particulars: {
    name: 'MV OCEAN STAR', imo: '9074729', callSign: '9HAB2', mmsi: '249123000', flag: 'Malta', portOfRegistry: 'Valletta',
    gt: 32500, nt: 18000, dwt: 56000, loa: 189.9, beam: 32.2, yearBuilt: 2012,
    owners: 'Star Owners Ltd', managers: 'Star Management', pandi: 'Gard', classSociety: 'DNV',
  },
};

function crew(over: Partial<CrewMember>): CrewMember {
  return {
    ...base, id: id(), surname: 'X', givenNames: 'Y', rank: 'master', nationality: 'Croatian', dateOfBirth: '1980-03-14',
    placeOfBirth: 'Split', passportNo: 'P1', passportExpiry: '2030-01-01', seamansBookNo: 'SB1', seamansBookExpiry: '2030-01-01',
    signOnDate: '2026-09-01', signOnPort: 'Rijeka', ...over,
  };
}

const master = crew({ surname: 'Horvat', givenNames: 'Luka' });
const oldChief = crew({ rank: 'chiefOfficer', surname: 'Kovač', givenNames: 'Ana', signOnDate: '2026-03-01', signOffDate: '2026-09-15' });
const chief = crew({ rank: 'chiefOfficer', surname: 'Babić', givenNames: 'Ivo', signOnDate: '2026-09-15' });
const other = crew({ rank: 'other', rankOther: 'Pumpman', surname: 'Pump', givenNames: 'Per' });

const voyage: Voyage = {
  ...base, id: id(), active: true, voyageNo: 'V-12', lastPort: 'Santos', nextPort: 'Rotterdam',
  etaLocal: '2026-11-02T08:30', etaOffsetMinutes: 60, cargo: 'Soya', charterers: 'ACME', agents: 'Port Agents BV',
};
const plus3: ClockChange = { ...base, id: id(), effectiveAt: '2026-01-01T00:00:00.000Z', toOffsetMinutes: 180 };
const loadLine: Certificate = {
  ...base, id: id(), key: 'loadLine', name: 'Load Line', number: 'LL-77', issuedBy: 'DNV', issueDate: '2024-03-15', remarks: '',
};

const ctx: FieldContext = {
  ship, crew: [master, oldChief, chief, other], voyages: [voyage], certificates: [loadLine], crewDocuments: [], clockChanges: [plus3],
  // Ship's time is UTC+03:00: 12:05 on the 28th.
  nowUtc: new Date('2026-10-28T09:05:00Z'),
};
const DATE = '2026-10-28';

let n = 0;
function field(label: string, kind: FieldKind = 'text', over: Partial<FieldDef> = {}): FieldDef {
  n += 1;
  return { id: `f${n}`, kind, label, section: '', loc: `loc${n}`, confidence: 'high', ...over };
}
function schemaOf(fields: FieldDef[], rowGroups: FormSchema['rowGroups'] = []): FormSchema {
  return { kind: 'docx', identity: { code: '', title: 'T', revision: '' }, fields, rowGroups, unsupported: [] };
}
const labelsLinked = (labels: string[], kind: FieldKind = 'text'): Record<string, FieldLink> => {
  const fields = labels.map((l) => field(l, kind));
  const links = suggestLinks(schemaOf(fields));
  return Object.fromEntries(fields.filter((f) => links[f.id]).map((f) => [f.label, links[f.id]]));
};

const toolbox = detectWord(readPackage(toolboxTalkDocx()), 'docx', 'toolbox.docx');
const weekly = detectWord(readPackage(weeklyJobsDotx()), 'dotx', 'weekly.dotx');
const permit = detectWord(readPackage(permitDocx()), 'docx', 'permit.docx');
const byLabel = (s: FormSchema, label: string) => s.fields.find((f) => f.label === label)!;

describe('suggestLinks: fixtures', () => {
  it('links the toolbox talk header', () => {
    const links = suggestLinks(toolbox);
    expect(links[byLabel(toolbox, 'Vessel').id]).toEqual({ source: 'vessel.name' });
    expect(links[byLabel(toolbox, 'Date').id]).toEqual({ source: 'time.date' });
    expect(links[byLabel(toolbox, 'Time').id]).toEqual({ source: 'time.time' });
    expect(links[byLabel(toolbox, 'Subject').id]).toBeUndefined();
  });

  it('links the weekly form header and the date column of its jobs', () => {
    const links = suggestLinks(weekly);
    expect(links[byLabel(weekly, 'Vessel').id]).toEqual({ source: 'vessel.name' });
    expect(links[byLabel(weekly, 'Year / Week No.').id]).toEqual({ source: 'time.yearWeek' });
    expect(links[byLabel(weekly, 'Date (from to)').id]).toEqual({ source: 'time.weekRange' });
    const jobs = weekly.rowGroups.find((g) => g.label === 'Jobs')!;
    const column = (label: string) => jobs.columns.find((c) => c.label === label)!;
    expect(links[column('Date').id]).toEqual({ source: 'time.date' });
    expect(links[column('Description').id]).toBeUndefined();
    expect(links[column('Remarks').id]).toBeUndefined();
  });

  it('does not link the time or name columns of a permit, where every row is a different reading or person', () => {
    const links = suggestLinks(permit);
    expect(Object.keys(links)).toEqual([]);
  });

  it('only names ids that exist in the schema', () => {
    const ids = new Set([...toolbox.fields.map((f) => f.id), ...toolbox.rowGroups.flatMap((g) => g.columns.map((c) => c.id))]);
    for (const key of Object.keys(suggestLinks(toolbox))) expect(ids.has(key)).toBe(true);
  });
});

describe('suggestLinks: the synonym table (spec 6)', () => {
  it('links the ship particulars', () => {
    expect(labelsLinked(['Vessel', 'Ship name', 'M/V', 'MV', 'Name of ship', 'Vessel:', ' VESSEL *'])).toEqual({
      Vessel: { source: 'vessel.name' }, 'Ship name': { source: 'vessel.name' }, 'M/V': { source: 'vessel.name' }, MV: { source: 'vessel.name' },
      'Name of ship': { source: 'vessel.name' }, 'Vessel:': { source: 'vessel.name' }, ' VESSEL *': { source: 'vessel.name' },
    });
    const pairs: [string, string][] = [
      ['IMO', 'vessel.imo'], ['IMO Number', 'vessel.imo'], ['IMO No.', 'vessel.imo'], ['I.M.O. No.', 'vessel.imo'],
      ['Call sign', 'vessel.callSign'], ['Distinctive letters', 'vessel.callSign'], ['Flag', 'vessel.flag'], ['MMSI', 'vessel.mmsi'],
      ['GT', 'vessel.gt'], ['NT', 'vessel.nt'], ['DWT', 'vessel.dwt'], ['Owner', 'vessel.owners'], ['ISM Company', 'vessel.managers'],
      ['Date of construction', 'vessel.yearBuilt'], ['Year built', 'vessel.yearBuilt'], ['Port of registry', 'vessel.portOfRegistry'],
    ];
    for (const [label, source] of pairs) expect(labelsLinked([label]), label).toEqual({ [label]: { source } });
  });

  it('has no source for Type, so it leaves it unlinked', () => {
    expect(labelsLinked(['Type', 'Ship type', 'Subject', 'Remarks'])).toEqual({});
  });

  it('matches a label however it is cased and punctuated, through normaliseLabel', () => {
    expect(normaliseLabel('I.M.O. No.')).toBe('i m o no');
    expect(labelsLinked(['i.m.o. no.', 'IMO NUMBER:', 'Call Sign :', 'Port Of Registry (Flag State)'])).toEqual({
      'i.m.o. no.': { source: 'vessel.imo' }, 'IMO NUMBER:': { source: 'vessel.imo' }, 'Call Sign :': { source: 'vessel.callSign' },
    });
  });

  it('links the time sources', () => {
    expect(labelsLinked(['Date', 'Dated', 'Date of submission'], 'date')).toEqual({
      Date: { source: 'time.date' }, Dated: { source: 'time.date' }, 'Date of submission': { source: 'time.date' },
    });
    expect(labelsLinked(['Time'])).toEqual({ Time: { source: 'time.time' } });
    expect(labelsLinked(['Month'])).toEqual({ Month: { source: 'time.month' } });
    expect(labelsLinked(['Year / Week No.', 'Year/Week', 'Year / Week'])).toEqual({
      'Year / Week No.': { source: 'time.yearWeek' }, 'Year/Week': { source: 'time.yearWeek' }, 'Year / Week': { source: 'time.yearWeek' },
    });
    expect(labelsLinked(['Date (from to)', 'Date (from - to)', 'Date (from – to)'])).toEqual({
      'Date (from to)': { source: 'time.weekRange' }, 'Date (from - to)': { source: 'time.weekRange' }, 'Date (from – to)': { source: 'time.weekRange' },
    });
  });

  it('takes a date or time format written in the label out before it matches', () => {
    expect(labelsLinked(['Date (dd/MMM/yyyy)', 'Date dd.mm.yyyy'], 'date')).toEqual({
      'Date (dd/MMM/yyyy)': { source: 'time.date' }, 'Date dd.mm.yyyy': { source: 'time.date' },
    });
  });

  it('links a time asked for in UTC to the UTC time', () => {
    expect(labelsLinked(['Time (24:00 UTC)'])).toEqual({ 'Time (24:00 UTC)': { source: 'time.timeUtc' } });
    const f = field('Time', 'time', { formatHint: '(24:00 UTC)' });
    expect(suggestLinks(schemaOf([f]))[f.id]).toEqual({ source: 'time.timeUtc' });
  });

  it('links the voyage', () => {
    const pairs: [string, string][] = [
      ['Port', 'voyage.nextPort'], ['Arrival port', 'voyage.nextPort'], ['Next port', 'voyage.nextPort'], ['Last port', 'voyage.lastPort'],
      ['ETA', 'voyage.eta'], ['Voyage no.', 'voyage.no'], ['Voyage No', 'voyage.no'], ['Agent', 'voyage.agents'], ['Agents', 'voyage.agents'],
    ];
    for (const [label, source] of pairs) expect(labelsLinked([label]), label).toEqual({ [label]: { source } });
  });

  it('links people to their rank, with the name alone unless the label asks for the rank', () => {
    const name = (rank: string) => ({ source: `crew.byRank.${rank}`, part: 'name' });
    expect(labelsLinked(['Master', 'Chief Officer', 'C/O', 'Ch. Officer', 'Chief Engineer', 'C/E'])).toEqual({
      Master: name('master'), 'Chief Officer': name('chiefOfficer'), 'C/O': name('chiefOfficer'), 'Ch. Officer': name('chiefOfficer'),
      'Chief Engineer': name('chiefEngineer'), 'C/E': name('chiefEngineer'),
    });
    expect(labelsLinked(['Person in charge', 'Responsible Officer', 'Prepared by'])).toEqual({
      'Person in charge': name('chiefOfficer'), 'Responsible Officer': name('chiefOfficer'), 'Prepared by': name('chiefOfficer'),
    });
  });

  it('gives a person label that holds Rank both name and rank', () => {
    expect(labelsLinked(['Master Name / Rank', 'Chief Officer name and rank', 'Prepared by (Name / Rank)'])).toEqual({
      'Master Name / Rank': { source: 'crew.byRank.master', part: 'nameRank' },
      'Chief Officer name and rank': { source: 'crew.byRank.chiefOfficer', part: 'nameRank' },
      'Prepared by (Name / Rank)': { source: 'crew.byRank.chiefOfficer', part: 'nameRank' },
    });
    expect(labelsLinked(['Master name', 'Name of Master'])).toEqual({
      'Master name': { source: 'crew.byRank.master', part: 'name' }, 'Name of Master': { source: 'crew.byRank.master', part: 'name' },
    });
  });

  it('does not link words that only start like a synonym', () => {
    expect(labelsLinked(['Masterpiece', 'Vessel condition', 'Date of birth', 'Port state control', 'Agenda', 'Timer', 'Monthly'])).toEqual({});
  });

  it('leaves out signatures, ticks, pictures and fields left empty', () => {
    const fields = [
      field('Master', 'checkbox'), field('Vessel', 'picture'), field('Master', 'text', { leftEmpty: true }), field('Signature Master'),
      field('Vessel', 'choice', { options: ['Yes', 'No'] }),
    ];
    expect(suggestLinks(schemaOf(fields))).toEqual({});
  });

  it('links a group column too, except time columns, whose rows differ', () => {
    const cols = [field('Date', 'date'), field('Time', 'time'), field('Time (24:00 UTC)', 'time'), field('Vessel'), field('Name')];
    const group = {
      id: 'g1', label: 'Log', section: '', loc: 'x', columns: cols, capacity: 3, growable: false, shape: 'rows' as const,
    };
    const links = suggestLinks(schemaOf([], [group]));
    expect(links).toEqual({ [cols[0].id]: { source: 'time.date' }, [cols[3].id]: { source: 'vessel.name' } });
  });
});

describe('autoValues: ship, voyage and time', () => {
  it('fills the toolbox talk header from the ship and ship time', () => {
    const links = suggestLinks(toolbox);
    const { values, missing } = autoValues(toolbox, links, ctx, DATE);
    expect(values[byLabel(toolbox, 'Vessel').id]).toBe('MV OCEAN STAR');
    // A date field holds ISO and a time field HH:mm (R2): the writers format them.
    expect(values[byLabel(toolbox, 'Date').id]).toBe('2026-10-28');
    expect(values[byLabel(toolbox, 'Time').id]).toBe('12:05');
    expect(values[byLabel(toolbox, 'Subject').id]).toBeUndefined();
    expect(missing).toEqual({});
  });

  it('fills the weekly form header: year / week and Monday to Sunday', () => {
    const { values } = autoValues(weekly, suggestLinks(weekly), ctx, DATE);
    expect(values[byLabel(weekly, 'Vessel').id]).toBe('MV OCEAN STAR');
    expect(values[byLabel(weekly, 'Year / Week No.').id]).toBe('2026 / 44');
    expect(values[byLabel(weekly, 'Date (from to)').id]).toBe('26-OCT-2026 - 01-NOV-2026');
  });

  it('fills a period field with the week\'s first and last day in its own format, and two date fields under a period label with the Monday and the Sunday (R20)', () => {
    const short = detectWord(readPackage(shortDatesDocx()), 'docx', 'short-dates.docx');
    const links = suggestLinks(short);
    const [day, period, from, to] = short.fields;
    expect([links[day!.id], links[period!.id], links[from!.id], links[to!.id]])
      .toEqual([undefined, { source: 'time.weekRange' }, { source: 'time.weekStart' }, { source: 'time.weekEnd' }]);
    // DATE is Wednesday 28 October 2026: its ISO week runs from Monday 26 October to Sunday 1 November.
    expect(autoValues(short, links, ctx, DATE).values).toEqual({ [period!.id]: '26.10 - 01.11', [from!.id]: '2026-10-26', [to!.id]: '2026-11-01' });
  });

  it('time.weekStart and time.weekEnd: the ISO Monday and Sunday of the draft date\'s week, as ISO or in a text field\'s format', () => {
    const date = field('Start', 'date');
    const text = field('End', 'text', { formatHint: 'dd.MM.yyyy' });
    const schema = schemaOf([date, text]);
    const links = { [date.id]: { source: 'time.weekStart' }, [text.id]: { source: 'time.weekEnd' } };
    expect(autoValues(schema, links, ctx, '2026-10-28').values).toEqual({ [date.id]: '2026-10-26', [text.id]: '01.11.2026' });
    // A Monday and a Sunday are their own week's ends; a week across the new year keeps its ISO days.
    expect(autoValues(schema, links, ctx, '2026-10-26').values).toEqual({ [date.id]: '2026-10-26', [text.id]: '01.11.2026' });
    expect(autoValues(schema, links, ctx, '2026-11-01').values).toEqual({ [date.id]: '2026-10-26', [text.id]: '01.11.2026' });
    expect(autoValues(schema, links, ctx, '2027-01-01').values).toEqual({ [date.id]: '2026-12-28', [text.id]: '03.01.2027' });
  });

  it('links a pair under a period label only when there are exactly two date fields with that label', () => {
    const one = field('Date (from to)', 'date');
    const three = ['a', 'b', 'c'].map((id) => ({ ...field('Period from - to', 'date'), id: `p${id}` }));
    const links = suggestLinks(schemaOf([one, ...three]));
    expect(links[one.id]).toBeUndefined();
    expect(three.map((f) => links[f.id])).toEqual([undefined, undefined, undefined]);
  });

  it('returns top-level fields only: a group column is linked but gets no value here', () => {
    const links = suggestLinks(weekly);
    const { values } = autoValues(weekly, links, ctx, DATE);
    const jobs = weekly.rowGroups.find((g) => g.label === 'Jobs')!;
    expect(links[jobs.columns[0].id]).toBeDefined();
    expect(Object.keys(values).sort()).toEqual(weekly.fields.map((f) => f.id).sort());
  });

  it('uses the ship date it is given, not the date of the clock', () => {
    const { values } = autoValues(toolbox, suggestLinks(toolbox), ctx, '2026-11-02');
    expect(values[byLabel(toolbox, 'Date').id]).toBe('2026-11-02');
  });

  it('gives a text field the date as its hint asks, else DD-MMM-YYYY', () => {
    const a = field('Date', 'text', { formatHint: 'dd/MMM/yyyy' });
    const b = field('Date', 'text');
    const c = field('Date dd.mm.yyyy', 'text');
    const d = field('Date', 'text', { formatHint: '(24:00 UTC)' });
    const s = schemaOf([a, b, c, d]);
    const { values } = autoValues(s, suggestLinks(s), ctx, DATE);
    expect(values).toEqual({ [a.id]: '28/Oct/2026', [b.id]: '28-OCT-2026', [c.id]: '28.10.2026', [d.id]: '28-OCT-2026' });
  });

  it('writes the week range with the hint of the field', () => {
    const a = field('Date (from to)', 'text', { formatHint: 'dd.MM.yyyy' });
    const s = schemaOf([a]);
    expect(autoValues(s, suggestLinks(s), ctx, DATE).values[a.id]).toBe('26.10.2026 - 01.11.2026');
  });

  it('gives the month and the first of the month for a date field', () => {
    const a = field('Month');
    const b = field('Month', 'date');
    const s = schemaOf([a, b]);
    const { values } = autoValues(s, suggestLinks(s), ctx, DATE);
    expect(values).toEqual({ [a.id]: 'October 2026', [b.id]: '2026-10-01' });
  });

  it('uses the week of the date it is given, across a year end', () => {
    const f = field('Year / Week No.');
    const s = schemaOf([f]);
    expect(autoValues(s, suggestLinks(s), ctx, '2027-01-01').values[f.id]).toBe('2026 / 53');
    const g = field('Date (from to)');
    const s2 = schemaOf([g]);
    expect(autoValues(s2, suggestLinks(s2), ctx, '2027-01-01').values[g.id]).toBe('28-DEC-2026 - 03-JAN-2027');
  });

  it('uses UTC for a time asked for in UTC, whether the link says so or the field only has the hint', () => {
    const ship = field('Time', 'time');
    const utcLabel = field('Time (24:00 UTC)', 'time');
    const utcHint = field('Time', 'time', { formatHint: '(24:00 UTC)' });
    const s = schemaOf([ship, utcLabel, utcHint]);
    const links = suggestLinks(s);
    expect(autoValues(s, links, ctx, DATE).values).toEqual({ [ship.id]: '12:05', [utcLabel.id]: '09:05', [utcHint.id]: '09:05' });
    // A person who linked a hinted field to ship's time by hand still gets UTC, as the form asks.
    const forced = autoValues(s, { [utcHint.id]: { source: 'time.time' } }, ctx, DATE);
    expect(forced.values[utcHint.id]).toBe('09:05');
  });

  it('follows the clock changes of the ship for the time', () => {
    const later: ClockChange = { ...base, id: id(), effectiveAt: '2026-10-28T00:00:00.000Z', toOffsetMinutes: -300 };
    const f = field('Time', 'time');
    const s = schemaOf([f]);
    expect(autoValues(s, suggestLinks(s), { ...ctx, clockChanges: [plus3, later] }, DATE).values[f.id]).toBe('04:05');
  });

  it('fills the voyage', () => {
    const labels = ['Next port', 'Last port', 'Voyage no.', 'Agent'];
    const fields = labels.map((l) => field(l));
    const s = schemaOf(fields);
    expect(autoValues(s, suggestLinks(s), ctx, DATE).values).toEqual({
      [fields[0].id]: 'Rotterdam', [fields[1].id]: 'Santos', [fields[2].id]: 'V-12', [fields[3].id]: 'Port Agents BV',
    });
  });

  it('splits the ETA into a date and a time field and writes both into a text field', () => {
    const d = field('ETA', 'date');
    const t = field('ETA', 'time');
    const x = field('ETA', 'text');
    const s = schemaOf([d, t, x]);
    expect(autoValues(s, suggestLinks(s), ctx, DATE).values).toEqual({
      [d.id]: '2026-11-02', [t.id]: '08:30', [x.id]: '02-NOV-2026 08:30',
    });
  });

  it('writes numbers from the particulars as text, and nothing for a particular that is not set', () => {
    const gt = field('GT', 'number');
    const dwt = field('DWT');
    const built = field('Year built');
    const s = schemaOf([gt, dwt, built]);
    expect(autoValues(s, suggestLinks(s), ctx, DATE).values).toEqual({ [gt.id]: '32500', [dwt.id]: '56000', [built.id]: '2012' });
    const bare = { ...ctx, ship: { ...ship, particulars: { ...ship.particulars, gt: undefined, imo: '' } } };
    const imo = field('IMO');
    const s2 = schemaOf([gt, imo]);
    expect(autoValues(s2, suggestLinks(s2), bare, DATE)).toEqual({ values: {}, missing: {} });
  });

  it('writes nothing for a voyage when the ship has none', () => {
    const f = field('Next port');
    const s = schemaOf([f]);
    expect(autoValues(s, suggestLinks(s), { ...ctx, voyages: [] }, DATE)).toEqual({ values: {}, missing: {} });
  });

  it('picks the option of a choice field that reads the same, else nothing', () => {
    const a = field('Flag', 'choice', { options: ['Panama', 'malta ', 'Liberia'] });
    const b = field('Flag', 'choice', { options: ['Panama', 'Liberia'] });
    const links = { [a.id]: { source: 'vessel.flag' }, [b.id]: { source: 'vessel.flag' } };
    expect(autoValues(schemaOf([a, b]), links, ctx, DATE).values).toEqual({ [a.id]: 'malta ' });
  });

  it('does not put a date into a time field, or a time into a date field', () => {
    const a = field('X', 'time');
    const b = field('Y', 'date');
    const links = { [a.id]: { source: 'time.date' }, [b.id]: { source: 'time.time' } };
    expect(autoValues(schemaOf([a, b]), links, ctx, DATE)).toEqual({ values: {}, missing: {} });
  });

  it('follows a link the person chose by hand, and ignores none, unknown sources and fields left empty', () => {
    const a = field('Anything');
    const b = field('Other');
    const c = field('Third');
    const d = field('Fourth', 'text', { leftEmpty: true });
    const e = field('Fifth');
    const links: Record<string, FieldLink> = {
      [a.id]: { source: 'vessel.classSociety' }, [b.id]: { source: 'none' }, [c.id]: { source: 'vessel.colour' },
      [d.id]: { source: 'vessel.name' }, [e.id]: { source: 'cert.loadLine.number' },
    };
    expect(autoValues(schemaOf([a, b, c, d, e]), links, ctx, DATE)).toEqual({
      values: { [a.id]: 'DNV', [e.id]: 'LL-77' }, missing: {},
    });
  });

  it('formats a date from a hand-made link as the field asks', () => {
    const a = field('Anything', 'date');
    const b = field('Anything', 'text', { formatHint: 'DD.MM.YYYY' });
    const links = { [a.id]: { source: 'cert.loadLine.issueDate' }, [b.id]: { source: 'cert.loadLine.issueDate' } };
    expect(autoValues(schemaOf([a, b]), links, ctx, DATE).values).toEqual({ [a.id]: '2024-03-15', [b.id]: '15.03.2024' });
  });

  it('makes nothing from a date that is not a date', () => {
    const f = field('Date', 'date');
    const s = schemaOf([f]);
    expect(autoValues(s, suggestLinks(s), ctx, 'soon')).toEqual({ values: {}, missing: {} });
  });
});

describe('autoValues: people', () => {
  it('fills a person with the crew member of that rank onboard at the date', () => {
    const m = field('Master');
    const c = field('Chief Officer');
    const s = schemaOf([m, c]);
    const { values, missing } = autoValues(s, suggestLinks(s), ctx, DATE);
    expect(values).toEqual({ [m.id]: 'Luka Horvat', [c.id]: 'Ivo Babić' });
    expect(missing).toEqual({});
    // On the 1st of September the previous chief officer was still onboard.
    expect(autoValues(s, suggestLinks(s), ctx, '2026-09-10').values[c.id]).toBe('Ana Kovač');
  });

  it('says so, and writes nothing, when nobody holds the rank', () => {
    const m = field('Master');
    const e = field('Chief Engineer');
    const s = schemaOf([m, e]);
    const { values, missing } = autoValues(s, suggestLinks(s), { ...ctx, crew: [] }, DATE);
    expect(values).toEqual({});
    expect(missing).toEqual({ [m.id]: 'No Master onboard', [e.id]: 'No Chief Engineer onboard' });
  });

  it('ignores a crew member who has signed off, or is deleted', () => {
    const m = field('Master');
    const s = schemaOf([m]);
    const gone = { ...master, signOffDate: '2026-10-01' };
    expect(autoValues(s, suggestLinks(s), { ...ctx, crew: [gone] }, DATE).missing).toEqual({ [m.id]: 'No Master onboard' });
    const deleted = { ...master, deleted: true };
    expect(autoValues(s, suggestLinks(s), { ...ctx, crew: [deleted] }, DATE).missing).toEqual({ [m.id]: 'No Master onboard' });
  });

  it('gives name and rank, or the rank alone, as the link asks', () => {
    const a = field('Master Name / Rank');
    const b = field('Rank');
    const c = field('Person');
    const links: Record<string, FieldLink> = {
      [a.id]: { source: 'crew.byRank.master', part: 'nameRank' },
      [b.id]: { source: 'crew.byRank.chiefOfficer', part: 'rank' },
      [c.id]: { source: 'crew.byRank.master' },
    };
    expect(autoValues(schemaOf([a, b, c]), links, ctx, DATE).values).toEqual({
      [a.id]: 'Luka Horvat / Master', [b.id]: 'Chief Officer', [c.id]: 'Luka Horvat',
    });
  });

  it('uses the free-text rank of an Other rank', () => {
    const a = field('Pumpman');
    const b = field('Pumpman rank');
    const links: Record<string, FieldLink> = {
      [a.id]: { source: 'crew.byRank.other', part: 'nameRank' }, [b.id]: { source: 'crew.byRank.other', part: 'rank' },
    };
    expect(autoValues(schemaOf([a, b]), links, ctx, DATE).values).toEqual({ [a.id]: 'Per Pump / Pumpman', [b.id]: 'Pumpman' });
  });

  it('reports a missing person under the rank part as well', () => {
    const a = field('Master Name / Rank');
    const links: Record<string, FieldLink> = { [a.id]: { source: 'crew.byRank.master', part: 'nameRank' } };
    expect(autoValues(schemaOf([a]), links, { ...ctx, crew: [] }, DATE).missing).toEqual({ [a.id]: 'No Master onboard' });
  });
});
