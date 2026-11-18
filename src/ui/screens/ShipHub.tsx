import { useMemo } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import type { ShipProfile } from '../../domain/types';
import { HUB_TILES } from '../hubTiles';
import type { HubTile } from '../hubTiles';
import { Icon } from '../icons';
import { hubStatuses } from '../overviewView';
import type { TileStatus } from '../overviewView';
import { useShipAlerts, useShipRecords } from '../useShipRecords';

export { HUB_TILES } from '../hubTiles';
export type { HubTile } from '../hubTiles';

/** The status lines of the tiles, live; `undefined` while the records load. */
function useHubStatuses(ship: ShipProfile): Record<HubTile, TileStatus> | undefined {
  const { shipToday, nowUtc, clockChanges, offsetMinutes } = useAppState();
  const records = useShipRecords(ship.id);
  const alerts = useShipAlerts(records, ship);
  return useMemo(
    () => records && alerts && hubStatuses({ ...records, ship, alerts, today: shipToday, now: nowUtc, clockChanges, offsetMinutes }),
    [records, alerts, ship, shipToday, nowUtc, clockChanges, offsetMinutes],
  );
}

/**
 * The tiles of one ship. Keyed by the ship, so that a switch of ship never shows the last one's status lines. An overdue
 * or due soon line is the filled or outlined pill; a ✓ line is a word in the ok colour; the rest are plain text.
 */
function Tiles({ ship }: { ship: ShipProfile }) {
  const statuses = useHubStatuses(ship);
  return (
    <ul class="hub-grid" role="list">
      {HUB_TILES.map((tile) => {
        const status = statuses?.[tile.id];
        const tone = status && status.tone !== 'plain' ? status.tone : undefined;
        return (
          <li key={tile.id}>
            <a class="hub-tile" href={tile.href} aria-labelledby={`hub-${tile.id}`} aria-describedby={`hub-${tile.id}-status`}>
              <span class="hub-icon"><Icon name={tile.icon} /></span>
              <span id={`hub-${tile.id}`} class="hub-name">{tile.name}</span>
              <span id={`hub-${tile.id}-status`} class={tone ? 'hub-status status' : 'hub-status'} data-tone={tone}>{status?.text}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The Ship tab: a tile for each section of the ship, two to a row, each with its live status line. A tile's accessible
 * name is its name alone (`aria-labelledby`); its status line is its description.
 */
export function ShipHub() {
  const { activeShip } = useAppState();
  return (
    <section class="screen">
      <h2>Ship</h2>
      <nav aria-label="Ship sections">
        {activeShip && <Tiles key={activeShip.id} ship={activeShip} />}
      </nav>
    </section>
  );
}
