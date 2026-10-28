import { CREW_DOC_TYPES, rankLabel } from './catalogues';
import { fullName, onboardAt } from './crew';
import { crewCertificateExpiryBand, crewDocBand, crewDocExpiryBand, worstBand } from './expiry';
import type { Band, BaseRecord, CrewDocType, CrewDocument, CrewMember } from './types';

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * What the document is called: the catalogue's label for its type, or for Other the name typed for it. A type the
 * catalogue does not have (a file from a newer version) is told by its name too, else it is "Other".
 */
export function docLabel(d: Pick<CrewDocument, 'type' | 'typeOther'>): string {
  const listed = d.type !== 'other' && CREW_DOC_TYPES.find((entry) => entry.key === d.type);
  return listed ? listed.label : d.typeOther?.trim() || 'Other';
}

/** The document's band: amber from 90 days before it expires, red once it has. None without an expiry. */
export function docBand(d: Pick<CrewDocument, 'expiryDate'>, ref: string): Band {
  return crewCertificateExpiryBand(d.expiryDate, ref);
}

/** The documents of the contract `crewId` that are not deleted. */
function liveDocsOf(docs: CrewDocument[], crewId: string): CrewDocument[] {
  return docs.filter((d) => !d.deleted && d.crewId === crewId);
}

/** The worst of the passport, the seaman's book and the live documents of this contract: the badge of the crew list. */
export function crewMemberBand(m: CrewMember, docs: CrewDocument[], ref: string): Band {
  return worstBand(crewDocBand(m, ref), ...liveDocsOf(docs, m.id).map((d) => docBand(d, ref)));
}

/** What a re-join copies of a document: the paper itself, for the same ship. */
export type CarriedDocument = Omit<CrewDocument, keyof BaseRecord | 'crewId'>;

/**
 * The papers a re-join takes over to the new contract: the live documents of `fromCrewId` that have no expiry or are
 * still valid on the sign-on day (`signOnDate`, `YYYY-MM-DD`; one that expires that day is). They are plain copies,
 * with the optional keys left out where the original has none.
 */
export function carryOverDocuments(docs: CrewDocument[], fromCrewId: string, signOnDate: string): CarriedDocument[] {
  return liveDocsOf(docs, fromCrewId)
    .filter((d) => !d.expiryDate || d.expiryDate >= signOnDate)
    .map((d) => ({
      shipId: d.shipId, type: d.type, ...(d.typeOther !== undefined && { typeOther: d.typeOther }), grade: d.grade,
      number: d.number, issuedBy: d.issuedBy, issueDate: d.issueDate, ...(d.expiryDate !== undefined && { expiryDate: d.expiryDate }),
      remarks: d.remarks,
    }));
}

/** The earlier expiry first; a document without one comes after all that have one. */
function compareExpiry(a: string | undefined, b: string | undefined): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  return compareText(a, b);
}

/** The catalogue position of a type; one the catalogue does not have comes with Other, last. */
function typeOrder(type: CrewDocType): number {
  const at = CREW_DOC_TYPES.findIndex((entry) => entry.key === type);
  return at < 0 ? CREW_DOC_TYPES.length - 1 : at;
}

/**
 * The live documents as a list shows them: in the order of the catalogue, papers of its own by name, then the earliest
 * expiry first (none last), then the issue date and the id. A new array.
 */
export function sortDocuments(docs: CrewDocument[]): CrewDocument[] {
  return docs
    .filter((d) => !d.deleted)
    .sort(
      (a, b) =>
        typeOrder(a.type) - typeOrder(b.type) ||
        docLabel(a).localeCompare(docLabel(b)) ||
        compareExpiry(a.expiryDate, b.expiryDate) ||
        compareText(a.issueDate, b.issueDate) ||
        compareText(a.id, b.id),
    );
}

/** Issued earlier first; the same day, the one entered earlier; then by id, so that every device picks the same one. */
function compareIssue(a: CrewDocument, b: CrewDocument): number {
  return compareText(a.issueDate, b.issueDate) || compareText(a.createdAt, b.createdAt) || compareText(a.id, b.id);
}

/** The live document of that type the contract has, the one issued last (see `compareIssue`). */
export function latestDocument(docs: CrewDocument[], crewId: string, type: CrewDocType): CrewDocument | undefined {
  return liveDocsOf(docs, crewId).filter((d) => d.type === type).sort(compareIssue).at(-1);
}

/** One line of the Expiring list: a paper of a crew member onboard, with the date it runs out and its band. */
export interface ExpiringItem {
  crewId: string;
  name: string;
  rank: string;
  what: string;
  expiryDate: string;
  band: Band;
}

/**
 * The papers of the crew onboard on `today` (`YYYY-MM-DD`) that expire on or before `until`, expired ones included:
 * the passport, the seaman's book and every live document. By expiry date, then name, then what it is. A paper without
 * an expiry date, or with one that is not a date, is left out.
 */
export function expiringBefore(input: { crew: CrewMember[]; docs: CrewDocument[]; today: string; until: string }): ExpiringItem[] {
  const { crew, docs, today, until } = input;
  const items: ExpiringItem[] = [];
  for (const m of onboardAt(crew, today)) {
    const base = { crewId: m.id, name: fullName(m), rank: rankLabel(m) };
    const papers: { what: string; expiryDate: string | undefined; band: Band }[] = [
      { what: 'Passport', expiryDate: m.passportExpiry, band: crewDocExpiryBand(m.passportExpiry, today) },
      { what: "Seaman's book", expiryDate: m.seamansBookExpiry, band: crewDocExpiryBand(m.seamansBookExpiry, today) },
      ...liveDocsOf(docs, m.id).map((d) => ({ what: docLabel(d), expiryDate: d.expiryDate, band: docBand(d, today) })),
    ];
    for (const { what, expiryDate, band } of papers) {
      // A band of none is a date that is missing or not real; it has nothing to warn about, nor to list.
      if (band !== 'none' && expiryDate !== undefined && expiryDate <= until) items.push({ ...base, what, expiryDate, band });
    }
  }
  return items.sort(
    (a, b) => compareText(a.expiryDate, b.expiryDate) || a.name.localeCompare(b.name) || compareText(a.what, b.what) || compareText(a.crewId, b.crewId),
  );
}
