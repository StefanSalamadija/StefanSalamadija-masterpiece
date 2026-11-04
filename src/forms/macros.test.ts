import { describe, expect, it } from 'vitest';
import { stripMacros } from './macros';
import { bytesOf, partText, readPackage, utf8, writePackage } from './package';
import type { Package } from './package';
import { inventoryXlsx } from './testing/excelFixtures';
import { asExcelTemplate, MACRO_REL, MACRO_TYPE, withMacros } from './testing/macroFixtures';
import { toolboxTalkDocx, weeklyJobsDotx } from './testing/wordFixtures';
import { CONTENT_TYPE } from './testing/zip';
import { parseXml } from './xml';

const TYPES = '[Content_Types].xml';

/** The package `stripMacros` gives for `bytes`, as stored: zipped and read back. */
function stripped(bytes: Uint8Array): Package {
  const result = stripMacros(readPackage(bytes));
  if (!result) throw new Error('nothing was stripped');
  return readPackage(writePackage(result.pkg, result.changed));
}

/** Every part of `a` is in `b` with the same bytes, and `b` has no other part. */
function expectSameParts(b: Package, a: Package): void {
  expect([...b.entries.keys()].sort()).toEqual([...a.entries.keys()].sort());
  for (const [name, bytes] of a.entries) expect(utf8(b.entries.get(name)!), name).toBe(utf8(bytes));
  for (const [name, bytes] of a.entries) expect(b.entries.get(name), name).toEqual(bytes);
}

describe('stripMacros', () => {
  it('gives back nothing for a file without macros, so its bytes are stored as they are', () => {
    expect(stripMacros(readPackage(toolboxTalkDocx()))).toBeUndefined();
    expect(stripMacros(readPackage(inventoryXlsx(5)))).toBeUndefined();
    expect(stripMacros(readPackage(asExcelTemplate(inventoryXlsx(5))))).toBeUndefined();
  });

  it('turns a .docm back into the very .docx it was made from: every part to the byte', () => {
    const docx = toolboxTalkDocx();
    const result = stripMacros(readPackage(withMacros(docx, 'docm')))!;
    expect(result.removed.sort()).toEqual(['word/_rels/vbaProject.bin.rels', 'word/vbaData.xml', 'word/vbaProject.bin']);
    expectSameParts(stripped(withMacros(docx, 'docm')), readPackage(docx));
  });

  it('keeps a template a template: a .dotm becomes a .dotx, a .xltm a .xltx', () => {
    expectSameParts(stripped(withMacros(weeklyJobsDotx(), 'dotm')), readPackage(weeklyJobsDotx()));
    const xltx = asExcelTemplate(inventoryXlsx(5));
    const fromXltm = stripped(withMacros(xltx, 'xltm'));
    expectSameParts(fromXltm, readPackage(xltx));
    expect(partText(fromXltm, TYPES)).toContain(MACRO_TYPE.xltx);
  });

  it('turns a .xlsm back into its .xlsx, keeping the printer settings that share the bin extension', () => {
    const xlsx = inventoryXlsx(5);
    const pkg = stripped(withMacros(xlsx, 'xlsm', { printerSettings: true }));
    const original = readPackage(xlsx);
    for (const [name, bytes] of original.entries) {
      if (name !== TYPES) expect(utf8(pkg.entries.get(name)!), name).toBe(utf8(bytes));
    }
    expect(pkg.entries.has('xl/vbaProject.bin')).toBe(false);
    expect(pkg.entries.has('xl/printerSettings/printerSettings1.bin')).toBe(true);
    const types = partText(pkg, TYPES)!;
    // Only the printer settings' Default is left of what was added.
    expect(types).toBe(partText(original, TYPES)!.replace(/<Default\b/, `<Default Extension="bin" ContentType="${MACRO_TYPE.printerSettings}"/><Default`));
    expect(types).not.toMatch(/vbaProject|macroEnabled/i);
    expect(types).toContain(CONTENT_TYPE.workbook);
  });

  it('removes the signature, a key map and a ribbon that calls macros, and keeps a ribbon that calls none', () => {
    const docx = toolboxTalkDocx();
    const bytes = withMacros(docx, 'docm', { signature: true, keyMap: true, ribbon: true, plainRibbon: true });
    const result = stripMacros(readPackage(bytes))!;
    expect(result.removed.sort()).toEqual([
      'customUI/_rels/customUI14.xml.rels', 'customUI/customUI14.xml', 'customUI/images/hello.png',
      'word/_rels/vbaProject.bin.rels', 'word/customizations.xml', 'word/vbaData.xml', 'word/vbaProject.bin', 'word/vbaProjectSignature.bin',
    ]);
    const pkg = stripped(bytes);
    const original = readPackage(docx);
    for (const [name, bytes] of original.entries) {
      if (name !== '_rels/.rels') expect(utf8(pkg.entries.get(name)!), name).toBe(utf8(bytes));
    }
    expect(pkg.entries.has('customUI/plain.xml')).toBe(true);
    const root = partText(pkg, '_rels/.rels')!;
    expect(root).toContain('customUI/plain.xml');
    expect(root).not.toContain('customUI14');
    expect(root.replace(/<Relationship Id="rIdUi2"[^>]*\/>/, '')).toBe(partText(original, '_rels/.rels'));
  });

  it('leaves every .rels and the content types well-formed', () => {
    const pkg = stripped(withMacros(toolboxTalkDocx(), 'docm', { signature: true, keyMap: true, ribbon: true }));
    for (const name of pkg.order) if (/\.(?:xml|rels)$/.test(name)) expect(() => parseXml(utf8(pkg.entries.get(name)!)), name).not.toThrow();
  });

  it('keeps a bin Default that another part still relies on', () => {
    const pkg = readPackage(withMacros(toolboxTalkDocx(), 'docm'));
    const changed = new Map([['word/embeddings/demo.bin', bytesOf('an embedded object')]]);
    const result = stripMacros(readPackage(writePackage(pkg, changed)))!;
    const out = readPackage(writePackage(result.pkg, result.changed));
    expect(out.entries.has('word/embeddings/demo.bin')).toBe(true);
    expect(partText(out, TYPES)).toContain('<Default Extension="bin"');
    expect(out.entries.has('word/vbaProject.bin')).toBe(false);
  });

  it('removes a project found only by its relationship or its Override, whatever its name', () => {
    const pkg = readPackage(toolboxTalkDocx());
    const rels = partText(pkg, 'word/_rels/document.xml.rels')!.replace('</Relationships>', `<Relationship Id="rIdX" Type="${MACRO_REL.vbaProject}" Target="macros/code.dat"/></Relationships>`);
    const types = partText(pkg, TYPES)!.replace('</Types>', `<Override PartName="/word/other.dat" ContentType="${MACRO_TYPE.vbaProject}"/></Types>`)
      .replace(CONTENT_TYPE.docx, MACRO_TYPE.docm);
    const bytes = writePackage(pkg, new Map([
      ['word/_rels/document.xml.rels', bytesOf(rels)], [TYPES, bytesOf(types)],
      ['word/macros/code.dat', bytesOf('one')], ['word/other.dat', bytesOf('two')],
    ]));
    const result = stripMacros(readPackage(bytes))!;
    expect(result.removed.sort()).toEqual(['word/macros/code.dat', 'word/other.dat']);
    expectSameParts(readPackage(writePackage(result.pkg, result.changed)), pkg);
  });

  it('keeps a byte order mark at the start of an edited .rels or content types', () => {
    const pkg = readPackage(withMacros(toolboxTalkDocx(), 'docm'));
    const bom = (text: string) => Uint8Array.from([0xef, 0xbb, 0xbf, ...bytesOf(text)]);
    const rels = 'word/_rels/document.xml.rels';
    const bytes = writePackage(pkg, new Map([[rels, bom(partText(pkg, rels)!)], [TYPES, bom(partText(pkg, TYPES)!)]]));
    const result = stripMacros(readPackage(bytes))!;
    for (const name of [rels, TYPES]) expect([...result.changed.get(name)!.slice(0, 3)], name).toEqual([0xef, 0xbb, 0xbf]);
    expect(utf8(result.changed.get(rels)!)).toBe(partText(readPackage(toolboxTalkDocx()), rels));
  });

  it('switches a macro-enabled main part that has no project, and says nothing was removed', () => {
    const pkg = readPackage(toolboxTalkDocx());
    const bytes = writePackage(pkg, new Map([[TYPES, bytesOf(partText(pkg, TYPES)!.replace(CONTENT_TYPE.docx, MACRO_TYPE.docm))]]));
    const result = stripMacros(readPackage(bytes))!;
    expect(result.removed).toEqual([]);
    expectSameParts(readPackage(writePackage(result.pkg, result.changed)), pkg);
  });
});
