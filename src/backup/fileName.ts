/** Letters that Unicode decomposition does not split into base letter + accent. */
const SPECIAL_LETTERS: Record<string, string> = { đ: 'd', Đ: 'D' };

/** Longest slug kept, so a long ship name cannot make a path that some file systems or apps refuse. */
const MAX_SLUG = 60;

/** A lowercase, file-system-safe version of a name: accents removed, anything else but letters and digits becomes one `-`. Empty when nothing usable is left. */
export function slugify(name: string): string {
  return name
    .replace(/[đĐ]/g, (c) => SPECIAL_LETTERS[c])
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // the combining accents that NFD split off
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, ''); // the cut may have landed just after a dash
}

/** `masterpiece-full-m-v-ocean-star-2026-10-25-1432.mpbak`: `shipLocalDateTime` is the ship's `YYYY-MM-DDTHH:mm`. */
export function backupFileName(kind: 'full' | 'handover', shipName: string, shipLocalDateTime: string): string {
  const stamp = shipLocalDateTime.replace('T', '-').replace(':', '');
  return `masterpiece-${kind}-${slugify(shipName) || 'ship'}-${stamp}.mpbak`;
}
