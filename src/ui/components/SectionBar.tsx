import type { RoutePath } from '../../app/router';
import { HUB_TILES } from '../hubTiles';

/** The second part of a Ship route that belongs to a tile of another address. */
const OWNERS: Record<string, string> = {
  // The Expiring screen of before piece 7 (now Due before the next port): crew documents.
  expiring: '#/ship/crew-documents',
};

/**
 * The name of the hub tile that a Ship route belongs to: `Crew` for `/ship/crew/:id/documents/new`, `Draft survey` for
 * `/ship/survey/data`. Empty for a route outside the Ship tab.
 */
export function sectionFor(path: RoutePath): string {
  const part = path.split('/')[2] ?? '';
  const href = OWNERS[part] ?? `#/ship/${part}`;
  return HUB_TILES.find((tile) => tile.href === href)?.name ?? '';
}

/** The row at the top of a Ship section screen: back to the hub, and the section's name. */
export function SectionBar({ path }: { path: RoutePath }) {
  return (
    <nav class="section-bar no-print" aria-label="Ship section">
      <a class="section-back" href="#/ship">‹ Ship</a>
      <span class="section-name">{sectionFor(path)}</span>
    </nav>
  );
}
