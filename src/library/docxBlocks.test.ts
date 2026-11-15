import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { docxBlocks } from './docxBlocks';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docx = (body: string): ArrayBuffer => {
  const zip = zipSync({ 'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${NS}><w:body>${body}</w:body></w:document>`) });
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
};
const p = (t: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${t}</w:t></w:r></w:p>`;

describe('docxBlocks', () => {
  it('reads paragraphs, headings (Heading1-3 become h2-h4) and tables in order', () => {
    const blocks = docxBlocks(docx(
      `${p('Safety', 'Heading1')}${p('Sub', 'Heading3')}${p('Body', 'Heading4')}<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t></w:r></w:p>`
      + `<w:tbl><w:tr><w:tc>${p('x')}${p('y')}</w:tc><w:tc>${p('z')}</w:tc></w:tr></w:tbl>`,
    ));
    expect(blocks).toEqual([
      { type: 'p', text: 'Safety', level: 2 },
      { type: 'p', text: 'Sub', level: 4 },
      { type: 'p', text: 'Body' },
      { type: 'p', text: 'a b' },
      { type: 'table', rows: [['x\ny', 'z']] },
    ]);
  });
  it('throws for something that is not a Word document', () => {
    expect(() => docxBlocks(new ArrayBuffer(4))).toThrow();
  });
});
