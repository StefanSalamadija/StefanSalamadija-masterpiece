import { describe, expect, it } from 'vitest';
import { bytesOf, partText, readPackage, writePackage } from '../package';
import type { Package } from '../package';
import { Controls, emptyRows, headerBlock, headerRow, p, row, run, table, wordPackage } from '../testing/wordXml';
import { contentControlsDocx, permitDocx, toolboxTalkDocx, weeklyJobsDotx } from '../testing/wordFixtures';
import { CONTENT_TYPE } from '../testing/zip';
import type { DraftValues, FieldDef, FormSchema } from '../types';
import { parseXml } from '../xml';
import { detectWord, locateColumn, locateWord } from './detect';
import { readWordValues } from './read';
import { extraRowsOf, writeWord } from './write';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const MAIN = 'word/document.xml';
const EN_SPACE = '\u2002';

const byLabel = (fields: FieldDef[], label: string): FieldDef => {
  const found = fields.find((f) => f.label === label);
  if (!found) throw new Error(`no field ${label} in ${fields.map((f) => f.label).join(', ')}`);
  return found;
};
const values = (fields: DraftValues['fields'] = {}, rows: DraftValues['rows'] = {}): DraftValues => ({ fields, rows });
/** Writes the values and reads the output back as a package. */
const fill = (pkg: Package, s: FormSchema, v: DraftValues): { changed: Map<string, Uint8Array>; out: Package } => {
  const changed = writeWord(pkg, s, v, { photos: {} });
  return { changed, out: readPackage(writePackage(pkg, changed)) };
};
const mainDoc = (pkg: Package): Document => parseXml(partText(pkg, MAIN)!);
const all = (el: Document | Element, ns: string, name: string): Element[] => Array.from(el.getElementsByTagNameNS(ns, name));
const wAttr = (el: Element, name: string): string | null => el.getAttributeNS(W, name);
/** The `w:char` of every symbol in an element. */
const symbols = (el: Element): string[] => all(el, W, 'sym').map((s) => wAttr(s, 'char')!);

describe('writeWord', () => {
  it('fills the toolbox talk, clones 3 participant rows and touches nothing else (the brief\'s test, with R1)', () => {
    const pkg = readPackage(toolboxTalkDocx());
    const s = detectWord(pkg, 'docx', 't.docx');
    const id = (l: string) => s.fields.find((f) => f.label === l)!.id;
    const [group] = s.rowGroups;
    const vals: DraftValues = {
      fields: { [id('Vessel')]: 'MV DEMO STAR', [id('Subject')]: 'Mooring' },
      rows: { [group.id]: Array.from({ length: 15 }, (_, i) => ({ [group.columns[0].id]: `Person ${i + 1}`, [group.columns[1].id]: 'AB' })) },
    };
    const changed = writeWord(pkg, s, vals, { photos: {} });
    const out = readPackage(writePackage(pkg, changed));
    expect([...changed.keys()]).toEqual(['word/document.xml']); // nothing else touched
    for (const part of pkg.order) if (!changed.has(part)) expect(out.entries.get(part)).toEqual(pkg.entries.get(part));
    expect(out.order).toEqual(pkg.order);

    const back = readWordValues(out, s, { [group.id]: 3 });
    expect(back.fields[id('Vessel')]).toBe('MV DEMO STAR');
    expect(back.fields[id('Subject')]).toBe('Mooring');
    const rows = back.rows[group.id];
    expect(rows).toHaveLength(15);
    expect(rows.map((r) => r[group.columns[0].id])).toEqual(Array.from({ length: 15 }, (_, i) => `Person ${i + 1}`));
    expect(rows.every((r) => r[group.columns[1].id] === 'AB')).toBe(true);

    // The participants table holds its header row and 15 rows.
    const participants = all(mainDoc(out), W, 'tbl')[1];
    const trs = all(participants, W, 'tr');
    expect(trs).toHaveLength(16);
    expect(trs[0].textContent).toBe('NameRankSignature');
    expect(trs.slice(1).map((tr) => all(tr, W, 't')[0]?.textContent)).toEqual(Array.from({ length: 15 }, (_, i) => `Person ${i + 1}`));
  });

  it('writes clones only straight after the group, so every stored address resolves in the output (R1)', () => {
    const pkg = readPackage(toolboxTalkDocx());
    const s = detectWord(pkg, 'docx', 't.docx');
    const [group] = s.rowGroups;
    const vals = values({}, { [group.id]: Array.from({ length: 14 }, () => ({ [group.columns[0].id]: 'X' })) });
    expect(extraRowsOf(s, vals)).toEqual({ [group.id]: 2 });
    const { out } = fill(pkg, s, vals);
    const targets = locateWord(mainDoc(out), MAIN, s, extraRowsOf(s, vals));
    expect([...targets.keys()].sort()).toEqual([...s.fields.map((f) => f.id), group.id].sort());
    const target = targets.get(group.id)!;
    expect(target.kind === 'group' && target.rows.length).toBe(14);
    // The signature table after the participants table is still where its address says.
    expect(all(mainDoc(out), W, 'tbl')[2].textContent).toContain('Signature:');
  });

  it('copies the result run\'s properties into a FORMTEXT and leaves one run between separate and end', () => {
    const pkg = readPackage(toolboxTalkDocx());
    const s = detectWord(pkg, 'docx', 't.docx');
    const { out } = fill(pkg, s, values({ [byLabel(s.fields, 'Vessel').id]: ' MV DEMO STAR ' }));
    const target = locateWord(mainDoc(out), MAIN, s).get('f1')!;
    if (target.kind !== 'formtext') throw new Error('not a FORMTEXT');
    const runs: Element[] = [];
    for (let node = target.begin.parentNode!.nextSibling; node; node = node.nextSibling) if (node.nodeType === 1) runs.push(node as Element);
    const kinds = runs.map((r) => (all(r, W, 'fldChar')[0] ? `fld:${wAttr(all(r, W, 'fldChar')[0], 'fldCharType')}` : all(r, W, 'instrText')[0] ? 'instr' : r.localName === 'r' ? 'run' : r.localName));
    expect(kinds).toEqual(['instr', 'fld:separate', 'run', 'fld:end', 'bookmarkEnd']);
    const result = runs[2];
    expect(all(result, W, 'rFonts')[0].getAttributeNS(W, 'ascii')).toBe('Arial');
    expect(all(result, W, 'noProof')).toHaveLength(1);
    const t = all(result, W, 't')[0];
    expect(t.textContent).toBe(' MV DEMO STAR ');
    expect(t.getAttribute('xml:space')).toBe('preserve');
    expect(result.textContent).not.toContain(EN_SPACE);
  });

  it('escapes_and_line_breaks: special characters, diacritics and line breaks round-trip and the XML stays valid', () => {
    const value = 'Šašić & <Co> "x"\nline 2';
    // A legacy FORMTEXT, a cell of a plain row group, and a multi-line content control.
    const toolbox = readPackage(toolboxTalkDocx());
    const s = detectWord(toolbox, 'docx', 't.docx');
    const [group] = s.rowGroups;
    const { changed, out } = fill(toolbox, s, values({ f2: value }, { [group.id]: [{ [group.columns[0].id]: value }] }));
    const xml = new TextDecoder().decode(changed.get(MAIN)!);
    expect(() => parseXml(xml)).not.toThrow();
    expect(xml).toContain('Šašić &amp; &lt;Co&gt; "x"</w:t><w:br/><w:t>line 2</w:t>');
    const back = readWordValues(out, s);
    expect(back.fields.f2).toBe(value);
    expect(back.rows[group.id][0][group.columns[0].id]).toBe(value);

    const controls = readPackage(contentControlsDocx());
    const c = detectWord(controls, 'docx', 'c.docx');
    const notes = byLabel(c.fields, 'Notes');
    const name = byLabel(c.fields, 'Name');
    const filled = fill(controls, c, values({ [notes.id]: `${value}\n\nđ ć\tend`, [name.id]: value }));
    expect(() => parseXml(partText(filled.out, MAIN)!)).not.toThrow();
    const read = readWordValues(filled.out, c);
    expect(read.fields[notes.id]).toBe(`${value}\n\nđ ć\tend`);
    expect(read.fields[name.id]).toBe(value);
  });

  it('writes a legacy date in its format and reads it back as ISO (R2)', () => {
    const pkg = readPackage(toolboxTalkDocx());
    const s = detectWord(pkg, 'docx', 't.docx');
    const date = byLabel(s.fields, 'Date');
    const time = byLabel(s.fields, 'Time');
    const { out } = fill(pkg, s, values({ [date.id]: '2026-10-28', [time.id]: '14:05' }));
    expect(partText(out, MAIN)).toContain('28/Oct/2026');
    const back = readWordValues(out, s);
    expect(back.fields[date.id]).toBe('2026-10-28');
    expect(back.fields[time.id]).toBe('14:05');
    // Fields not given read as not filled: the five en spaces Word shows in an empty FORMTEXT are no value.
    expect(back.fields[byLabel(s.fields, 'Vessel').id]).toBeNull();
  });

  it('ticks the chosen option\'s box only: choosing No in the permit writes F0FE in the No cell', () => {
    const pkg = readPackage(permitDocx());
    const s = detectWord(pkg, 'docx', 'p.docx');
    const check = byLabel(s.fields, 'Check 1.1');
    const { out } = fill(pkg, s, values({ [check.id]: 'No', [byLabel(s.fields, 'Check 2.3').id]: 'N/A' }));
    const target = locateWord(mainDoc(out), MAIN, s).get(check.id)!;
    if (target.kind !== 'tick') throw new Error('not a tick');
    expect(target.cells.map(symbols)).toEqual([['F0A8'], ['F0FE'], ['F0A8']]);
    expect(all(target.cells[1], W, 'sym')[0].getAttributeNS(W, 'font')).toBe('Wingdings');
    expect(symbols(mainDoc(out).documentElement).filter((c) => c === 'F0FE')).toHaveLength(2);
    const back = readWordValues(out, s);
    expect(back.fields[check.id]).toBe('No');
    expect(back.fields[byLabel(s.fields, 'Check 2.3').id]).toBe('N/A');
    expect(back.fields[byLabel(s.fields, 'Check 1.2').id]).toBeNull();
  });

  it('ticks a box written as text, and puts a centred X in a tick cell that has no box', () => {
    const c = new Controls();
    const widths = [5000, 1500, 1500];
    const textBoxes = row(widths, ['Text boxes', { content: p('<w:r><w:t>☐</w:t></w:r>') }, { content: p('<w:r><w:t>□</w:t></w:r>') }]);
    const noBoxes = row(widths, ['No boxes', '', '']);
    const pkg = readPackage(wordPackage({
      kind: 'docx', header: headerBlock(c, { title: 'Demo Ticks', code: 'TST-90', revision: '00' }),
      body: table(widths, [headerRow(widths, ['', 'Yes', 'No']), textBoxes, noBoxes]) + p(),
    }));
    const s = detectWord(pkg, 'docx', 'ticks.docx');
    const [boxes, plain] = s.fields;
    expect([boxes.label, plain.label]).toEqual(['Text boxes', 'No boxes']);
    const { out } = fill(pkg, s, values({ [boxes.id]: 'No', [plain.id]: 'Yes' }));
    const targets = locateWord(mainDoc(out), MAIN, s);
    const ticks = (fieldId: string) => {
      const t = targets.get(fieldId)!;
      if (t.kind !== 'tick') throw new Error('not a tick');
      return t.cells;
    };
    expect(ticks(boxes.id).map((cell) => cell.textContent)).toEqual(['☐', '☒']);
    const [yes, no] = ticks(plain.id);
    expect(yes.textContent).toBe('X');
    expect(all(yes, W, 'jc')[0].getAttributeNS(W, 'val')).toBe('center');
    expect(no.textContent).toBe('');
    const back = readWordValues(out, s);
    expect(back.fields[boxes.id]).toBe('No');
    expect(back.fields[plain.id]).toBe('Yes');
  });

  it('sets a FORMDROPDOWN\'s result to the entry index, counting the prompt entry', () => {
    const pkg = readPackage(weeklyJobsDotx());
    const s = detectWord(pkg, 'dotx', 'w.dotx');
    const jobs = s.rowGroups[0];
    const status = byLabel(jobs.columns, 'Status');
    const { out } = fill(pkg, s, values({}, { [jobs.id]: [{ [status.id]: 'Completed' }, { [status.id]: 'Pending' }] }));
    const target = locateWord(mainDoc(out), MAIN, s).get(jobs.id)!;
    if (target.kind !== 'group') throw new Error('not a group');
    const result = (rowIndex: number) => {
      const t = locateColumn(target.rows[rowIndex], status)!;
      if (t.kind !== 'formdrop') throw new Error('not a dropdown');
      const ddList = all(t.begin, W, 'ddList')[0];
      const first = Array.from(ddList.childNodes).find((n) => n.nodeType === 1) as Element;
      return first.localName === 'result' ? wAttr(first, 'val') : undefined;
    };
    expect([result(0), result(1), result(2)]).toEqual(['2', '1', undefined]);
    const back = readWordValues(out, s).rows[jobs.id];
    expect(back.map((r) => r[status.id])).toEqual(['Completed', 'Pending', null]);
  });

  it('checks and unchecks a legacy FORMCHECKBOX', () => {
    const pkg = readPackage(permitDocx());
    const s = detectWord(pkg, 'docx', 'p.docx');
    const box = byLabel(s.fields, 'Checks completed');
    const checked = fill(pkg, s, values({ [box.id]: true })).out;
    const checkBox = all(mainDoc(checked), W, 'checkBox')[0];
    expect(all(checkBox, W, 'checked').map((el) => wAttr(el, 'val'))).toEqual(['1']);
    expect((Array.from(checkBox.childNodes).filter((n) => n.nodeType === 1).at(-1) as Element).localName).toBe('checked');
    expect(readWordValues(checked, s).fields[box.id]).toBe(true);

    const unchecked = fill(checked, s, values({ [box.id]: false })).out;
    expect(all(mainDoc(unchecked), W, 'checked')).toHaveLength(0);
    expect(readWordValues(unchecked, s).fields[box.id]).toBe(false);
  });

  it('checks a w14:checkbox, showing the checked glyph in its font', () => {
    const pkg = readPackage(contentControlsDocx());
    const s = detectWord(pkg, 'docx', 'c.docx');
    const box = byLabel(s.fields, 'Confirmed');
    const { out } = fill(pkg, s, values({ [box.id]: true }));
    const target = locateWord(mainDoc(out), MAIN, s).get(box.id)!;
    if (target.kind !== 'sdt') throw new Error('not a control');
    expect(all(target.sdt, W14, 'checked')[0].getAttributeNS(W14, 'val')).toBe('1');
    const content = all(target.sdt, W, 'sdtContent')[0];
    expect(content.textContent).toBe('\u2612');
    expect(all(content, W, 'rFonts')[0].getAttributeNS(W, 'ascii')).toBe('MS Gothic');
    expect(readWordValues(out, s).fields[box.id]).toBe(true);

    const back = fill(out, s, values({ [box.id]: false })).out;
    const again = locateWord(mainDoc(back), MAIN, s).get(box.id)!;
    if (again.kind !== 'sdt') throw new Error('not a control');
    expect(all(again.sdt, W14, 'checked')[0].getAttributeNS(W14, 'val')).toBe('0');
    expect(all(again.sdt, W, 'sdtContent')[0].textContent).toBe('\u2610');
    expect(readWordValues(back, s).fields[box.id]).toBe(false);
  });

  it('writes content controls: text, a date with fullDate, a list choice, and drops the placeholder flag and style', () => {
    const pkg = readPackage(contentControlsDocx());
    const s = detectWord(pkg, 'docx', 'c.docx');
    const f = (label: string) => byLabel(s.fields, label).id;
    const { out } = fill(pkg, s, values({ [f('Name')]: 'A. Person', [f('Date')]: '2026-10-28', [f('Option')]: 'Third', [f('Entry')]: 'Second', [f('Notes')]: 'All fine' }));
    const targets = locateWord(mainDoc(out), MAIN, s);
    const sdtOf = (label: string): Element => {
      const t = targets.get(f(label))!;
      if (t.kind !== 'sdt') throw new Error('not a control');
      return t.sdt;
    };
    const content = (label: string) => all(sdtOf(label), W, 'sdtContent')[0];

    const date = sdtOf('Date');
    expect(all(date, W, 'date')[0].getAttributeNS(W, 'fullDate')).toBe('2026-10-28T00:00:00Z');
    expect(content('Date').textContent).toBe('28/Oct/2026');
    expect(all(content('Date'), W, 'p')).toHaveLength(1); // the block-level control keeps its paragraph

    expect(content('Option').textContent).toBe('Third');
    expect(all(sdtOf('Option'), W, 'dropDownList')[0].getAttributeNS(W, 'lastValue')).toBe('3');
    expect(content('Entry').textContent).toBe('Second');

    const notes = sdtOf('Notes');
    expect(all(notes, W, 'showingPlcHdr')).toHaveLength(0);
    expect(all(notes, W, 'rStyle')).toHaveLength(0);
    expect(content('Notes').textContent).toBe('All fine');

    const back = readWordValues(out, s);
    expect(back.fields).toMatchObject({ [f('Name')]: 'A. Person', [f('Date')]: '2026-10-28', [f('Option')]: 'Third', [f('Entry')]: 'Second', [f('Notes')]: 'All fine' });
    // Not written: what the template holds. A control that shows its prompt holds no value.
    expect(readWordValues(pkg, s).fields).toMatchObject({ [f('Name')]: 'Sample name', [f('Date')]: '2026-01-01', [f('Notes')]: null, [f('Confirmed')]: false });
  });

  it('clones the last item of a repeating section with fresh unique ids and unique form-field names', () => {
    const pkg = readPackage(weeklyJobsDotx());
    const s = detectWord(pkg, 'dotx', 'w.dotx');
    const jobs = s.rowGroups[0];
    const col = (label: string) => byLabel(jobs.columns, label).id;
    const job = (n: number) => ({ [col('Date')]: `2026-10-${20 + n}`, [col('Responsible')]: `Person ${n}`, [col('Description')]: `Job ${n}`, [col('Status')]: n % 2 ? 'Pending' : 'Completed', [col('Remarks')]: null });
    const vals = values({ f1: 'MV DEMO STAR' }, { [jobs.id]: [1, 2, 3, 4, 5].map(job) });
    expect(extraRowsOf(s, vals)).toEqual({ [jobs.id]: 2 });
    const { out } = fill(pkg, s, vals);
    const doc = mainDoc(out);

    const ids = all(doc, W, 'sdtPr').map((pr) => all(pr, W, 'id')[0]).filter(Boolean).map((el) => wAttr(el, 'val')!);
    expect(ids.length).toBe(21 + 2 * 5); // two more items, each with its own id and 4 controls
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((value) => /^\d+$/.test(value) && Number(value) > 0 && Number(value) < 2 ** 31)).toBe(true);

    const starts = all(doc, W, 'bookmarkStart');
    const names = starts.map((b) => wAttr(b, 'name')!);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(starts.map((b) => wAttr(b, 'id'))).size).toBe(starts.length);
    const ffNames = all(doc, W, 'ffData').map((ff) => wAttr(all(ff, W, 'name')[0], 'val')!);
    expect(new Set(ffNames).size).toBe(ffNames.length);
    for (const ff of ffNames) expect(names).toContain(ff);
    for (const name of [...names, ...ffNames]) expect(name.length).toBeLessThanOrEqual(20);
    // Every bookmark end has its start.
    expect(all(doc, W, 'bookmarkEnd').map((b) => wAttr(b, 'id')).sort()).toEqual(starts.map((b) => wAttr(b, 'id')).sort());

    const section = locateWord(doc, MAIN, s, extraRowsOf(s, vals)).get(jobs.id)!;
    if (section.kind !== 'group') throw new Error('not a group');
    expect(section.rows).toHaveLength(5);
    expect(section.repeating).toBeDefined();
    const back = readWordValues(out, s, extraRowsOf(s, vals));
    expect(back.fields.f1).toBe('MV DEMO STAR');
    expect(back.rows[jobs.id]).toEqual([1, 2, 3, 4, 5].map(job));
    expect(partText(out, MAIN)).toContain('24.10.2026'); // the date control's own dd.MM.yyyy
  });

  it('clears a cloned item, so that a value in the template\'s last item is not copied into the new rows', () => {
    const c = new Controls();
    const widths = [4000, 5638];
    const item = (text: string, placeholder: boolean) => row(widths, [
      { content: p(c.textControl({ alias: 'Item', tag: 'item', text, placeholder })) },
      { content: p(c.formText()) },
    ]);
    const pkg = readPackage(wordPackage({
      kind: 'docx', header: headerBlock(c, { title: 'Demo Items', code: 'TST-91', revision: '00' }),
      body: table(widths, [headerRow(widths, ['Item', 'Note']), c.repeatingSection({ alias: 'Items', tag: 'items', items: [item('Prompt', true), item('Old text', false)] })]) + p(),
    }));
    const s = detectWord(pkg, 'docx', 'items.docx');
    const [group] = s.rowGroups;
    expect(group.capacity).toBe(2);
    const [itemCol, noteCol] = group.columns;
    const vals = values({}, { [group.id]: [{ [itemCol.id]: 'One' }, {}, { [noteCol.id]: 'three' }, {}] });
    const { out } = fill(pkg, s, vals);
    const back = readWordValues(out, s, extraRowsOf(s, vals)).rows[group.id];
    // The template's own second item is not written, so it keeps its text; the clones do not get it.
    expect(back).toEqual([
      { [itemCol.id]: 'One', [noteCol.id]: null },
      { [itemCol.id]: 'Old text', [noteCol.id]: null },
      { [itemCol.id]: null, [noteCol.id]: 'three' },
      { [itemCol.id]: null, [noteCol.id]: null },
    ]);
    expect(partText(out, MAIN)!.split('Old text')).toHaveLength(2);
  });

  it('turns a .dotx into a .docx: the main part\'s content type', () => {
    const pkg = readPackage(weeklyJobsDotx());
    const s = detectWord(pkg, 'dotx', 'w.dotx');
    const { changed, out } = fill(pkg, s, values({ f1: 'MV DEMO STAR' }));
    expect([...changed.keys()].sort()).toEqual(['[Content_Types].xml', MAIN]);
    const types = partText(out, '[Content_Types].xml')!;
    expect(types).toContain(`PartName="/word/document.xml" ContentType="${CONTENT_TYPE.docx}"`);
    expect(types).not.toContain(CONTENT_TYPE.dotx);
    expect(types.replace(CONTENT_TYPE.docx, CONTENT_TYPE.dotx)).toBe(partText(pkg, '[Content_Types].xml'));
    // Even with nothing to fill, the output is a document.
    expect([...writeWord(pkg, s, values(), { photos: {} }).keys()]).toEqual(['[Content_Types].xml']);
  });

  it('never writes a leftEmpty field or column', () => {
    const pkg = readPackage(toolboxTalkDocx());
    const s = detectWord(pkg, 'docx', 't.docx');
    const [group] = s.rowGroups;
    const signature = byLabel(group.columns, 'Signature');
    expect(signature.leftEmpty).toBe(true);
    const { out } = fill(pkg, s, values({}, { [group.id]: [{ [group.columns[0].id]: 'A. Person', [signature.id]: 'signed' }] }));
    expect(partText(out, MAIN)).not.toContain('signed');
    expect(readWordValues(out, s).rows[group.id][0][signature.id]).toBeNull();

    const schema: FormSchema = { ...s, fields: s.fields.map((f) => (f.label === 'Subject' ? { ...f, leftEmpty: true } : f)) };
    const changed = writeWord(pkg, schema, values({ f2: 'not written' }), { photos: {} });
    expect(changed.size).toBe(0);
  });

  it('fills the cells of a plain group with the paragraph\'s properties, and a date column in its hint', () => {
    const pkg = readPackage(permitDocx());
    const s = detectWord(pkg, 'docx', 'p.docx');
    const gas = s.rowGroups.find((g) => g.label === 'Gas readings')!;
    const [time, o2] = gas.columns;
    const vals = values({}, { [gas.id]: [{ [time.id]: '08:00', [o2.id]: '20.9' }, { [time.id]: '09:00', [o2.id]: '20.8' }] });
    const { out } = fill(pkg, s, vals);
    const back = readWordValues(out, s).rows[gas.id];
    expect(back).toHaveLength(10);
    expect(back.slice(0, 2).map((r) => [r[time.id], r[o2.id]])).toEqual([['08:00', '20.9'], ['09:00', '20.8']]);
    expect(back[2][time.id]).toBeNull();
    // The alarm rows above are not touched.
    expect(partText(out, MAIN)).toContain('19.5');
  });

  it('refuses a value for a field it cannot find, a choice that is not an option, and too many rows for a group that cannot grow', () => {
    const pkg = readPackage(permitDocx());
    const s = detectWord(pkg, 'docx', 'p.docx');
    const check = byLabel(s.fields, 'Check 1.1');
    expect(() => writeWord(pkg, s, values({ [check.id]: 'Maybe' }), { photos: {} })).toThrow(/Maybe/);
    const moved: FormSchema = { ...s, fields: s.fields.map((f) => (f.id === check.id ? { ...f, loc: 'word/document.xml#0/99' } : f)) };
    expect(() => writeWord(pkg, moved, values({ [check.id]: 'Yes' }), { photos: {} })).toThrow(new RegExp(check.id));
    const box = byLabel(s.fields, 'Checks completed');
    expect(() => writeWord(pkg, s, values({ [box.id]: 'yes' }), { photos: {} })).toThrow(new RegExp(box.id));
    const fixed: FormSchema = { ...s, rowGroups: s.rowGroups.map((g) => ({ ...g, growable: false })) };
    const personnel = fixed.rowGroups[1];
    const tooMany = values({}, { [personnel.id]: Array.from({ length: 9 }, () => ({ [personnel.columns[0].id]: 'A' })) });
    expect(() => writeWord(pkg, fixed, tooMany, { photos: {} })).toThrow(new RegExp(personnel.id));
    // Nothing given is nothing written.
    expect(writeWord(pkg, s, values({ [check.id]: null, [box.id]: null }), { photos: {} }).size).toBe(0);
  });

  describe('R12: writing a field never moves another stored address', () => {
    /** The result run of every FORMTEXT (five en spaces), and the separate run before it. */
    const RESULT = /<w:r><w:rPr>(?:(?!<\/w:rPr>).)*<\/w:rPr><w:t>(?:&#x2002;){5}<\/w:t><\/w:r>/g;
    const SEPARATE = /<w:r><w:rPr>(?:(?!<\/w:rPr>).)*<\/w:rPr><w:fldChar w:fldCharType="separate"\/><\/w:r>/g;
    const variants: [string, (xml: string) => string][] = [
      ['one result run', (xml) => xml],
      ['no result run', (xml) => xml.replace(RESULT, '')],
      ['three result runs', (xml) => xml.replace(RESULT, (r) => r.replace(/(?:&#x2002;){5}/, '&#x2002;') + r.replace(/(?:&#x2002;){5}/, '&#x2002;&#x2002;') + r.replace(/(?:&#x2002;){5}/, '&#x2002;&#x2002;'))],
      ['no separate and no result', (xml) => xml.replace(RESULT, '').replace(SEPARATE, '')],
    ];
    /** Three FORMTEXTs in one paragraph, and a repeating section whose rows hold two FORMTEXTs in one cell and one in the next. */
    const build = (mutate: (xml: string) => string): Package => {
      const c = new Controls();
      const widths = [5000, 4638];
      const item = () => row(widths, [{ content: p(c.formText() + run(' / ') + c.formText()) }, { content: p(c.formText()) }]);
      const body = p(run('Vessel: ') + c.formText() + run(' IMO No.: ') + c.formText() + run(' Flag: ') + c.formText())
        + table(widths, [headerRow(widths, ['Name / Rank', 'Notes']), c.repeatingSection({ alias: 'People', tag: 'people', items: [item(), item()] })]) + p();
      const pkg = readPackage(wordPackage({ kind: 'docx', header: headerBlock(c, { title: 'Demo Shift', code: 'TST-92', revision: '00' }), body }));
      const xml = mutate(partText(pkg, MAIN)!);
      pkg.entries.set(MAIN, bytesOf(xml));
      return pkg;
    };

    it.each(variants)('%s: every field and row reads back, top level and in cloned rows', (_name, mutate) => {
      const pkg = build(mutate);
      const s = detectWord(pkg, 'docx', 'shift.docx'); // the template as it is, with its own addresses
      expect(s.fields.map((f) => f.label)).toEqual(['Vessel', 'IMO No.', 'Flag']);
      const [group] = s.rowGroups;
      expect(group.columns).toHaveLength(3);
      const [a, b, n] = group.columns.map((col) => col.id);
      const records = [{ [a]: 'Ann', [b]: 'AB', [n]: 'first' }, { [a]: 'Bob', [n]: 'second' }, { [b]: 'OS', [n]: 'third' }, { [a]: 'Cy', [b]: 'C/O' }];
      const vals = values({ f1: 'MV DEMO STAR', f2: '1234567', f3: 'Demo Flag' }, { [group.id]: records });
      const { out } = fill(pkg, s, vals);
      const back = readWordValues(out, s, extraRowsOf(s, vals));
      expect(back.fields).toEqual({ f1: 'MV DEMO STAR', f2: '1234567', f3: 'Demo Flag' });
      expect(back.rows[group.id]).toEqual(records.map((r) => ({ [a]: r[a] ?? null, [b]: r[b] ?? null, [n]: r[n] ?? null })));
      // Written again over its own output, the form still reads right (a result that is already text).
      const again = fill(out, s, values({ f1: 'MV OTHER', f3: 'Flag 2' })).out;
      expect(readWordValues(again, s, extraRowsOf(s, vals)).fields).toEqual({ f1: 'MV OTHER', f2: '1234567', f3: 'Flag 2' });
    });

    it.each(variants)('%s: a paragraph keeps its number of children when its fields are written', (_name, mutate) => {
      const pkg = build(mutate);
      const s = detectWord(pkg, 'docx', 'shift.docx');
      const count = (doc: Document): number => Array.from(all(doc, W, 'p')[0].childNodes).filter((node) => node.nodeType === 1).length;
      const { out } = fill(pkg, s, values({ f1: 'a\nb', f2: 'c', f3: 'd' }));
      expect(count(mainDoc(out))).toBe(count(mainDoc(pkg)));
    });
  });

  it('reads a plain-group cell of several paragraphs as its text, and an empty one as null', () => {
    const c = new Controls();
    const widths = [3000, 3000, 3638];
    const empty = () => row(widths, [{ content: p() + p() }, { content: p() + p() }, { content: p() }]);
    const pkg = readPackage(wordPackage({
      kind: 'docx', header: headerBlock(c, { title: 'Demo Cells', code: 'TST-93', revision: '00' }),
      body: table(widths, [headerRow(widths, ['Name', 'Date (dd.mm.yyyy)', 'Remarks']), empty(), empty()]) + p(),
    }));
    const s = detectWord(pkg, 'docx', 'cells.docx');
    const [group] = s.rowGroups;
    const [name, date, remarks] = group.columns;
    expect(date.kind).toBe('date');
    const vals = values({}, { [group.id]: [{ [name.id]: 'Ann', [date.id]: '2026-10-28', [remarks.id]: 'ok' }, { [name.id]: 'Bob\n' }, { [name.id]: 'Cy', [date.id]: '2026-11-01' }] });
    const { out } = fill(pkg, s, vals);
    expect(readWordValues(out, s, extraRowsOf(s, vals)).rows[group.id]).toEqual([
      { [name.id]: 'Ann', [date.id]: '2026-10-28', [remarks.id]: 'ok' },
      { [name.id]: 'Bob\n', [date.id]: null, [remarks.id]: null },
      { [name.id]: 'Cy', [date.id]: '2026-11-01', [remarks.id]: null },
    ]);
    expect(partText(out, MAIN)).toContain('28.10.2026');
    // The cell keeps its second paragraph: it gives the row its height.
    const firstRow = all(all(mainDoc(out), W, 'tbl')[0], W, 'tr')[1];
    expect(all(all(firstRow, W, 'tc')[0], W, 'p')).toHaveLength(2);
  });

  it('shows a content-control date in a format with a weekday, and falls back when the format asks for a time (R13)', () => {
    const c = new Controls();
    const widths = [3000, 6638];
    const control = (label: string, format: string) => row(widths, [`${label}:`, { content: p(c.dateControl({ alias: label, tag: label.toLowerCase(), format, text: 'Click or tap to enter a date.', placeholder: true })) }]);
    const pkg = readPackage(wordPackage({
      kind: 'docx', header: headerBlock(c, { title: 'Demo Dates', code: 'TST-94', revision: '00' }),
      body: table(widths, [control('Day', 'dddd, d MMMM yyyy'), control('Logged', 'dd/MM/yyyy HH:mm'), control('Hinted', 'd/M/yyyy h:mm AM/PM')]) + p(),
    }));
    const detected = detectWord(pkg, 'docx', 'dates.docx');
    const s: FormSchema = { ...detected, fields: detected.fields.map((f) => (f.label === 'Hinted' ? { ...f, formatHint: 'dd/MMM/yyyy' } : f)) };
    const ids = s.fields.map((f) => f.id);
    const { out } = fill(pkg, s, values(Object.fromEntries(ids.map((id) => [id, '2026-10-28']))));
    const targets = locateWord(mainDoc(out), MAIN, s);
    const shown = ids.map((id) => {
      const t = targets.get(id)!;
      if (t.kind !== 'sdt') throw new Error('not a control');
      expect(all(t.sdt, W, 'date')[0].getAttributeNS(W, 'fullDate')).toBe('2026-10-28T00:00:00Z');
      return all(t.sdt, W, 'sdtContent')[0].textContent;
    });
    expect(shown).toEqual(['Wednesday, 28 October 2026', '28-OCT-2026', '28/Oct/2026']);
    expect(Object.values(readWordValues(out, s).fields)).toEqual(['2026-10-28', '2026-10-28', '2026-10-28']);
  });

  it('grows two plain groups of one table, and finds the field after them', () => {
    const c = new Controls();
    const widths = [4819, 4819];
    const pkg = readPackage(wordPackage({
      kind: 'docx', header: headerBlock(c, { title: 'Demo Two Groups', code: 'TST-95', revision: '00' }),
      body: table(widths, [
        headerRow(widths, ['Name', 'Rank']), ...emptyRows(widths, 2),
        headerRow(widths, ['Item', 'Qty']), ...emptyRows(widths, 2),
        row(widths, ['Remarks:', { content: p(c.formText()) }]),
      ]) + p(),
    }));
    const s = detectWord(pkg, 'docx', 'two.docx');
    expect(s.rowGroups.map((g) => g.capacity)).toEqual([2, 2]);
    const [people, items] = s.rowGroups;
    const rowsOf = (g: typeof people, prefix: string, count: number) => Array.from({ length: count }, (_, i) => ({ [g.columns[0].id]: `${prefix} ${i + 1}`, [g.columns[1].id]: String(i + 1) }));
    const vals = values({ [s.fields[0].id]: 'all done' }, { [people.id]: rowsOf(people, 'Person', 5), [items.id]: rowsOf(items, 'Item', 4) });
    const { out } = fill(pkg, s, vals);
    const back = readWordValues(out, s, extraRowsOf(s, vals));
    expect(back.fields[s.fields[0].id]).toBe('all done');
    expect(back.rows[people.id]).toEqual(rowsOf(people, 'Person', 5));
    expect(back.rows[items.id]).toEqual(rowsOf(items, 'Item', 4));
    expect(all(all(mainDoc(out), W, 'tbl')[0], W, 'tr')).toHaveLength(2 + 5 + 4 + 1);
  });
});
