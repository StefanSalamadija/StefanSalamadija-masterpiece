import { describe, expect, it } from 'vitest';
import type { Alert } from '../domain/alerts';
import { VESSEL_KEYS } from '../domain/fieldDictionary';
import type { Certificate, ClockChange, CrewDocument, CrewMember, DraftSurvey, Particulars, ShipProfile, Voyage } from '../domain/types';
import { etaCountdown, etaLocalText, hubStatuses, particularsToFill, shiftText, voyageCard } from './overviewView';

// Made-up data. The clock is 2026-11-17T09:00Z and the ship is at UTC+03:00, so the ship's today is 2026-11-17.
const NOW = new Date('2026-11-17T09:00:00.000Z');
const TODAY = '2026-11-17';
const OFFSET = 180;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const stamp = { createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: 'device', deleted: false, scope: 'ship' as const };

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${String((seq += 1)).padStart(3, '0')}`;

function member(over: Partial<CrewMember> = {}): CrewMember {
  return {
    ...stamp, id: nextId('crew'), shipId: 'ship-1', surname: 'EXAMPLE', givenNames: 'Robert', rank: 'secondOfficer', nationality: 'Utopian',
    dateOfBirth: '1980-03-14', placeOfBirth: 'Example City', passportNo: 'P0001', passportExpiry: '2030-01-01', seamansBookNo: 'S0001',
    seamansBookExpiry: '2030-01-01', signOnDate: '2026-10-01', signOnPort: 'Santos', ...over,
  };
}

function voyage(over: Partial<Voyage> = {}): Voyage {
  return {
    ...stamp, id: nextId('voy'), shipId: 'ship-1', active: true, voyageNo: 'V-112', lastPort: 'Santos', nextPort: 'Qingdao',
    etaLocal: '2026-11-19T14:00', etaOffsetMinutes: OFFSET, cargo: 'Soya beans', charterers: 'Example Charterers', agents: 'Sample Agency', ...over,
  };
}

function change(effectiveAt: string, toOffsetMinutes: number, over: Partial<ClockChange> = {}): ClockChange {
  return { ...stamp, id: nextId('cc'), shipId: 'ship-1', effectiveAt, toOffsetMinutes, ...over };
}

function survey(over: Partial<DraftSurvey> = {}): DraftSurvey {
  return { ...stamp, id: nextId('srv'), shipId: 'ship-1', kind: 'initial', operation: 'loading', drafts: {}, deductibles: {}, ...over };
}

const FULL: Particulars = {
  name: 'MV OCEAN STAR', imo: '9000001', callSign: 'XXXX1', mmsi: '000000001', flag: 'Utopia', portOfRegistry: 'Example Port',
  gt: 30000, nt: 17000, dwt: 52000, loa: 190, beam: 32.26, yearBuilt: 2012,
  owners: 'Example Owners Ltd', managers: 'Sample Ship Management', pandi: 'Example P&I Club', classSociety: 'Example Class',
};

function ship(particulars: Particulars = FULL): ShipProfile {
  return { ...stamp, id: 'ship-1', scope: 'ship', particulars } as ShipProfile;
}

function alert(kind: Alert['kind'], band: Alert['band'], due: string): Alert {
  return { key: nextId(kind), kind, band, title: 'x', detail: 'x', href: '#/', due, what: 'x' };
}

describe('etaCountdown', () => {
  it('counts days and hours, hours and minutes, or minutes', () => {
    expect(etaCountdown(new Date(NOW.getTime() + 2 * DAY + 5 * HOUR + 30 * MIN), NOW)).toBe('2 d 5 h');
    expect(etaCountdown(new Date(NOW.getTime() + DAY), NOW)).toBe('1 d 0 h');
    expect(etaCountdown(new Date(NOW.getTime() + 5 * HOUR + 12 * MIN + 59_000), NOW)).toBe('5 h 12 min');
    expect(etaCountdown(new Date(NOW.getTime() + 42 * MIN), NOW)).toBe('42 min');
    expect(etaCountdown(new Date(NOW.getTime() + 30_000), NOW)).toBe('0 min');
    expect(etaCountdown(NOW, NOW)).toBe('0 min');
  });

  it('says Passed once the ETA is behind, and never NaN', () => {
    expect(etaCountdown(new Date(NOW.getTime() - MIN), NOW)).toBe('Passed');
    expect(etaCountdown(new Date(NOW.getTime() - 3 * DAY), NOW)).toBe('Passed');
    expect(etaCountdown(new Date(Number.NaN), NOW)).toBe('');
  });
});

describe('etaLocalText', () => {
  it('words the local time at the port', () => {
    expect(etaLocalText('2026-11-19T14:00')).toBe('19 Nov 14:00 LT');
    expect(etaLocalText('2027-01-05T06:30')).toBe('5 Jan 06:30 LT');
  });

  it('is nothing for a time that cannot be read', () => {
    expect(etaLocalText('')).toBe('');
    expect(etaLocalText('2026-13-40T99:00')).toBe('');
  });
});

describe('shiftText', () => {
  it('words a clock change with a true minus sign', () => {
    expect(shiftText(-60)).toBe('−1 h');
    expect(shiftText(30)).toBe('+30 min');
    expect(shiftText(90)).toBe('+1 h 30 min');
    expect(shiftText(120)).toBe('+2 h');
    expect(shiftText(-570)).toBe('−9 h 30 min');
    expect(shiftText(0)).toBe('0 min');
  });
});

describe('voyageCard', () => {
  const base = { crew: [member(), member({ surname: 'SAMPLE', givenNames: 'John', rank: 'ab' })], today: TODAY, now: NOW, clockChanges: [], offsetMinutes: OFFSET };

  it('says No voyage with no voyage, and still counts the crew', () => {
    expect(voyageCard(base)).toEqual({ overline: 'No voyage', onBoard: 2 });
  });

  it('shows the voyage number, the route, the countdown and the local ETA', () => {
    expect(voyageCard({ ...base, voyage: voyage() })).toEqual({
      overline: 'Voyage V-112', route: 'Santos → Qingdao', eta: { countdown: '2 d 2 h', local: '19 Nov 14:00 LT' }, onBoard: 2,
    });
  });

  it('says Voyage alone when the voyage has no number', () => {
    expect(voyageCard({ ...base, voyage: voyage({ voyageNo: '' }) }).overline).toBe('Voyage');
    expect(voyageCard({ ...base, voyage: voyage({ voyageNo: '   ' }) }).overline).toBe('Voyage');
  });

  it('leaves the route out with neither port, and puts a dash for a missing one', () => {
    expect(voyageCard({ ...base, voyage: voyage({ lastPort: '', nextPort: '' }) })).not.toHaveProperty('route');
    expect(voyageCard({ ...base, voyage: voyage({ lastPort: '' }) }).route).toBe('— → Qingdao');
    expect(voyageCard({ ...base, voyage: voyage({ nextPort: ' ' }) }).route).toBe('Santos → —');
  });

  it('says ETA not set with no ETA, or one that cannot be read', () => {
    expect(voyageCard({ ...base, voyage: voyage({ etaLocal: '' }) }).eta).toEqual({ missing: 'ETA not set' });
    expect(voyageCard({ ...base, voyage: voyage({ etaLocal: 'soon' }) }).eta).toEqual({ missing: 'ETA not set' });
    expect(voyageCard({ ...base, voyage: voyage({ etaOffsetMinutes: Number.NaN }) }).eta).toEqual({ missing: 'ETA not set' });
  });

  it("counts down to the port's own offset, not the ship's", () => {
    // 14:00 at UTC+08:00 is 06:00Z on the 19th: 1 d 21 h from 09:00Z on the 17th.
    const card = voyageCard({ ...base, voyage: voyage({ etaOffsetMinutes: 480 }) });
    expect(card.eta).toEqual({ countdown: '1 d 21 h', local: '19 Nov 14:00 LT' });
  });

  it('says Passed for an ETA behind', () => {
    expect(voyageCard({ ...base, voyage: voyage({ etaLocal: '2026-11-16T10:00' }) }).eta).toEqual({ countdown: 'Passed', local: '16 Nov 10:00 LT' });
  });

  it('counts only the crew onboard today', () => {
    const crew = [
      member(),
      member({ signOnDate: '2026-12-01' }),                             // joins later
      member({ signOnDate: '2026-01-01', signOffDate: '2026-11-10' }),   // has left
      member({ deleted: true }),
      member({ signOnDate: TODAY }),
    ];
    expect(voyageCard({ ...base, crew }).onBoard).toBe(2);
    expect(voyageCard({ ...base, crew: [] }).onBoard).toBe(0);
  });

  it('words the next clock change against the offset now', () => {
    const clockChanges = [change('2026-01-01T00:00:00.000Z', OFFSET), change('2026-11-17T19:00:00.000Z', 120), change('2026-11-20T00:00:00.000Z', 60)];
    expect(voyageCard({ ...base, clockChanges }).clockChange).toBe('Next clock change: −1 h');
    expect(voyageCard({ ...base, clockChanges: [change('2026-11-18T00:00:00.000Z', 300)] }).clockChange).toBe('Next clock change: +2 h');
    // One that has happened, or was cancelled, is not next.
    expect(voyageCard({ ...base, clockChanges: [change('2026-11-17T08:00:00.000Z', 240)] })).not.toHaveProperty('clockChange');
    expect(voyageCard({ ...base, clockChanges: [change('2026-11-18T00:00:00.000Z', 240, { deleted: true })] })).not.toHaveProperty('clockChange');
  });

  it('never says 0 min: a change to the offset the ship already keeps moves no clock, so the next one that does is next', () => {
    expect(voyageCard({ ...base, clockChanges: [change('2026-11-18T00:00:00.000Z', OFFSET)] })).not.toHaveProperty('clockChange');
    const sameThenBack = [change('2026-11-18T00:00:00.000Z', OFFSET), change('2026-11-20T00:00:00.000Z', 120)];
    expect(voyageCard({ ...base, clockChanges: sameThenBack }).clockChange).toBe('Next clock change: −1 h');
  });
});

describe('particularsToFill', () => {
  it('reads the 16 fields the form fill uses', () => {
    expect(VESSEL_KEYS).toHaveLength(16);
    expect(particularsToFill(FULL)).toBe(0);
  });

  it('counts blank text and missing numbers', () => {
    expect(particularsToFill({ ...FULL, pandi: '', gt: undefined })).toBe(2);
    expect(particularsToFill({ ...FULL, owners: '   ', callSign: '\t' })).toBe(2);
    expect(particularsToFill({ ...FULL, dwt: Number.NaN })).toBe(1);
    expect(particularsToFill({} as Particulars)).toBe(16);
  });
});

describe('hubStatuses', () => {
  const empty = {
    crew: [] as CrewMember[], certificates: [] as Certificate[], crewDocuments: [] as CrewDocument[], voyages: [] as Voyage[], surveys: [] as DraftSurvey[],
    ship: ship(), alerts: [] as Alert[], today: TODAY, now: NOW, clockChanges: [] as ClockChange[], offsetMinutes: OFFSET,
  };

  it('has a line for every tile on an empty ship', () => {
    expect(hubStatuses(empty)).toEqual({
      crew: { text: '0 on board', tone: 'plain' },
      crewDocuments: { text: '✓ None due', tone: 'ok' },
      certificates: { text: '✓ None due', tone: 'ok' },
      reliefs: { text: '✓ None due', tone: 'ok' },
      voyage: { text: 'No voyage', tone: 'plain' },
      time: { text: 'UTC+03:00', tone: 'plain' },
      survey: { text: 'No surveys', tone: 'plain' },
      particulars: { text: '✓ Complete', tone: 'ok' },
    });
  });

  it('counts the crew onboard', () => {
    const crew = [member(), member(), member({ signOnDate: '2026-12-01' })];
    expect(hubStatuses({ ...empty, crew }).crew).toEqual({ text: '2 on board', tone: 'plain' });
  });

  it('crew documents: expired first, else due', () => {
    const red = [alert('crewDoc', 'red', '2026-11-12'), alert('crewCertificate', 'red', '2026-11-01'), alert('crewDoc', 'amber', '2026-12-01')];
    expect(hubStatuses({ ...empty, alerts: red }).crewDocuments).toEqual({ text: '2 expired', tone: 'danger' });
    const amber = [alert('crewCertificate', 'amber', '2026-12-24'), alert('certificate', 'red', '2026-11-01')];
    expect(hubStatuses({ ...empty, alerts: amber }).crewDocuments).toEqual({ text: '1 due', tone: 'warn' });
  });

  it('certificates: overdue first, else due in the nearest days', () => {
    const red = [alert('certificate', 'red', '2026-11-01'), alert('certificate', 'amber', '2026-12-01')];
    expect(hubStatuses({ ...empty, alerts: red }).certificates).toEqual({ text: '1 overdue', tone: 'danger' });
    const amber = [alert('certificate', 'amber', '2026-12-20'), alert('certificate', 'amber', '2026-12-01'), alert('crewDoc', 'amber', '2026-11-20')];
    expect(hubStatuses({ ...empty, alerts: amber }).certificates).toEqual({ text: '2 due in 14 d', tone: 'warn' });
    expect(hubStatuses({ ...empty, alerts: [alert('certificate', 'amber', TODAY)] }).certificates).toEqual({ text: '1 due today', tone: 'warn' });
  });

  it('contracts and reliefs: overdue first, else due in 30 d', () => {
    const red = [alert('contract', 'red', '2026-11-01'), alert('onboardLimit', 'red', '2026-10-01'), alert('contract', 'amber', '2026-12-01')];
    expect(hubStatuses({ ...empty, alerts: red }).reliefs).toEqual({ text: '2 overdue', tone: 'danger' });
    const amber = [alert('contract', 'amber', '2026-12-01'), alert('onboardLimit', 'amber', '2026-12-10')];
    expect(hubStatuses({ ...empty, alerts: amber }).reliefs).toEqual({ text: '2 due in 30 d', tone: 'warn' });
  });

  it('voyage: its number and ETA date', () => {
    expect(hubStatuses({ ...empty, voyages: [voyage()] }).voyage).toEqual({ text: 'V-112 · ETA 19 Nov', tone: 'plain' });
    expect(hubStatuses({ ...empty, voyages: [voyage({ etaLocal: '' })] }).voyage).toEqual({ text: 'V-112 · ETA not set', tone: 'plain' });
    expect(hubStatuses({ ...empty, voyages: [voyage({ voyageNo: '', etaLocal: '2027-01-03T08:00' })] }).voyage).toEqual({ text: 'ETA 3 Jan 2027', tone: 'plain' });
    expect(hubStatuses({ ...empty, voyages: [voyage({ active: false })] }).voyage).toEqual({ text: 'No voyage', tone: 'plain' });
  });

  it("ship's time: the zone, and the next change at its time today or on its day", () => {
    const today = [change('2026-01-01T00:00:00.000Z', OFFSET), change('2026-11-17T19:00:00.000Z', 120)];  // 22:00 on board
    expect(hubStatuses({ ...empty, clockChanges: today }).time).toEqual({ text: 'UTC+03:00 · −1 h at 22:00', tone: 'plain' });
    const later = [change('2026-01-01T00:00:00.000Z', OFFSET), change('2026-11-25T23:00:00.000Z', 240)];  // 02:00 on 26 Nov
    expect(hubStatuses({ ...empty, clockChanges: later }).time).toEqual({ text: 'UTC+03:00 · +1 h on 26 Nov', tone: 'plain' });
    // 23:30Z on the 17th is 02:30 on the 18th on board: not today.
    const afterMidnight = [change('2026-01-01T00:00:00.000Z', OFFSET), change('2026-11-17T23:30:00.000Z', 120)];
    expect(hubStatuses({ ...empty, clockChanges: afterMidnight }).time.text).toBe('UTC+03:00 · −1 h on 18 Nov');
    // A change to the same offset moves no clock: never "0 min".
    expect(hubStatuses({ ...empty, clockChanges: [change('2026-11-17T19:00:00.000Z', OFFSET)] }).time.text).toBe('UTC+03:00');
    const sameThenLater = [change('2026-11-17T19:00:00.000Z', OFFSET), change('2026-11-25T23:00:00.000Z', 240)];
    expect(hubStatuses({ ...empty, clockChanges: sameThenLater }).time.text).toBe('UTC+03:00 · +1 h on 26 Nov');
  });

  it('draft survey: the newest, by its date or else the day it was made', () => {
    const surveys = [
      survey({ kind: 'initial', date: '2026-11-14' }),
      survey({ kind: 'final', date: '2026-11-02' }),
      survey({ kind: 'interim', createdAt: '2026-11-10T22:30:00.000Z' }),   // 01:30 on the 11th on board
    ];
    expect(hubStatuses({ ...empty, surveys }).survey).toEqual({ text: 'Last: initial, 14 Nov', tone: 'plain' });
    expect(hubStatuses({ ...empty, surveys: [surveys[2]] }).survey).toEqual({ text: 'Last: interim, 11 Nov', tone: 'plain' });
  });

  it('particulars: complete, or how many to fill', () => {
    expect(hubStatuses({ ...empty, ship: ship({ ...FULL, imo: '', loa: undefined, managers: ' ' }) }).particulars).toEqual({ text: '3 to fill', tone: 'warn' });
  });
});
