/** Letters that Unicode decomposition does not split into base letter + accent. */
const SPECIAL_LETTERS: Record<string, string> = { đ: 'd', Đ: 'D' };

/** A lowercase, file-system-safe version of a ship name: accents removed, anything else but letters and digits becomes one `-`. */
function slug(name: string): string {
  return name
    .replace(/[đĐ]/g, (c) => SPECIAL_LETTERS[c])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `masterpiece-full-m-v-ocean-star-2026-10-25-1432.mpbak`: `shipLocalDateTime` is the ship's `YYYY-MM-DDTHH:mm`. */
export function backupFileName(kind: 'full' | 'handover', shipName: string, shipLocalDateTime: string): string {
  const stamp = shipLocalDateTime.replace('T', '-').replace(':', '');
  return `masterpiece-${kind}-${slug(shipName) || 'ship'}-${stamp}.mpbak`;
}
