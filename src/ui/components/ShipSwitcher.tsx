import { useEffect, useId, useRef } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { updateSettings } from '../../db/settings';
import { listShips } from '../../db/ships';
import type { ShipProfile } from '../../domain/types';
import { Icon } from '../icons';
import { useLive } from '../useLive';

/**
 * The sheet the ship pill opens: one button per ship (the active one pressed, with a ✓), and a way to the profiles. A
 * modal `<dialog>`, open as long as it is rendered. Choosing a ship makes it the active one, as Make active in Profiles
 * does, and closes the sheet. Escape and a tap on the backdrop close it too, and the focus goes back to the pill.
 */
export function ShipSwitcher({ onClose }: { onClose: () => void }) {
  const { db, activeShip } = useAppState();
  const ships = useLive(() => listShips(db), [db]);
  const dialog = useRef<HTMLDialogElement>(null);
  const closedByUnmount = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = document.activeElement;
    if (!element.open) element.showModal();
    return () => {
      closedByUnmount.current = true; // its `close` event comes later, and must not shut a sheet opened again since
      if (element.open) element.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  async function choose(ship: ShipProfile): Promise<void> {
    try {
      if (ship.id !== activeShip?.id) await updateSettings(db, { activeShipId: ship.id });
      onClose();
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <dialog
      ref={dialog} class="dialog switcher" aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (!closedByUnmount.current) onClose();
      }}
      // A tap outside the sheet lands on the dialog itself (its backdrop): everything inside is in `.switcher-body`.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div class="switcher-body">
        <h2 id={titleId} class="switcher-title">Switch ship</h2>
        <ul class="row-list" role="list">
          {ships?.map((ship) => {
            const active = ship.id === activeShip?.id;
            return (
              <li key={ship.id}>
                <button type="button" class="list-row switcher-ship" aria-pressed={active ? 'true' : 'false'} onClick={() => void choose(ship)}>
                  <span class="list-row-title">{ship.particulars.name}</span>
                  {active && <Icon name="check" />}
                </button>
              </li>
            );
          })}
        </ul>
        <a class="btn btn-outline" href="#/profiles" onClick={onClose}>Manage ship profiles</a>
      </div>
    </dialog>
  );
}
