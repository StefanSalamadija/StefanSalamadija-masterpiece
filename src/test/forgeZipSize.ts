/**
 * Tests only: rewrites the uncompressed size that every central-directory entry of a zip declares, so the archive
 * looks like a zip bomb without being one.
 */
export function forgeZipSize(zip: Uint8Array, size: number): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  for (let i = 0; i + 46 <= out.length; i++) {
    if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, size, true);
  }
  return out;
}
