import { CREW_DOC_TYPES } from '../domain/catalogues';
import type { BaseRecord, CrewDocType, CrewDocument, FieldError } from '../domain/types';
import { validateCrewDocument } from '../domain/validation';

/** The catalogue's key for a paper that is not in it, which is named by hand. */
const OTHER = 'other';

/** What is typed in the crew document form: every field as text, and a paper that may not be chosen yet. */
export interface CrewDocumentForm {
  /** The catalogue key of the chosen paper (`'other'` for one of its own), or `''` while none is chosen. */
  type: CrewDocType | '';
  /** The name of a paper of its own; only used, and only kept, when the type is Other. */
  typeOther: string;
  /** The grade or capacity; only asked for, and only kept, by the papers that have one. */
  grade: string;
  number: string;
  issuedBy: string;
  issueDate: string;
  expiryDate: string;
  remarks: string;
}

export type CrewDocumentControl = keyof CrewDocumentForm;

/** The controls of the form, top to bottom: the first one with a problem gets the focus. */
export const CREW_DOCUMENT_CONTROLS: readonly CrewDocumentControl[] = [
  'type', 'typeOther', 'grade', 'number', 'issuedBy', 'issueDate', 'expiryDate', 'remarks',
];

/** What the form can say about a document: all but the record's own fields and where it belongs (the ship and the contract). */
export type CrewDocumentFields = Omit<CrewDocument, keyof BaseRecord | 'shipId' | 'crewId'>;

export function blankCrewDocumentForm(): CrewDocumentForm {
  return { type: '', typeOther: '', grade: '', number: '', issuedBy: '', issueDate: '', expiryDate: '', remarks: '' };
}

const inCatalogue = (type: string): boolean => type !== OTHER && CREW_DOC_TYPES.some((entry) => entry.key === type);

/** True for the papers that name a grade or capacity: the certificates of competency, endorsements and GMDSS. */
export function isGraded(type: string): boolean {
  return CREW_DOC_TYPES.some((entry) => entry.key === type && entry.graded);
}

/**
 * The form for a saved document. One that the catalogue does not have (Other, or a type from a newer version) is Other
 * with its name, so that the name is never lost.
 */
export function crewDocumentFormOf(d: CrewDocument): CrewDocumentForm {
  const listed = inCatalogue(d.type);
  return {
    type: listed ? d.type : OTHER, typeOther: listed ? '' : d.typeOther ?? '', grade: d.grade, number: d.number,
    issuedBy: d.issuedBy, issueDate: d.issueDate, expiryDate: d.expiryDate ?? '', remarks: d.remarks,
  };
}

/** The catalogue as the select shows it: its groups in order, each with its papers. Other is not one of them. */
export function crewDocumentGroups(): { group: string; types: { key: CrewDocType; label: string }[] }[] {
  const groups: { group: string; types: { key: CrewDocType; label: string }[] }[] = [];
  for (const { key, label, group } of CREW_DOC_TYPES) {
    if (key === OTHER) continue;
    let found = groups.find((g) => g.group === group);
    if (!found) groups.push((found = { group, types: [] }));
    found.types.push({ key, label });
  }
  return groups;
}

/** The form with another paper chosen. A name typed for Other, and a grade, are dropped when the paper has no use for them. */
export function withDocumentType(form: CrewDocumentForm, type: CrewDocType | ''): CrewDocumentForm {
  return { ...form, type, typeOther: type === OTHER ? form.typeOther : '', grade: isGraded(type) ? form.grade : '' };
}

/**
 * The fields the form stands for, with the text trimmed; none while no paper is chosen. An expiry that is empty is
 * left out (the issue date is the exception: it is kept as empty text), and so is the name of anything but Other.
 */
export function crewDocumentFieldsOf(form: CrewDocumentForm): CrewDocumentFields | undefined {
  if (form.type === '') return undefined;
  const fields: CrewDocumentFields = {
    type: form.type, grade: isGraded(form.type) ? form.grade.trim() : '', number: form.number.trim(), issuedBy: form.issuedBy.trim(),
    issueDate: form.issueDate, remarks: form.remarks.trim(),
  };
  if (form.type === OTHER) fields.typeOther = form.typeOther.trim();
  if (form.expiryDate) fields.expiryDate = form.expiryDate;
  return fields;
}

/** The change that saves `fields` over a saved document: an expiry the form left empty, and a name Other no longer needs, are cleared, not kept. */
export function crewDocumentPatchOf(fields: CrewDocumentFields): Partial<CrewDocument> {
  return { expiryDate: undefined, typeOther: undefined, ...fields };
}

/** Everything wrong with the form, in the order of `validateCrewDocument`. */
export function crewDocumentProblems(form: CrewDocumentForm): FieldError[] {
  return validateCrewDocument({
    type: form.type, typeOther: form.typeOther, issueDate: form.issueDate, expiryDate: form.expiryDate || undefined,
  });
}

/** The problem to show at each control (each problem names its control): the first one, an error before a warning. */
export function problemsByControl(problems: FieldError[]): Map<CrewDocumentControl, FieldError> {
  const byControl = new Map<CrewDocumentControl, FieldError>();
  for (const found of problems) {
    const control = found.field as CrewDocumentControl;
    const known = byControl.get(control);
    if (!known || (known.severity === 'warning' && found.severity === 'error')) byControl.set(control, found);
  }
  return byControl;
}
