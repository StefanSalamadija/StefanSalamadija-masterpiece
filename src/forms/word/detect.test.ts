import { describe, expect, it } from 'vitest';
import { partText, readPackage } from '../package';
import { Controls, emptyRows, headerBlock, headerRow, heading, p, row, run, table, tickBox, titleRow, wordPackage } from '../testing/wordXml';
import { contentControlsDocx, oddLayoutsDocx, permitDocx, toolboxTalkDocx, weeklyJobsDotx } from '../testing/wordFixtures';
import type { FieldDef, FormSchema } from '../types';
import { parseXml } from '../xml';
import { detectWord, locateColumn, locateWord } from './detect';
import type { WordTarget } from './detect';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MAIN = 'word/document.xml';

const detect = (bytes: Uint8Array, kind: 'docx' | 'dotx' = 'docx', name = 'form.docx'): FormSchema => detectWord(readPackage(bytes), kind, name);
const documentOf = (bytes: Uint8Array): Document => parseXml(partText(readPackage(bytes), MAIN)!);
const byLabel = (s: FormSchema, label: string): FieldDef => {
  const found = s.fields.find((f) => f.label === label);
  if (!found) throw new Error(`no field ${label} in ${s.fields.map((f) => f.label).join(', ')}`);
  return found;
};
/** What a test needs of a field: its kind, label, section and the optional details. */
const summary = (f: FieldDef) => ({
  id: f.id, kind: f.kind, label: f.label, section: f.section, confidence: f.confidence,
  ...(f.options ? { options: f.options } : {}), ...(f.formatHint ? { formatHint: f.formatHint } : {}), ...(f.leftEmpty ? { leftEmpty: true } : {}),
});
/** The `w:name` of the legacy form field a target points at. */
const fieldName = (target: WordTarget | undefined): string | null | undefined => {
  if (!target || !('begin' in target)) return undefined;
  return target.begin.getElementsByTagNameNS(W, 'name')[0]?.getAttributeNS(W, 'val');
};
/** The nodes a target points at, so that two targets can be compared by identity. */
const nodesOf = (target: WordTarget): Element[] => {
  switch (target.kind) {
    case 'formtext': case 'formcheck': case 'formdrop': return [target.begin];
    case 'sdt': return [target.sdt];
    case 'tick': return target.cells;
    case 'cell': return [target.tc];
    case 'group': return target.rows;
  }
};
/** Expects the same nodes, by identity, in the same order. */
const expectSameNodes = (actual: Element[], expected: Element[]): void => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((node, i) => expect(node).toBe(expected[i]));
};
/** Inserts `count` deep copies of `last` straight after it, as the writer does, and gives them back in order. */
const cloneAfter = (last: Element, count: number): Element[] => {
  const clones: Element[] = [];
  let anchor = last;
  for (let i = 0; i < count; i += 1) {
    const clone = last.cloneNode(true) as Element;
    anchor.parentNode!.insertBefore(clone, anchor.nextSibling);
    clones.push(clone);
    anchor = clone;
  }
  return clones;
};

describe('detectWord', () => {
  it('finds the fields, groups, ticks and controls of the fixtures (the brief\'s test)', () => {
    const s = detectWord(readPackage(toolboxTalkDocx()), 'docx', 'toolbox.docx');
    expect(s.identity).toEqual({ code: 'TST-01', title: 'Toolbox Talk', revision: '00 / 01.01.2026' });
    expect(s.fields.map((f) => f.label)).toEqual(expect.arrayContaining(['Vessel', 'Subject', 'Date', 'Time']));
    const g = s.rowGroups.find((r) => r.label === 'Participants')!;
    expect(g.capacity).toBe(12);
    expect(g.columns.map((c) => [c.label, !!c.leftEmpty])).toEqual([['Name', false], ['Rank', false], ['Signature', true]]);

    const p2 = detectWord(readPackage(permitDocx()), 'docx', 'p.docx');
    const tick = p2.fields.find((f) => f.kind === 'choice' && f.section.startsWith('Section 1'))!;
    expect(tick.options).toEqual(['Yes', 'No', 'N/A']);

    const w = detectWord(readPackage(weeklyJobsDotx()), 'dotx', 'w.dotx');
    expect(w.rowGroups.map((r) => r.growable)).toEqual([true, true]);
    expect(w.rowGroups[0].columns.find((c) => c.label === 'Status')!.options).toEqual(['Pending', 'Completed']);

    const c = detectWord(readPackage(contentControlsDocx()), 'docx', 'c.docx');
    expect(c.fields.find((f) => f.kind === 'date')!.formatHint).toBe('dd/MMM/yyyy');
  });

  it('labels_from_merged_and_above: finds labels in merged cells and above the field, and says when it found none', () => {
    const s = detect(oddLayoutsDocx());
    expect(s.fields.map((f) => [f.label, f.confidence])).toEqual([
      ['Field 1', 'low'], // a paragraph with only a field in it, and nothing before it
      ['Contact', 'high'], // beside the cell that opens the vertical merge
      ['Contact', 'high'], // beside the merge's continuation, which is empty itself
      ['Port', 'high'], // the cell above
      ['Berth', 'high'], // the cell above, not the empty cell to the left
    ]);
    expect(s.unsupported).toEqual(['Text box: "Box note:"', 'Header field: "Ref"']);
    expect(s.rowGroups).toEqual([]);
    expect(s.identity).toEqual({ code: 'TST-05', title: 'Demo Odd Layouts', revision: '00 / 01.01.2026' });
  });

  it('reads the toolbox talk: labels keep their case, the date takes its own field format, the time its label', () => {
    const s = detect(toolboxTalkDocx(), 'docx', 'toolbox.docx');
    expect(s.kind).toBe('docx');
    expect(s.fields.map(summary)).toEqual([
      { id: 'f1', kind: 'text', label: 'Vessel', section: '', confidence: 'high' },
      { id: 'f2', kind: 'text', label: 'Subject', section: '', confidence: 'high' },
      { id: 'f3', kind: 'date', label: 'Date', section: '', confidence: 'high', formatHint: 'dd/MMM/yyyy' },
      { id: 'f4', kind: 'time', label: 'Time', section: '', confidence: 'high' },
    ]);
    const [g] = s.rowGroups;
    expect(s.rowGroups).toHaveLength(1);
    expect(g).toMatchObject({ id: 'g1', label: 'Participants', section: 'Participants', capacity: 12, growable: true, shape: 'rows' });
    expect(g.fixedRows).toBeUndefined();
    expect(g.columns.map(summary)).toEqual([
      { id: 'g1.c1', kind: 'text', label: 'Name', section: 'Participants', confidence: 'high' },
      { id: 'g1.c2', kind: 'text', label: 'Rank', section: 'Participants', confidence: 'high' },
      { id: 'g1.c3', kind: 'text', label: 'Signature', section: 'Participants', confidence: 'high', leftEmpty: true },
    ]);
    expect(s.unsupported).toEqual([]);
  });

  it('follows the renamed and added fields of a later revision', () => {
    const s = detect(toolboxTalkDocx({ revision: '01 / 01.06.2026', renameSubjectTo: 'Topic', extraFieldLabel: 'Location' }));
    expect(s.identity.revision).toBe('01 / 01.06.2026');
    expect(s.fields.map((f) => f.label)).toEqual(['Vessel', 'Topic', 'Location', 'Date', 'Time']);
  });

  it('reads the permit: tick rows by section, a gas table with its alarm rows, personnel and a checkbox', () => {
    const s = detect(permitDocx());
    expect(s.identity).toEqual({ code: 'TST-02', title: 'Demo Permit', revision: '00 / 01.01.2026' });
    const ticks = (section: string, labels: string[]) => labels.map((label) => ({ kind: 'choice', label, section, confidence: 'high', options: ['Yes', 'No', 'N/A'] }));
    expect(s.fields.map(summary).map(({ id: _id, ...rest }) => rest)).toEqual([
      ...ticks('Section 1 – Checks', ['Check 1.1', 'Check 1.2', 'Check 1.3', 'Check 1.4']),
      ...ticks('Section 2 – Entry', ['Check 2.1', 'Check 2.2', 'Check 2.3']),
      { kind: 'checkbox', label: 'Checks completed', section: 'Personnel', confidence: 'high' },
    ]);
    expect(s.fields.map((f) => f.id)).toEqual(['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8']);

    const [gas, personnel] = s.rowGroups;
    expect(s.rowGroups).toHaveLength(2);
    expect(gas).toMatchObject({ id: 'g1', label: 'Gas readings', section: 'Gas readings', capacity: 10, growable: true, shape: 'rows' });
    expect(gas.columns.map((c) => [c.id, c.kind, c.label])).toEqual([
      ['g1.c1', 'time', 'Time'], ['g1.c2', 'text', 'O2 [Vol.%]'], ['g1.c3', 'text', 'CO [ppm]'], ['g1.c4', 'text', 'H2S [ppm]'],
    ]);
    expect(gas.fixedRows).toEqual([
      { label: 'Alarm 1', cells: ['Alarm 1', '19.5', '25', '5'] },
      { label: 'Alarm 2', cells: ['Alarm 2', '23', '50', '10'] },
    ]);
    expect(personnel).toMatchObject({ id: 'g2', label: 'Personnel', section: 'Personnel', capacity: 8, growable: true });
    expect(personnel.columns.map((c) => [c.kind, c.label])).toEqual([['text', 'Name / Rank'], ['time', 'Time IN'], ['time', 'Time OUT']]);
    expect(personnel.fixedRows).toBeUndefined();
  });

  it('reads the weekly jobs template: two repeating sections, their columns from the header row or the control', () => {
    const s = detect(weeklyJobsDotx(), 'dotx', 'weekly.dotx');
    expect(s.kind).toBe('dotx');
    expect(s.identity).toEqual({ code: 'TST-03', title: 'Demo Weekly Jobs', revision: '00 / 01.01.2026' });
    expect(s.fields.map(summary)).toEqual([
      { id: 'f1', kind: 'text', label: 'Vessel', section: '', confidence: 'high' },
      { id: 'f2', kind: 'text', label: 'Year / Week No.', section: '', confidence: 'high' },
      { id: 'f3', kind: 'text', label: 'Date (from to)', section: '', confidence: 'high' },
    ]);
    const [jobs, pictures] = s.rowGroups;
    expect(jobs).toMatchObject({ id: 'g1', label: 'Jobs', section: 'Jobs', capacity: 3, growable: true, shape: 'rows' });
    expect(jobs.columns.map(summary)).toEqual([
      { id: 'g1.c1', kind: 'date', label: 'Date', section: 'Jobs', confidence: 'high', formatHint: 'dd.MM.yyyy' },
      { id: 'g1.c2', kind: 'text', label: 'Responsible', section: 'Jobs', confidence: 'high' },
      { id: 'g1.c3', kind: 'text', label: 'Description', section: 'Jobs', confidence: 'high' },
      { id: 'g1.c4', kind: 'choice', label: 'Status', section: 'Jobs', confidence: 'high', options: ['Pending', 'Completed'] },
      { id: 'g1.c5', kind: 'text', label: 'Remarks', section: 'Jobs', confidence: 'high' },
    ]);
    expect(pictures).toMatchObject({ id: 'g2', label: 'Pictures', section: 'Pictures', capacity: 1, growable: true });
    expect(pictures.columns.map((c) => [c.id, c.kind, c.label, c.options])).toEqual([
      ['g2.c1', 'picture', 'Picture', undefined], ['g2.c2', 'choice', 'Photo', ['Before', 'After']],
      ['g2.c3', 'picture', 'Picture', undefined], ['g2.c4', 'choice', 'Photo', ['Before', 'After']],
      ['g2.c5', 'picture', 'Picture', undefined], ['g2.c6', 'choice', 'Photo', ['Before', 'After']],
    ]);
  });

  it('reads every kind of content control, and leaves out the list prompt', () => {
    const s = detect(contentControlsDocx());
    expect(s.fields.map(summary)).toEqual([
      { id: 'f1', kind: 'text', label: 'Name', section: '', confidence: 'high' },
      { id: 'f2', kind: 'date', label: 'Date', section: '', confidence: 'high', formatHint: 'dd/MMM/yyyy' },
      { id: 'f3', kind: 'choice', label: 'Option', section: '', confidence: 'high', options: ['First', 'Second', 'Third'] },
      { id: 'f4', kind: 'choice', label: 'Entry', section: '', confidence: 'high', options: ['First', 'Second', 'Third'] },
      { id: 'f5', kind: 'checkbox', label: 'Confirmed', section: '', confidence: 'high' },
      { id: 'f6', kind: 'text', label: 'Notes', section: '', confidence: 'high' },
    ]);
    expect(s.rowGroups).toEqual([]);
  });

  it('gives the same schema every time for the same file', () => {
    for (const make of [toolboxTalkDocx, permitDocx, weeklyJobsDotx, contentControlsDocx, oddLayoutsDocx]) {
      expect(detect(make())).toEqual(detect(make()));
    }
  });

  it('addresses every field and group in the main part', () => {
    const s = detect(toolboxTalkDocx());
    for (const def of [...s.fields, ...s.rowGroups]) expect(def.loc).toMatch(/^word\/document\.xml#\d+(?:\/\d+)*(?:\+\d+(?:\/\d+)*)*$/);
    for (const column of s.rowGroups[0].columns) expect(column.loc).toMatch(/^\d+(?:\/\d+)*$/);
  });

  it('takes the kind and hint from the label, the field type and the label of a checkbox after it', () => {
    const c = new Controls();
    const widths = [3000, 6638];
    const body = table(widths, [
      row(widths, ['Departure (DD.MM.YYYY):', { content: p(c.formText()) }]),
      row(widths, ['Time (24:00 UTC):', { content: p(c.formText()) }]),
      row(widths, ['Quantity', { content: p(c.formText({ type: 'number' })) }]),
      row(widths, ['Clock', { content: p(c.formText({ type: 'currentTime' })) }]),
      row(widths, ['Signed by master:', { content: p(c.formText()) }]),
      row(widths, ['Options', { content: p(c.formCheckbox() + run(' Hot work ') + c.formCheckbox() + run(' Cold work')) }]),
    ]) + p(run('Remarks: ') + c.formText()) + p(run('Grade')) + p() + p(c.formDropdown(['   ', 'One', 'Two'])) + p(c.formText());
    const s = detect(wordPackage({ kind: 'docx', header: headerBlock(c, { title: 'Kinds', code: 'TST-90', revision: '0' }), body }));
    expect(s.fields.map((f) => [f.kind, f.label, f.formatHint, !!f.leftEmpty])).toEqual([
      ['date', 'Departure (DD.MM.YYYY)', 'DD.MM.YYYY', false],
      ['time', 'Time (24:00 UTC)', '(24:00 UTC)', false],
      ['number', 'Quantity', undefined, false],
      ['time', 'Clock', undefined, false],
      ['text', 'Signed by master', undefined, true],
      ['checkbox', 'Hot work', undefined, false],
      ['checkbox', 'Cold work', undefined, false],
      ['text', 'Remarks', undefined, false],
      ['choice', 'Grade', undefined, false], // the paragraph before it (past an empty one), as nothing in its own paragraph names it
      ['text', 'Field 10', undefined, false], // the paragraph before it names another field, so it is not this one's label
    ]);
    expect(s.fields[8].options).toEqual(['One', 'Two']);
    expect(s.fields.map((f) => f.confidence)).toEqual([...Array(9).fill('high'), 'low']);
  });

  it('names each checkbox of a line that starts with text by the words before it, never by a neighbour\'s', () => {
    const c = new Controls();
    const widths = [3000, 6638];
    const body = table(widths, [
      row(widths, ['Gas free', { content: p(run('Yes ') + c.formCheckbox() + run(' No ') + c.formCheckbox()) }]),
      row(widths, ['Work', { content: p(run('Hot work ') + c.formCheckbox() + run(' Cold work ') + c.formCheckbox()) }]),
      row(widths, ['Kind', { content: p(c.formCheckbox() + run(' Hot work ') + c.formCheckbox() + run(' Cold work')) }]),
    ]) + p(run('Done ') + c.formCheckbox() + run(' Pending ') + c.formCheckbox());
    const s = detect(wordPackage({ kind: 'docx', header: headerBlock(c, { title: 'Boxes', code: 'TST-97', revision: '0' }), body }));
    expect(s.fields.map((f) => f.label)).toEqual(['Yes', 'No', 'Hot work', 'Cold work', 'Hot work', 'Cold work', 'Done', 'Pending']);
  });

  it.each([
    ['Yes [] No []', ['Yes', 'No']],
    ['Yes [] No [] N/A []', ['Yes', 'No', 'N/A']],
    ['Hot work [] Cold work []', ['Hot work', 'Cold work']],
    ['[] Hot [] Cold', ['Hot', 'Cold']],
    ['Permit type: [] Hot work [] Cold work', ['Hot work', 'Cold work']],
    ['Is the area safe? [] Yes [] No', ['Yes', 'No']],
    ['Name [text] Yes [] No []', ['Name', 'Yes', 'No']],
  ])('names the checkboxes of the line "%s" by the words that belong to each box', (line, labels) => {
    const c = new Controls();
    // `[]` is a FORMCHECKBOX, `[text]` a FORMTEXT; the rest is text, with the spaces as written.
    const content = line.split(/(\[\]|\[text\])/).filter((part) => part !== '')
      .map((part) => (part === '[]' ? c.formCheckbox() : part === '[text]' ? c.formText() : run(part))).join('');
    const widths = [3000, 6638];
    const body = p(content) + table(widths, [row(widths, ['Question', { content: p(content) }])]);
    const s = detect(wordPackage({ kind: 'docx', header: headerBlock(c, { title: 'Lines', code: 'TST-99', revision: '0' }), body }));
    // The same line as a body paragraph, then in a table cell.
    expect(s.fields.map((f) => f.label)).toEqual([...labels, ...labels]);
  });

  it('takes tick headers in any case and box text symbols, and keeps going over a title row', () => {
    const c = new Controls();
    const widths = [5000, 1500, 1500];
    const box = { content: p(run('☐')) };
    const body = table(widths, [
      headerRow(widths, ['Item', 'ok', 'bad']),
      row(widths, ['Lights', box, box]),
      titleRow(widths, 'Deck'),
      row(widths, ['Hatches', { content: p(run('□')) }, '']),
      row(widths, ['Notes', { content: p(c.formText()), span: 2 }]),
    ]);
    const s = detect(wordPackage({ kind: 'docx', header: headerBlock(c, { title: 'Ticks', code: 'TST-91', revision: '0' }), body }));
    expect(s.fields.map((f) => [f.kind, f.label, f.section, f.options])).toEqual([
      ['choice', 'Lights', '', ['ok', 'bad']],
      ['choice', 'Hatches', 'Deck', ['ok', 'bad']],
      ['text', 'Notes', 'Deck', undefined],
    ]);
  });

  it('reads the label of a checkbox on its own line only, and the paragraph-level repeating section', () => {
    const c = new Controls();
    const widths = [3000, 6638];
    const body = table(widths, [
      row(widths, ['Agreed', { content: p(c.formCheckbox()) + p(run('Remarks: ') + c.formText()) }]),
    ]) + p() + c.repeatingSection({
      alias: 'Notes', tag: 'notes', items: [p(run('Note: ') + c.textControl({ alias: 'Note text', tag: 'note', text: 'Click or tap here to enter text.', placeholder: true }))],
    });
    const bytes = wordPackage({ kind: 'docx', header: headerBlock(c, { title: 'Lines', code: 'TST-94', revision: '0' }), body });
    const s = detect(bytes);
    expect(s.fields.map((f) => [f.kind, f.label])).toEqual([['checkbox', 'Agreed'], ['text', 'Remarks']]);
    expect(s.rowGroups.map((g) => [g.label, g.capacity, g.growable, g.columns.map((col) => [col.kind, col.label])])).toEqual([['Notes', 1, true, [['text', 'Note']]]]);
    const target = locateWord(documentOf(bytes), MAIN, s).get('g1')!;
    expect(target.kind === 'group' && target.repeating?.localName).toBe('sdt');
    if (target.kind === 'group') expect(locateColumn(target.rows[0], s.rowGroups[0].columns[0])).toMatchObject({ kind: 'sdt' });
  });

  it('lists the fields of a footer, and reads a header as one text even when it is split in many runs', () => {
    const c = new Controls();
    const pkg = readPackage(wordPackage({ kind: 'docx', header: p(run('Fo') + run('rm: TST-95')) + p(run('Revision: 2')) + p(run('Split Title')), body: p(run('Body')) }));
    const footer = `<w:ftr xmlns:w="${W}">${p(run('Checked by: ') + c.formText())}${p(c.formCheckbox())}</w:ftr>`;
    pkg.entries.set('word/footer1.xml', new TextEncoder().encode(footer));
    const s = detectWord(pkg, 'docx', 'f.docx');
    expect(s.identity).toEqual({ code: 'TST-95', title: 'Split Title', revision: '2' });
    expect(s.unsupported).toEqual(['Footer field: "Checked by"', 'Footer field']);
    expect(s.fields).toEqual([]);
  });

  it('reads a rich text control that holds text as the form\'s own text, and one that shows its prompt as a field', () => {
    const c = new Controls();
    const richText = (inner: string, prompt = false) => `<w:sdt><w:sdtPr><w:alias w:val="Block"/><w:id w:val="7"/>${prompt ? '<w:showingPlcHdr/>' : ''}</w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
    const gallery = (inner: string) => `<w:sdt><w:sdtPr><w:id w:val="8"/><w:docPartObj><w:docPartGallery w:val="Cover Pages"/></w:docPartObj></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
    const body = richText(p(run('Read before use.'))) + p(run('Remarks:')) + richText(p(run('Click or tap here to enter text.')), true)
      + gallery(p(run('Officer: ') + c.formText()));
    const s = detect(wordPackage({ kind: 'docx', header: headerBlock(c, { title: 'Rich', code: 'TST-96', revision: '0' }), body }));
    expect(s.fields.map((f) => [f.kind, f.label])).toEqual([['text', 'Remarks'], ['text', 'Officer']]);
  });

  it('detects a 3-page permit in well under a second', () => {
    const c = new Controls();
    const widths = [5438, 1400, 1400, 1400];
    const ticks = [{ content: p(tickBox()) }, { content: p(tickBox()) }, { content: p(tickBox()) }];
    const sections = Array.from({ length: 6 }, (_, s) => heading(`Section ${s + 1}`) + table(widths, [
      headerRow(widths, ['', 'Yes', 'No', 'N/A']),
      ...Array.from({ length: 25 }, (_, i) => row(widths, [`Check ${s + 1}.${i + 1}`, ...ticks])),
    ]) + table(widths, [headerRow(widths, ['Name', 'Rank', 'Time', 'Sign']), ...emptyRows(widths, 20)]) + p(run('Remarks: ') + c.formText()));
    const bytes = wordPackage({ kind: 'docx', header: headerBlock(c, { title: 'Big', code: 'TST-92', revision: '0' }), body: sections.join('') });
    const pkg = readPackage(bytes);
    const started = performance.now();
    const s = detectWord(pkg, 'docx', 'big.docx');
    expect(performance.now() - started).toBeLessThan(1000);
    expect(s.fields).toHaveLength(6 * 26);
    expect(s.rowGroups).toHaveLength(6);
  });
});

describe('locateWord', () => {
  const fixtures: [string, () => Uint8Array][] = [
    ['toolbox', toolboxTalkDocx], ['permit', permitDocx], ['weekly', weeklyJobsDotx], ['controls', contentControlsDocx], ['odd', oddLayoutsDocx],
  ];

  it.each(fixtures)('returns a target for every field id and group id of the %s template', (_name, make) => {
    const bytes = make();
    const s = detect(bytes);
    const targets = locateWord(documentOf(bytes), MAIN, s);
    expect([...targets.keys()].sort()).toEqual([...s.fields, ...s.rowGroups].map((d) => d.id).sort());
    for (const f of s.fields) {
      const kind = targets.get(f.id)!.kind;
      if (f.kind === 'choice' && targets.get(f.id)!.kind === 'tick') expect((targets.get(f.id) as { cells: Element[] }).cells).toHaveLength(f.options!.length);
      else expect(['formtext', 'formcheck', 'formdrop', 'sdt']).toContain(kind);
    }
    for (const g of s.rowGroups) {
      const target = targets.get(g.id)!;
      expect(target.kind).toBe('group');
      if (target.kind !== 'group') continue;
      expect(target.rows).toHaveLength(g.capacity);
      for (const r of target.rows) for (const column of g.columns) expect(locateColumn(r, column)).toBeDefined();
    }
  });

  it('points each target at the right node', () => {
    const toolbox = toolboxTalkDocx();
    const s = detect(toolbox);
    const t = locateWord(documentOf(toolbox), MAIN, s);
    expect(['Vessel', 'Subject', 'Date', 'Time'].map((l) => fieldName(t.get(byLabel(s, l).id)))).toEqual(['Text1', 'Text2', 'Text3', 'Text4']);
    expect(t.get('f1')!.kind).toBe('formtext');
    const group = t.get('g1')!;
    expect(group.kind === 'group' && group.repeating).toBeUndefined();

    const permit = permitDocx();
    const ps = detect(permit);
    const pt = locateWord(documentOf(permit), MAIN, ps);
    const tick = pt.get('f1')!;
    expect(tick.kind).toBe('tick');
    if (tick.kind === 'tick') {
      expect(tick.cells.every((cell) => cell.localName === 'tc')).toBe(true);
      expect((tick.cells[0].parentNode as Element).textContent).toContain('Check 1.1');
    }
    expect(pt.get('f8')!.kind).toBe('formcheck');

    const weekly = weeklyJobsDotx();
    const ws = detect(weekly);
    const wt = locateWord(documentOf(weekly), MAIN, ws);
    const jobs = wt.get('g1')!;
    expect(jobs.kind).toBe('group');
    if (jobs.kind === 'group') {
      expect(jobs.repeating!.localName).toBe('sdt');
      expect(jobs.repeating!.getElementsByTagNameNS(W, 'alias')[0].getAttributeNS(W, 'val')).toBe('Jobs');
      expect(locateColumn(jobs.rows[1], ws.rowGroups[0].columns[3])).toMatchObject({ kind: 'formdrop' });
      expect(fieldName(locateColumn(jobs.rows[1], ws.rowGroups[0].columns[3]))).toBe('Dropdown2');
      expect(locateColumn(jobs.rows[2], ws.rowGroups[0].columns[0])).toMatchObject({ kind: 'sdt' });
    }

    const controls = contentControlsDocx();
    const cs = detect(controls);
    const ct = locateWord(documentOf(controls), MAIN, cs);
    const date = ct.get(cs.fields.find((f) => f.kind === 'date')!.id)!;
    expect(date.kind === 'sdt' && date.sdt.getElementsByTagNameNS(W, 'tag')[0].getAttributeNS(W, 'val')).toBe('date');
  });

  it('resolves only the addresses of the part it is given', () => {
    const bytes = toolboxTalkDocx();
    expect(locateWord(documentOf(bytes), 'word/header1.xml', detect(bytes)).size).toBe(0);
  });

  it('leaves out an address that no longer points at the kind of node it was made for', () => {
    const bytes = toolboxTalkDocx();
    const s = detect(bytes);
    const doc = documentOf(bytes);
    const body = doc.getElementsByTagNameNS(W, 'body')[0];
    body.insertBefore(doc.createElementNS(W, 'w:p'), body.firstChild); // every address in the body moves on by one
    const targets = locateWord(doc, MAIN, s);
    expect(targets.has('f1')).toBe(false);
    expect(targets.has('g1')).toBe(false);
  });

  it('still finds every id after the writer cloned rows, in the same table and after it (R1)', () => {
    const c = new Controls();
    const widths = [4000, 5638];
    const body = table(widths, [
      headerRow(widths, ['Name', 'Rank']),
      ...emptyRows(widths, 3),
      row(widths, ['Remarks:', { content: p(c.formText()) }]),
      headerRow(widths, ['Item', 'Qty']),
      ...emptyRows(widths, 2),
      row(widths, ['Total:', { content: p(c.formText()) }]),
    ]) + p(run('Notes: ') + c.formText());
    const bytes = wordPackage({ kind: 'docx', header: headerBlock(c, { title: 'Clones', code: 'TST-93', revision: '0' }), body });
    const s = detect(bytes);
    expect(s.fields.map((f) => f.label)).toEqual(['Remarks', 'Total', 'Notes']);
    expect(s.rowGroups.map((g) => [g.capacity, g.columns.map((col) => col.label)])).toEqual([[3, ['Name', 'Rank']], [2, ['Item', 'Qty']]]);

    const doc = documentOf(bytes);
    const before = locateWord(doc, MAIN, s);
    const extraRows = { g1: 4, g2: 1 };
    const clones: Record<string, Element[]> = {};
    for (const [id, count] of Object.entries(extraRows)) {
      const target = before.get(id)!;
      if (target.kind !== 'group') throw new Error('not a group');
      clones[id] = cloneAfter(target.rows.at(-1)!, count);
    }
    const after = locateWord(doc, MAIN, s, extraRows);
    for (const f of s.fields) expectSameNodes(nodesOf(after.get(f.id)!), nodesOf(before.get(f.id)!));
    expect(['f1', 'f2', 'f3'].map((id) => fieldName(after.get(id)))).toEqual(['Text1', 'Text2', 'Text3']);
    for (const g of s.rowGroups) {
      const target = after.get(g.id)!;
      if (target.kind !== 'group') throw new Error('not a group');
      const old = before.get(g.id) as { rows: Element[] };
      expect(target.rows).toHaveLength(g.capacity + extraRows[g.id as 'g1' | 'g2']);
      target.rows.forEach((r, i) => expect(r).toBe(i < g.capacity ? old.rows[i] : clones[g.id][i - g.capacity]));
      const cell = locateColumn(target.rows.at(-1)!, g.columns[1]);
      expect(cell?.kind).toBe('cell');
      expect((cell as { tc: Element }).tc).toBe(clones[g.id].at(-1)!.getElementsByTagNameNS(W, 'tc')[1]);
    }
    // Without the clone counts, the addresses after the first group now miss.
    expect(fieldName(locateWord(doc, MAIN, s).get('f2'))).not.toBe('Text2');
  });

  it('counts rows and items past the markup between them, in detection and in locateWord, before and after clones', () => {
    const c = new Controls();
    const widths = [4000, 5638];
    const mark = (id: number) => `<w:bookmarkStart w:id="${id}" w:name="mark${id}"/>`;
    const markEnd = (id: number) => `<w:bookmarkEnd w:id="${id}"/>`;
    const item = (content: string, id: number) => `<w:sdt><w:sdtPr><w:id w:val="${id}"/><w15:repeatingSectionItem/></w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
    const logRow = () => row(widths, [{ content: p(c.formText()) }, { content: p(c.textControl({ alias: 'Note', tag: 'note', text: 'Click or tap here to enter text.', placeholder: true })) }]);
    const section = `<w:sdt><w:sdtPr><w:alias w:val="Log"/><w:id w:val="100"/><w15:repeatingSection/></w:sdtPr><w:sdtContent>`
      + `${item(logRow(), 101)}${mark(90)}${item(logRow(), 102)}${markEnd(90)}${item(logRow(), 103)}</w:sdtContent></w:sdt>`;
    const [r1, r2, r3, r4] = emptyRows(widths, 4);
    const body = table(widths, [headerRow(widths, ['Entry', 'Note']), section, row(widths, ['After log:', { content: p(c.formText()) }])])
      + p()
      + table(widths, [headerRow(widths, ['Name', 'Rank']), r1, r2, mark(91), r3, `<w:permStart w:id="92" w:edGrp="everyone"/>`, r4, markEnd(91), row(widths, ['Remarks:', { content: p(c.formText()) }])]);
    const bytes = wordPackage({ kind: 'docx', header: headerBlock(c, { title: 'Marks', code: 'TST-98', revision: '0' }), body });
    const s = detect(bytes);
    expect(s.rowGroups.map((g) => [g.id, g.label, g.capacity, g.columns.map((col) => col.label)])).toEqual([
      ['g1', 'Log', 3, ['Entry', 'Note']],
      ['g2', 'Table 2', 4, ['Name', 'Rank']],
    ]);
    expect(s.fields.map((f) => f.label)).toEqual(['After log', 'Remarks']);

    const doc = documentOf(bytes);
    const before = locateWord(doc, MAIN, s);
    expect([...before.keys()].sort()).toEqual(['f1', 'f2', 'g1', 'g2']);
    const log = before.get('g1')!;
    const people = before.get('g2')!;
    if (log.kind !== 'group' || people.kind !== 'group') throw new Error('not groups');
    expect(log.rows.map((r) => r.getElementsByTagNameNS(W, 'id')[0].getAttributeNS(W, 'val'))).toEqual(['101', '102', '103']);
    expect(log.repeating!.getElementsByTagNameNS(W, 'alias')[0].getAttributeNS(W, 'val')).toBe('Log');
    expect(people.rows.every((r) => r.localName === 'tr')).toBe(true);
    expect(people.rows).toHaveLength(4);

    const extraRows = { g1: 2, g2: 3 };
    const clones = { g1: cloneAfter(log.rows.at(-1)!, 2), g2: cloneAfter(people.rows.at(-1)!, 3) };
    const after = locateWord(doc, MAIN, s, extraRows);
    for (const id of ['f1', 'f2']) expectSameNodes(nodesOf(after.get(id)!), nodesOf(before.get(id)!));
    expect(['f1', 'f2'].map((id) => fieldName(after.get(id)))).toEqual(['Text4', 'Text5']);
    for (const g of s.rowGroups) {
      const target = after.get(g.id) as { rows: Element[] };
      const id = g.id as 'g1' | 'g2';
      expectSameNodes(target.rows, [...(before.get(id) as { rows: Element[] }).rows, ...clones[id]]);
      for (const r of target.rows) for (const column of g.columns) expect(locateColumn(r, column)).toBeDefined();
    }
  });

  it('keeps two plain groups in one table apart when markup sits between and inside them, before and after clones', () => {
    const c = new Controls();
    const widths = [4000, 5638];
    const [r1, r2, r3, r4, r5] = emptyRows(widths, 5);
    const body = table(widths, [
      headerRow(widths, ['Name', 'Rank']), r1, '<w:bookmarkStart w:id="80" w:name="a"/>', r2,
      '<w:commentRangeStart w:id="81"/>', headerRow(widths, ['Item', 'Qty']), r3, '<w:permStart w:id="82" w:edGrp="everyone"/>', r4,
      '<w:bookmarkEnd w:id="80"/>', r5, '<w:permEnd w:id="82"/>', row(widths, ['Total:', { content: p(c.formText()) }]),
    ]);
    const bytes = wordPackage({ kind: 'docx', header: headerBlock(c, { title: 'Two', code: 'TST-89', revision: '0' }), body });
    const s = detect(bytes);
    expect(s.rowGroups.map((g) => [g.capacity, g.columns.map((col) => col.label)])).toEqual([[2, ['Name', 'Rank']], [3, ['Item', 'Qty']]]);
    expect(s.fields.map((f) => f.label)).toEqual(['Total']);

    const doc = documentOf(bytes);
    const before = locateWord(doc, MAIN, s);
    const rowsOf = (targets: Map<string, WordTarget>, id: string) => (targets.get(id) as { rows: Element[] }).rows;
    expect(rowsOf(before, 'g1')).toHaveLength(2);
    expect(rowsOf(before, 'g2')).toHaveLength(3);
    const clones = { g1: cloneAfter(rowsOf(before, 'g1').at(-1)!, 3), g2: cloneAfter(rowsOf(before, 'g2').at(-1)!, 2) };
    const after = locateWord(doc, MAIN, s, { g1: 3, g2: 2 });
    expectSameNodes(nodesOf(after.get('f1')!), nodesOf(before.get('f1')!));
    expectSameNodes(rowsOf(after, 'g1'), [...rowsOf(before, 'g1'), ...clones.g1]);
    expectSameNodes(rowsOf(after, 'g2'), [...rowsOf(before, 'g2'), ...clones.g2]);
  });

  it('still finds every id after the writer cloned items of a repeating section and rows of a plain table', () => {
    for (const [make, extraRows] of [[weeklyJobsDotx, { g1: 2, g2: 3 }], [toolboxTalkDocx, { g1: 3 }], [permitDocx, { g1: 5, g2: 1 }]] as const) {
      const bytes = make();
      const s = detect(bytes);
      const doc = documentOf(bytes);
      const before = locateWord(doc, MAIN, s);
      const clones: Record<string, Element[]> = {};
      for (const [id, count] of Object.entries(extraRows)) clones[id] = cloneAfter((before.get(id) as { rows: Element[] }).rows.at(-1)!, count);
      const after = locateWord(doc, MAIN, s, extraRows);
      expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
      for (const f of s.fields) expectSameNodes(nodesOf(after.get(f.id)!), nodesOf(before.get(f.id)!));
      for (const g of s.rowGroups) {
        const rows = (after.get(g.id) as { rows: Element[] }).rows;
        const added = (extraRows as Record<string, number>)[g.id] ?? 0;
        expect(rows).toHaveLength(g.capacity + added);
        rows.slice(g.capacity).forEach((r, i) => expect(r).toBe(clones[g.id][i]));
        for (const r of rows) for (const column of g.columns) expect(locateColumn(r, column)).toBeDefined();
      }
    }
  });
});
