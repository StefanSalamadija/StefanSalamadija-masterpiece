import { HUB_TILES } from '../hubTiles';
import { Icon } from '../icons';

export { HUB_TILES } from '../hubTiles';
export type { HubTile } from '../hubTiles';

/**
 * The Ship tab: a tile for each section of the ship, two to a row. A tile's accessible name is its name alone
 * (`aria-labelledby`); its status line, which Task 5 fills in, is its description.
 */
export function ShipHub() {
  return (
    <section class="screen">
      <h2>Ship</h2>
      <nav aria-label="Ship sections">
        <ul class="hub-grid" role="list">
          {HUB_TILES.map((tile) => (
            <li key={tile.id}>
              <a class="hub-tile" href={tile.href} aria-labelledby={`hub-${tile.id}`} aria-describedby={`hub-${tile.id}-status`}>
                <span class="hub-icon"><Icon name={tile.icon} /></span>
                <span id={`hub-${tile.id}`} class="hub-name">{tile.name}</span>
                <span id={`hub-${tile.id}-status`} class="hub-status" />
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
