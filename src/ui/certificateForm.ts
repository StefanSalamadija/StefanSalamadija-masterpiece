import { CERTIFICATES } from '../domain/catalogues';
import type { BaseRecord, Certificate, FieldError } from '../domain/types';
import { validateCertificate } from '../domain/validation';

/** The catalogue's key for a certificate that is not in it, which is named by hand. */
const OTHER = 'other';

/** What is typed in the certificate form: every field as text, and a certificate that may not be chosen yet. */
export interface CertificateForm {
  /** The catalogue key of the chosen certificate, `'other'` for one of its own, or `''` while none is chosen. */
  key: string;
  /** The name of a certificate of its own; only used, and only kept, when the key is Other. */
  customName: string;
  number: string;
  issuedBy: string;
  issueDate: string;
  expiryDate: string;
  nextSurveyDue: string;
  remarks: string;
}

export type CertificateControl = keyof CertificateForm;

/** The controls of the form, top to bottom: the first one with a problem gets the focus. */
export const CERTIFICATE_CONTROLS: readonly CertificateControl[] = [
  'key', 'customName', 'number', 'issuedBy', 'issueDate', 'expiryDate', 'nextSurveyDue', 'remarks',
];

/** What the form can say about a certificate. */
export type CertificateFields = Omit<Certificate, keyof BaseRecord | 'shipId'>;

export function blankCertificateForm(): CertificateForm {
  return { key: '', customName: '', number: '', issuedBy: '', issueDate: '', expiryDate: '', nextSurveyDue: '', remarks: '' };
}

const inCatalogue = (key: string): boolean => key !== OTHER && CERTIFICATES.some((entry) => entry.key === key);

/**
 * The form for a saved certificate. One that the catalogue does not have (Other, or a key from elsewhere) is Other
 * with its name, so that the name is never lost.
 */
export function certificateFormOf(c: Certificate): CertificateForm {
  const listed = inCatalogue(c.key);
  return {
    key: listed ? c.key : OTHER, customName: listed ? '' : c.name, number: c.number, issuedBy: c.issuedBy,
    issueDate: c.issueDate, expiryDate: c.expiryDate ?? '', nextSurveyDue: c.nextSurveyDue ?? '', remarks: c.remarks,
  };
}

/** The catalogue as the select shows it: its groups in order, each with its certificates. Other is not one of them. */
export function certificateGroups(): { group: string; certificates: { key: string; name: string }[] }[] {
  const groups: { group: string; certificates: { key: string; name: string }[] }[] = [];
  for (const { key, name, group } of CERTIFICATES) {
    if (key === OTHER) continue;
    let found = groups.find((g) => g.group === group);
    if (!found) groups.push((found = { group, certificates: [] }));
    found.certificates.push({ key, name });
  }
  return groups;
}

/** The form with another certificate chosen. A name typed for Other is dropped when something else is chosen. */
export function withCertificate(form: CertificateForm, key: string): CertificateForm {
  return { ...form, key, customName: key === OTHER ? form.customName : '' };
}

/** The name of the certificate: the catalogue's for an entry of it, what was typed for Other, and nothing while none is chosen. */
function nameOf(form: CertificateForm): string {
  if (form.key === OTHER) return form.customName.trim();
  return CERTIFICATES.find((entry) => entry.key === form.key)?.name ?? '';
}

/**
 * The fields the form stands for, with the text trimmed. A date that is empty is left out (the issue date is the
 * exception: it is kept as empty text).
 */
export function certificateFieldsOf(form: CertificateForm): CertificateFields {
  const fields: CertificateFields = {
    key: form.key, name: nameOf(form), number: form.number.trim(), issuedBy: form.issuedBy.trim(),
    issueDate: form.issueDate, remarks: form.remarks.trim(),
  };
  if (form.expiryDate) fields.expiryDate = form.expiryDate;
  if (form.nextSurveyDue) fields.nextSurveyDue = form.nextSurveyDue;
  return fields;
}

/** The change that saves `fields` over a saved certificate: a date the form left empty is cleared, not kept. */
export function certificatePatchOf(fields: CertificateFields): Partial<Certificate> {
  return { expiryDate: undefined, nextSurveyDue: undefined, ...fields };
}

/** Everything wrong with the form, in the order of `validateCertificate`. */
export function certificateProblems(form: CertificateForm): FieldError[] {
  return validateCertificate({
    name: nameOf(form), issueDate: form.issueDate, expiryDate: form.expiryDate || undefined,
    nextSurveyDue: form.nextSurveyDue || undefined,
  });
}

/** The control a problem is shown at, which is not always the field's own. */
function controlOf(field: string, form: CertificateForm): CertificateControl {
  // The name is missing either from the select, or from the box that takes the name of a certificate of its own.
  if (field === 'name') return form.key === OTHER ? 'customName' : 'key';
  return field as CertificateControl;
}

/** The problem to show at each control: the first one, an error before a warning. */
export function problemsByControl(problems: FieldError[], form: CertificateForm): Map<CertificateControl, FieldError> {
  const byControl = new Map<CertificateControl, FieldError>();
  for (const found of problems) {
    const control = controlOf(found.field, form);
    const known = byControl.get(control);
    if (!known || (known.severity === 'warning' && found.severity === 'error')) byControl.set(control, found);
  }
  return byControl;
}
