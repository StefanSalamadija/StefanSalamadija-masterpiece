import { loadPdf } from '../pdfjs';
import type { Extracted } from './index';

const MIN_AVERAGE_CHARS_PER_PAGE = 20;
const YIELD_EVERY_PAGES = 10;

export async function extractPdf(data: ArrayBuffer, onProgress?: (done: number, total: number) => void): Promise<Extracted> {
  let pdf;
  try {
    pdf = await loadPdf(data);
  } catch {
    return { textStatus: 'failed', textError: 'Protected or damaged PDF', parts: [] };
  }
  try {
    const total = pdf.numPages;
    const parts: Extracted['parts'] = [];
    let chars = 0;
    for (let n = 1; n <= total; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str;
        text += item.hasEOL ? '\n' : ' ';
      }
      text = text.trim();
      chars += text.length;
      parts.push({ part: n, label: `Page ${n}`, text });
      page.cleanup();
      onProgress?.(n, total);
      if (n % YIELD_EVERY_PAGES === 0) await new Promise((r) => setTimeout(r));
    }
    if (total === 0 || chars / total < MIN_AVERAGE_CHARS_PER_PAGE) return { pageCount: total, textStatus: 'no-text', parts: [] };
    return { pageCount: total, textStatus: 'indexed', parts };
  } catch {
    return { textStatus: 'failed', textError: 'Protected or damaged PDF', parts: [] };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
