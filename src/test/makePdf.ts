/**
 * Builds a valid minimal PDF for tests. Each page is either lines of Helvetica text, or 'image' for a page that holds
 * only a small picture and no text operators (as a scan does). The xref table holds the real byte offsets.
 */
export function makePdf(pages: (string[] | 'image')[], sizes: ([number, number] | undefined)[] = []): Uint8Array {
  const objects: string[] = [];
  const n = pages.length;
  // Object numbers: 1 catalog, 2 pages, 3 font, 4 image, then a page and a content stream per page.
  const pageId = (i: number) => 5 + i * 2;
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${n} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  const pixels = '80808080';
  objects[4] = `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${pixels.length + 1} >>\nstream\n${pixels}>\nendstream`;
  pages.forEach((page, i) => {
    const content = page === 'image'
      ? 'q 400 0 0 400 100 200 cm /Im1 Do Q'
      : `BT /F1 12 Tf 14 TL 72 720 Td ${page.map((line) => `(${line.replace(/[\\()]/g, '\\$&')}) Tj T*`).join(' ')} ET`;
    objects[pageId(i)] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${sizes[i]?.[0] ?? 612} ${sizes[i]?.[1] ?? 792}] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> /Contents ${pageId(i) + 1} 0 R >>`;
    objects[pageId(i) + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
