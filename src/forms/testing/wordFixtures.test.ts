import { describe, expect, it } from 'vitest';
import { readPackage, utf8 } from '../package';
import type { Package } from '../package';
import { parseXml } from '../xml';
import { contentControlsDocx, oddLayoutsDocx, permitDocx, toolboxTalkDocx, weeklyJobsDotx } from './wordFixtures';

/*
 * What each Word fixture holds, so that the tests of detection and writing can rely on it. The XML is read here in
 * the plainest way (by element name), not with the code under test.
 */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';

const all = (root: Document | Element, ns: string, name: string): Element[] => Array.from(root.getElementsByTagNameNS(ns, name));
const attr = (element: Element, name: string): string | null => element.getAttributeNS(W, name);
const part = (pkg: Package, path: string): Document => parseXml(utf8(pkg.entries.get(path)!));
const textOf = (element: Element | Document): string => all(element, W, 't').map((t) => t.textContent ?? '').join('');

/** A legacy form field as the runs say it: its name, instruction, `ffData` details, and the runs between `separate` and `end`. */
interface LegacyField { name: string; instruction: string; steps: string[]; result: string; input?: Element; list: string[]; checkBox?: Element }

/** Reads the form fields of a part in document order, by walking its runs. */
function legacyFields(doc: Document | Element): LegacyField[] {
  const fields: LegacyField[] = [];
  let current: LegacyField | undefined;
  for (const run of all(doc, W, 'r')) {
    // Only what the run holds itself: a run that anchors a text box has whole paragraphs, with fields, below it.
    const own = (name: string): Element | undefined => Array.from(run.childNodes).find((n) => (n as Element).localName === name) as Element | undefined;
    const fldChar = own('fldChar');
    const type = fldChar ? attr(fldChar, 'fldCharType') : null;
    if (type === 'begin') {
      const ffData = all(fldChar!, W, 'ffData')[0];
      current = { name: ffData ? attr(all(ffData, W, 'name')[0]!, 'val')! : '', instruction: '', steps: ['begin'], result: '', list: [] };
      if (ffData) {
        current.input = all(ffData, W, 'textInput')[0];
        current.checkBox = all(ffData, W, 'checkBox')[0];
        current.list = all(ffData, W, 'listEntry').map((entry) => attr(entry, 'val')!);
      }
      fields.push(current);
    } else if (current && own('instrText')) {
      current.instruction += own('instrText')!.textContent;
      current.steps.push('instruction');
    } else if (current && type) {
      current.steps.push(type);
      if (type === 'end') current = undefined;
    } else if (current && current.steps.includes('separate')) {
      current.result += own('t')?.textContent ?? '';
      current.steps.push('result');
    }
  }
  return fields.filter((field) => field.name !== '');
}

/** The `w:tr` elements of the table at `index` of the part, in order, and each one's cell texts. */
const tableRows = (doc: Document, index: number): Element[] => all(all(doc, W, 'tbl')[index]!, W, 'tr');
const cellTexts = (row: Element): string[] => all(row, W, 'tc').map(textOf);
/** A row with no text, no field, no symbol and no picture in any cell. */
const isEmptyRow = (row: Element): boolean => textOf(row).trim() === ''
  && ['fldChar', 'sym', 'drawing', 'sdt'].every((name) => all(row, W, name).length === 0);
const headerOf = (pkg: Package): string => textOf(part(pkg, 'word/header1.xml'));
const EN_SPACES = '\u2002'.repeat(5);

describe('every Word fixture', () => {
  const builders = { toolboxTalkDocx, permitDocx, weeklyJobsDotx, contentControlsDocx, oddLayoutsDocx };

  it.each(Object.entries(builders))('%s: the header is reached from w:sectPr through its relationship, and has a content type', (_name, build) => {
    const pkg = readPackage(build());
    const sectPr = all(part(pkg, 'word/document.xml'), W, 'sectPr')[0]!;
    const reference = all(sectPr, W, 'headerReference')[0]!;
    expect(attr(reference, 'type')).toBe('default');
    const rId = reference.getAttributeNS(R, 'id');
    const rels = all(part(pkg, 'word/_rels/document.xml.rels'), RELS, 'Relationship');
    expect(rels.find((rel) => rel.getAttribute('Id') === rId)!.getAttribute('Target')).toBe('header1.xml');
    const overrides = all(part(pkg, '[Content_Types].xml'), TYPES, 'Override');
    expect(overrides.find((o) => o.getAttribute('PartName') === '/word/header1.xml')!.getAttribute('ContentType'))
      .toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml');
  });

  it.each(Object.entries(builders))('%s: every legacy field runs begin, instruction, separate, result, end, in a bookmark of its name', (_name, build) => {
    const pkg = readPackage(build());
    for (const path of ['word/document.xml', 'word/header1.xml']) {
      const doc = part(pkg, path);
      const fields = legacyFields(doc);
      const bookmarks = all(doc, W, 'bookmarkStart').map((b) => attr(b, 'name'));
      expect(bookmarks).toEqual(fields.map((f) => f.name));
      for (const field of fields) {
        expect(field.steps[0]).toBe('begin');
        expect(field.steps.slice(1, 3)).toEqual(['instruction', 'separate']);
        expect(field.steps.at(-1)).toBe('end');
        expect(field.instruction).toMatch(/^ FORM(?:TEXT|CHECKBOX|DROPDOWN) $/);
      }
    }
  });

  it('never has a literal en space, only the character reference', () => {
    const text = utf8(readPackage(toolboxTalkDocx()).entries.get('word/document.xml')!);
    expect(text).toContain('&#x2002;&#x2002;&#x2002;&#x2002;&#x2002;');
  });

  it('builds the same bytes every time', () => {
    for (const build of Object.values(builders)) expect(build()).toEqual(build());
  });
});

describe('toolboxTalkDocx', () => {
  const pkg = readPackage(toolboxTalkDocx());
  const doc = part(pkg, 'word/document.xml');

  it('has the title, form code and revision in the header', () => {
    const lines = all(part(pkg, 'word/header1.xml'), W, 'p').map(textOf).filter(Boolean);
    expect(lines).toEqual(['Toolbox Talk', 'Form: TST-01', 'Revision: 00 / 01.01.2026', 'Page: 1 of 1']);
  });

  it('has Vessel, Subject, Date and Time as FORMTEXT fields, with an empty result of five en spaces', () => {
    const rows = tableRows(doc, 0).map(cellTexts);
    expect(rows).toEqual([['Vessel:', EN_SPACES], ['Subject:', EN_SPACES], ['Date:', EN_SPACES, `Time: ${EN_SPACES}`]]);
    const fields = legacyFields(doc);
    expect(fields.map((f) => f.instruction.trim())).toEqual(['FORMTEXT', 'FORMTEXT', 'FORMTEXT', 'FORMTEXT']);
    expect(fields.map((f) => f.result)).toEqual([EN_SPACES, EN_SPACES, EN_SPACES, EN_SPACES]);
    expect(fields.map((f) => f.steps)).toEqual(Array(4).fill(['begin', 'instruction', 'separate', 'result', 'end']));
  });

  it('gives the date field its own type and format, and leaves the others plain', () => {
    const inputs = legacyFields(doc).map((f) => f.input!);
    expect(inputs.map((input) => all(input, W, 'type').map((t) => attr(t, 'val')))).toEqual([[], [], ['date'], []]);
    expect(attr(all(inputs[2]!, W, 'format')[0]!, 'val')).toBe('dd/MMM/yyyy');
  });

  it('has a Participants table with a header and 12 empty rows', () => {
    const rows = tableRows(doc, 1);
    expect(cellTexts(rows[0]!)).toEqual(['Name', 'Rank', 'Signature']);
    expect(rows).toHaveLength(13);
    expect(rows.slice(1).every(isEmptyRow)).toBe(true);
    expect(all(doc, W, 'p').filter((p) => textOf(p) === 'Participants')).toHaveLength(1);
  });

  it('ends with a cell holding Signature: and (Person in charge)', () => {
    const cell = all(tableRows(doc, 2)[0]!, W, 'tc');
    expect(cell).toHaveLength(1);
    expect(all(cell[0]!, W, 'p').map(textOf)).toEqual(['Signature:', '(Person in charge)']);
  });

  it('can be a later revision: a new revision text, a renamed Subject and an extra Location field', () => {
    const later = readPackage(toolboxTalkDocx({ revision: '01 / 01.06.2026', renameSubjectTo: 'Topic', extraFieldLabel: 'Location' }));
    expect(headerOf(later)).toContain('Revision: 01 / 01.06.2026');
    const laterDoc = part(later, 'word/document.xml');
    expect(tableRows(laterDoc, 0).map((row) => cellTexts(row)[0])).toEqual(['Vessel:', 'Topic:', 'Location:', 'Date:']);
    expect(legacyFields(laterDoc)).toHaveLength(5);
    expect(tableRows(laterDoc, 1)).toHaveLength(13);
  });
});

describe('permitDocx', () => {
  const pkg = readPackage(permitDocx());
  const doc = part(pkg, 'word/document.xml');

  it('has two Yes / No / N/A sections of tick boxes, each a Wingdings F0A8 symbol', () => {
    const section1 = tableRows(doc, 0);
    expect(cellTexts(section1[0]!)).toEqual(['Section 1 – Checks']);
    expect(attr(all(section1[0]!, W, 'gridSpan')[0]!, 'val')).toBe('4');
    expect(cellTexts(section1[1]!)).toEqual(['', 'Yes', 'No', 'N/A']);
    expect(section1.slice(2).map((row) => cellTexts(row)[0])).toEqual(['Check 1.1', 'Check 1.2', 'Check 1.3', 'Check 1.4']);

    expect(all(doc, W, 'p').filter((p) => textOf(p) === 'Section 2 – Entry')).toHaveLength(1);
    const section2 = tableRows(doc, 1);
    expect(cellTexts(section2[0]!)).toEqual(['', 'Yes', 'No', 'N/A']);
    expect(section2.slice(1).map((row) => cellTexts(row)[0])).toEqual(['Check 2.1', 'Check 2.2', 'Check 2.3']);

    const symbols = all(doc, W, 'sym');
    expect(symbols).toHaveLength((4 + 3) * 3);
    for (const symbol of symbols) {
      expect([attr(symbol, 'font'), attr(symbol, 'char')]).toEqual(['Wingdings', 'F0A8']);
    }
    for (const row of [...section1.slice(2), ...section2.slice(1)]) {
      expect(all(row, W, 'tc').map((cell) => all(cell, W, 'sym').length)).toEqual([0, 1, 1, 1]);
    }
  });

  it('has a gas table: two alarm rows, then 10 empty reading rows', () => {
    const rows = tableRows(doc, 2);
    expect(cellTexts(rows[0]!)).toEqual(['Gas readings']);
    expect(cellTexts(rows[1]!)).toEqual(['Time', 'O2 [Vol.%]', 'CO [ppm]', 'H2S [ppm]']);
    expect(cellTexts(rows[2]!)).toEqual(['Alarm 1', '19.5', '25', '5']);
    expect(cellTexts(rows[3]!)).toEqual(['Alarm 2', '23', '50', '10']);
    expect(rows).toHaveLength(14);
    expect(rows.slice(4).every(isEmptyRow)).toBe(true);
  });

  it('has a Personnel table with 8 empty rows', () => {
    const rows = tableRows(doc, 3);
    expect(cellTexts(rows[0]!)).toEqual(['Name / Rank', 'Time IN', 'Time OUT']);
    expect(rows).toHaveLength(9);
    expect(rows.slice(1).every(isEmptyRow)).toBe(true);
    expect(all(doc, W, 'p').filter((p) => textOf(p) === 'Personnel')).toHaveLength(1);
  });

  it('has one legacy checkbox, unchecked, after its label', () => {
    const fields = legacyFields(doc);
    expect(fields.map((f) => f.instruction.trim())).toEqual(['FORMCHECKBOX']);
    expect(fields[0]!.steps).toEqual(['begin', 'instruction', 'separate', 'end']);
    expect(attr(all(fields[0]!.checkBox!, W, 'default')[0]!, 'val')).toBe('0');
    expect(cellTexts(tableRows(doc, 4)[0]!)).toEqual(['Checks completed:', '']);
  });
});

describe('weeklyJobsDotx', () => {
  const pkg = readPackage(weeklyJobsDotx());
  const doc = part(pkg, 'word/document.xml');

  it('is a template', () => {
    const overrides = all(part(pkg, '[Content_Types].xml'), TYPES, 'Override');
    expect(overrides.find((o) => o.getAttribute('PartName') === '/word/document.xml')!.getAttribute('ContentType'))
      .toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml');
  });

  it('has Vessel, Year / Week No. and Date (from to) as FORMTEXT fields', () => {
    expect(tableRows(doc, 0).map((row) => cellTexts(row)[0])).toEqual(['Vessel:', 'Year / Week No.:', 'Date (from to):']);
    const text = legacyFields(doc).filter((f) => f.instruction.trim() === 'FORMTEXT');
    expect(text).toHaveLength(3);
  });

  it('has a Jobs repeating section of 3 items under a header row, with a Status dropdown in each', () => {
    const jobs = all(doc, W15, 'repeatingSection');
    expect(jobs).toHaveLength(2);
    const outer = jobs[0]!.parentNode!.parentNode as Element;
    expect(attr(all(outer, W, 'alias')[0]!, 'val')).toBe('Jobs');
    // Each item is a control of its own inside the outer control's content, and holds one table row.
    const items = all(outer, W15, 'repeatingSectionItem').map((item) => item.parentNode!.parentNode as Element);
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.parentNode!.parentNode).toBe(outer);
      expect(all(item, W, 'tr')).toHaveLength(1);
    }

    const table = all(doc, W, 'tbl')[1]!;
    expect(cellTexts(all(table, W, 'tr')[0]!)).toEqual(['Date', 'Responsible', 'Description', 'Status', 'Remarks']);
    expect(all(outer, W, 'tr')).toHaveLength(3);
    const dropdowns = legacyFields(doc).filter((f) => f.instruction.trim() === 'FORMDROPDOWN' && f.list[1] === 'Pending');
    expect(dropdowns).toHaveLength(3);
    for (const dropdown of dropdowns) expect(dropdown.list).toEqual(['_ choose', 'Pending', 'Completed']);
  });

  it('has a Pictures repeating section of one item: 3 picture controls, each with a Before / After dropdown', () => {
    const outer = all(doc, W15, 'repeatingSection')[1]!.parentNode!.parentNode as Element;
    expect(all(outer, W15, 'repeatingSectionItem')).toHaveLength(1);
    expect(all(outer, W, 'tr')).toHaveLength(1);
    const pictures = all(outer, W, 'picture');
    expect(pictures).toHaveLength(3);
    const drops = legacyFields(doc).filter((f) => f.list[1] === 'Before');
    expect(drops.map((f) => f.list)).toEqual(Array(3).fill(['_ choose', 'Before', 'After']));
    expect(drops.map((f) => f.name)).toEqual(['Photo1', 'Photo2', 'Photo3']);
  });

  it('shows each picture control as a placeholder: an inline picture with its extent and a blip on the image relationship', () => {
    const rels = all(part(pkg, 'word/_rels/document.xml.rels'), RELS, 'Relationship');
    const image = rels.find((rel) => rel.getAttribute('Type')!.endsWith('/image'))!;
    expect(image.getAttribute('Target')).toBe('media/image1.png');
    const controls = all(doc, W, 'sdt').filter((sdt) => all(all(sdt, W, 'sdtPr')[0]!, W, 'picture').length === 1);
    expect(controls).toHaveLength(3);
    for (const control of controls) {
      expect(all(all(control, W, 'sdtPr')[0]!, W, 'showingPlcHdr')).toHaveLength(1);
      const inline = all(control, WP, 'inline')[0]!;
      expect(Number(all(inline, WP, 'extent')[0]!.getAttribute('cx'))).toBeGreaterThan(0);
      const blip = all(inline, A, 'blip')[0]!;
      expect(blip.getAttributeNS(R, 'embed')).toBe(image.getAttribute('Id'));
    }
  });

  it('declares the extension namespaces and marks them ignorable, with unique control ids', () => {
    const root = doc.documentElement;
    expect(root.getAttribute('xmlns:w14')).toBe(W14);
    expect(root.getAttribute('xmlns:w15')).toBe(W15);
    expect(root.getAttributeNS('http://schemas.openxmlformats.org/markup-compatibility/2006', 'Ignorable')).toBe('w14 w15');
    const ids = all(doc, W, 'sdtPr').map((pr) => attr(all(pr, W, 'id')[0]!, 'val'));
    expect(new Set(ids).size).toBe(ids.length);
    // Two repeating sections, their 4 items, 4 controls in each of the 3 job rows, and 3 picture controls.
    expect(ids).toHaveLength(2 + 4 + 3 * 4 + 3);
  });
});

describe('contentControlsDocx', () => {
  const pkg = readPackage(contentControlsDocx());
  const doc = part(pkg, 'word/document.xml');
  const properties = all(doc, W, 'sdtPr');
  const kindOf = (pr: Element): string => Array.from(pr.childNodes).map((n) => (n as Element).localName)
    .find((name) => ['text', 'date', 'dropDownList', 'comboBox', 'checkbox'].includes(name))!;

  it('has a text, date, drop-down, combo box and checkbox control, and one more text control', () => {
    expect(properties.map(kindOf)).toEqual(['text', 'date', 'dropDownList', 'comboBox', 'checkbox', 'text']);
  });

  it('has exactly one control that shows its placeholder', () => {
    const flagged = properties.filter((pr) => all(pr, W, 'showingPlcHdr').length === 1);
    expect(flagged.map((pr) => attr(all(pr, W, 'alias')[0]!, 'val'))).toEqual(['Notes']);
  });

  it('has a date control in dd/MMM/yyyy with its full date, which is a control of its own between paragraphs', () => {
    const date = all(doc, W, 'date')[0]!;
    expect(attr(date, 'fullDate')).toBe('2026-01-01T00:00:00Z');
    expect(attr(all(date, W, 'dateFormat')[0]!, 'val')).toBe('dd/MMM/yyyy');
    const sdt = date.parentNode!.parentNode as Element;
    expect((sdt.parentNode as Element).localName).toBe('tc');
  });

  it('has list items with display texts and values', () => {
    const items = (name: string) => all(all(doc, W, name)[0]!, W, 'listItem').map((item) => [attr(item, 'displayText'), attr(item, 'val') ?? attr(item, 'value')]);
    expect(items('comboBox')).toEqual([['First', '1'], ['Second', '2'], ['Third', '3']]);
    expect(items('dropDownList')).toEqual([[null, 'Choose an item.'], ['First', '1'], ['Second', '2'], ['Third', '3']]);
  });

  it('has a w14:checkbox with its states', () => {
    const box = all(doc, W14, 'checkbox')[0]!;
    expect(all(box, W14, 'checked')[0]!.getAttributeNS(W14, 'val')).toBe('0');
    expect(all(box, W14, 'checkedState')[0]!.getAttributeNS(W14, 'val')).toBe('2612');
    expect(all(box, W14, 'uncheckedState')[0]!.getAttributeNS(W14, 'val')).toBe('2610');
    expect(textOf(box.parentNode!.parentNode as Element)).toBe('\u2610');
  });
});

describe('oddLayoutsDocx', () => {
  const pkg = readPackage(oddLayoutsDocx());
  const doc = part(pkg, 'word/document.xml');

  it('starts with a field that has no text before it', () => {
    const body = all(doc, W, 'body')[0]!;
    const first = Array.from(body.childNodes).filter((n) => n.nodeType === 1)[0] as Element;
    expect(first.localName).toBe('p');
    expect(textOf(first)).toBe(EN_SPACES);
    expect(legacyFields(first)).toHaveLength(1);
  });

  it('has two fields beside a vertically merged Contact cell, whose lower cell is empty', () => {
    const [top, bottom] = tableRows(doc, 0);
    expect(all(top!, W, 'vMerge').map((v) => attr(v, 'val'))).toEqual(['restart']);
    expect(all(bottom!, W, 'vMerge').map((v) => attr(v, 'val'))).toEqual([null]);
    expect([cellTexts(top!)[0], cellTexts(bottom!)[0]]).toEqual(['Contact', '']);
    expect(all(top!, W, 'fldChar')).toHaveLength(3);
    expect(all(bottom!, W, 'fldChar')).toHaveLength(3);
  });

  it('has two fields in the row under Port and Berth', () => {
    const [labels, fields] = tableRows(doc, 1);
    expect(cellTexts(labels!)).toEqual(['Port', 'Berth']);
    expect(all(fields!, W, 'tc').map((cell) => all(cell, W, 'fldChar').length)).toEqual([3, 3]);
  });

  it('has a floating text box with a field in it, as Word writes it: a wps:txbx and a VML copy', () => {
    const box = all(doc, WPS, 'txbx')[0]!;
    expect(all(box, W, 'txbxContent')).toHaveLength(1);
    expect(textOf(box)).toContain('Box note:');
    expect(all(box, W, 'fldChar').length).toBeGreaterThan(0);
    expect(all(doc, W, 'txbxContent')).toHaveLength(2);
    expect(all(doc, 'urn:schemas-microsoft-com:vml', 'textbox')).toHaveLength(1);
  });

  it('has a FORMTEXT field in the header', () => {
    const fields = legacyFields(part(pkg, 'word/header1.xml'));
    expect(fields.map((f) => f.instruction.trim())).toEqual(['FORMTEXT']);
    expect(headerOf(pkg)).toContain('Form: TST-05');
  });
});
