import { contractEndDate, daysOnboard } from './contracts';
import { fullName, onboardAt } from './crew';
import { latestDocument } from './crewDocs';
import { formatOffset, shipOffsetAt, toShipLocal } from './shipTime';
import type { Certificate, ClockChange, CrewDocType, CrewDocument, CrewMember, Particulars, ShipProfile, Voyage } from './types';

export interface FieldContext {
  ship: ShipProfile;
  crew: CrewMember[];
  voyages: Voyage[];
  certificates: Certificate[];
  crewDocuments: CrewDocument[];
  clockChanges: ClockChange[];
  nowUtc: Date;
}

export type FieldValue = string | number | CrewMember[] | undefined;

const VESSEL_KEYS: readonly (keyof Particulars)[] = [
  'name', 'imo', 'callSign', 'mmsi', 'flag', 'portOfRegistry', 'gt', 'nt', 'dwt', 'loa', 'beam', 'yearBuilt',
  'owners', 'managers', 'pandi', 'classSociety',
];

/** Dictionary name after `voyage.` → how it is read from the active `Voyage`. */
const VOYAGE_FIELDS: Readonly<Record<string, (v: Voyage) => string>> = {
  no: (v) => v.voyageNo,
  lastPort: (v) => v.lastPort,
  nextPort: (v) => v.nextPort,
  // Local time at the destination, `YYYY-MM-DDTHH:mm`; its UTC offset is `etaTimeZone`, which can differ from the ship's.
  eta: (v) => v.etaLocal,
  etaTimeZone: (v) => formatOffset(v.etaOffsetMinutes),
  cargo: (v) => v.cargo,
  charterers: (v) => v.charterers,
  agents: (v) => v.agents,
};

const CERT_FIELDS: readonly (keyof Certificate)[] = ['number', 'issuedBy', 'issueDate', 'expiryDate', 'nextSurveyDue'];

const DOC_FIELDS: readonly (keyof CrewDocument)[] = ['number', 'grade', 'issuedBy', 'issueDate', 'expiryDate'];

/** The fixed dictionary names. The `crew.byRank.<rank>.<field>`, `crew.byRank.<rank>.doc.<type>.<field>` and `cert.<key>.<field>` patterns are not listed. */
export const FIELD_NAMES: readonly string[] = [
  ...VESSEL_KEYS.map((k) => `vessel.${k}`),
  ...Object.keys(VOYAGE_FIELDS).map((k) => `voyage.${k}`),
  'today', 'now', 'nowUtc', 'ship.timeZone', 'crew.onboard', 'crew.onboardCount',
];

function scalar(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function has(list: readonly string[], key: string): boolean {
  return list.includes(key);
}

/** A field of a crew member as at `asAt`: the stored ones, the full name, and the contract end and days onboard worked out from them. */
function crewField(m: CrewMember, field: string, asAt: string): FieldValue {
  if (field === 'fullName') return fullName(m);
  if (field === 'contractEndDate') return contractEndDate(m);
  if (field === 'daysOnboard') return daysOnboard(m, asAt);
  return Object.hasOwn(m, field) ? scalar(m[field as keyof CrewMember]) : undefined;
}

/**
 * Looks up a dictionary name ("enter once, use everywhere"). `opts.asAt` (`YYYY-MM-DD`, default ship's today) is the
 * reference date for `crew.*` and `today`; `now` and `nowUtc` are always the real current time.
 * Deleted records are ignored, and an unknown name or an unset value gives `undefined`.
 */
export function resolveField(name: string, ctx: FieldContext, opts?: { asAt?: string }): FieldValue {
  const offset = shipOffsetAt(ctx.clockChanges, ctx.nowUtc);
  const shipNow = toShipLocal(ctx.nowUtc, offset);
  const asAt = opts?.asAt ?? shipNow.date;
  const parts = name.split('.');

  switch (name) {
    case 'today': return asAt;
    case 'now': return shipNow.dateTime;
    case 'nowUtc': return ctx.nowUtc.toISOString();
    case 'ship.timeZone': return formatOffset(offset);
    case 'crew.onboard': return onboardAt(ctx.crew, asAt);
    case 'crew.onboardCount': return onboardAt(ctx.crew, asAt).length;
  }

  if (parts.length === 2 && parts[0] === 'vessel') {
    return has(VESSEL_KEYS, parts[1]) ? ctx.ship.particulars[parts[1] as keyof Particulars] : undefined;
  }

  if (parts.length === 2 && parts[0] === 'voyage') {
    if (!Object.hasOwn(VOYAGE_FIELDS, parts[1])) return undefined;
    const voyage = ctx.voyages.find((v) => !v.deleted && v.active);
    return voyage && VOYAGE_FIELDS[parts[1]](voyage);
  }

  if (parts.length === 4 && parts[0] === 'crew' && parts[1] === 'byRank') {
    const member = onboardAt(ctx.crew, asAt).find((m) => m.rank === parts[2]);
    return member && crewField(member, parts[3], asAt);
  }

  // `crew.byRank.master.doc.coc.number`: a field of the latest document of that type held by the person of that rank.
  if (parts.length === 6 && parts[0] === 'crew' && parts[1] === 'byRank' && parts[3] === 'doc') {
    if (!has(DOC_FIELDS, parts[5])) return undefined;
    const member = onboardAt(ctx.crew, asAt).find((m) => m.rank === parts[2]);
    const document = member && latestDocument(ctx.crewDocuments, member.id, parts[4] as CrewDocType);
    return document && scalar(document[parts[5] as keyof CrewDocument]);
  }

  if (parts.length === 3 && parts[0] === 'cert') {
    if (!has(CERT_FIELDS, parts[2])) return undefined;
    const cert = ctx.certificates.find((c) => !c.deleted && c.key === parts[1]);
    return cert && scalar(cert[parts[2] as keyof Certificate]);
  }

  return undefined;
}
