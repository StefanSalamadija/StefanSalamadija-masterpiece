import { useEffect, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import type { FieldError, PinSettings } from '../../domain/types';
import { changePasscode, setFingerprint, setRelockMinutes, turnOffLock, turnOnLock } from '../../security/appLock';
import { relockMinutesOf } from '../../security/lockState';
import {
  FINGERPRINT_TOGGLE_FAILED, LOCK_FORGOTTEN_NOTE, LOCK_LIMITS_NOTE, LOCK_MINUTES_ERROR, LOCK_NO_REUSE_NOTE, parseLockMinutes,
} from '../lockView';
import { useFingerprintAvailable } from '../useFingerprintAvailable';
import { Field } from './Field';
import { PasscodeForm } from './PasscodeForm';

/** Says what happened in the status line under the section, which stays on the page so that it is announced. */
type Say = (text: string) => void;

/** "Lock after (minutes in background)", saved with its own button. Nothing is saved while the number is wrong. */
function LockTimeForm({ pin, say }: { pin: PinSettings; say: Say }) {
  const { db } = useAppState();
  const [minutes, setMinutes] = useState(String(relockMinutesOf(pin)));
  const [error, setError] = useState<FieldError>();
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const input = useRef<HTMLInputElement>(null);

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

/** The lock is on: change the passcode, the fingerprint, the lock time, or turn it off. */
function LockOn({ pin, say }: { pin: PinSettings; say: Say }) {
  const { db } = useAppState();
  const fingerprintAvailable = useFingerprintAvailable() === true;
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  // The box follows a tap at once; if the phone then refuses, it goes back to what is true.
  const [fingerprintOn, setFingerprintOn] = useState(pin.fingerprint !== undefined);
  useEffect(() => setFingerprintOn(pin.fingerprint !== undefined), [pin.fingerprint]);

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
          autoFocus fingerprintOffered={false} submitLabel="Set new passcode"
          onSubmit={async (newPin) => {
            await changePasscode(db, newPin);
            setChanging(false);
            say('Passcode changed.');
          }}
          secondary={{ label: 'Cancel', onClick: () => setChanging(false) }}
        />
      ) : (
        <div class="form-actions">
          <button type="button" class="btn btn-outline" aria-disabled={busy ? 'true' : undefined} onClick={() => setChanging(true)}>
            Change passcode
          </button>
        </div>
      )}
      {fingerprintAvailable && (
        <label class="check">
          <input
            type="checkbox" checked={fingerprintOn} aria-disabled={busy ? 'true' : undefined}
            onChange={(event) => {
              const on = event.currentTarget.checked;
              setFingerprintOn(on);
              void run(async () => {
                if (await setFingerprint(db, on)) {
                  say(on ? 'Fingerprint unlock is on.' : 'Fingerprint unlock is off.');
                } else {
                  setFingerprintOn(!on);
                  say(FINGERPRINT_TOGGLE_FAILED);
                }
              });
            }}
          />
          <span>Unlock with fingerprint</span>
        </label>
      )}
      <LockTimeForm pin={pin} say={say} />
      <div class="form-actions">
        <button
          type="button" class="btn btn-outline" aria-disabled={busy ? 'true' : undefined}
          onClick={() => void run(async () => {
            await turnOffLock(db);
            say('App lock is off.');
          })}
        >
          Turn off app lock
        </button>
      </div>
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
