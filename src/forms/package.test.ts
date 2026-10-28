import { zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import {
  DamagedFormError, FormFileError, FormTooLargeError, MacroFileError, NotAFormError, OldFormatError,
} from './errors';
import {
  bytesOf, partText, readPackage, sniffFormat, utf8, writePackage,
} from './package';
import { zipOf } from './testing/zip';

const TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const DOCX_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const DOTX_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml';
const XLSX_MAIN = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const DOCM_MAIN = 'application/vnd.ms-word.document.macroEnabled.main+xml';
const DOTM_MAIN = 'application/vnd.ms-word.template.macroEnabledTemplate.main+xml';
const XLSM_MAIN = 'application/vnd.ms-excel.sheet.macroEnabled.main+xml';
const PPTX_MAIN = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';

/** A `[Content_Types].xml` that declares `part` as the main part. */
function contentTypes(part: string, contentType: string, extra = ''): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + `<Types xmlns="${TYPES_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/><Override PartName="/${part}" ContentType="${contentType}"/>${extra}</Types>`;
}
const CT_DOCX = contentTypes('word/document.xml', DOCX_MAIN);
const CT_DOTX = contentTypes('word/document.xml', DOTX_MAIN);
const CT_DOCM = contentTypes('word/document.xml', DOCM_MAIN);
const CT_XLSX = contentTypes('xl/workbook.xml', XLSX_MAIN);

const DOC = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>';
const DOC2 = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>';
const WORKBOOK = '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>';
/** Every byte value once, so a part that is decoded as text and encoded again would not survive. */
const PNG = Uint8Array.from({ length: 256 }, (_, i) => i);
const MIB = 1024 * 1024;

/** A package with `count` empty parts, to cross the entry limit. */
function manyParts(count: number): Uint8Array {
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i += 1) files[`parts/p${i}.xml`] = '';
  return zipOf(files);
}

/** A copy of `zip` with every occurrence of the text `from` overwritten by `to`, which must be as long. */
function renamed(zip: Uint8Array, from: string, to: string): Uint8Array {
  const out = zip.slice();
  const before = bytesOf(from);
  for (let i = 0; i + before.length <= out.length; i += 1) {
    if (before.every((byte, k) => out[i + k] === byte)) out.set(bytesOf(to), i);
  }
  return out;
}

describe('readPackage and writePackage', () => {
  it('round-trips: unchanged parts keep their exact bytes', () => {
    const pkg = readPackage(zipOf({ '[Content_Types].xml': CT_DOCX, 'word/document.xml': DOC, 'word/media/a.png': PNG }));
    const out = readPackage(writePackage(pkg, new Map([['word/document.xml', bytesOf(DOC2)]])));
    expect(out.order).toEqual(pkg.order);
    expect(out.entries.get('word/media/a.png')).toEqual(pkg.entries.get('word/media/a.png'));
    expect(out.entries.get('word/media/a.png')).toEqual(PNG);
    expect(utf8(out.entries.get('word/document.xml')!)).toBe(DOC2);
    expect(utf8(out.entries.get('[Content_Types].xml')!)).toBe(CT_DOCX);
  });

  it('lists the parts in the order of the file and keeps that order when one is replaced', () => {
    const pkg = readPackage(zipOf({ 'b.xml': '<b/>', '[Content_Types].xml': CT_DOCX, 'a.xml': '<a/>', 'word/document.xml': DOC }));
    expect(pkg.order).toEqual(['b.xml', '[Content_Types].xml', 'a.xml', 'word/document.xml']);
    expect([...pkg.entries.keys()]).toEqual(pkg.order);
    const out = readPackage(writePackage(pkg, new Map([['a.xml', bytesOf('<a x="1"/>')]])));
    expect(out.order).toEqual(pkg.order);
    expect(partText(out, 'a.xml')).toBe('<a x="1"/>');
    expect(partText(out, 'b.xml')).toBe('<b/>');
  });

  it('appends a new part after the existing ones', () => {
    const pkg = readPackage(zipOf({ '[Content_Types].xml': CT_DOCX, 'word/document.xml': DOC }));
    const changed = new Map([['word/media/new.jpg', PNG], ['word/document.xml', bytesOf(DOC2)], ['word/_rels/extra.rels', bytesOf('<r/>')]]);
    const out = readPackage(writePackage(pkg, changed));
    expect(out.order).toEqual(['[Content_Types].xml', 'word/document.xml', 'word/media/new.jpg', 'word/_rels/extra.rels']);
    expect(out.entries.get('word/media/new.jpg')).toEqual(PNG);
  });

  it('leaves the package it was given alone', () => {
    const pkg = readPackage(zipOf({ '[Content_Types].xml': CT_DOCX, 'word/document.xml': DOC }));
    writePackage(pkg, new Map([['word/document.xml', bytesOf(DOC2)], ['word/new.xml', bytesOf('<n/>')]]));
    expect(pkg.order).toEqual(['[Content_Types].xml', 'word/document.xml']);
    expect(partText(pkg, 'word/document.xml')).toBe(DOC);
    expect(pkg.entries.has('word/new.xml')).toBe(false);
  });

  it('writes the same file every time, whenever it is written', () => {
    const pkg = readPackage(zipOf({ '[Content_Types].xml': CT_DOCX, 'word/document.xml': DOC, 'word/media/a.png': PNG }));
    const changed = new Map([['word/document.xml', bytesOf(DOC2)]]);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(2026, 9, 28, 8, 0, 0));
      const first = writePackage(pkg, changed);
      const unchanged = writePackage(pkg, new Map());
      vi.setSystemTime(new Date(2031, 2, 4, 17, 30, 40));
      expect(writePackage(pkg, changed)).toEqual(first);
      expect(writePackage(pkg, new Map())).toEqual(unchanged);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps folder entries and empty parts', () => {
    const pkg = readPackage(zipOf({ 'word/': new Uint8Array(0), 'word/media/': new Uint8Array(0), 'word/empty.xml': '', 'word/document.xml': DOC }));
    const out = readPackage(writePackage(pkg, new Map()));
    expect(out.order).toEqual(['word/', 'word/media/', 'word/empty.xml', 'word/document.xml']);
    expect(out.entries.get('word/empty.xml')).toEqual(new Uint8Array(0));
  });

  it('reads UTF-8 text and writes it back exactly', () => {
    const text = '<t>Š ć đ &amp; "q"\n</t>';
    const pkg = readPackage(zipOf({ 'a.xml': text }));
    expect(partText(pkg, 'a.xml')).toBe(text);
    expect(utf8(bytesOf(text))).toBe(text);
    expect(bytesOf('Š')).toEqual(new Uint8Array([0xc5, 0xa0]));
  });

  it('gives no text for a part that is not there', () => {
    const pkg = readPackage(zipOf({ 'a.xml': '<a/>' }));
    expect(partText(pkg, 'missing.xml')).toBeUndefined();
    expect(partText(pkg, 'A.xml')).toBeUndefined();
  });
});

describe('package limits', () => {
  it('enforces size, entry and uncompressed limits', () => {
    // 20 MB + 1 byte is too large, however little of it is read.
    expect(() => readPackage(new Uint8Array(20 * MIB + 1))).toThrow(FormTooLargeError);
    expect(() => readPackage(new Uint8Array(20 * MIB + 1))).toThrow('This file is too large to be a form (over 20 MB).');
    // 2001 entries is damaged; 2000 is fine.
    expect(() => readPackage(manyParts(2001))).toThrow(DamagedFormError);
    expect(readPackage(manyParts(2000)).order).toHaveLength(2000);
    // A zip bomb: a small file whose one part inflates to more than 100 MB.
    const bomb = zipSync({ 'word/document.xml': [new Uint8Array(100 * MIB + 1), { level: 1 }] });
    expect(bomb.length).toBeLessThan(MIB);
    expect(() => readPackage(bomb)).toThrow(DamagedFormError);
  });

  it('allows exactly 20 MB and refuses over it before looking inside', () => {
    // Not a zip, so the size is allowed and the file is reported as damaged instead.
    expect(() => readPackage(new Uint8Array(20 * MIB))).toThrow(DamagedFormError);
  });

  it('adds up the sizes of all parts for the 100 MB limit', () => {
    const both: Zippable = { 'a.bin': [new Uint8Array(51 * MIB), { level: 1 }], 'b.bin': [new Uint8Array(51 * MIB), { level: 1 }] };
    expect(() => readPackage(zipSync(both))).toThrow(DamagedFormError);
    const half = zipSync({ 'a.bin': [new Uint8Array(51 * MIB), { level: 1 }] });
    expect(readPackage(half).entries.get('a.bin')!.length).toBe(51 * MIB);
  });

  it('refuses bytes that are not a readable zip', () => {
    expect(() => readPackage(new Uint8Array(0))).toThrow(DamagedFormError);
    expect(() => readPackage(bytesOf('%PDF-1.4'))).toThrow(DamagedFormError);
    expect(() => readPackage(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toThrow(DamagedFormError);
    const zip = zipOf({ 'word/document.xml': DOC, 'word/other.xml': DOC2 });
    expect(() => readPackage(zip.subarray(0, zip.length - 10))).toThrow(DamagedFormError);
  });

  it('refuses a package that lists one part name twice', () => {
    // Same-length names, so the local header and the directory entry of the second part can be renamed in place.
    const duplicated = renamed(zipOf({ 'word/a.xml': '<a/>', 'word/b.xml': '<b/>' }), 'word/b.xml', 'word/a.xml');
    expect(() => readPackage(duplicated)).toThrow(DamagedFormError);
  });
});

describe('sniffFormat', () => {
  it('sniffs kinds and refuses old, macro and foreign files', () => {
    expect(sniffFormat('a.dotx', zipOf({ '[Content_Types].xml': CT_DOTX, 'word/document.xml': DOC }))).toBe('dotx');
    expect(() => sniffFormat('a.doc', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toThrow(OldFormatError);
    expect(() => sniffFormat('a.docx', zipOf({ '[Content_Types].xml': CT_DOCM, 'word/document.xml': DOC }))).toThrow(MacroFileError);
    expect(() => sniffFormat('a.pdf', bytesOf('%PDF-1.4'))).toThrow(NotAFormError);
  });

  it('reads the kind from the main part, not from the file name', () => {
    const docx = zipOf({ '[Content_Types].xml': CT_DOCX, 'word/document.xml': DOC });
    const xlsx = zipOf({ '[Content_Types].xml': CT_XLSX, 'xl/workbook.xml': WORKBOOK });
    expect(sniffFormat('form.docx', docx)).toBe('docx');
    expect(sniffFormat('form.xlsx', xlsx)).toBe('xlsx');
    expect(sniffFormat('renamed.xlsx', docx)).toBe('docx');
    expect(sniffFormat('renamed.docx', xlsx)).toBe('xlsx');
    expect(sniffFormat('', docx)).toBe('docx');
  });

  it('is not misled by the order or spelling of the content types', () => {
    const types = `<Types xmlns="${TYPES_NS}"><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`
      + `<Override PartName="/word/document.xml" ContentType="${DOCX_MAIN.toUpperCase()}"/></Types>`;
    expect(sniffFormat('a.docx', zipOf({ '[Content_Types].xml': types, 'word/document.xml': DOC, 'word/styles.xml': '<s/>' }))).toBe('docx');
  });

  it('refuses the old binary formats by their magic, whatever the file is called', () => {
    const cfb = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    for (const name of ['old.doc', 'old.xls', 'old.docx', 'old.xlsx', '']) expect(() => sniffFormat(name, cfb), name).toThrow(OldFormatError);
  });

  it('refuses macro-enabled files by content type, by a VBA project part, and by file name', () => {
    const word = { 'word/document.xml': DOC };
    expect(() => sniffFormat('a.dotx', zipOf({ '[Content_Types].xml': contentTypes('word/document.xml', DOTM_MAIN), ...word }))).toThrow(MacroFileError);
    expect(() => sniffFormat('a.xlsx', zipOf({ '[Content_Types].xml': contentTypes('xl/workbook.xml', XLSM_MAIN), 'xl/workbook.xml': WORKBOOK }))).toThrow(MacroFileError);
    // An ordinary main part with a macro project beside it.
    const vba = contentTypes('word/document.xml', DOCX_MAIN, '<Override PartName="/word/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/>');
    expect(() => sniffFormat('a.docx', zipOf({ '[Content_Types].xml': vba, ...word, 'word/vbaProject.bin': PNG }))).toThrow(MacroFileError);
    // The project part by name alone, declared by a Default extension that says nothing about macros.
    const bare = zipOf({ '[Content_Types].xml': CT_DOCX, ...word, 'xl/VBAProject.BIN': PNG });
    expect(() => sniffFormat('a.docx', bare)).toThrow(MacroFileError);
    // A macro-enabled name on a package that says nothing about macros is still refused.
    for (const name of ['a.docm', 'a.xlsm', 'a.dotm', 'A.XLSM']) {
      expect(() => sniffFormat(name, zipOf({ '[Content_Types].xml': CT_DOCX, ...word })), name).toThrow(MacroFileError);
    }
  });

  it('still says macros when the main part of a macro file is missing', () => {
    // That must not turn the macro message into the generic one.
    expect(() => sniffFormat('a.docm', zipOf({ '[Content_Types].xml': CT_DOCM }))).toThrow(MacroFileError);
  });

  it('refuses anything else as not a form', () => {
    expect(() => sniffFormat('a.pdf', bytesOf('%PDF-1.4'))).toThrow(NotAFormError);
    expect(() => sniffFormat('a.txt', new Uint8Array(0))).toThrow(NotAFormError);
    expect(() => sniffFormat('a.docx', new Uint8Array([0x50, 0x4b]))).toThrow(NotAFormError);
    // An empty zip starts PK 05 06, not PK 03 04.
    expect(() => sniffFormat('a.docx', zipSync({}))).toThrow(NotAFormError);
    // A zip with no content types, and one that is some other kind of package.
    expect(() => sniffFormat('a.docx', zipOf({ 'word/document.xml': DOC }))).toThrow(NotAFormError);
    expect(() => sniffFormat('a.pptx', zipOf({ '[Content_Types].xml': contentTypes('ppt/presentation.xml', PPTX_MAIN), 'ppt/presentation.xml': '<p/>' }))).toThrow(NotAFormError);
    // Content types that name no main part at all.
    expect(() => sniffFormat('a.docx', zipOf({ '[Content_Types].xml': `<Types xmlns="${TYPES_NS}"/>`, 'word/document.xml': DOC }))).toThrow(NotAFormError);
  });

  it('refuses a package whose main part is not in the zip', () => {
    expect(() => sniffFormat('a.docx', zipOf({ '[Content_Types].xml': CT_DOCX }))).toThrow(NotAFormError);
    expect(() => sniffFormat('a.xlsx', zipOf({ '[Content_Types].xml': CT_XLSX, 'word/document.xml': DOC }))).toThrow(NotAFormError);
    expect(() => sniffFormat('a.dotx', zipOf({ '[Content_Types].xml': CT_DOTX }))).toThrow(NotAFormError);
  });

  it('says damaged when the zip, or its content types, cannot be read', () => {
    expect(() => sniffFormat('a.docx', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6]))).toThrow(DamagedFormError);
    expect(() => sniffFormat('a.docx', zipOf({ '[Content_Types].xml': 'not xml', 'word/document.xml': DOC }))).toThrow(DamagedFormError);
    expect(() => sniffFormat('a.docx', zipOf({ '[Content_Types].xml': `<!DOCTYPE Types><Types xmlns="${TYPES_NS}"/>`, 'word/document.xml': DOC }))).toThrow(DamagedFormError);
  });

  it('applies the size and entry limits before it opens anything', () => {
    expect(() => sniffFormat('a.docx', new Uint8Array(20 * MIB + 1))).toThrow(FormTooLargeError);
    const crowded = zipOf({ '[Content_Types].xml': CT_DOCX, 'word/document.xml': DOC, ...Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`p${i}.xml`, ''])) });
    expect(() => sniffFormat('a.docx', crowded)).toThrow(DamagedFormError);
  });
});

describe('form file errors', () => {
  it('say exactly what the person should do', () => {
    const cases: [FormFileError, string, string][] = [
      [new OldFormatError(), 'OldFormatError', 'This is an old Word or Excel format. Open it once in Word or Excel and save it as .docx or .xlsx, then import that file.'],
      [new MacroFileError(), 'MacroFileError', "Files with macros can't be imported. Save a copy without macros (.docx or .xlsx) and import that."],
      [new NotAFormError(), 'NotAFormError', "This file isn't a Word or Excel form."],
      [new FormTooLargeError(), 'FormTooLargeError', 'This file is too large to be a form (over 20 MB).'],
      [new DamagedFormError(), 'DamagedFormError', "This file couldn't be read. It may be damaged."],
    ];
    for (const [error, name, message] of cases) {
      expect(error.message).toBe(message);
      expect(error.name).toBe(name);
      expect(error).toBeInstanceOf(FormFileError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('are told apart by class', () => {
    expect(new OldFormatError()).not.toBeInstanceOf(MacroFileError);
    expect(new DamagedFormError()).not.toBeInstanceOf(NotAFormError);
  });
});
