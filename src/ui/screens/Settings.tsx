import type { RefObject } from 'preact';
import { useId, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { exportAndShare } from '../../backup/exportFlow';
import type { ExportOutcome } from '../../backup/exportFlow';
import { getRememberedPassword } from '../../backup/passwordCache';
import { updateSettings } from '../../db/settings';
import { listShips } from '../../db/ships';
import { listSnapshots, restoreSnapshot, SNAPSHOTS_KEPT } from '../../db/snapshots';
import type { SnapshotSummary } from '../../db/snapshots';
import type { FieldError } from '../../domain/types';
import { AppLockSettings } from '../components/AppLockSettings';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { PasswordDialog } from '../components/PasswordDialog';
import {
  cleanDeviceName, DEVICE_NAME_REQUIRED, EXPORT_CANCELLED, oldestRemovedNote, parseReminderDays, REMINDER_ERROR,
  snapshotCountsText, snapshotDate, snapshotReason,
} from '../settingsView';
import { useDialogAction } from '../useDialogAction';
import { useLive } from '../useLive';

const problem = (field: string, message: string): FieldError => ({ field, severity: 'error', message });

type ExportDialog = 'full' | 'handover';

/**
 * Export a full backup, export one ship as a handover file, and a way in to the import screen. Export is asked for in a
 * dialog, which makes the file and shares it; what happened is told in the status line, which stays on the page.
 */
function BackupSection() {
  const { db, settings, activeShip } = useAppState();
  const ships = useLive(() => listShips(db), [db]);
  const [chosenShipId, setChosenShipId] = useState<string>();
  const [dialog, setDialog] = useState<ExportDialog>();
  const [status, setStatus] = useState('');
  const fullButton = useRef<HTMLButtonElement>(null);
  const handoverButton = useRef<HTMLButtonElement>(null);
  const shipSelectId = useId();

  // The ship that is chosen, else the active one; a chosen ship that has gone from the list gives way to the first.
  const handoverShip = ships?.find((ship) => ship.id === (chosenShipId ?? activeShip?.id)) ?? ships?.[0];

  const open = (which: ExportDialog): void => {
    setStatus('');
    setDialog(which);
  };
  const done = (outcome: ExportOutcome, exported: string): void => {
    setStatus(outcome === 'cancelled' ? EXPORT_CANCELLED : exported);
    setDialog(undefined);
  };

  return (
    <div class="settings-section">
      <h3>Backup</h3>
      <p class="helper-text">A backup is one encrypted file. Keep a copy somewhere other than this device.</p>
      <div class="form-actions">
        <button ref={fullButton} type="button" class="btn btn-primary" onClick={() => open('full')}>Export full backup</button>
        <a class="btn btn-outline" href="#/settings/import">Import backup</a>
      </div>
      <div class="inline-form">
        <div class="field">
          <label for={shipSelectId}>Ship</label>
          <select id={shipSelectId} value={handoverShip?.id ?? ''} onChange={(event) => setChosenShipId(event.currentTarget.value)}>
            {ships?.map((ship) => <option key={ship.id} value={ship.id}>{ship.particulars.name}</option>)}
          </select>
        </div>
        <button ref={handoverButton} type="button" class="btn btn-outline" disabled={!handoverShip} onClick={() => open('handover')}>
          Export handover file
        </button>
      </div>
      <p class="helper-text">A handover file holds one ship, for your relief. It has a password of its own.</p>
      {/* Always on the page, with its text set after it is there, so that it is announced. */}
      <p class="live" role="status">{status}</p>
      {dialog === 'full' && activeShip && (
        <PasswordDialog
          title="Export full backup" showWarning={!settings.firstExportDone} offerRemember
          intro={<p>Everything on this device, every ship, goes into one encrypted file.</p>}
          initialPassword={getRememberedPassword()} focusFallback={fullButton} onCancel={() => setDialog(undefined)}
          onSubmit={async (password, remember) => {
            done(await exportAndShare(db, { kind: 'full', password, shipId: activeShip.id, remember }), 'Full backup exported.');
          }}
        />
      )}
      {dialog === 'handover' && handoverShip && (
        <PasswordDialog
          title="Export handover file" showWarning={!settings.firstExportDone} offerRemember={false}
          intro={<p>Only {handoverShip.particulars.name} goes into this file, with a password of its own. Give the password to the person taking over.</p>}
          focusFallback={handoverButton} onCancel={() => setDialog(undefined)}
          onSubmit={async (password) => {
            done(await exportAndShare(db, { kind: 'handover', password, shipId: handoverShip.id, remember: false }), 'Handover file exported.');
          }}
        />
      )}
    </div>
  );
}

function RestoreDialog({ snapshot, removalNote, onClose, onRestored, focusFallback }: {
  snapshot: SnapshotSummary;
  /** Said when the restore pushes the oldest snapshot out: the snapshots are full. */
  removalNote?: string;
  onClose: () => void;
  onRestored: () => void;
  focusFallback: RefObject<HTMLElement | null>;
}) {
  const { db } = useAppState();
  const { busy, failure, run } = useDialogAction();
  return (
    <ConfirmDialog
      title="Restore this snapshot?" confirmLabel="Restore" busy={busy} error={failure} focusFallback={focusFallback}
      // A failure stays in the dialog and the data stays as it was. On success the dialog is closed here.
      onConfirm={() => void run(async () => {
        await restoreSnapshot(db, snapshot.id);
        onRestored();
      })}
      onCancel={onClose}
      body={
        <>
          <p>
            {`This puts back the ships, crew, certificates, voyages and clock changes of the snapshot from ${snapshotDate(snapshot.createdAt)} (${snapshotReason(snapshot)}), in place of what is on this device now.`}
          </p>
          <p>Your current data is saved as a snapshot first, so the restore can be undone.</p>
          {removalNote && <p>{removalNote}</p>}
        </>
      }
    />
  );
}

/** The snapshots kept on this device, newest first, each with a Restore button. */
function SnapshotSection() {
  const { db } = useAppState();
  const snapshots = useLive(() => listSnapshots(db), [db]);
  const [requested, setRequested] = useState<SnapshotSummary>();
  const [status, setStatus] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <div class="settings-section">
      {/* The focus goes here when the Restore button that opened the dialog is gone with its row. */}
      <h3 ref={heading} tabIndex={-1}>Restore snapshot</h3>
      <p class="helper-text">
        {`Masterpiece keeps the last ${SNAPSHOTS_KEPT} snapshots of your data. One is saved automatically before an import, before an update and before a restore.`}
      </p>
      {snapshots?.length === 0 && <p class="empty">No snapshots yet.</p>}
      {snapshots && snapshots.length > 0 && (
        <ul class="snapshot-list" role="list" aria-label="Snapshots">
          {snapshots.map((snapshot) => {
            const textId = `snapshot-${snapshot.id}`;
            return (
              <li key={snapshot.id} class="card snapshot-row">
                <div id={textId} class="snapshot-text">
                  <span class="snapshot-reason">{snapshotReason(snapshot)}</span>
                  <span class="snapshot-date">{snapshotDate(snapshot.createdAt)}</span>
                  <span class="snapshot-counts">{snapshotCountsText(snapshot.counts)}</span>
                </div>
                <button
                  type="button" class="btn btn-outline btn-small" aria-describedby={textId}
                  onClick={() => {
                    setStatus('');
                    setRequested(snapshot);
                  }}
                >
                  Restore
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p class="live" role="status">{status}</p>
      {requested && (
        <RestoreDialog
          snapshot={requested} removalNote={oldestRemovedNote(snapshots ?? [], SNAPSHOTS_KEPT)} focusFallback={heading}
          onClose={() => setRequested(undefined)}
          onRestored={() => {
            setStatus(`Restored the snapshot from ${snapshotDate(requested.createdAt)}. Your previous data is saved as "Before restore".`);
            setRequested(undefined);
          }}
        />
      )}
    </div>
  );
}

/**
 * The backup reminder and this device's name, saved together with Save. Nothing is saved while either is wrong; the first
 * that is wrong gets the focus. Save is `aria-disabled` while it runs, not `disabled`, which would take the focus from it.
 */
function DeviceSection() {
  const { db, settings } = useAppState();
  const [days, setDays] = useState(String(settings.backupReminderDays));
  const [name, setName] = useState(settings.deviceName);
  const [errors, setErrors] = useState<{ days?: FieldError; name?: FieldError }>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  // Set at once, where `busy` is only seen by the next render: a second tap in between must not save twice.
  const saving = useRef(false);
  const daysInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    if (saving.current) return;
    const reminderDays = parseReminderDays(days);
    const deviceName = cleanDeviceName(name);
    if (reminderDays === undefined || deviceName === '') {
      setErrors({
        days: reminderDays === undefined ? problem('days', REMINDER_ERROR) : undefined,
        name: deviceName === '' ? problem('name', DEVICE_NAME_REQUIRED) : undefined,
      });
      (reminderDays === undefined ? daysInput : nameInput).current?.focus();
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
      await updateSettings(db, { backupReminderDays: reminderDays, deviceName });
      // The form shows what was kept: the name trimmed and cut.
      setDays(String(reminderDays));
      setName(deviceName);
      setErrors({});
      setSaved(true);
    } catch (err) {
      reportError(err);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <form class="settings-section" onSubmit={save} noValidate>
      <h3>This device</h3>
      <Field
        label="Backup reminder (days)" inputMode="numeric" value={days} error={errors.days} inputRef={daysInput}
        hint="Masterpiece reminds you to back up when your last full backup is older than this."
        onInput={(value) => {
          setDays(value);
          setErrors((current) => ({ ...current, days: undefined }));
          setSaved(false);
        }}
      />
      <Field
        label="Device name" value={name} error={errors.name} inputRef={nameInput}
        hint="Shown to whoever opens a backup made here."
        onInput={(value) => {
          setName(value);
          setErrors((current) => ({ ...current, name: undefined }));
          setSaved(false);
        }}
      />
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" aria-disabled={busy ? 'true' : undefined}>Save</button>
        <p class="save-status" role="status">{saved ? 'Saved' : ''}</p>
      </div>
    </form>
  );
}

/** Backup and restore, this device's preferences, and the version. */
export function Settings() {
  return (
    <section class="screen">
      <h2>Settings</h2>
      <BackupSection />
      <SnapshotSection />
      <DeviceSection />
      <AppLockSettings />
      <div class="settings-section">
        <h3>About</h3>
        <p>Masterpiece {__APP_VERSION__}</p>
      </div>
    </section>
  );
}
