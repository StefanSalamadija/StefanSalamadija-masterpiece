import type { ComponentChildren, RefObject } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { updateRecord } from '../../db/records';
import { updateSettings } from '../../db/settings';
import { copyShip, createShip, deleteShip, deleteSummary, listShips } from '../../db/ships';
import { deviceOffsetMinutes } from '../../domain/shipTime';
import { shipDeleteText } from '../../domain/shipDeleteText';
import type { FieldError, ShipProfile } from '../../domain/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { OffsetSelect } from '../components/OffsetSelect';
import { SHIP_NAME_REQUIRED } from '../messages';
import { useDialogAction } from '../useDialogAction';
import { useLive } from '../useLive';

const NAME_REQUIRED: FieldError = { field: 'name', severity: 'error', message: SHIP_NAME_REQUIRED };

/** What every dialog of this screen is given. */
interface DialogProps {
  onClose: () => void;
  /** Where the focus goes when the button that opened the dialog is gone. */
  focusFallback: RefObject<HTMLElement | null>;
}

interface NameDialogProps extends DialogProps {
  title: string;
  nameLabel: string;
  confirmLabel: string;
  initialName: string;
  /** More fields below the name, whose values the owner keeps. */
  children?: ComponentChildren;
  /** Does the work with the trimmed name, and closes the dialog when it is done. A failure is shown in the dialog. */
  onSubmit: (name: string) => Promise<void>;
}

/** A dialog that asks for a ship name (never blank) and maybe a little more. */
function NameDialog({ title, nameLabel, confirmLabel, initialName, children, onSubmit, onClose, focusFallback }: NameDialogProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<FieldError>();
  const { busy, failure, run } = useDialogAction();
  const input = useRef<HTMLInputElement>(null);

  function confirm(): void {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(NAME_REQUIRED);
      input.current?.focus();
      return;
    }
    void run(() => onSubmit(trimmed));
  }

  return (
    <ConfirmDialog
      title={title} confirmLabel={confirmLabel} busy={busy} error={failure} focusFallback={focusFallback}
      onConfirm={confirm} onCancel={onClose}
      body={
        <>
          <Field
            label={nameLabel} value={name} error={error} inputRef={input}
            onInput={(value) => {
              setName(value);
              setError(undefined);
            }}
          />
          {children}
        </>
      }
    />
  );
}

function NewShipDialog({ onClose, focusFallback }: DialogProps) {
  const { db } = useAppState();
  const [offset, setOffset] = useState(() => deviceOffsetMinutes());
  return (
    <NameDialog
      title="New ship" nameLabel="Ship name" confirmLabel="Create ship" initialName=""
      onClose={onClose} focusFallback={focusFallback}
      onSubmit={async (name) => {
        await createShip(db, name, offset);
        onClose();
      }}
    >
      <OffsetSelect value={offset} onChange={setOffset} />
    </NameDialog>
  );
}

function RenameShipDialog({ ship, onClose, focusFallback }: DialogProps & { ship: ShipProfile }) {
  const { db } = useAppState();
  return (
    <NameDialog
      title="Rename ship" nameLabel="Ship name" confirmLabel="Rename" initialName={ship.particulars.name}
      onClose={onClose} focusFallback={focusFallback}
      onSubmit={async (name) => {
        if (name !== ship.particulars.name) {
          await updateRecord<ShipProfile>(db, 'ships', ship.id, { particulars: { ...ship.particulars, name } });
        }
        onClose();
      }}
    />
  );
}

function CopyShipDialog({ ship, onClose, focusFallback }: DialogProps & { ship: ShipProfile }) {
  const { db } = useAppState();
  const [includeCertificates, setIncludeCertificates] = useState(false);
  return (
    <NameDialog
      title={`Copy ${ship.particulars.name}`} nameLabel="New ship name" confirmLabel="Copy ship" initialName=""
      onClose={onClose} focusFallback={focusFallback}
      onSubmit={async (name) => {
        await copyShip(db, ship.id, name, { includeCertificates });
        onClose();
      }}
    >
      <p class="helper-text">
        The particulars are copied, but not the IMO number, call sign or MMSI. Crew, voyages and clock changes are never copied.
      </p>
      <label class="check">
        <input
          type="checkbox" checked={includeCertificates}
          onChange={(event) => setIncludeCertificates(event.currentTarget.checked)}
        />
        <span>Copy certificate list (names only)</span>
      </label>
    </NameDialog>
  );
}

function DeleteShipDialog({ ship, onClose, focusFallback }: DialogProps & { ship: ShipProfile }) {
  const { db } = useAppState();
  // Live, so the counts are right at the moment of confirming.
  const summary = useLive(() => deleteSummary(db, ship.id), [db, ship.id]);
  const { busy, failure, run } = useDialogAction();

  function confirm(): void {
    // The screen closes this dialog when the ship leaves the list, which is after its row is gone, so the focus can
    // go to the fallback and not to a button that is about to disappear.
    void run(() => deleteShip(db, ship.id));
  }

  return (
    <ConfirmDialog
      title={`Delete ${ship.particulars.name}?`} confirmLabel="Delete ship" danger
      busy={busy} confirmDisabled={!summary} error={failure} focusFallback={focusFallback}
      onConfirm={confirm} onCancel={onClose}
      body={<p>{summary ? shipDeleteText(summary) : 'Checking what this ship contains…'}</p>}
    />
  );
}

type DialogState =
  | { kind: 'create' }
  | { kind: 'rename' | 'copy' | 'delete'; ship: ShipProfile };

/** All ship profiles: switch the active ship, add one, rename, copy for a sister ship, or delete. */
export function Profiles() {
  const { db, activeShip } = useAppState();
  const ships = useLive(() => listShips(db), [db]);
  const [requested, setDialog] = useState<DialogState>();
  const newShipButton = useRef<HTMLButtonElement>(null);
  const close = (): void => setDialog(undefined);
  // A dialog about a ship that is no longer in the list (deleted here, or in another tab) is closed.
  const dialog = requested?.kind === 'create' || ships?.some((ship) => ship.id === requested?.ship.id) ? requested : undefined;
  const dialogProps = { onClose: close, focusFallback: newShipButton };

  async function makeActive(ship: ShipProfile): Promise<void> {
    try {
      await updateSettings(db, { activeShipId: ship.id });
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <section class="screen">
      <div class="screen-head">
        <h2>Ship profiles</h2>
        <button ref={newShipButton} type="button" class="btn btn-primary" onClick={() => setDialog({ kind: 'create' })}>New ship</button>
      </div>
      <ul class="ship-list" role="list" aria-label="Ships">
        {ships?.map((ship) => {
          const active = ship.id === activeShip?.id;
          return (
            <li key={ship.id} class="card ship-row">
              <div class="ship-row-head">
                <span class="ship-row-name">{ship.particulars.name}</span>
                {active && <span class="badge">Active</span>}
              </div>
              <div class="ship-row-actions">
                {!active && (
                  <button type="button" class="btn btn-outline btn-small" onClick={() => makeActive(ship)}>Make active</button>
                )}
                <button type="button" class="btn btn-outline btn-small" onClick={() => setDialog({ kind: 'rename', ship })}>Rename</button>
                <button type="button" class="btn btn-outline btn-small" onClick={() => setDialog({ kind: 'copy', ship })}>Copy</button>
                <button type="button" class="btn btn-outline btn-small" onClick={() => setDialog({ kind: 'delete', ship })}>Delete</button>
              </div>
            </li>
          );
        })}
      </ul>
      {dialog?.kind === 'create' && <NewShipDialog {...dialogProps} />}
      {dialog?.kind === 'rename' && <RenameShipDialog ship={dialog.ship} {...dialogProps} />}
      {dialog?.kind === 'copy' && <CopyShipDialog ship={dialog.ship} {...dialogProps} />}
      {dialog?.kind === 'delete' && <DeleteShipDialog ship={dialog.ship} {...dialogProps} />}
    </section>
  );
}
