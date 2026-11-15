import type { LibraryDoc } from '../../../domain/types';

/** Gives the file to the person: the share sheet where it takes files, else a download. */
export async function openWith(blob: Blob, doc: LibraryDoc): Promise<void> {
  const file = new File([blob], doc.fileName, { type: doc.mimeType || blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: doc.title });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) throw err;
    }
    return;
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = doc.fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
