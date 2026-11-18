import type { Alert, AlertKind } from '../domain/alerts';
import { onboardAt } from '../domain/crew';
import { daysBetween, isValidIsoDate, isValidLocalDateTime, MONTH_NAMES, shortDate } from '../domain/dates';
import { VESSEL_KEYS } from '../domain/fieldDictionary';
import { formatOffset, liveChanges, shipLocalToInstant, toShipLocal } from '../domain/shipTime';
import type { ClockChange, CrewMember, DraftSurvey, Particulars, ShipProfile, Voyage } from '../domain/types';
import { currentVoyage } from '../domain/voyage';
import type { HubTile } from './hubTiles';
import { historyRows } from './shipTimeView';
import type { ShipRecords } from './useShipRecords';

const MS_PER_MINUTE = 60_000;
/** A true minus sign, as the canvas writes a clock change back (`−1 h`). */
const MINUS = '−';

/**
 * How long until the ETA: `2 d 5 h`, `5 h 12 min` or `42 min` (whole minutes, rounded down), and `Passed` once it is
 * behind. Nothing (`''`) for an instant that is not a time, rather than `NaN`.
 */
export function etaCountdown(eta: Date, now: Date): string {
  const ms = eta.getTime() - now.getTime();
  if (Number.isNaN(ms)) return '';
  if (ms < 0) return 'Passed';
  const minutes = Math.floor(ms / MS_PER_MINUTE);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes % 60} min`;
  return `${minutes} min`;
}

/** The ETA as kept, local time at the port: `2026-11-19T14:00` → `19 Nov 14:00 LT`. Nothing for a time that cannot be read. */
export function etaLocalText(etaLocal: string): string {
  if (!isValidLocalDateTime(etaLocal)) return '';
  return `${Number(etaLocal.slice(8, 10))} ${MONTH_NAMES[Number(etaLocal.slice(5, 7)) - 1]} ${etaLocal.slice(11, 16)} LT`;
}

/** A clock change as the clocks move: `−1 h`, `+30 min`, `+1 h 30 min`; `0 min` for none. */
export function shiftText(deltaMinutes: number): string {
  const abs = Math.abs(deltaMinutes);
  const parts = [Math.floor(abs / 60) && `${Math.floor(abs / 60)} h`, abs % 60 && `${abs % 60} min`].filter(Boolean);
  if (parts.length === 0) return '0 min';
  return `${deltaMinutes < 0 ? MINUS : '+'}${parts.join(' ')}`;
}

/** What Home's voyage card shows. Each missing thing is one plain line, never an empty figure. */
export interface VoyageCardView {
  /** `Voyage V-112`, `Voyage` for a voyage with no number, or `No voyage`. */
  overline: string;
  /** `Santos → Qingdao`, with `—` for a port that is not known; absent when neither is. */
  route?: string;
  /** The countdown and the local time at the port, or that the ETA is not set; absent with no voyage. */
  eta?: { countdown: string; local: string } | { missing: 'ETA not set' };
  /** The crew onboard on the ship's today. */
  onBoard: number;
  /** `Next clock change: −1 h`, when one is scheduled. */
  clockChange?: string;
}

/** The ETA as an instant: the local time read with the port's own offset. Undefined when either cannot be read. */
function etaInstant(v: Voyage): Date | undefined {
  if (typeof v.etaLocal !== 'string' || !isValidLocalDateTime(v.etaLocal) || !Number.isFinite(v.etaOffsetMinutes)) return undefined;
  return shipLocalToInstant(v.etaLocal, v.etaOffsetMinutes);
}

/**
 * The next scheduled change that moves the clocks. One to the offset the ship already keeps moves nothing (it would read
 * "0 min"), so it is passed over, and the one after it is next.
 */
function nextMove(changes: ClockChange[], now: Date, offsetMinutes: number): ClockChange | undefined {
  return liveChanges(changes).find((c) => Date.parse(c.effectiveAt) > now.getTime() && c.toOffsetMinutes !== offsetMinutes);
}

/** The voyage card of Home: the current voyage (if any), the crew onboard and the next clock change. */
export function voyageCard(input: {
  voyage?: Voyage; crew: CrewMember[]; today: string; now: Date; clockChanges: ClockChange[]; offsetMinutes: number;
}): VoyageCardView {
  const { voyage, crew, today, now, clockChanges, offsetMinutes } = input;
  const view: VoyageCardView = { overline: 'No voyage', onBoard: onboardAt(crew, today).length };
  if (voyage) {
    const no = (voyage.voyageNo ?? '').trim();
    view.overline = no ? `Voyage ${no}` : 'Voyage';
    const from = (voyage.lastPort ?? '').trim();
    const to = (voyage.nextPort ?? '').trim();
    if (from || to) view.route = `${from || '—'} → ${to || '—'}`;
    const eta = etaInstant(voyage);
    view.eta = eta ? { countdown: etaCountdown(eta, now), local: etaLocalText(voyage.etaLocal) } : { missing: 'ETA not set' };
  }
  const next = nextMove(clockChanges, now, offsetMinutes);
  if (next) view.clockChange = `Next clock change: ${shiftText(next.toOffsetMinutes - offsetMinutes)}`;
  return view;
}

/** How many of the 16 particulars the forms are filled from are still blank: text that is empty after trimming, or no number. */
export function particularsToFill(p: Particulars): number {
  return VESSEL_KEYS.filter((key) => {
    const value: unknown = p?.[key];
    return typeof value === 'string' ? value.trim() === '' : typeof value !== 'number' || !Number.isFinite(value);
  }).length;
}

/** The status line of a Ship hub tile. `plain` is muted text; `ok` a ✓ and a word; `warn` and `danger` the outlined and filled pills. */
export interface TileStatus {
  text: string;
  tone: 'plain' | 'ok' | 'warn' | 'danger';
}

const NONE_DUE: TileStatus = { text: '✓ None due', tone: 'ok' };

function ofKinds(alerts: Alert[], kinds: readonly AlertKind[]) {
  const mine = alerts.filter((a) => kinds.includes(a.kind));
  return { red: mine.filter((a) => a.band === 'red'), amber: mine.filter((a) => a.band === 'amber') };
}

/** The date a survey is shown by: its own date, else the ship's date of the day it was made. */
function surveyDate(s: DraftSurvey, offsetMinutes: number): string | undefined {
  if (s.date && isValidIsoDate(s.date)) return s.date;
  const made = new Date(s.createdAt);
  return Number.isNaN(made.getTime()) ? undefined : toShipLocal(made, offsetMinutes).date;
}

function surveyStatus(surveys: DraftSurvey[], today: string, offsetMinutes: number): TileStatus {
  let newest: { date: string; s: DraftSurvey } | undefined;
  for (const s of surveys) {
    const date = surveyDate(s, offsetMinutes);
    if (!date) continue;
    if (!newest || date > newest.date || (date === newest.date && s.createdAt > newest.s.createdAt)) newest = { date, s };
  }
  return { text: newest ? `Last: ${newest.s.kind}, ${shortDate(newest.date, today)}` : 'No surveys', tone: 'plain' };
}

function timeStatus(clockChanges: ClockChange[], now: Date, today: string, offsetMinutes: number): string {
  const zone = formatOffset(offsetMinutes);
  const next = nextMove(clockChanges, now, offsetMinutes);
  // The time the clocks are moved, as the Ship's time history lists it.
  const row = next && historyRows(clockChanges, now).find((r) => r.id === next.id);
  if (!next || !row) return zone;
  const [date, time] = row.when.split(' ');
  return `${zone} · ${shiftText(next.toOffsetMinutes - offsetMinutes)} ${date === today ? `at ${time}` : `on ${shortDate(date, today)}`}`;
}

function voyageStatus(voyages: Voyage[], today: string): string {
  const v = currentVoyage(voyages);
  if (!v) return 'No voyage';
  const no = (v.voyageNo ?? '').trim();
  const eta = etaInstant(v) ? `ETA ${shortDate(v.etaLocal.slice(0, 10), today)}` : 'ETA not set';
  return no ? `${no} · ${eta}` : eta;
}

/** The live status line of each Ship hub tile (spec §7), from the ship's records and alerts. */
export function hubStatuses(input: ShipRecords & {
  ship: ShipProfile; alerts: Alert[]; today: string; now: Date; clockChanges: ClockChange[]; offsetMinutes: number;
}): Record<HubTile, TileStatus> {
  const { crew, voyages, surveys, ship, alerts, today, now, clockChanges, offsetMinutes } = input;

  const docs = ofKinds(alerts, ['crewDoc', 'crewCertificate']);
  const certs = ofKinds(alerts, ['certificate']);
  const reliefs = ofKinds(alerts, ['contract', 'onboardLimit']);
  const nearest = Math.min(...certs.amber.map((a) => (isValidIsoDate(a.due) ? daysBetween(today, a.due) : Infinity)));
  const toFill = particularsToFill(ship.particulars);

  return {
    crew: { text: `${onboardAt(crew, today).length} on board`, tone: 'plain' },
    crewDocuments: docs.red.length ? { text: `${docs.red.length} expired`, tone: 'danger' }
      : docs.amber.length ? { text: `${docs.amber.length} due`, tone: 'warn' } : NONE_DUE,
    certificates: certs.red.length ? { text: `${certs.red.length} overdue`, tone: 'danger' }
      : certs.amber.length ? { text: `${certs.amber.length} due${nearest === Infinity ? '' : nearest > 0 ? ` in ${nearest} d` : ' today'}`, tone: 'warn' }
        : NONE_DUE,
    reliefs: reliefs.red.length ? { text: `${reliefs.red.length} overdue`, tone: 'danger' }
      : reliefs.amber.length ? { text: `${reliefs.amber.length} due in 30 d`, tone: 'warn' } : NONE_DUE,
    voyage: { text: voyageStatus(voyages, today), tone: 'plain' },
    time: { text: timeStatus(clockChanges, now, today, offsetMinutes), tone: 'plain' },
    survey: surveyStatus(surveys, today, offsetMinutes),
    particulars: toFill === 0 ? { text: '✓ Complete', tone: 'ok' } : { text: `${toFill} to fill`, tone: 'warn' },
  };
}
