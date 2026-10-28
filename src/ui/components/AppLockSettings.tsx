import { useEffect, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import type { FieldError, PinSettings } from '../../domain/types';
import { changePasscode, setFingerprint, setRelockMinutes, turnOffLock, turnOnLock } from '../../security/appLock';
import { relockMinutesOf } from '../../security/lockState';
import {
  FINGERPRINT_TOGGLE_FAILED, LOCK_FORGOTTEN_NOTE, LOCK_LIMITS_NOTE, LOCK_MINUTES_ERROR, LOCK_NO_REUSE_NOTE, parseLockMinutes,
} from '../lockView';
import type { ConfirmPurpose } from '../lockView';
import { useFingerprintAvailable } from '../useFingerprintAvailable';
import { ConfirmPasscodeDialog } from './ConfirmPasscodeDialog';
import { Field } from './Field';
import { PasscodeForm } from './PasscodeForm';

/** Says what happened in the status line under the section, which stays on the page so that it is announced. */
type Say = (text: string) => void;

/** "Lock after (minutes in background)", saved with its own button. Nothing is saved while the number is wrong. */
function LockTimeForm({ pin, say }: { pin: PinSettings; say: Say }) {
  const { db } = useAppState();
  const stored = relockMinutesOf(pin);
  const [minutes, setMinutes] = useState(String(stored));
  const [error, setError] = useState<FieldError>();
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  // The lock time can be changed from another tab: the field follows what is stored (and so shows what this tab has saved).
  // Only a change counts: on opening the field already shows it, and must not be reset over what has been typed since.
  const shown = useRef(stored);
  useEffect(() => {
    if (shown.current === stored) return;
    shown.current = stored;
    setMinutes(String(stored));
    setError(undefined);
  }, [stored]);

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    if (saving.current) return;
    const value = parseLockMinutes(minutes);
    if (value === undefined) {
      setError({ field: 'minutes', severity: 'error', message: LOCK_MINUTES_ERROR });
      input.current?.focus();
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
      await setRelockMinutes(db, value);
      setMinutes(String(value));
      setError(undefined);
      say(`The app locks after ${value} ${value === 1 ? 'minute' : 'minutes'} in the background.`);
    } catch (err) {
      reportError(err);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <form class="inline-form" onSubmit={save} noValidate>
      <Field
        label="Lock after (minutes in background)" inputMode="numeric" value={minutes} error={error} inputRef={input}
        onInput={(value) => {
          setMinutes(value);
          setError(undefined);
        }}
      />
      <button type="submit" class="btn btn-outline" aria-disabled={busy ? 'true' : undefined}>Set lock time</button>
    </form>
  );
}

/**
 * The lock is on: change the passcode, the fingerprint, the lock time, or turn it off. The passcode cannot be changed, the
 * lock cannot be turned off and a fingerprint cannot be added without the current passcode (the fingerprint also does
 * to change the passcode or turn the lock off, once one is enrolled), so that a phone left unlocked is not enough.
 * Taking a fingerprint away only removes a way in, so it asks for nothing.
 */
function LockOn({ pin, say }: { pin: PinSettings; say: Say }) {
  const { db } = useAppState();
  const fingerprintAvailable = useFingerprintAvailable() === true;
  const [changing, setChanging] = useState(false);
  // Changing the passcode, turning the lock off and turning the fingerprint on ask for the current passcode first.
  const [confirming, setConfirming] = useState<ConfirmPurpose>();
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  // The confirmation closes as the new-passcode form opens: the focus goes to the form's first field, not back to the button that is gone.
  const newPasscode = useRef<HTMLInputElement>(null);
  // The box follows a tap at once; if the phone then refuses, it goes back to what is true.
  const enrolled = pin.fingerprint !== undefined;
  const [fingerprintOn, setFingerprintOn] = useState(enrolled);
  const seenEnrolled = useRef(enrolled);
  useEffect(() => {
    if (seenEnrolled.current === enrolled) return; // only a change (here or in another tab), not the first run, which could undo a tap
    seenEnrolled.current = enrolled;
    setFingerprintOn(enrolled);
  }, [enrolled]);

  /** Turns the fingerprint on once the passcode has been confirmed: the phone is asked for a key; if it will not make one the box goes back. */
  async function enrollFingerprint(): Promise<void> {
    setFingerprintOn(true);
    if (await setFingerprint(db, true)) {
      say('Fingerprint unlock is on.');
    } else {
      setFingerprintOn(false);
      say(FINGERPRINT_TOGGLE_FAILED);
    }
  }

  /** Opens a confirmation, unless one of the buttons below is running. */
  function confirm(purpose: ConfirmPurpose): void {
    if (!working.current) setConfirming(purpose);
  }

  /** Runs one of the buttons below; a second tap while one runs is ignored. */
  async function run(action: () => Promise<void>): Promise<void> {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      await action();
    } catch (err) {
      reportError(err);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      {changing ? (
        <PasscodeForm
          autoFocus passcodeRef={newPasscode} fingerprintOffered={false} submitLabel="Set new passcode"
          onSubmit={async (newPin) => {
            await changePasscode(db, newPin);
            setChanging(false);
            say('Passcode changed.');
          }}
          secondary={{ label: 'Cancel', onClick: () => setChanging(false) }}
        />
      ) : (
        <div class="form-actions">
          <button type="button" class="btn btn-outline" aria-disabled={busy ? 'true' : undefined} onClick={() => confirm('change')}>
            Change passcode
          </button>
        </div>
      )}
      {fingerprintAvailable && (
        <label class="check">
          <input
            type="checkbox" checked={fingerprintOn} aria-disabled={busy ? 'true' : undefined}
            onChange={(event) => {
              const box = event.currentTarget;
              const on = box.checked;
              if (working.current) {
                box.checked = !on; // one of the buttons is running: the tap is not taken
              } else if (on) {
                // Adding a way in needs the passcode. The box stays as it is (off) until that is given.
                box.checked = false;
                setConfirming('fingerprint');
              } else {
                setFingerprintOn(false);
                void run(async () => {
                  await setFingerprint(db, false);
                  say('Fingerprint unlock is off.');
                });
              }
            }}
          />
          <span>Unlock with fingerprint</span>
        </label>
      )}
      <LockTimeForm pin={pin} say={say} />
      <div class="form-actions">
        <button type="button" class="btn btn-outline" aria-disabled={busy ? 'true' : undefined} onClick={() => confirm('off')}>
          Turn off app lock
        </button>
      </div>
      {confirming && (
        <ConfirmPasscodeDialog
          purpose={confirming} pin={pin} focusFallback={confirming === 'change' ? newPasscode : undefined}
          onCancel={() => setConfirming(undefined)}
          onConfirmed={() => {
            setConfirming(undefined);
            if (confirming === 'change') {
              setChanging(true);
            } else if (confirming === 'fingerprint') {
              void run(enrollFingerprint);
            } else {
              void run(async () => {
                await turnOffLock(db);
                say('App lock is off.');
              });
            }
          }}
        />
      )}
    </>
  );
}

/** The lock is off: one button opens the passcode form. */
function LockOff({ say }: { say: Say }) {
  const { db } = useAppState();
  const fingerprintAvailable = useFingerprintAvailable() === true;
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div class="form-actions">
        <button type="button" class="btn btn-primary" onClick={() => setOpen(true)}>Turn on app lock</button>
      </div>
    );
  }
  return (
    <PasscodeForm
      autoFocus fingerprintOffered={fingerprintAvailable} submitLabel="Turn on app lock"
      onSubmit={async (pin, withFingerprint) => {
        const { fingerprintFailed } = await turnOnLock(db, pin, withFingerprint);
        setOpen(false);
        say(fingerprintFailed ? FINGERPRINT_TOGGLE_FAILED : 'App lock is on.');
      }}
      secondary={{ label: 'Cancel', onClick: () => setOpen(false) }}
    />
  );
}

/**
 * The `App lock` section of Settings. The two notes say what the lock is and is not, and what to do if the way in is lost.
 * The status line under the section stays on the page and only its text changes, so that it is announced.
 */
export function AppLockSettings() {
  const { settings } = useAppState();
  const [status, setStatus] = useState('');
  const { pin } = settings;

  return (
    <div class="settings-section">
      <h3>App lock</h3>
      <p class="helper-text">{LOCK_LIMITS_NOTE}</p>
      <p class="helper-text">{LOCK_FORGOTTEN_NOTE}</p>
      <p class="helper-text">{LOCK_NO_REUSE_NOTE}</p>
      {pin ? <LockOn pin={pin} say={setStatus} /> : <LockOff say={setStatus} />}
      <p class="live" role="status">{status}</p>
    </div>
  );
}
