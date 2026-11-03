/*
 * Photos for a form (spec §7): a picture from the phone's camera is made smaller before it is kept, so that a draft with
 * several photos stays small enough for a backup and for the form file. `fitWithin` is the size rule (pure, and
 * unit-tested); `downsizeImage` draws the picture on a canvas at that size and gives a JPEG (covered by the end-to-end
 * test, as it needs a browser).
 */

/** The size of a picture of `width` × `height` pixels whose longest side is at most `longest`; never larger than it is. */
export function fitWithin(width: number, height: number, longest: number): { width: number; height: number } {
  const scale = Math.min(1, longest / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export const PHOTO_UNREADABLE = "That picture couldn't be read. Choose another photo.";

type Source = { source: CanvasImageSource; width: number; height: number; release: () => void };

/** Decodes a picture: `createImageBitmap` (which turns it upright), else an `Image` element. */
async function decode(blob: Blob): Promise<Source> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Some browsers cannot decode a format here; the image element may still.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * A picture as a JPEG whose longest side is at most `longest` pixels, at `quality` (0 to 1). A picture that is already
 * small is only re-encoded. Throws an `Error` with `PHOTO_UNREADABLE` when the file is no picture the browser can read.
 */
export async function downsizeImage(
  blob: Blob, longest = 1600, quality = 0.8,
): Promise<{ jpeg: Uint8Array; width: number; height: number }> {
  let decoded: Source;
  try {
    decoded = await decode(blob);
  } catch {
    throw new Error(PHOTO_UNREADABLE);
  }
  try {
    const { width, height } = fitWithin(decoded.width, decoded.height, longest);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(PHOTO_UNREADABLE);
    context.fillStyle = '#fff'; // a JPEG has no transparency: a transparent PNG would turn black
    context.fillRect(0, 0, width, height);
    context.drawImage(decoded.source, 0, 0, width, height);
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!jpeg) throw new Error(PHOTO_UNREADABLE);
    return { jpeg: new Uint8Array(await jpeg.arrayBuffer()), width, height };
  } finally {
    decoded.release();
  }
}
