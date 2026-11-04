import { afterEach, describe, expect, it, vi } from 'vitest';
import { DamagedFormError } from './errors';
import { parseXml, serializeXml } from './xml';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const WORD_MIN = `${DECLARATION}\r\n<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>`;

afterEach(() => vi.restoreAllMocks());

describe('parseXml', () => {
  it('refuses DOCTYPE', () => expect(() => parseXml('<!DOCTYPE x [<!ENTITY a "b">]><x/>')).toThrow(DamagedFormError));

  it('refuses a DOCTYPE after the declaration and in front of a real Word root', () => {
    expect(() => parseXml(`${DECLARATION}<!DOCTYPE w:document SYSTEM "http://example.invalid/x.dtd"><w:document xmlns:w="${W}"/>`))
      .toThrow(DamagedFormError);
  });

  it('refuses text that is not well-formed XML, each with the damaged-file message', () => {
    const broken: Record<string, string> = {
      empty: '',
      'plain text': 'not xml',
      'mismatched tags': '<a><b></a>',
      'unclosed tag': '<a><b>',
      // xmldom only reports this one at "error" level, and then writes it back as `&amp;nbsp;`, changing the text.
      'undefined entity': '<a>&nbsp;</a>',
      'unbound prefix': '<w:a/>',
      'repeated attribute': '<a x="1" x="2"/>',
      'two root elements': '<a/><b/>',
      'text after the root': '<a/>junk',
      // Reported only as a warning, and repaired to `b="c"` on writing.
      'unquoted attribute': '<a b=c/>',
    };
    for (const [name, text] of Object.entries(broken)) {
      expect(() => parseXml(text), name).toThrow(DamagedFormError);
      expect(() => parseXml(text), name).toThrow("This file couldn't be read. It may be damaged.");
    }
  });

  it('stays quiet on bad input, so a refused file leaves nothing in the console', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const text of ['<a>&nbsp;</a>', '<a b=c/>', '<a><b></a>', '']) expect(() => parseXml(text)).toThrow(DamagedFormError);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads namespaces, attributes and text', () => {
    const doc = parseXml(WORD_MIN);
    const root = doc.documentElement!;
    expect(root.localName).toBe('document');
    expect(root.namespaceURI).toBe(W);
    expect(doc.getElementsByTagNameNS(W, 't')[0]!.textContent).toBe('Hello');
  });

  it('accepts a replacement character in the text, which is only a warning to the parser', () => {
    expect(parseXml('<a>x�y</a>').documentElement!.textContent).toBe('x�y');
  });
});

describe('serializeXml', () => {
  it('serialises Word XML with the declaration and namespaces kept', () => {
    const s = serializeXml(parseXml(WORD_MIN));
    expect(s.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')).toBe(true);
    expect(s).toContain('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"');
  });

  it('adds no declaration when the part had none', () => {
    expect(serializeXml(parseXml('<a><b/></a>'))).toBe('<a><b/></a>');
  });

  it('writes back what it read: escapes, diacritics and a space-preserving run', () => {
    const text = '<w:t xml:space="preserve"> Š ć đ &amp; &lt; &gt; "q" </w:t>';
    const xml = `${DECLARATION}\n<w:document xmlns:w="${W}"><w:body>${text}</w:body></w:document>`;
    const once = serializeXml(parseXml(xml));
    expect(once).toContain('<w:t xml:space="preserve"> Š ć đ &amp; &lt; ');
    expect(parseXml(once).getElementsByTagNameNS(W, 't')[0]!.textContent).toBe(' Š ć đ & < > "q" ');
    expect(serializeXml(parseXml(once))).toBe(once);
  });

  it('keeps an unrelated prefix declared on the root, as Word writes mc:Ignorable', () => {
    const mc = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
    const xml = `<w:document xmlns:w="${W}" xmlns:mc="${mc}" xmlns:w14="http://example.invalid/w14" mc:Ignorable="w14"/>`;
    const s = serializeXml(parseXml(xml));
    expect(s).toContain(`xmlns:mc="${mc}"`);
    expect(s).toContain('xmlns:w14="http://example.invalid/w14"');
    expect(s).toContain('mc:Ignorable="w14"');
  });
});
