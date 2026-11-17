import type { DraftSurvey, DraftSurveyShip } from '../../domain/types';
import { verifyOutput } from '../../forms/engine';
import { FormFileError, FormWriteError, IntegrityError } from '../../forms/errors';
import { parseRange, parseRef } from '../../forms/excel/refs';
import { kid, kids, loadWorkbook, relOfType, relsOf, workbookPath } from '../../forms/excel/workbook';
import type { CellModel, SheetModel } from '../../forms/excel/workbook';
import { writeExcel } from '../../forms/excel/write';
import { bytesOf, partText, readPackage, writePackage } from '../../forms/package';
import type { Package } from '../../forms/package';
import type { DraftValues, FieldDef, FieldKind, FormSchema } from '../../forms/types';
import { parseXml, serializeXml } from '../../forms/xml';
import { CELL_NAMES, missingCells, normalizeLabel } from './cells';
import type { CellKey, CellMap, SurveySheet } from './types';

/*
 * Filling the company workbook in (spec §4.4): the survey's inputs, and nothing else, go into the template's input
 * cells by the cell map stored at import. An initial survey or constant check is written on INITIAL, a final or interim
 * survey on FINAL (spec §2: interims follow FINAL), and both together when both are given. FINAL's own dA and LBP are
 * written from the ship record (spec §4.2 item 20), so the workbook agrees with the app.
 *
 * The forms engine does the writing (`writeExcel`: formulas, styles and every other part stay byte-identical, and the
 * workbook is set to `fullCalcOnLoad`), and its check (`verifyOutput`) reads every value back before the file is handed
 * over. An input the survey leaves empty is cleared first, so that the template's old value (the company workbook is a
 * filled-in survey) does not stay: `writeExcel` writes values only.
 *
 * Before anything is written, every target cell is checked (the Task 2 carry): it must not be a formula, must not be
 * inside a merged block other than at its first cell, and must not be the label or unit beside an input (a number
 * input that holds text, a text input that holds a label such as "Port:" or a unit such as "MT"). A target that fails,
 * or a required input with no cell, refuses the whole fill with a plain message: nothing is written.
 */

export interface FillInput {
  /** The stored template: the company workbook as imported. */
  bytes: Uint8Array;
  cellMap: CellMap;
  ship: DraftSurveyShip;
  /** For the file's name. */
  shipName: string;
  /** Written on INITIAL: an initial survey, or a constant check. */
  initial?: DraftSurvey;
  /** Written on FINAL: a final or interim survey. */
  other?: DraftSurvey;
  /** The day for the file's name when the survey has no date (ISO). */
  today?: string;
}

export interface FilledWorkbook { fileName: string; bytes: Uint8Array }

const XLSX_NAME = /[\\/:*?"<>|\p{Cc}\p{Cf}]/gu;

/** `Draft_Survey_<Ship>_<YYYY-MM-DD>_<kind>.xlsx`, with the ship's name made safe for a file (spaces as `_`). */
export function surveyFileName(shipName: string, date: string, kind: string): string {
  const ship = shipName.trim().replace(XLSX_NAME, '-').replace(/\s+/gu, '_') || 'Ship';
  return `Draft_Survey_${ship}_${date}_${kind}.xlsx`;
}

const NUMBER_KEYS = new Set<CellKey>([
  'fP', 'fS', 'mP', 'mS', 'aP', 'aS', 'density', 'ballast', 'freshWater', 'vlsfo', 'lsmgo', 'lubOil', 'other',
  'comparedQty', 'blQty', 'windBft', 'swell', 'finalOwnDA', 'finalOwnLBP',
]);
const kindOf = (key: CellKey): FieldKind =>
  NUMBER_KEYS.has(key) ? 'number' : key === 'date' ? 'date' : key === 'timeFrom' || key === 'timeTill' ? 'time' : 'text';

/** The workbook's own words under its title: what INITIAL's H3 holds, which FINAL and the DS Report compare with. */
const OPERATION_TEXT = { loading: 'Loading of', discharging: 'Discharging of' } as const;

/**
 * Texts that are labels or units of the sheet, never an input's value: the inputs' own labels, and the units the
 * workbook writes beside them.
 */
const LABELS = new Set([
  ...Object.values(CELL_NAMES).map(normalizeLabel),
  'm', 'mt', 't', 'cm', 'bft', '%', '°', 't/m3', 'kg/m3', 'tons', 'time', 'port', 'starboard', 'forward', 'midships', 'aft',
  'weather', 'q-ty', 'bl q-ty', 'shore scale', 'b/l figure', 'loading of', 'discharging of',
].map(normalizeLabel));

/** A text that labels a cell rather than fills one: it ends in ":" or "=", is a known label or unit, or is a separator. */
function looksLikeLabel(text: string): boolean {
  const trimmed = text.trim();
  return /[:=]$/.test(trimmed) || !/[\p{L}\p{N}]/u.test(trimmed) || LABELS.has(normalizeLabel(trimmed));
}

const isTextCell = (cell: CellModel) => cell.type === 's' || cell.type === 'str' || cell.type === 'inlineStr' || cell.type === 'b' || cell.type === 'e';

/** Why the cell can't take the input, or `undefined` when it can. */
function unsafe(sheet: SheetModel, ref: string, key: CellKey): string | undefined {
  const at = parseRef(ref);
  if (!at || !/^[A-Z]+\d+$/.test(ref)) return 'is not a cell address';
  for (const merge of sheet.merges) {
    const m = parseRange(merge);
    if (m && m.r1 <= at.row && at.row <= m.r2 && m.c1 <= at.col && at.col <= m.c2 && (m.r1 !== at.row || m.c1 !== at.col)) {
      return `is inside the merged block ${merge}, not its first cell`;
    }
  }
  const cell = sheet.cells.get(ref);
  if (cell?.formula !== undefined) return 'is a formula';
  const text = cell?.text.trim() ?? '';
  if (!cell || text === '') return undefined;
  if (key === 'operation') {
    const op = text.toLowerCase();
    return op === 'loading of' || op === 'discharging of' ? undefined : `holds “${text}”, not “Loading of” or “Discharging of”`;
  }
  if (kindOf(key) === 'number') return isTextCell(cell) ? `holds “${text}”, a label or unit, not a number` : undefined;
  return isTextCell(cell) && looksLikeLabel(text) ? `holds “${text}”, a label or unit, not an input` : undefined;
}

const numberText = (x: number | undefined) => (x === undefined ? undefined : String(x));

/** What each mapped input of a sheet gets: its text, or `undefined` for an input the survey leaves empty. */
function valuesFor(sheet: SurveySheet, survey: DraftSurvey, ship: DraftSurveyShip, operation: DraftSurvey['operation']): Partial<Record<CellKey, string | undefined>> {
  const d = survey.drafts;
  const x = survey.deductibles;
  const values: Partial<Record<CellKey, string | undefined>> = {
    port: survey.port, terminal: survey.terminal, cargo: survey.cargo, holds: survey.holds, date: survey.date,
    timeFrom: survey.timeFrom, timeTill: survey.timeTill, windBft: numberText(survey.windBft), swell: numberText(survey.swell),
    fP: numberText(d.fP), fS: numberText(d.fS), mP: numberText(d.mP), mS: numberText(d.mS), aP: numberText(d.aP), aS: numberText(d.aS),
    density: numberText(survey.density),
    ballast: numberText(x.ballast), freshWater: numberText(x.freshWater), vlsfo: numberText(x.vlsfo), lsmgo: numberText(x.lsmgo),
    lubOil: numberText(x.lubOil), other: numberText(x.other),
    blQty: numberText(survey.blQty), remarks: survey.remarks, surveyor: survey.surveyor, chiefOfficer: survey.chiefOfficer,
  };
  if (sheet === 'INITIAL') {
    values.operation = OPERATION_TEXT[operation];
    values.cargoTitle = survey.cargo;
  } else {
    values.comparedQty = numberText(survey.comparedQty);
    values.finalOwnDA = numberText(ship.dA);
    values.finalOwnLBP = numberText(ship.lbp);
  }
  return values;
}

/** The sheet's XML with the cells `refs` emptied (no value, no type), and the number of shared strings they held. */
function clearCells(text: string, refs: ReadonlySet<string>): { text: string; strings: number } {
  const doc = parseXml(text);
  let strings = 0;
  for (const row of kids(kid(doc.documentElement, 'sheetData') ?? doc.documentElement, 'row')) {
    for (const c of kids(row, 'c')) {
      if (!refs.has(c.getAttribute('r') ?? '')) continue;
      const held = kids(c).filter((k) => k.localName === 'v' || k.localName === 'is');
      if (c.getAttribute('t') === 's' && held.some((k) => k.localName === 'v')) strings += 1;
      for (const k of held) c.removeChild(k);
      c.removeAttribute('t');
    }
  }
  return { text: serializeXml(doc), strings };
}

const REFUSED = "The company workbook can't be filled in from the app";
const REIMPORT = 'Import the company workbook again under Ship data, or check its labels. The numbers and the report still work.';

/**
 * The template filled in with the survey(s), checked, and named; or why it can't be (a plain message, and no file).
 * The operation written on INITIAL is the initial survey's own (a constant check is always "Loading of", which the
 * sheet calls the constant); an interim or final survey's stored operation is never used.
 */
export function fillSurveyWorkbook(input: FillInput): FilledWorkbook | { error: string } {
  const jobs: { sheet: SurveySheet; survey: DraftSurvey }[] = [];
  if (input.initial) jobs.push({ sheet: 'INITIAL', survey: input.initial });
  if (input.other) jobs.push({ sheet: 'FINAL', survey: input.other });
  if (jobs.length === 0) return { error: 'There is no survey to write.' };

  const missing = missingCells(input.cellMap, jobs.map((j) => j.sheet));
  if (missing.length > 0) {
    return { error: `${REFUSED}: ${missing.join(', ')} ${missing.length === 1 ? "wasn't" : "weren't"} found in it. ${REIMPORT}` };
  }

  let pkg: Package;
  let sheets: SheetModel[];
  try {
    pkg = readPackage(input.bytes);
    sheets = loadWorkbook(pkg).sheets;
  } catch (error) {
    if (error instanceof FormFileError) return { error: `The stored company workbook couldn't be read. ${REIMPORT}` };
    throw error;
  }

  const fields: FieldDef[] = [];
  const values: DraftValues = { fields: {}, rows: {} };
  const toClear = new Map<string, Set<string>>();
  const problems: string[] = [];
  for (const { sheet: name, survey } of jobs) {
    const sheet = sheets.find((s) => s.name.trim().toUpperCase() === name);
    if (!sheet) return { error: `${REFUSED}: it has no ${name} sheet. ${REIMPORT}` };
    const operation = survey.kind === 'constant' ? 'loading' : survey.operation;
    const given = valuesFor(name, survey, input.ship, operation);
    // Two inputs on one cell: the second would overwrite the first, so it is refused rather than left to the read-back.
    const taken = new Map<string, CellKey>();
    for (const [key, ref] of Object.entries(input.cellMap[name]) as [CellKey, string][]) {
      const first = taken.get(ref);
      if (first !== undefined) { problems.push(`${name}: ${CELL_NAMES[first]} and ${CELL_NAMES[key]} (${ref}) are the same cell`); continue; }
      taken.set(ref, key);
      const why = unsafe(sheet, ref, key);
      if (why) { problems.push(`${name}: ${CELL_NAMES[key]} (${ref}) ${why}`); continue; }
      const value = given[key];
      if (value === undefined || value === '') {
        const refs = toClear.get(sheet.path) ?? new Set<string>();
        refs.add(ref);
        toClear.set(sheet.path, refs);
        continue;
      }
      const id = `${name}!${key}`;
      fields.push({ id, kind: kindOf(key), label: CELL_NAMES[key], section: name, loc: `${sheet.path}!${ref}`, confidence: 'high' });
      values.fields[id] = value;
    }
  }
  if (problems.length > 0) return { error: `${REFUSED}: ${problems.join('; ')}. ${REIMPORT}` };

  try {
    // The template with the empty inputs cleared: what the values are written into, and what the check compares with.
    const cleared: Package = { entries: new Map(pkg.entries), order: pkg.order };
    const changed = new Map<string, Uint8Array>();
    let releasedStrings = 0;
    for (const [part, refs] of toClear) {
      const result = clearCells(partText(pkg, part)!, refs);
      releasedStrings += result.strings;
      changed.set(part, bytesOf(result.text));
    }
    const sstPath = relOfType(relsOf(pkg, workbookPath(pkg)), 'sharedStrings')?.target;
    const sst = sstPath === undefined ? undefined : partText(pkg, sstPath);
    if (releasedStrings > 0 && sstPath !== undefined && sst !== undefined) {
      const counted = sst.replace(/(<(?:\w+:)?sst\b[^>]*?\bcount=")(\d+)"/, (_, head: string, n: string) => `${head}${Math.max(0, Number(n) - releasedStrings)}"`);
      if (counted !== sst) changed.set(sstPath, bytesOf(counted));
    }
    for (const [part, bytes] of changed) cleared.entries.set(part, bytes);

    const schema: FormSchema = { kind: 'xlsx', identity: { code: '', title: 'Draft survey', revision: '' }, fields, rowGroups: [], unsupported: [] };
    for (const [part, bytes] of writeExcel(cleared, schema, values)) changed.set(part, bytes);
    const bytes = writePackage(pkg, changed);
    verifyOutput(cleared, readPackage(bytes), new Set(changed.keys()), schema, values);

    const last = input.other ?? input.initial!;
    const kind = [input.initial && (input.initial.kind === 'constant' ? 'Constant' : 'Initial'), input.other && (input.other.kind === 'interim' ? 'Interim' : 'Final')]
      .filter(Boolean).join('_');
    return { fileName: surveyFileName(input.shipName, last.date ?? input.today ?? new Date().toISOString().slice(0, 10), kind), bytes };
  } catch (error) {
    if (error instanceof FormWriteError || error instanceof IntegrityError || error instanceof FormFileError) {
      return { error: `${REFUSED}: ${error.message} ${REIMPORT}` };
    }
    throw error;
  }
}
