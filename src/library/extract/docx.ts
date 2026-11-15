import { strFromU8 } from 'fflate';
import { parseXml } from '../../forms/xml';
import { DOCX_XML_MAX_BYTES, unzipLimited } from '../zipLimits';
import type { Extracted } from './index';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** The text of `w:t` elements, one line per paragraph (a table cell holds paragraphs, so it gets its own line too). */
export function extractDocx(data: ArrayBuffer): Extracted {
  try {
    const files = unzipLimited(new Uint8Array(data), DOCX_XML_MAX_BYTES, (f) => f.name === 'word/document.xml');
    const entry = files['word/document.xml'];
    if (!entry) throw new Error('no document.xml');
    const doc = parseXml(strFromU8(entry));
    const lines: string[] = [];
    for (const p of Array.from(doc.getElementsByTagNameNS(W_NS, 'p'))) {
      let line = '';
      for (const t of Array.from(p.getElementsByTagNameNS(W_NS, 't'))) line += t.textContent ?? '';
      lines.push(line);
    }
    const text = lines.join('\n').trim();
    return { textStatus: text ? 'indexed' : 'no-text', parts: text ? [{ part: 1, label: 'Document', text }] : [] };
  } catch {
    return { textStatus: 'failed', textError: 'Damaged document', parts: [] };
  }
}
