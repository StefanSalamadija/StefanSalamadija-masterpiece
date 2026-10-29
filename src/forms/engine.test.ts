import { describe, expect, it } from 'vitest';
import { assemble, DOCX_MIME, importForm, makeFile, verifyOutput, XLSX_MIME } from './engine';
import type { MakeFileInput } from './engine';
import { FormWriteError, IntegrityError, NotAFormError, OldFormatError } from './errors';
import { readExcelValues } from './excel/read';
import { canonicalExcelValue } from './excel/values';
import { formFileName } from './fileName';
import { bytesOf, partText, readPackage, writePackage } from './package';
import type { FormKind, Package } from './package';
import { conditionListXlsx, dayGridXlsx, inventoryXlsx, matrixXlsx } from './testing/excelFixtures';
import { contentControlsDocx, oddLayoutsDocx, permitDocx, toolboxTalkDocx, weeklyJobsDotx } from './testing/wordFixtures';
import type { DraftValues, FieldDef, FormSchema, FormValue } from './types';
import { readWordValues } from './word/read';
import { extraRowsOf } from './word/write';

const INTEGRITY_MESSAGE = 'The file couldn\'t be made correctly, so it wasn\'t shared. Nothing was lost — your draft is still here.';
const DATE = '2026-10-28';
const PHOTO = 'photo-1';

/** A tiny JPEG: start of image, a baseline frame header (4 x 3) and end of image. The writer never decodes it. */
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 3, 0, 4, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);

type Fixture = { name: string; fileName: string; make: () => Uint8Array };
const FIXTURES: Fixture[] = [
  { name: 'toolbox', fileName: 'toolbox.docx', make: () => toolboxTalkDocx() },
  { name: 'toolbox rev 01', fileName: 'toolbox-rev01.docx', make: () => toolboxTalkDocx({ revision: '01 / 01.06.2026', renameSubjectTo: 'Topic', extraFieldLabel: 'Location' }) },
  { name: 'permit', fileName: 'permit.docx', make: permitDocx },
  { name: 'weekly jobs (template)', fileName: 'weekly.dotx', make: weeklyJobsDotx },
  { name: 'content controls', fileName: 'controls.docx', make: contentControlsDocx },
  { name: 'odd layouts', fileName: 'odd.docx', make: oddLayoutsDocx },
  { name: 'inventory', fileName: 'inventory.xlsx', make: () => inventoryXlsx(120) },
  { name: 'day grid', fileName: 'daygrid.xlsx', make: dayGridXlsx },
  { name: 'matrix', fileName: 'matrix.xlsx', make: matrixXlsx },
  { name: 'condition list', fileName: 'conditions.xlsx', make: conditionListXlsx },
];

const isWord = (kind: FormKind): boolean => kind !== 'xlsx';

/** A value of the field's kind for row (or field number) `i`, as the fill screen would hold it (R2). */
function sample(f: FieldDef, i: number): FormValue {
  switch (f.kind) {
    case 'date': return `2026-10-${String((i % 28) + 1).padStart(2, '0')}`;
    case 'time': return `${String(i % 24).padStart(2, '0')}:15`;
    case 'number': return `${i},5`;
    case 'checkbox': return i % 2 === 0;
    case 'choice': return f.options![i % f.options!.length]!;
    case 'picture': return PHOTO;
    default: return `Text ${i} & <Š ć đ> "q"\r\nline two`;
  }
}

/**
 * Every field filled, left-empty ones included (they must not be written). Every group filled, with its row 1 left
 * blank; a group that can grow gets two rows more than it holds.
 */
function everything(s: FormSchema): DraftValues {
  const out: DraftValues = { fields: {}, rows: {} };
  s.fields.forEach((f, i) => { out.fields[f.id] = sample(f, i); });
  for (const g of s.rowGroups) {
    const count = g.capacity + (g.growable && isWord(s.kind) ? 2 : 0);
    out.rows[g.id] = Array.from({ length: count }, (_, i) => Object.fromEntries(g.columns.map((c) => [c.id, i === 1 ? null : sample(c, i)])));
  }
  return out;
}

/**
 * What a value reads back as, worked out here from the writers' contracts: Excel through `canonicalExcelValue`; Word
 * text with `\n` line ends, ISO dates as given, booleans and options as given. Pictures are checked by presence apart.
 */
function expected(kind: FormKind, f: FieldDef, value: FormValue | undefined): FormValue {
  if (f.leftEmpty || value === undefined || value === null || value === '') return null;
  if (!isWord(kind)) return canonicalExcelValue(f, value);
  return typeof value === 'boolean' ? value : value.replace(/\r\n/g, '\n');
}

function expectRead(kind: FormKind, f: FieldDef, value: FormValue | undefined, back: FormValue | undefined, where: string): void {
  if (f.kind === 'picture' && !f.leftEmpty && value) expect(back, where).toMatch(/^word\/media\/mp-\d+\.jpeg$/);
  else expect(back, where).toEqual(expected(kind, f, value));
}

function inputOf(fixture: Fixture, values?: (s: FormSchema) => DraftValues): MakeFileInput {
  const bytes = fixture.make();
  const { kind, schema } = importForm(fixture.fileName, bytes);
  return { kind, fileName: fixture.fileName, bytes, schema, values: values ? values(schema) : everything(schema), photos: { [PHOTO]: JPEG }, date: DATE };
}

const fixture = (name: string): Fixture => FIXTURES.find((f) => f.name === name)!;

/** What `makeFile` would verify, before verifying it: the template, the output read back, and the parts written. */
function assembled(input: MakeFileInput): { original: Package; output: Package; changed: Set<string> } {
  const made = assemble(input);
  return { original: made.original, output: readPackage(made.bytes), changed: made.changed };
}

function expectIntegrityError(run: () => unknown): IntegrityError {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(IntegrityError);
  expect((caught as Error).message).toBe(INTEGRITY_MESSAGE);
  return caught as IntegrityError;
}

describe('formFileName', () => {
  it('names a .dotx template\'s output as .docx: <code> <title> <date>', () => {
    expect(formFileName({ code: 'TST-01', title: 'Toolbox Talk', revision: '' }, '2026-10-28', 'dotx')).toBe('TST-01 Toolbox Talk 2026-10-28.docx');
    expect(formFileName({ code: 'TST-01', title: 'Toolbox Talk', revision: '00' }, '2026-10-28', 'docx')).toBe('TST-01 Toolbox Talk 2026-10-28.docx');
    expect(formFileName({ code: 'TST-11', title: 'Demo Inventory', revision: '' }, '2026-10-28', 'xlsx')).toBe('TST-11 Demo Inventory 2026-10-28.xlsx');
  });

  it('leaves the code out when there is none', () => {
    expect(formFileName({ code: '', title: 'Toolbox Talk', revision: '' }, DATE, 'docx')).toBe('Toolbox Talk 2026-10-28.docx');
  });

  it('turns the characters a file name cannot hold, and control characters, into -', () => {
    expect(formFileName({ code: 'TST-01', title: 'Hot/Cold: work*? "x" <y> |z\\', revision: '' }, DATE, 'docx'))
      .toBe('TST-01 Hot-Cold- work-- -x- -y- -z- 2026-10-28.docx');
    // A tab or a line break is whitespace, and becomes a space like any other run of it.
    expect(formFileName({ code: 'TST/01', title: 'A\tB\u0007C\u007fD\u0085E', revision: '' }, DATE, 'docx')).toBe('TST-01 A B-C-D-E 2026-10-28.docx');
  });

  it('turns bidi and other invisible format characters into - too, so a name cannot be shown back to front', () => {
    expect(formFileName({ code: '', title: 'Plan‮xcod.exe​', revision: '' }, DATE, 'docx')).toBe('Plan-xcod.exe- 2026-10-28.docx');
  });

  it('collapses runs of whitespace and trims', () => {
    expect(formFileName({ code: ' TST-01 ', title: '  Toolbox    Talk\n', revision: '' }, DATE, 'docx')).toBe('TST-01 Toolbox Talk 2026-10-28.docx');
  });

  it('cuts a 200-character title so the name is 120 characters before the extension, keeping the code and the date', () => {
    const name = formFileName({ code: 'TST-01', title: 'x'.repeat(200), revision: '' }, DATE, 'docx');
    expect(name.endsWith('.docx')).toBe(true);
    const base = name.slice(0, -'.docx'.length);
    expect(base).toHaveLength(120);
    expect(base).toBe(`TST-01 ${'x'.repeat(120 - 7 - 11)} 2026-10-28`);
  });

  it('does not leave a space at the cut, and never splits a character in two', () => {
    expect(formFileName({ code: 'TST-01', title: `${'a'.repeat(101)} ${'b'.repeat(50)}`, revision: '' }, DATE, 'docx'))
      .toBe(`TST-01 ${'a'.repeat(101)} 2026-10-28.docx`);
    const ship = '\u{1F6A2}';
    expect(formFileName({ code: '', title: 'x'.repeat(108) + ship.repeat(5), revision: '' }, DATE, 'xlsx')).toBe(`${'x'.repeat(108)}${ship} 2026-10-28.xlsx`);
  });

  it('gives just the date when there is neither code nor title', () => {
    expect(formFileName({ code: '', title: ' / ', revision: '' }, DATE, 'docx')).toBe('- 2026-10-28.docx');
    expect(formFileName({ code: '', title: '', revision: '' }, DATE, 'docx')).toBe('2026-10-28.docx');
  });
});

describe('importForm', () => {
  it.each(FIXTURES)('$name: sniffs the kind and detects the fields', (f) => {
    const { kind, schema } = importForm(f.fileName, f.make());
    expect(kind).toBe(f.fileName.split('.').pop());
    expect(schema.kind).toBe(kind);
    expect(schema.fields.length + schema.rowGroups.length).toBeGreaterThan(0);
  });

  it('refuses what is not a form with the file errors\' own messages', () => {
    expect(() => importForm('notes.txt', bytesOf('just some text'))).toThrow(NotAFormError);
    expect(() => importForm('old.doc', Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]))).toThrow(OldFormatError);
  });
});

describe('makeFile on every fixture (R1)', () => {
  it.each(FIXTURES)('$name: every value reads back from the output as written, and the output imports', (f) => {
    const input = inputOf(f);
    const { kind, schema, values } = input;
    const made = makeFile(input);

    const ext = kind === 'xlsx' ? 'xlsx' : 'docx';
    expect(made.fileName).toBe(`${schema.identity.code} ${schema.identity.title} ${DATE}.${ext}`);
    expect(made.mime).toBe(kind === 'xlsx' ? XLSX_MIME : DOCX_MIME);

    const out = readPackage(made.bytes);
    const back = isWord(kind) ? readWordValues(out, schema, extraRowsOf(schema, values)) : readExcelValues(out, schema);
    for (const field of schema.fields) expectRead(kind, field, values.fields[field.id], back.fields[field.id], field.id);
    for (const group of schema.rowGroups) {
      const rows = values.rows[group.id]!;
      expect(back.rows[group.id]!.length, group.id).toBe(Math.max(rows.length, group.capacity));
      rows.forEach((row, i) => {
        for (const column of group.columns) expectRead(kind, column, row[column.id], back.rows[group.id]![i]![column.id], `${column.id} row ${i}`);
      });
    }

    const again = importForm(made.fileName, made.bytes);
    expect(again.kind).toBe(ext);
  });

  it('turns a .dotx into a .docx: its main part becomes a document\'s', () => {
    const made = makeFile(inputOf(fixture('weekly jobs (template)'), () => ({ fields: {}, rows: {} })));
    expect(made.fileName).toBe('TST-03 Demo Weekly Jobs 2026-10-28.docx');
    expect(partText(readPackage(made.bytes), '[Content_Types].xml')).toContain('wordprocessingml.document.main+xml');
    expect(importForm(made.fileName, made.bytes).kind).toBe('docx');
  });

  it('names the file after the template\'s own name when the form has neither code nor title', () => {
    const input = inputOf(fixture('toolbox'));
    const made = makeFile({ ...input, fileName: 'My form.docx', schema: { ...input.schema, identity: { code: '', title: '', revision: '' } } });
    expect(made.fileName).toBe('My form 2026-10-28.docx');
  });

  it('lets a FormWriteError through as it is, naming the field, so the person can see which value has no place', () => {
    const input = inputOf(fixture('permit'), (s) => ({ fields: { [s.fields[0]!.id]: 'Maybe' }, rows: {} }));
    let caught: unknown;
    try {
      makeFile(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FormWriteError);
    expect(caught).not.toBeInstanceOf(IntegrityError);
    expect((caught as Error).message).toContain('f1');
    expect((caught as Error).message).toContain('Check 1.1');
  });

  it('refuses a file whose date would read back as another (a 2-digit year before 2000 reads as 20xx, a known limit)', () => {
    const input = inputOf(fixture('toolbox'), (s) => ({ fields: { [s.fields.find((f) => f.kind === 'date')!.id]: '1999-12-31' }, rows: {} }));
    const schema: FormSchema = { ...input.schema, fields: input.schema.fields.map((f) => (f.kind === 'date' ? { ...f, formatHint: 'dd.MM.yy' } : f)) };
    const error = expectIntegrityError(() => makeFile({ ...input, schema }));
    expect(error.reason).toContain('f3');
    // The same date with a 4-digit year is fine.
    expect(() => makeFile({ ...input, schema: { ...schema, fields: schema.fields.map((f) => (f.kind === 'date' ? { ...f, formatHint: 'dd.MM.yyyy' } : f)) } })).not.toThrow();
  });
});

describe('verifyOutput', () => {
  it('passes what makeFile assembles, for Word and Excel', () => {
    for (const name of ['toolbox', 'weekly jobs (template)', 'inventory']) {
      const input = inputOf(fixture(name));
      const { original, output, changed } = assembled(input);
      expect(() => verifyOutput(original, output, changed, input.schema, input.values), name).not.toThrow();
    }
  });

  it('refuses an output whose unchanged part was corrupted (the seam: the assembled output, changed before verifying)', () => {
    for (const [name, part] of [['toolbox', 'word/styles.xml'], ['inventory', 'xl/styles.xml'], ['toolbox', 'word/media/image1.png']] as const) {
      const input = inputOf(fixture(name));
      const { original, output, changed } = assembled(input);
      expect(changed.has(part)).toBe(false);
      const bytes = Uint8Array.from(output.entries.get(part)!);
      bytes[bytes.length - 2] ^= 1;
      output.entries.set(part, bytes);
      const error = expectIntegrityError(() => verifyOutput(original, output, changed, input.schema, input.values));
      expect(error.reason).toContain(part);
    }
  });

  it('refuses an output that lost a part, or has a part nobody wrote', () => {
    const input = inputOf(fixture('toolbox'));
    const lost = assembled(input);
    lost.output.entries.delete('word/header1.xml');
    expect(expectIntegrityError(() => verifyOutput(lost.original, lost.output, lost.changed, input.schema, input.values)).reason).toContain('word/header1.xml');

    const added = assembled(input);
    added.output.entries.set('word/extra.xml', bytesOf('<a/>'));
    expect(expectIntegrityError(() => verifyOutput(added.original, added.output, added.changed, input.schema, input.values)).reason).toContain('word/extra.xml');

    const missing = assembled(input);
    missing.changed.add('word/promised.xml');
    expect(expectIntegrityError(() => verifyOutput(missing.original, missing.output, missing.changed, input.schema, input.values)).reason).toContain('word/promised.xml');
  });

  it('refuses a changed XML part that does not parse, but does not parse a changed photo', () => {
    const input = inputOf(fixture('weekly jobs (template)'));
    const broken = assembled(input);
    const rels = 'word/_rels/document.xml.rels';
    expect(broken.changed.has(rels)).toBe(true);
    broken.output.entries.set(rels, bytesOf(partText(broken.output, rels)!.slice(0, -10)));
    expect(expectIntegrityError(() => verifyOutput(broken.original, broken.output, broken.changed, input.schema, input.values)).reason).toContain(rels);

    const types = assembled(input);
    expect(types.changed.has('[Content_Types].xml')).toBe(true);
    types.output.entries.set('[Content_Types].xml', bytesOf('<Types><Default'));
    expect(expectIntegrityError(() => verifyOutput(types.original, types.output, types.changed, input.schema, input.values)).reason).toContain('[Content_Types].xml');

    const photo = assembled(input);
    const media = [...photo.changed].filter((part) => part.endsWith('.jpeg'));
    expect(media.length).toBeGreaterThan(0);
    expect(() => verifyOutput(photo.original, photo.output, photo.changed, input.schema, input.values)).not.toThrow();
  });

  it('refuses an output in which a filled value reads back differently', () => {
    const input = inputOf(fixture('toolbox'));
    const { original, output, changed } = assembled(input);
    const f1 = input.schema.fields[0]!.id;
    const other: DraftValues = { ...input.values, fields: { ...input.values.fields, [f1]: 'Another vessel' } };
    expect(expectIntegrityError(() => verifyOutput(original, output, changed, input.schema, other)).reason).toContain(f1);

    const group = input.schema.rowGroups[0]!;
    const rows = input.values.rows[group.id]!.map((row, i) => (i === 13 ? { ...row, [group.columns[0]!.id]: 'Someone else' } : row));
    const otherRow: DraftValues = { ...input.values, rows: { ...input.values.rows, [group.id]: rows } };
    expect(expectIntegrityError(() => verifyOutput(original, output, changed, input.schema, otherRow)).reason).toContain(group.columns[0]!.id);
  });

  it('refuses a value in a row that the output does not have', () => {
    const input = inputOf(fixture('inventory'), (s) => ({ fields: {}, rows: { [s.rowGroups[0]!.id]: [] } }));
    const { original, output, changed } = assembled(input);
    const group = input.schema.rowGroups[0]!;
    const rows = Array.from({ length: group.capacity + 1 }, (_, i) => (i === group.capacity ? { [group.columns[0]!.id]: 'Extra' } : {}));
    expectIntegrityError(() => verifyOutput(original, output, changed, input.schema, { fields: {}, rows: { [group.id]: rows } }));
    // Blank rows past the end are no value at all.
    const blank = rows.map(() => ({ [group.columns[0]!.id]: null }));
    expect(() => verifyOutput(original, output, changed, input.schema, { fields: {}, rows: { [group.id]: blank } })).not.toThrow();
  });

  it('accepts left-empty fields and blank values as the template has them, prefilled controls included', () => {
    const input = inputOf(fixture('content controls'), (s) => ({ fields: Object.fromEntries(s.fields.map((f) => [f.id, null])), rows: {} }));
    const { original, output, changed } = assembled(input);
    // The template's controls already hold text and a date, which a blank draft leaves as they are.
    expect(readWordValues(output, input.schema).fields.f1).toBe('Sample name');
    expect(() => verifyOutput(original, output, changed, input.schema, input.values)).not.toThrow();

    const toolbox = inputOf(fixture('toolbox'));
    const signature = toolbox.schema.rowGroups[0]!.columns.find((c) => c.leftEmpty)!;
    expect(toolbox.values.rows[toolbox.schema.rowGroups[0]!.id]![0]![signature.id]).toBeTruthy();
    const made = assembled(toolbox);
    expect(() => verifyOutput(made.original, made.output, made.changed, toolbox.schema, toolbox.values)).not.toThrow();
  });

  it('checks pictures by presence: a filled one must show the new photo, even where the template already shows a picture', () => {
    // The weekly form with its picture controls showing their stock image as a picture, not as a placeholder.
    const base = fixture('weekly jobs (template)');
    const prefilled: Fixture = {
      ...base,
      make: () => {
        const pkg = readPackage(base.make());
        const doc = partText(pkg, 'word/document.xml')!;
        const edited = doc.replace(/<w:showingPlcHdr\/>(<w:picture\/>)/g, '$1');
        expect(edited).not.toBe(doc);
        pkg.entries.set('word/document.xml', bytesOf(edited));
        return writePackage(pkg, new Map());
      },
    };
    const pictures = (s: FormSchema) => s.rowGroups.find((g) => g.label === 'Pictures')!;

    // No photo in the draft: the stock pictures stay, and that is right.
    const none = inputOf(prefilled, () => ({ fields: {}, rows: {} }));
    const unfilled = assembled(none);
    const group = pictures(none.schema);
    expect(readWordValues(unfilled.output, none.schema).rows[group.id]![0]![group.columns[0]!.id]).toMatch(/^word\/media\//);
    expect(() => verifyOutput(unfilled.original, unfilled.output, unfilled.changed, none.schema, none.values)).not.toThrow();

    // A photo in the draft that the output does not show is refused, although the control reads as filled.
    const photo: DraftValues = { fields: {}, rows: { [group.id]: [{ [group.columns[0]!.id]: PHOTO }] } };
    expectIntegrityError(() => verifyOutput(unfilled.original, unfilled.output, unfilled.changed, none.schema, photo));

    // Written, it passes.
    const filled = assembled({ ...none, values: photo });
    expect(() => verifyOutput(filled.original, filled.output, filled.changed, none.schema, photo)).not.toThrow();
  });

  it('has the exact integrity message and its own name', () => {
    const error = new IntegrityError('test');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('IntegrityError');
    expect(error.message).toBe(INTEGRITY_MESSAGE);
    expect(error.reason).toBe('test');
  });
});

