import { describe, expect, it } from 'vitest';
import { partText, readPackage, writePackage } from '../package';
import type { Package } from '../package';
import { Controls, p, row, run, table, wordPackage } from '../testing/wordXml';
import { weeklyJobsDotx } from '../testing/wordFixtures';
import { CONTENT_TYPE, REL_TYPE } from '../testing/zip';
import type { DraftValues, FieldDef, FormSchema } from '../types';
import { parseXml } from '../xml';
import { detectWord } from './detect';
import { locateWord } from './address';
import { readWordValues } from './read';
import { FormWriteError, extraRowsOf, writeWord } from './write';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MAIN = 'word/document.xml';
const RELS = 'word/_rels/document.xml.rels';
const TYPES = '[Content_Types].xml';

/**
 * A tiny JPEG for the tests: the start of image, a comment that tells it from another, a baseline frame header that
 * gives its size (the part of the format the writer reads) and the end of image. It is not a picture a viewer can
 * show; the writer never decodes one.
 */
function jpegOf(width: number, height: number, tag: string): Uint8Array {
  const comment = Array.from(new TextEncoder().encode(tag));
  const be = (n: number) => [n >> 8, n & 0xff];
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xfe, ...be(comment.length + 2), ...comment,
    0xff, 0xc0, ...be(17), 8, ...be(height), ...be(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xd9,
  ]);
}

const all = (el: Document | Element, ns: string, name: string): Element[] => Array.from(el.getElementsByTagNameNS(ns, name));
const mainDoc = (pkg: Package): Document => parseXml(partText(pkg, MAIN)!);
const written = (pkg: Package, changed: Map<string, Uint8Array>): Package => readPackage(writePackage(pkg, changed));
const values = (fields: DraftValues['fields'] = {}, rows: DraftValues['rows'] = {}): DraftValues => ({ fields, rows });

function weekly(): { pkg: Package; s: FormSchema; pictures: FieldDef[]; groupId: string } {
  const pkg = readPackage(weeklyJobsDotx());
  const s = detectWord(pkg, 'dotx', 'w.dotx');
  const group = s.rowGroups.find((g) => g.label === 'Pictures')!;
  return { pkg, s, pictures: group.columns.filter((c) => c.kind === 'picture'), groupId: group.id };
}

/** The picture controls of the Pictures table in document order. */
const controls = (pkg: Package): Element[] => all(mainDoc(pkg), W, 'sdt').filter((sdt) => {
  const pr = Array.from(sdt.childNodes).find((n) => n.nodeType === 1 && (n as Element).localName === 'sdtPr') as Element | undefined;
  return !!pr && all(pr, W, 'picture').length > 0;
});
const embed = (sdt: Element): string | null => all(sdt, A, 'blip')[0].getAttributeNS(R, 'embed');
const plainRelations = (pkg: Package): Map<string, { type: string; target: string }> => {
  const out = new Map<string, { type: string; target: string }>();
  for (const rel of Array.from(parseXml(partText(pkg, RELS)!).getElementsByTagName('Relationship'))) {
    out.set(rel.getAttribute('Id')!, { type: rel.getAttribute('Type')!, target: rel.getAttribute('Target')! });
  }
  return out;
};

describe('writeWord pictures', () => {
  it('puts two photos into picture controls: media parts, relationships, content type, blips (the brief\'s test)', () => {
    const { pkg, s, pictures, groupId } = weekly();
    expect(pictures).toHaveLength(3);
    const photos = { photoA: jpegOf(1600, 1200, 'A'), photoB: jpegOf(1600, 1200, 'B') };
    const vals = values({}, { [groupId]: [{ [pictures[0].id]: 'photoA', [pictures[2].id]: 'photoB' }] });
    const changed = writeWord(pkg, s, vals, { photos });
    const out = written(pkg, changed);

    expect([...changed.keys()].sort()).toEqual([TYPES, MAIN, RELS, 'word/media/mp-1.jpeg', 'word/media/mp-2.jpeg'].sort());
    expect(out.entries.get('word/media/mp-1.jpeg')).toEqual(photos.photoA);
    expect(out.entries.get('word/media/mp-2.jpeg')).toEqual(photos.photoB);
    // Everything else is the template's own bytes, in the template's order, with the new parts at the end.
    for (const part of pkg.order) if (!changed.has(part)) expect(out.entries.get(part)).toEqual(pkg.entries.get(part));
    expect(out.order).toEqual([...pkg.order, 'word/media/mp-1.jpeg', 'word/media/mp-2.jpeg']);

    const rels = plainRelations(out);
    expect(rels.get('rIdMp1')).toEqual({ type: REL_TYPE.image, target: 'media/mp-1.jpeg' });
    expect(rels.get('rIdMp2')).toEqual({ type: REL_TYPE.image, target: 'media/mp-2.jpeg' });
    // The placeholder and every relationship the template had stay.
    for (const [id, rel] of plainRelations(pkg)) expect(rels.get(id)).toEqual(rel);
    expect(partText(out, RELS)!.startsWith(partText(pkg, RELS)!.slice(0, partText(pkg, RELS)!.indexOf('</Relationships>')))).toBe(true);

    const types = partText(out, TYPES)!;
    expect(types).toContain('<Default Extension="jpeg" ContentType="image/jpeg"/>');
    expect(types).toContain(`PartName="/word/document.xml" ContentType="${CONTENT_TYPE.docx}"`);

    const [first, second, third] = controls(out);
    expect([embed(first), embed(second), embed(third)]).toEqual(['rIdMp1', 'rId3', 'rIdMp2']);
    expect(all(first, W, 'showingPlcHdr')).toHaveLength(0);
    expect(all(second, W, 'showingPlcHdr')).toHaveLength(1); // not given a photo: still its placeholder
    expect(all(third, W, 'showingPlcHdr')).toHaveLength(0);

    const back = readWordValues(out, s);
    const row0 = back.rows[groupId][0];
    expect(row0[pictures[0].id]).toBe('word/media/mp-1.jpeg');
    expect(row0[pictures[1].id]).toBeNull();
    expect(row0[pictures[2].id]).toBe('word/media/mp-2.jpeg');
    // The template reads as nothing filled.
    expect(readWordValues(pkg, s).rows[groupId][0][pictures[0].id]).toBeNull();
  });

  it('gives the same bytes for the same inputs', () => {
    const { pkg, s, pictures, groupId } = weekly();
    const photos = { a: jpegOf(800, 600, 'A') };
    const vals = values({}, { [groupId]: [{ [pictures[0].id]: 'a' }] });
    const one = writePackage(pkg, writeWord(pkg, s, vals, { photos }));
    const two = writePackage(pkg, writeWord(pkg, s, vals, { photos }));
    expect(one).toEqual(two);
  });

  it('keeps the frame for a photo of its shape and fits any other shape inside it, without distortion', () => {
    const { pkg, s, pictures, groupId } = weekly();
    const photos = { wide: jpegOf(4000, 3000, 'w'), tall: jpegOf(3000, 4000, 'h'), flat: jpegOf(4000, 1000, 'f') };
    const vals = values({}, { [groupId]: [{ [pictures[0].id]: 'wide', [pictures[1].id]: 'tall', [pictures[2].id]: 'flat' }] });
    const out = written(pkg, writeWord(pkg, s, vals, { photos }));
    const sizes = controls(out).map((sdt) => {
      const extent = all(sdt, WP, 'extent')[0];
      const ext = all(all(sdt, A, 'xfrm')[0], A, 'ext')[0];
      expect(ext.getAttribute('cx')).toBe(extent.getAttribute('cx')); // the picture's own size follows the frame
      expect(ext.getAttribute('cy')).toBe(extent.getAttribute('cy'));
      return [Number(extent.getAttribute('cx')), Number(extent.getAttribute('cy'))];
    });
    expect(sizes).toEqual([[1800000, 1350000], [1012500, 1350000], [1800000, 450000]]);
  });

  it('keeps the frame when the JPEG\'s size cannot be read', () => {
    const { pkg, s, pictures, groupId } = weekly();
    const photos = { odd: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]) };
    const out = written(pkg, writeWord(pkg, s, values({}, { [groupId]: [{ [pictures[0].id]: 'odd' }] }), { photos }));
    const extent = all(controls(out)[0], WP, 'extent')[0];
    expect([extent.getAttribute('cx'), extent.getAttribute('cy')]).toEqual(['1800000', '1350000']);
    expect(embed(controls(out)[0])).toBe('rIdMp1');
  });

  it('changes no element count, so no other stored address moves (R12)', () => {
    const { pkg, s, pictures, groupId } = weekly();
    // Every element with the number of its element children, by path. Only w:showingPlcHdr is allowed to go.
    const skeleton = (doc: Document, skip: string[]): string[] => {
      const out: string[] = [];
      const visit = (el: Element, path: string): void => {
        const kids = (Array.from(el.childNodes).filter((n) => n.nodeType === 1) as Element[]).filter((k) => !skip.includes(k.localName));
        out.push(`${path}/${el.localName}:${kids.length}`);
        kids.forEach((k, i) => visit(k, `${path}/${i}`));
      };
      visit(doc.documentElement, '');
      return out;
    };
    const photos = { a: jpegOf(800, 600, 'A') };
    const out = written(pkg, writeWord(pkg, s, values({}, { [groupId]: [{ [pictures[0].id]: 'a', [pictures[1].id]: 'a' }] }), { photos }));
    expect(all(mainDoc(out), W, 'showingPlcHdr')).toHaveLength(all(mainDoc(pkg), W, 'showingPlcHdr').length - 2);
    expect(skeleton(mainDoc(out), ['showingPlcHdr'])).toEqual(skeleton(mainDoc(pkg), ['showingPlcHdr']));
    // Every stored address still resolves.
    expect([...locateWord(mainDoc(out), MAIN, s).keys()].sort()).toEqual([...locateWord(mainDoc(pkg), MAIN, s).keys()].sort());
  });

  it('drops the prompt style from the photo\'s run and sets the picture name', () => {
    const { pkg, s, pictures, groupId } = weekly();
    const styled = partText(pkg, MAIN)!.split('<w:rPr><w:noProof/></w:rPr>').join('<w:rPr><w:rStyle w:val="PlaceholderText"/><w:noProof/></w:rPr>');
    pkg.entries.set(MAIN, new TextEncoder().encode(styled));
    const out = written(pkg, writeWord(pkg, s, values({}, { [groupId]: [{ [pictures[0].id]: 'a' }] }), { photos: { a: jpegOf(8, 6, 'A') } }));
    const styles = controls(out).map((sdt) => all(sdt, W, 'rStyle').length);
    expect(styles).toEqual([0, 1, 1]);
    expect(all(controls(out)[0], 'http://schemas.openxmlformats.org/drawingml/2006/picture', 'cNvPr')[0].getAttribute('name')).toBe('mp-1.jpeg');
  });

  it('shares one media part between controls given the same photo', () => {
    const { pkg, s, pictures, groupId } = weekly();
    const photos = { same: jpegOf(800, 600, 'S') };
    const changed = writeWord(pkg, s, values({}, { [groupId]: [{ [pictures[0].id]: 'same', [pictures[2].id]: 'same' }] }), { photos });
    expect([...changed.keys()].filter((k) => k.startsWith('word/media/'))).toEqual(['word/media/mp-1.jpeg']);
    const [first, , third] = controls(written(pkg, changed));
    expect(embed(first)).toBe('rIdMp1');
    expect(embed(third)).toBe('rIdMp1');
  });

  it('clones the item for more photos than it holds; each photo has its own relationship and drawing id', () => {
    const { pkg, s, pictures, groupId } = weekly();
    const photos = { a: jpegOf(800, 600, 'A'), b: jpegOf(800, 600, 'B'), c: jpegOf(800, 600, 'C') };
    const vals = values({}, { [groupId]: [{ [pictures[0].id]: 'a' }, { [pictures[0].id]: 'b', [pictures[1].id]: 'c' }] });
    expect(extraRowsOf(s, vals)).toEqual({ [groupId]: 1 });
    const out = written(pkg, writeWord(pkg, s, vals, { photos }));
    const found = controls(out);
    expect(found).toHaveLength(6);
    expect(found.map(embed)).toEqual(['rIdMp1', 'rId3', 'rId3', 'rIdMp2', 'rIdMp3', 'rId3']);
    expect(found.map((sdt) => all(sdt, W, 'showingPlcHdr').length)).toEqual([0, 1, 1, 0, 0, 1]);
    const ids = all(mainDoc(out), WP, 'docPr').map((d) => d.getAttribute('id'));
    expect(new Set(ids).size).toBe(ids.length);
    const sdtIds = all(mainDoc(out), W, 'id').filter((e) => (e.parentNode as Element).localName === 'sdtPr').map((e) => e.getAttributeNS(W, 'val'));
    expect(new Set(sdtIds).size).toBe(sdtIds.length);

    const back = readWordValues(out, s, { [groupId]: 1 }).rows[groupId];
    expect(back.map((r) => [r[pictures[0].id], r[pictures[1].id], r[pictures[2].id]])).toEqual([
      ['word/media/mp-1.jpeg', null, null],
      ['word/media/mp-2.jpeg', 'word/media/mp-3.jpeg', null],
    ]);
  });

  it('writes a photo into a picture field outside a table', () => {
    const c = new Controls();
    const widths = [3000, 6638];
    const body = table(widths, [row(widths, ['Vessel:', { content: p(c.formText()) }]), row(widths, ['Site photo', { content: c.pictureControl({ alias: 'Site photo', tag: 'site', rId: 'rId3', cx: 1800000, cy: 1350000 }) + p(run('')) }])]);
    const pkg = readPackage(wordPackage({ kind: 'docx', bodyUsesImage: true, header: p(), body }));
    const s = detectWord(pkg, 'docx', 'site.docx');
    const photo = s.fields.find((f) => f.kind === 'picture');
    expect(photo?.label).toBe('Site photo');
    const out = written(pkg, writeWord(pkg, s, values({ [photo!.id]: 'shot' }), { photos: { shot: jpegOf(640, 480, 's') } }));
    expect(readWordValues(out, s).fields[photo!.id]).toBe('word/media/mp-1.jpeg');
    expect(readWordValues(pkg, s).fields[photo!.id]).toBeNull();
  });

  it('numbers the new relationship and part past names already in use', () => {
    const { pkg, s, pictures, groupId } = weekly();
    const rels = partText(pkg, RELS)!.replace('</Relationships>', `<Relationship Id="rIdMp1" Type="${REL_TYPE.image}" Target="media/other.png"/></Relationships>`);
    pkg.entries.set(RELS, new TextEncoder().encode(rels));
    pkg.entries.set('word/media/mp-2.jpeg', Uint8Array.from([1]));
    pkg.order.push('word/media/mp-2.jpeg');
    const photos = { a: jpegOf(800, 600, 'A') };
    const changed = writeWord(pkg, s, values({}, { [groupId]: [{ [pictures[0].id]: 'a' }] }), { photos });
    expect(changed.has('word/media/mp-3.jpeg')).toBe(true);
    expect(changed.has('word/media/mp-2.jpeg')).toBe(false);
    const out = written(pkg, changed);
    expect(plainRelations(out).get('rIdMp3')?.target).toBe('media/mp-3.jpeg');
    expect(plainRelations(out).get('rIdMp1')?.target).toBe('media/other.png');
  });

  it('adds no Default for jpeg when the package already has one', () => {
    const { pkg, s, pictures, groupId } = weekly();
    const types = partText(pkg, TYPES)!.replace('<Default Extension="png"', '<Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png"');
    pkg.entries.set(TYPES, new TextEncoder().encode(types));
    const changed = writeWord(pkg, s, values({}, { [groupId]: [{ [pictures[0].id]: 'a' }] }), { photos: { a: jpegOf(8, 6, 'A') } });
    const out = partText(written(pkg, changed), TYPES)!;
    expect(out.match(/Extension="jpeg"/g)).toHaveLength(1);
  });

  it('refuses a photo id that has no photo, naming the field; writes nothing for a blank value', () => {
    const { pkg, s, pictures, groupId } = weekly();
    const vals = values({}, { [groupId]: [{ [pictures[1].id]: 'gone' }] });
    expect(() => writeWord(pkg, s, vals, { photos: { other: jpegOf(8, 6, 'o') } })).toThrow(FormWriteError);
    expect(() => writeWord(pkg, s, vals, { photos: { other: jpegOf(8, 6, 'o') } })).toThrow(new RegExp(`${pictures[1].id}.*gone|gone.*${pictures[1].id}`));
    expect(() => writeWord(pkg, s, values({}, { [groupId]: [{ [pictures[0].id]: 'toString' }] }), { photos: {} })).toThrow(FormWriteError);
    expect(() => writeWord(pkg, s, values({}, { [groupId]: [{ [pictures[0].id]: 'png' }] }), { photos: { png: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]) } })).toThrow(/JPEG/);

    const blank = writeWord(pkg, s, values({}, { [groupId]: [{ [pictures[0].id]: null, [pictures[1].id]: '' }] }), { photos: {} });
    expect([...blank.keys()]).toEqual([TYPES]); // only the .dotx becoming a .docx
  });
});
