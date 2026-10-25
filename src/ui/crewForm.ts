import { fullName, overlappingContract, rejoinDraft } from '../domain/crew';
import { validateCrewMember } from '../domain/validation';
import type { CrewDraft, CrewMember, FieldError, RankKey } from '../domain/types';

/** What is typed in the crew form: every field as text, and a rank that may not be chosen yet. */
export interface CrewForm {
  surname: string;
  givenNames: string;
  rank: RankKey | '';
  /** The rank in words; only used, and only kept, when the rank is Other. */
  rankOther: string;
  nationality: string;
  dateOfBirth: string;
  placeOfBirth: string;
  passportNo: string;
  passportExpiry: string;
  seamansBookNo: string;
  seamansBookExpiry: string;
  signOnDate: string;
  signOnPort: string;
}

export type CrewControl = keyof CrewForm;

/** The controls of the form, top to bottom: the first one with a problem gets the focus. */
export const CONTROL_ORDER: readonly CrewControl[] = [
  'surname', 'givenNames', 'rank', 'rankOther', 'nationality', 'dateOfBirth', 'placeOfBirth', 'passportNo',
  'passportExpiry', 'seamansBookNo', 'seamansBookExpiry', 'signOnDate', 'signOnPort',
];

/** What the form can say about a contract; the sign-off is made with its own dialog. */
export type CrewFields = Omit<CrewDraft, 'signOffDate' | 'signOffPort'>;

export const RANK_REQUIRED = 'Rank is required.';
const SIGN_OFF_DATE_REQUIRED = 'Sign-off date is required.';

const problem = (field: string, message: string): FieldError => ({ field, severity: 'error', message });

export function blankCrewForm(): CrewForm {
  return {
    surname: '', givenNames: '', rank: '', rankOther: '', nationality: '', dateOfBirth: '', placeOfBirth: '',
    passportNo: '', passportExpiry: '', seamansBookNo: '', seamansBookExpiry: '', signOnDate: '', signOnPort: '',
  };
}

/** The form for a saved contract, or for a draft that is not saved yet. */
export function crewFormOf(m: CrewDraft): CrewForm {
  return {
    surname: m.surname, givenNames: m.givenNames, rank: m.rank, rankOther: m.rankOther ?? '',
    nationality: m.nationality, dateOfBirth: m.dateOfBirth, placeOfBirth: m.placeOfBirth, passportNo: m.passportNo,
    passportExpiry: m.passportExpiry, seamansBookNo: m.seamansBookNo, seamansBookExpiry: m.seamansBookExpiry,
    signOnDate: m.signOnDate, signOnPort: m.signOnPort,
  };
}

function fieldsWith(form: CrewForm, rank: RankKey): CrewFields {
  const fields: CrewFields = {
    surname: form.surname.trim(), givenNames: form.givenNames.trim(), rank, nationality: form.nationality.trim(),
    dateOfBirth: form.dateOfBirth, placeOfBirth: form.placeOfBirth.trim(), passportNo: form.passportNo.trim(),
    passportExpiry: form.passportExpiry, seamansBookNo: form.seamansBookNo.trim(), seamansBookExpiry: form.seamansBookExpiry,
    signOnDate: form.signOnDate, signOnPort: form.signOnPort.trim(),
  };
  if (rank === 'other') fields.rankOther = form.rankOther.trim();
  return fields;
}

/** The fields the form stands for, with the text trimmed; undefined while no rank is chosen. */
export function crewFieldsOf(form: CrewForm): CrewFields | undefined {
  return form.rank === '' ? undefined : fieldsWith(form, form.rank);
}

/**
 * The change that saves `fields` over `saved`. Whatever else is kept in the record (the sign-off) is not in it, and a
 * rank text the rank no longer needs is cleared.
 */
export function crewPatchOf(fields: CrewFields, saved: CrewMember): Partial<CrewMember> {
  return fields.rank !== 'other' && saved.rankOther !== undefined ? { ...fields, rankOther: undefined } : fields;
}

/** The problem of a contract that runs into another contract of the same person, naming that contract and its dates. */
export function overlapProblem(
  candidate: Parameters<typeof overlappingContract>[0], crew: CrewMember[], field: string,
): FieldError | undefined {
  const other = overlappingContract(candidate, crew);
  if (!other) return undefined;
  const span = other.signOffDate ? `from ${other.signOnDate} to ${other.signOffDate}` : `from ${other.signOnDate} (still onboard)`;
  return problem(field, `This overlaps ${fullName(other)}'s contract ${span}.`);
}

/** What the form needs to know about the contract it edits and the ship's other contracts. */
export interface CrewFormContext {
  /** The saved contract being edited; absent for a new one. */
  id?: string;
  /** Its sign-off, if any: the form does not show it, but a sign-on after it is a problem. */
  signOffDate?: string;
  /** The ship's live contracts, to keep one person's contracts apart. */
  crew?: CrewMember[];
}

/**
 * Everything wrong with the form, in the order of `validateCrewMember`, the missing rank next and a contract that
 * runs into another one of the same person last (shown at the sign-on date).
 */
export function crewFormProblems(form: CrewForm, today: string, { id, signOffDate, crew = [] }: CrewFormContext = {}): FieldError[] {
  // With no rank chosen validation is given any rank, so that it checks the other fields; the missing rank is added below.
  const fields = fieldsWith(form, form.rank || 'ab');
  const problems = validateCrewMember({ ...fields, ...(signOffDate && { signOffDate }) }, today);
  if (form.rank === '') problems.push(problem('rank', RANK_REQUIRED));
  const clash = overlapProblem({ ...fields, id, signOffDate }, crew, 'signOnDate');
  if (clash) problems.push(clash);
  return problems;
}

/** The control a problem is shown at, which is not always the field's own. */
function controlOf(field: string, form: CrewForm): CrewControl {
  // The rank text is what is missing when Other is chosen; the sign-on date is the one date of the form that fixes a sign-off.
  if (field === 'rank') return form.rank === 'other' ? 'rankOther' : 'rank';
  if (field === 'signOffDate') return 'signOnDate';
  return field as CrewControl;
}

/** The problem to show at each control: the first one, an error before a warning. */
export function problemsByControl(problems: FieldError[], form: CrewForm): Map<CrewControl, FieldError> {
  const byControl = new Map<CrewControl, FieldError>();
  for (const found of problems) {
    const control = controlOf(found.field, form);
    const known = byControl.get(control);
    if (!known || (known.severity === 'warning' && found.severity === 'error')) byControl.set(control, found);
  }
  return byControl;
}

/**
 * What is wrong with signing `m` off on `signOffDate`: the date is needed, cannot be before the sign-on, and cannot
 * reach a later contract of the same person (among `crew`, the ship's live contracts).
 */
export function signOffProblem(m: CrewMember, signOffDate: string, today: string, crew: CrewMember[] = []): FieldError | undefined {
  if (signOffDate === '') return problem('signOffDate', SIGN_OFF_DATE_REQUIRED);
  const own = validateCrewMember({ ...m, signOffDate }, today).find((found) => found.field === 'signOffDate');
  return own ?? overlapProblem({ ...m, signOffDate }, crew, 'signOffDate');
}

/**
 * What is wrong with re-joining on `signOnDate`: a real date, after the sign-off of the contract it follows, and not
 * running into another contract of the person (the new one has no end).
 */
export function rejoinProblem(m: CrewMember, signOnDate: string, today: string, crew: CrewMember[] = []): FieldError | undefined {
  const draft = rejoinDraft(m, signOnDate, '');
  const own = validateCrewMember(draft, today).find((found) => found.field === 'signOnDate');
  if (own) return own;
  if (m.signOffDate && signOnDate <= m.signOffDate) {
    return problem('signOnDate', `Sign-on must be after the sign-off date (${m.signOffDate}).`);
  }
  return overlapProblem(draft, crew, 'signOnDate');
}
