import type { RefObject } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { exportAndShare } from '../../backup/exportFlow';
import type { ExportOutcome } from '../../backup/exportFlow';
import { getRememberedPassword } from '../../backup/passwordCache';
import { updateSettings } from '../../db/settings';
import { listShips } from '../../db/ships';
import { listSnapshots, restoreSnapshot, SNAPSHOTS_KEPT } from '../../db/snapshots';
import type { SnapshotSummary } from '../../db/snapshots';
import type { FieldError, Settings, Theme } from '../../domain/types';
import { AppLockSettings } from '../components/AppLockSettings';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { PasswordDialog } from '../components/PasswordDialog';
import {
  cleanDeviceName, DEVICE_NAME_REQUIRED, EXPORT_CANCELLED, INCLUDE_LIBRARY_HINT, INCLUDE_LIBRARY_LABEL, oldestRemovedNote,
  parseReminderDays, REMINDER_ERROR, restoreExplanation, snapshotCountsText, snapshotDate, snapshotReason,
} from '../settingsView';
import { THEME_LABELS, THEMES } from '../theme';
import { NIGHT_TIMES } from '../themeSchedule';
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
  // Ticked each time the handover dialog opens: the relief needs the forms to fill the ship's drafts in.
  const [includeLibrary, setIncludeLibrary] = useState(true);
  const fullButton = useRef<HTMLButtonElement>(null);
  const handoverButton = useRef<HTMLButtonElement>(null);
  const shipSelectId = useId();
  const libraryHintId = useId();

  // The ship that is chosen, else the active one; a chosen ship that has gone from the list gives way to the first.
  const handoverShip = ships?.find((ship) => ship.id === (chosenShipId ?? activeShip?.id)) ?? ships?.[0];

  const open = (which: ExportDialog): void => {
    setStatus('');
    setIncludeLibrary(true);
    setDialog(which);
  };
  const done = (outcome: ExportOutcome, exported: string): void => {
    setStatus(outcome === 'cancelled' ? EXPORT_CANCELLED : exported);
    setDialog(undefined);
  };

  return (
    <div class="settings-section" id="settings-backup">
      <h3 tabIndex={-1}>Backup</h3>
      <p class="helper-text">A backup is one encrypted file. Keep a copy somewhere other than this device.</p>
      <div class="form-actions">
        <button ref={fullButton} type="button" class="btn btn-primary" onClick={() => open('full')}>Export full backup</button>
        <a class="btn btn-outline" href="#/settings/import">Import backup</a>
        <a class="btn btn-outline" href="#/library/files">Library files</a>
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
          options={
            <>
              <label class="check">
                <input
                  type="checkbox" checked={includeLibrary} aria-describedby={libraryHintId}
                  onChange={(event) => setIncludeLibrary(event.currentTarget.checked)}
                />
                <span>{INCLUDE_LIBRARY_LABEL}</span>
              </label>
              <p id={libraryHintId} class="helper-text">{INCLUDE_LIBRARY_HINT}</p>
            </>
          }
          onSubmit={async (password) => {
            const request = { kind: 'handover' as const, password, shipId: handoverShip.id, remember: false, includeLibrary };
            done(await exportAndShare(db, request), 'Handover file exported.');
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
            {restoreExplanation(snapshot)}
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

/** Shown, and nothing saved, when From and To are set to the same time: the window would be empty. */
export const NIGHT_TIMES_CLASH = 'From and To must differ.';

/**
 * The theme settings (spec §12.5): the base theme, and automatic night with its hours in ship's time. The header button
 * reads and writes the same settings with `updateSettings`, and `AppState` puts the theme that results on `<html>` (and
 * the mirror for the first paint), so neither needs to tell the other. Everything applies at once; there is nothing to
 * save. Any change here ends a theme held with the header button (`themeOverride`).
 */
function ThemeSection() {
  const { db, settings } = useAppState();
  const themeId = useId();
  const fromId = useId();
  const toId = useId();
  const errorId = `${toId}-error`;
  // Hours picked but not saved yet: while they are being written, or because From and To are the same.
  const [draft, setDraft] = useState<{ from: string; to: string; changed: 'from' | 'to' }>();
  const from = draft?.from ?? settings.nightFrom;
  const to = draft?.to ?? settings.nightTo;
  const clash = draft !== undefined && draft.from === draft.to ? draft.changed : undefined;

  useEffect(() => {
    // The picked hours are stored: from here on the settings are what the lists show.
    if (draft && draft.from === settings.nightFrom && draft.to === settings.nightTo) setDraft(undefined);
  }, [draft, settings.nightFrom, settings.nightTo]);

  async function save(patch: Partial<Settings>): Promise<void> {
    try {
      await updateSettings(db, { ...patch, themeOverride: undefined });
    } catch (err) {
      setDraft(undefined); // not saved: the lists go back to what is stored
      reportError(err);
    }
  }

  function chooseTime(changed: 'from' | 'to', value: string): void {
    const next = { from, to, changed, [changed]: value };
    setDraft(next);
    if (next.from !== next.to) void save({ nightFrom: next.from, nightTo: next.to });
  }

  const timeSelect = (which: 'from' | 'to', id: string, label: string, value: string) => (
    <div class="field">
      <label for={id}>{label}</label>
      <select
        id={id} value={value}
        aria-invalid={clash === which ? 'true' : undefined} aria-describedby={clash === which ? errorId : undefined}
        onChange={(event) => chooseTime(which, event.currentTarget.value)}
      >
        {NIGHT_TIMES.map((time) => <option key={time} value={time}>{time}</option>)}
      </select>
      {clash === which && <p id={errorId} class="field-error" role="alert">{NIGHT_TIMES_CLASH}</p>}
    </div>
  );

  return (
    <div class="settings-section" id="settings-display">
      <h3 tabIndex={-1}>Display</h3>
      <div class="field">
        <label for={themeId}>Theme</label>
        <select id={themeId} value={settings.theme} onChange={(event) => void save({ theme: event.currentTarget.value as Theme })}>
          {THEMES.map((theme) => <option key={theme} value={theme}>{THEME_LABELS[theme]}</option>)}
        </select>
      </div>
      <label class="check">
        <input
          type="checkbox" checked={settings.nightAuto}
          onChange={(event) => {
            setDraft(undefined);
            void save({ nightAuto: event.currentTarget.checked });
          }}
        />
        Night red automatically
      </label>
      {settings.nightAuto && (
        <>
          {timeSelect('from', fromId, "From (ship's time)", from)}
          {timeSelect('to', toId, "To (ship's time)", to)}
        </>
      )}
      <p class="helper-text">
        Between From and To in ship's time the app is Night red. The button at the top of every screen changes the theme until
        the next switch. Printing is always black on white.
      </p>
    </div>
  );
}

/** The section that `?at=` in the address asks for (`#/settings?at=lock`), following the address as it changes. */
function useSectionAsked(): string | null {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const update = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return new URLSearchParams(hash.split('?')[1] ?? '').get('at');
}

/**
 * Backup and restore, this device's preferences, and the version. Opened with `?at=backup`, `?at=lock` or `?at=display`
 * (from More), it scrolls that section into view and puts the focus on its heading.
 */
export function Settings() {
  const at = useSectionAsked();
  useEffect(() => {
    const section = at ? document.getElementById(`settings-${at}`) : null;
    const heading = section?.querySelector<HTMLElement>('h3');
    if (!section || !heading) return;
    // After the app has moved a new screen to the top, which it does once every screen has drawn.
    const frame = requestAnimationFrame(() => {
      heading.focus({ preventScroll: true });
      section.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [at]);

  return (
    <section class="screen">
      <h2>Settings</h2>
      <BackupSection />
      <SnapshotSection />
      <DeviceSection />
      <AppLockSettings />
      <ThemeSection />
      <div class="settings-section">
        <h3>About</h3>
        <p>Masterpiece {__APP_VERSION__}</p>
      </div>
    </section>
  );
}
