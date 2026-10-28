import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeFormFixtures } from '../../../e2e/fixtures/makeForms';
import { readPackage, sniffFormat, utf8 } from '../package';
import type { FormKind } from '../package';
import { parseXml } from '../xml';
import { contentControlsDocx, oddLayoutsDocx, permitDocx, toolboxTalkDocx, weeklyJobsDotx } from './wordFixtures';
import { conditionListXlsx, dayGridXlsx, inventoryXlsx, matrixXlsx } from './excelFixtures';
import { zipOf } from './zip';

const FIXTURES: { name: string; fileName: string; kind: FormKind; build: () => Uint8Array }[] = [
  { name: 'toolboxTalkDocx', fileName: 'toolbox.docx', kind: 'docx', build: () => toolboxTalkDocx() },
  { name: 'permitDocx', fileName: 'permit.docx', kind: 'docx', build: () => permitDocx() },
  { name: 'weeklyJobsDotx', fileName: 'weekly.dotx', kind: 'dotx', build: () => weeklyJobsDotx() },
  { name: 'contentControlsDocx', fileName: 'controls.docx', kind: 'docx', build: () => contentControlsDocx() },
  { name: 'oddLayoutsDocx', fileName: 'odd.docx', kind: 'docx', build: () => oddLayoutsDocx() },
  { name: 'inventoryXlsx', fileName: 'inventory.xlsx', kind: 'xlsx', build: () => inventoryXlsx() },
  { name: 'dayGridXlsx', fileName: 'daygrid.xlsx', kind: 'xlsx', build: () => dayGridXlsx() },
  { name: 'matrixXlsx', fileName: 'matrix.xlsx', kind: 'xlsx', build: () => matrixXlsx() },
  { name: 'conditionListXlsx', fileName: 'conditions.xlsx', kind: 'xlsx', build: () => conditionListXlsx() },
];

describe.each(FIXTURES)('$name', ({ fileName, kind, build }) => {
  it('is a package that readPackage opens and sniffFormat names', () => {
    const bytes = build();
    expect(readPackage(bytes).entries.size).toBeGreaterThan(4);
    expect(sniffFormat(fileName, bytes)).toBe(kind);
  });

  it('has only well-formed XML parts', () => {
    const pkg = readPackage(build());
    const xmlParts = pkg.order.filter((path) => /\.(?:xml|rels)$/.test(path));
    expect(xmlParts.length).toBeGreaterThan(3);
    for (const path of xmlParts) expect(() => parseXml(utf8(pkg.entries.get(path)!)), path).not.toThrow();
  });
});

const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

/** The path a relationship's target names, from the part that owns the `.rels` file (`''` for the package itself). */
function resolveTarget(owner: string, target: string): string {
  const base = owner === '' ? [] : owner.split('/').slice(0, -1);
  for (const step of target.split('/')) {
    if (step === '..') base.pop();
    else if (step !== '.') base.push(step);
  }
  return base.join('/');
}

describe.each(FIXTURES)('$name as an Office package', ({ build }) => {
  const pkg = readPackage(build());

  it('has every part that a relationship points to, and the owner of every .rels', () => {
    const relsParts = pkg.order.filter((path) => path.endsWith('.rels'));
    expect(relsParts).toContain('_rels/.rels');
    for (const rels of relsParts) {
      const owner = rels === '_rels/.rels' ? '' : rels.replace('_rels/', '').replace(/\.rels$/, '');
      if (owner) expect(pkg.entries.has(owner), `${rels} belongs to ${owner}`).toBe(true);
      const doc = parseXml(utf8(pkg.entries.get(rels)!));
      const ids = new Set<string>();
      for (const rel of Array.from(doc.getElementsByTagNameNS(RELS_NS, 'Relationship'))) {
        const id = rel.getAttribute('Id')!;
        expect(ids.has(id), `${rels} repeats ${id}`).toBe(false);
        ids.add(id);
        const target = resolveTarget(owner, rel.getAttribute('Target')!);
        expect(pkg.entries.has(target), `${rels} ${id} -> ${target}`).toBe(true);
      }
    }
  });

  it('gives every part a content type, and every Override names a part that is there', () => {
    const types = parseXml(utf8(pkg.entries.get('[Content_Types].xml')!));
    const defaults = new Set(Array.from(types.getElementsByTagNameNS(TYPES_NS, 'Default')).map((d) => d.getAttribute('Extension')));
    const overrides = new Set(Array.from(types.getElementsByTagNameNS(TYPES_NS, 'Override')).map((o) => o.getAttribute('PartName')!.slice(1)));
    for (const path of pkg.order) {
      if (path === '[Content_Types].xml') continue;
      expect(overrides.has(path) || defaults.has(path.split('.').pop()!), `${path} has no content type`).toBe(true);
    }
    for (const part of overrides) expect(pkg.entries.has(part), `Override for missing ${part}`).toBe(true);
  });
});

describe('the bytes of a fixture', () => {
  afterEach(() => vi.useRealTimers());

  /** The zip entries carry a time, so two builds made seconds apart must not differ by it: the clock is moved on between them. */
  it.each([...FIXTURES.map(({ name, build }) => [name, build] as const), ['zipOf', () => zipOf({ 'a.xml': '<a/>' })] as const])(
    '%s does not depend on the time it is built',
    (_name, build) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0));
      const first = build();
      vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 7));
      expect(build()).toEqual(first);
    },
  );
});

describe('inventoryXlsx', () => {
  it('has 120 prefilled item rows below the header at row 8', () => {
    const book = XLSX.read(inventoryXlsx(120), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]!]!, { header: 1, blankrows: true });
    const items = rows.slice(8).filter((row) => typeof row[1] === 'string' && /^Item \d+$/.test(row[1] as string));
    expect(items).toHaveLength(120);
  });
});

describe('the source of the fixtures', () => {
  const sources = import.meta.glob<string>('./*.ts', { query: '?raw', import: 'default', eager: true });
  /** The spaces that look like a space or like nothing: no-break, en, em, thin, ideographic. The en space of an empty FORMTEXT must be a character reference. */
  const UNUSUAL_SPACE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/;

  it('holds no unusual space character: where one is needed it is written as an escape', () => {
    expect(Object.keys(sources)).toContain('./wordXml.ts');
    expect(Object.entries(sources).filter(([, text]) => UNUSUAL_SPACE.test(text)).map(([file]) => file)).toEqual([]);
  });
});

describe('writeFormFixtures', () => {
  const SHEET_RANGES: Record<string, string> = {
    'inventory.xlsx': 'A1:F131', 'daygrid.xlsx': 'A1:N43', 'matrix.xlsx': 'A1:J18', 'conditions.xlsx': 'A1:D108',
  };

  it('writes each fixture to disk, and SheetJS reads the workbooks', async () => {
    const dir = await fs.mkdtemp(`${tmpdir()}/forms-`);
    try {
      const paths = await writeFormFixtures(dir);
      expect(Object.keys(paths)).toEqual([
        'toolbox.docx', 'toolbox-rev01.docx', 'permit.docx', 'weekly.dotx', 'inventory.xlsx', 'daygrid.xlsx', 'matrix.xlsx', 'conditions.xlsx',
      ]);
      for (const [fileName, path] of Object.entries(paths)) {
        const bytes = await fs.readFile(path);
        const kind = sniffFormat(fileName, bytes);
        expect(kind).toBe(fileName.slice(fileName.lastIndexOf('.') + 1));
        if (kind === 'xlsx') {
          const book = XLSX.read(bytes, { type: 'array' });
          expect(book.SheetNames, fileName).toHaveLength(1);
          expect(book.Sheets[book.SheetNames[0]!]!['!ref'], fileName).toBe(SHEET_RANGES[fileName]);
        }
      }
      expect(new Uint8Array(await fs.readFile(paths['toolbox.docx']!))).toEqual(toolboxTalkDocx());
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('writes toolbox-rev01.docx as a later revision of the same form', async () => {
    const dir = await fs.mkdtemp(`${tmpdir()}/forms-`);
    try {
      const paths = await writeFormFixtures(dir);
      const first = readPackage(await fs.readFile(paths['toolbox.docx']!));
      const later = readPackage(await fs.readFile(paths['toolbox-rev01.docx']!));
      expect(utf8(first.entries.get('word/header1.xml')!)).toContain('Form: TST-01');
      expect(utf8(later.entries.get('word/header1.xml')!)).toContain('Form: TST-01');
      expect(utf8(later.entries.get('word/header1.xml')!)).toContain('Revision: 01 / 01.06.2026');
      expect(utf8(later.entries.get('word/document.xml')!)).toContain('Topic:');
      expect(utf8(later.entries.get('word/document.xml')!)).toContain('Location:');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
