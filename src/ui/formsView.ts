import { alignLeftEmpty } from '../domain/formSetup';
import type { BaseRecord, FormDraft, FormTemplate } from '../domain/types';
// Types only: the forms engine is loaded on demand (see `src/forms/load.ts`). What it computes (the suggested helpers,
// the period label) is passed in.
import type { FieldDef, FieldLink, FormSchema, FormSetup, HelperKey, RowGroupDef } from '../forms/types';
import { linkFromValue, linkValue } from './formLinks';

/*
 * What the Forms screens show, worked out from the library, the drafts and a template's setup. Everything here is pure;
 * the screens (`Forms.tsx`, `FormSetup.tsx`) only draw it. Text read from a form (code, title, labels) is untrusted and is
 * only ever put into strings that the screens render as text.
 */

/** The files the import takes: Word and Excel forms and templates, and their macro-enabled kinds, whose macros are removed (R21). */
export const FORM_FILE_TYPES = '.docx,.dotx,.docm,.dotm,.xlsx,.xltx,.xlsm,.xltm';

export const fillHref = (templateId: string): string => `#/forms/${encodeURIComponent(templateId)}/fill`;
export const setupHref = (templateId: string): string => `#/forms/${encodeURIComponent(templateId)}/setup`;

/** `TST-01 · Toolbox Talk · Rev 00 / 01.01.2026`, leaving out a code or a revision the form has not got. */
export function libraryText(t: Pick<FormTemplate, 'code' | 'title' | 'revision'>): string {
  return [t.code, t.title, t.revision === '' ? '' : `Rev ${t.revision}`].filter((part) => part !== '').join(' · ');
}

/** By code (numbers in order, case ignored), forms without a code last. */
function compareCodes(a: string, b: string): number {
  if (a === '' || b === '') return a === b ? 0 : a === '' ? 1 : -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Library order: by code, then by title, then by id so the order never depends on the table's. */
function compareTemplates(a: FormTemplate, b: FormTemplate): number {
  return compareCodes(a.code, b.code)
    || a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Whether a form is found by the search: every word of it is in the code, the title or the revision (case ignored). */
export function matchesSearch(t: Pick<FormTemplate, 'code' | 'title' | 'revision'>, query: string): boolean {
  const haystack = `${t.code} ${t.title} ${t.revision}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter((word) => word !== '').every((word) => haystack.includes(word));
}

/** The live forms the search finds, in library order. */
export function libraryRows(templates: FormTemplate[], query: string): FormTemplate[] {
  return templates.filter((t) => !t.deleted && matchesSearch(t, query)).sort(compareTemplates);
}

/** Newest first: changed last, then created last, then by id (as `src/db/forms.ts` picks the newest). */
function newestFirst<T extends BaseRecord>(a: T, b: T): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * The library form a new file with `code` replaces: the live one with that code, or, when several have it (after a
 * handover brought a second copy), the one changed last. None for an empty code, which says nothing.
 */
export function replaceTarget(templates: FormTemplate[], code: string): FormTemplate | undefined {
  if (code === '') return undefined;
  return templates.filter((t) => !t.deleted && t.code === code).sort(newestFirst)[0];
}

/**
 * The form a draft is filled from: the live one it names, else the live one with its (non-empty) code and the revision it
 * was made with (R25: another revision's field ids can name other boxes; the newest, when several), else none.
 */
export function templateForDraft(draft: Pick<FormDraft, 'templateId' | 'code' | 'revision'>, templates: FormTemplate[]): FormTemplate | undefined {
  const own = templates.find((t) => t.id === draft.templateId && !t.deleted);
  if (own || draft.code === '') return own;
  return templates.filter((t) => !t.deleted && t.code === draft.code && t.revision === draft.revision).sort(newestFirst)[0];
}

/** What a draft whose form is not here says: the revision it was made with, when it has one recorded (R25). */
function orphanText(draft: FormDraft): string {
  const code = draft.code === '' ? '(no code)' : draft.code;
  return draft.revision ? `${code} — made with Revision ${draft.revision}; import that revision to continue` : `${code} — import this form to continue`;
}

/** A line of `In progress`, and the form it opens (none when the form is not in the library). */
export interface DraftRow {
  draft: FormDraft;
  template?: FormTemplate;
  text: string;
}

/**
 * The drafts in progress: `<code> <title> — <period>` (`periodLabel` from the helpers), in library order and then by
 * period. A draft whose form is not here (it came in a handover without the library, or was made with another
 * revision) says `<code> — made with Revision <r>; import that revision to continue` (R25), or, with no revision
 * recorded, `<code> — import this form to continue`; these come last.
 */
export function draftRows(drafts: FormDraft[], templates: FormTemplate[], periodLabel: (period: string) => string): DraftRow[] {
  const rows = drafts.filter((d) => !d.deleted).map((draft): DraftRow => {
    const template = templateForDraft(draft, templates);
    if (!template) return { draft, text: orphanText(draft) };
    const name = template.code === '' ? template.title : `${template.code} ${template.title}`;
    return { draft, template, text: `${name} — ${periodLabel(draft.period)}` };
  });
  return rows.sort((a, b) => {
    if (a.template && b.template) {
      return compareTemplates(a.template, b.template) || (a.draft.period < b.draft.period ? -1 : a.draft.period > b.draft.period ? 1 : 0);
    }
    if (a.template || b.template) return a.template ? -1 : 1;
    return compareCodes(a.draft.code, b.draft.code) || (a.draft.period < b.draft.period ? -1 : 1);
  });
}

/** The question asked before a new revision replaces a form. */
export function replacePrompt(oldRevision: string, newRevision: string): string {
  return `Replace Revision ${oldRevision} with Revision ${newRevision}?`;
}

/** What the setup says after a revision replaced a form: the fields nothing was linked to, and the values lost from drafts. */
export function revisionNotice(result: { unmatched: string[]; droppedFromDrafts: number }): string[] {
  const lines: string[] = [];
  if (result.unmatched.length > 0) lines.push(`New fields to check: ${result.unmatched.join(', ')}`);
  const n = result.droppedFromDrafts;
  if (n > 0) lines.push(`${n} ${n === 1 ? 'value' : 'values'} in open drafts could not be carried over.`);
  return lines;
}

/* ---- Setup review ---- */

/** The question asked before a form is removed from the library (R26): `Remove TST-01 Toolbox Talk and its drafts?`. */
export function removePrompt(identity: { code: string; title: string }): string {
  return `Remove ${[identity.code, identity.title].filter((part) => part !== '').join(' ')} and its drafts?`;
}

/** Said once a form has been removed. */
export const FORM_REMOVED = 'Form removed.';

export function setupHeading(identity: { code: string; title: string }): string {
  return `Set up ${identity.code === '' ? identity.title : identity.code}`;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function listed(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** What detection found: `Found 4 fields and 1 table of 12 rows.` */
export function foundSummary(schema: FormSchema): string {
  const parts: string[] = [];
  if (schema.fields.length > 0) parts.push(plural(schema.fields.length, 'field', 'fields'));
  if (schema.rowGroups.length > 0) {
    parts.push(`${plural(schema.rowGroups.length, 'table', 'tables')} of ${listed(schema.rowGroups.map((g) => String(g.capacity)))} rows`);
  }
  return parts.length === 0 ? 'Found nothing to fill in.' : `Found ${parts.join(' and ')}.`;
}

/** A field of the setup: a form field, or a column of a row group (shown under the group's heading). */
export interface SetupEntry {
  field: FieldDef;
  group?: RowGroupDef;
}

export interface SetupSections {
  /** Linked to a source: `Filled for you`. */
  filled: SetupEntry[];
  /** Filled in by the person: `You fill`. Fields with an unsure name come first, to be named. */
  you: SetupEntry[];
  /** Left empty on purpose (a signature): `Left empty`. */
  empty: SetupEntry[];
}

/** The fields, then the columns of each group, in the form's order. */
function entriesOf(schema: FormSchema): SetupEntry[] {
  return [...schema.fields.map((field) => ({ field })), ...schema.rowGroups.flatMap((group) => group.columns.map((field) => ({ field, group })))];
}

/** Whether a field can take a value from a link: a tick box and a photo cannot. */
export function canLink(field: FieldDef): boolean {
  return field.kind !== 'checkbox' && field.kind !== 'picture';
}

/** The select value of a field: `empty`, a link (`link:…`), or `you`. */
export function choiceOf(setup: FormSetup, id: string): string {
  if (setup.leftEmpty.includes(id)) return 'empty';
  const link = setup.links[id];
  return (link && linkValue(link)) ?? 'you';
}

/** Each field in the section its choice puts it in. */
export function setupSections(schema: FormSchema, setup: FormSetup): SetupSections {
  const sections: SetupSections = { filled: [], you: [], empty: [] };
  for (const entry of entriesOf(schema)) {
    const choice = choiceOf(setup, entry.field.id);
    (choice === 'empty' ? sections.empty : choice === 'you' ? sections.you : sections.filled).push(entry);
  }
  const unsure = (e: SetupEntry): number => (e.field.confidence === 'low' ? 0 : 1);
  sections.you.sort((a, b) => unsure(a) - unsure(b)); // stable: the form's order within each
  return sections;
}

/**
 * The setup with a new choice for one field: `empty` leaves it empty, `you` has the person fill it, a link value links
 * it. A field that is not linked gets `{ source: 'none' }`, so that nothing fills it in and a new revision keeps that
 * choice; a field left empty is also taken out of every helper (as `alignLeftEmpty` does when the setup is stored). An
 * unknown value changes nothing. The setup given is not changed.
 */
export function applyChoice(setup: FormSetup, id: string, choice: string): FormSetup {
  const link = choice === 'empty' || choice === 'you' ? { source: 'none' as const } : linkFromValue(choice);
  if (!link) return setup;
  const others = setup.leftEmpty.filter((x) => x !== id);
  if (choice !== 'empty') return { ...setup, links: { ...setup.links, [id]: link }, leftEmpty: others };
  // Left empty: out of every helper too, so that nothing fills it in.
  const helpers = Object.fromEntries(Object.entries(setup.helpers).map(([key, ids]) => [key, (ids ?? []).filter((x) => x !== id)]));
  return { ...setup, links: { ...setup.links, [id]: link }, leftEmpty: [...others, id], helpers: helpers as FormSetup['helpers'] };
}

/**
 * What the setup review keeps of the unsure fields (low confidence, R23) the person confirmed or renamed (R24), with the
 * setup they change.
 */
export interface NameReview {
  setup: FormSetup;
  /** The name each confirmed field was confirmed with, by id: such a field is saved at high confidence (`savedSchema`). */
  confirmed: Record<string, string>;
  /** The link (select value) the review suggested for a confirmed field, by id, while the person has chosen no other. */
  suggested: Record<string, string>;
}

/**
 * The review once the person has confirmed or renamed the unsure field `field` as `name` (R24): the field counts as
 * named at high confidence, and `suggest` (the engine's `suggestLinkFor`, given the field with its new name at high
 * confidence) gives the link for that name. The link is put in the setup, where the person sees it and can change it,
 * when the field is filled by the person (`you`) or still holds the link suggested for an earlier name; a choice the
 * person made (another link, `Leave empty`) is kept. With no link for the new name, a link suggested for an earlier one
 * gives way to `you`. An empty name confirms nothing. The review given is not changed.
 */
export function confirmName(review: NameReview, field: FieldDef, name: string, suggest: (named: FieldDef) => FieldLink | undefined): NameReview {
  const label = name.trim();
  if (label === '') return review;
  const link = suggest({ ...field, label, confidence: 'high' });
  const value = link === undefined ? undefined : linkValue(link);
  const { [field.id]: before, ...others } = review.suggested;
  const confirmed = { ...review.confirmed, [field.id]: label };
  const current = choiceOf(review.setup, field.id);
  if (current !== 'you' && current !== before) return { setup: review.setup, confirmed, suggested: others };
  const setup = applyChoice(review.setup, field.id, value ?? 'you');
  return { setup, confirmed, suggested: value === undefined ? others : { ...others, [field.id]: value } };
}

const HELPER_ORDER: readonly HelperKey[] = ['pickCrew', 'allOk', 'todayRow', 'startFromLast', 'jobLog', 'thresholds', 'now'];

/** A switch of the `Helpers` section: one helper, for one group or field (or, for All OK, one section's fields). */
export interface HelperSwitch {
  key: HelperKey;
  ids: string[];
  label: string;
  on: boolean;
}

function helperName(key: HelperKey, okWord: string): string {
  switch (key) {
    case 'pickCrew': return 'Add from crew';
    case 'allOk': return `All ${okWord.trim() || 'OK'}`;
    case 'todayRow': return "Today's row";
    case 'startFromLast': return 'Start from last';
    case 'jobLog': return 'Carry over unfinished jobs';
    case 'thresholds': return 'Check readings against alarms';
    case 'now': return 'Now';
  }
}

/** What each id of the schema is called: a field, a group, a column (`<group> · <column>`) or a matrix block. */
function namesOf(schema: FormSchema): Map<string, { label: string; section?: string; field: boolean }> {
  const names = new Map<string, { label: string; section?: string; field: boolean }>();
  for (const f of schema.fields) {
    names.set(f.id, { label: f.label, section: f.section, field: true });
    if (f.block !== undefined && !names.has(f.block)) names.set(f.block, { label: f.section || 'Table', field: false });
  }
  for (const g of schema.rowGroups) {
    names.set(g.id, { label: g.label, field: false });
    for (const c of g.columns) names.set(c.id, { label: `${g.label} · ${c.label}`, field: true });
  }
  return names;
}

/**
 * The switches of the `Helpers` section: for each helper, each place `suggested` (the engine's `suggestHelpers`) or the
 * setup has it, that is still in the form and not left empty. All OK has one switch for the fields of each section (it sets a whole
 * section), and one for each group. A switch is on when the setup has the helper for every id of it.
 */
export function helperSwitches(schema: FormSchema, setup: FormSetup, suggested: Record<HelperKey, string[]>): HelperSwitch[] {
  const names = namesOf(schema);
  const switches: HelperSwitch[] = [];
  for (const key of HELPER_ORDER) {
    // A field left empty is never offered: no helper may fill it in.
    const ids = [...new Set([...suggested[key], ...(setup.helpers[key] ?? [])])].filter((id) => names.has(id) && !setup.leftEmpty.includes(id));
    const name = helperName(key, setup.okWord);
    const add = (label: string, of: string[]): void => {
      switches.push({ key, ids: of, label: `${name}: ${label}`, on: of.every((id) => setup.helpers[key]?.includes(id)) });
    };
    if (key === 'allOk') {
      const bySection = new Map<string, string[]>();
      for (const id of ids) {
        const entry = names.get(id);
        if (entry?.field) bySection.set(entry.section ?? '', [...(bySection.get(entry.section ?? '') ?? []), id]);
        else add(entry?.label ?? id, [id]);
      }
      for (const [section, of] of bySection) add(section || 'Fields without a section', of);
    } else {
      for (const id of ids) add(names.get(id)?.label ?? id, [id]);
    }
  }
  return switches;
}

/** The setup with a switch turned on or off. */
export function setHelper(setup: FormSetup, helper: HelperSwitch, on: boolean): FormSetup {
  const current = (setup.helpers[helper.key] ?? []).filter((id) => !helper.ids.includes(id));
  return { ...setup, helpers: { ...setup.helpers, [helper.key]: on ? [...current, ...helper.ids] : current } };
}

/** `Not finished value` is asked for only while the job log helper is on. */
export function showsNotFinished(setup: FormSetup): boolean {
  return (setup.helpers.jobLog ?? []).length > 0;
}

export const OK_WORD_REQUIRED = 'Enter the OK word.';
export const NAME_REQUIRED = 'Enter a name for this field.';
export const NOT_FINISHED_REQUIRED = 'Enter the status of a job that is not finished.';

/**
 * What must be put right before the setup is saved, by `okWord`, `notFinished` or field id. `notFinished` is checked only
 * when it is given, which the screen does while `Not finished value` is asked for (`showsNotFinished`).
 */
export function setupProblems(state: { okWord: string; labels: Record<string, string>; notFinished?: string }): Record<string, string> {
  const problems: Record<string, string> = {};
  if (state.okWord.trim() === '') problems.okWord = OK_WORD_REQUIRED;
  if (state.notFinished !== undefined && state.notFinished.trim() === '') problems.notFinished = NOT_FINISHED_REQUIRED;
  for (const [id, label] of Object.entries(state.labels)) if (label.trim() === '') problems[id] = NAME_REQUIRED;
  return problems;
}

/**
 * The schema as it is saved with the setup: the fields the person named have their new label, those they confirmed
 * (`confirmed`, R24) are at high confidence, and the left-empty marks follow the setup (`alignLeftEmpty`, the rule the
 * store applies too; the writers leave such a field unwritten).
 */
export function savedSchema(schema: FormSchema, setup: FormSetup, labels: Record<string, string>, confirmed: ReadonlySet<string> = new Set()): FormSchema {
  const rename = (f: FieldDef): FieldDef => {
    const label = labels[f.id]?.trim();
    const named = label ? { ...f, label } : f;
    return confirmed.has(f.id) && named.confidence !== 'high' ? { ...named, confidence: 'high' } : named;
  };
  const named = { ...schema, fields: schema.fields.map(rename), rowGroups: schema.rowGroups.map((g) => ({ ...g, columns: g.columns.map(rename) })) };
  return alignLeftEmpty(named, setup).schema;
}
