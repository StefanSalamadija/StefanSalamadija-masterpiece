import { strFromU8 } from 'fflate';
import { DOCX_XML_MAX_BYTES, unzipLimited } from './zipLimits';
import { parseXml } from '../forms/xml';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** What the viewer draws for a Word document. A heading's `level` is the HTML level: Heading1 to 3 become h2 to h4. */
export type DocxBlock =
  | { type: 'p'; text: string; level?: 2 | 3 | 4 }
  | { type: 'table'; rows: string[][] };

function children(el: Element, name: string): Element[] {
  return Array.from(el.children).filter((c) => c.namespaceURI === W_NS && c.localName === name);
}

/** The text of one paragraph: its runs' text, with a tab or a line break as a space. */
function paragraphText(p: Element): string {
  let out = '';
  const walk = (node: Element): void => {
    for (const c of Array.from(node.children)) {
      if (c.namespaceURI !== W_NS) continue;
      if (c.localName === 't') out += c.textContent ?? '';
      else if (c.localName === 'tab' || c.localName === 'br') out += ' ';
      else walk(c);
    }
  };
  walk(p);
  return out;
}

function headingLevel(p: Element): 2 | 3 | 4 | undefined {
  const style = children(p, 'pPr')[0] && children(children(p, 'pPr')[0], 'pStyle')[0];
  const match = /^Heading([1-3])$/.exec(style?.getAttributeNS(W_NS, 'val') ?? '');
  return match ? ((Number(match[1]) + 1) as 2 | 3 | 4) : undefined;
}

/** Reads `word/document.xml` into paragraphs, headings and tables, in order. Throws when it is not a Word document. */
export function docxBlocks(data: ArrayBuffer): DocxBlock[] {
  const files = unzipLimited(new Uint8Array(data), DOCX_XML_MAX_BYTES, (f) => f.name === 'word/document.xml');
  const entry = files['word/document.xml'];
  if (!entry) throw new Error('no document.xml');
  const body = parseXml(strFromU8(entry)).getElementsByTagNameNS(W_NS, 'body')[0];
  if (!body) throw new Error('no body');
  const blocks: DocxBlock[] = [];
  for (const el of Array.from(body.children)) {
    if (el.namespaceURI !== W_NS) continue;
    if (el.localName === 'p') {
      const level = headingLevel(el);
      blocks.push({ type: 'p', text: paragraphText(el), ...(level ? { level } : {}) });
    } else if (el.localName === 'tbl') {
      const rows = children(el, 'tr').map((tr) => children(tr, 'tc').map((tc) => children(tc, 'p').map(paragraphText).join('\n')));
      blocks.push({ type: 'table', rows });
    }
  }
  return blocks;
}
