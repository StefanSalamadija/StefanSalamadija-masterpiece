import type { PDFDocumentProxy } from 'pdfjs-dist';

type PdfjsModule = typeof import('pdfjs-dist');

let testLib: PdfjsModule | undefined;

/**
 * Tests only: runs pdf.js from its legacy build in this thread, with no worker. Production never calls this, so it
 * always uses the worker.
 */
export function useTestPdfjs(lib: unknown): void {
  testLib = lib as PdfjsModule;
}

/** URL of a file the build copies into `pdfjs/`, relative to the app's base (`base: './'`) so it works under any path. */
function pdfjsUrl(file: string): string {
  return new URL(`${import.meta.env.BASE_URL}pdfjs/${file}`, document.baseURI).href;
}

/** The one place pdf.js is configured: worker, standard fonts, CMaps, ICC profiles and wasm all come from `pdfjs/`. */
export async function loadPdf(data: ArrayBuffer | Uint8Array): Promise<PDFDocumentProxy> {
  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  if (testLib) {
    return testLib.getDocument({ data: bytes, disableWorker: true, useSystemFonts: false } as never).promise;
  }
  const lib = await import('pdfjs-dist');
  lib.GlobalWorkerOptions.workerSrc = pdfjsUrl('pdf.worker.min.mjs');
  return lib.getDocument({
    data: bytes,
    standardFontDataUrl: pdfjsUrl('standard_fonts/'),
    cMapUrl: pdfjsUrl('cmaps/'),
    cMapPacked: true,
    iccUrl: pdfjsUrl('iccs/'),
    wasmUrl: pdfjsUrl('wasm/'),
  }).promise;
}
