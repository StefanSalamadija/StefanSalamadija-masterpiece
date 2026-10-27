import type { RefObject } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { eraseDeviceData } from '../../app/eraseDevice';
import type { PinSettings } from '../../domain/types';
import { saveLockout } from '../../security/appLock';
import { isFingerprintAvailable, unlockWithFingerprint } from '../../security/fingerprint';
import { evaluateLockout } from '../../security/lockState';
import type { LockoutView } from '../../security/lockState';
import { registerFailure, registerSuccess, verifyPin } from '../../security/pin';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LogoMark } from '../components/LogoMark';
import {
  FINGERPRINT_NOT_RECOGNISED, PASSCODE_FORMAT_ERROR, WRONG_PASSCODE, lockoutText, passcodeDigits,
} from '../lockView';
import { logoMode } from '../theme';
import { useDialogAction } from '../useDialogAction';
import { useFingerprintAvailable } from '../useFingerprintAvailable';

const COUNTDOWN_STEP_MS = 1000;

interface Notice {
  text: string;
  /** Announced at once (a wrong passcode), or politely. */
  urgent: boolean;
}

function EraseDialog({ onCancel, focusFallback }: { onCancel: () => void; focusFallback: RefObject<HTMLElement | null> }) {
  const { db } = useAppState();
  const { busy, failure, run } = useDialogAction();
  return (
    <ConfirmDialog
      title="Erase everything on this device?" confirmLabel="Erase everything" danger busy={busy} error={failure}
      focusFallback={focusFallback}
      // On success the page starts again from nothing, so the dialog is never closed here.
      onConfirm={() => void run(async () => {
        await eraseDeviceData(db);
        window.location.reload();
      })}
      onCancel={onCancel}
      body={
        <>
          <p>This deletes every ship, crew member, certificate and snapshot on this device, and the passcode. It cannot be undone.</p>
          <p>The only way to get your data back is to restore a backup you exported earlier.</p>
        </>
      }
    />
  );
}

/**
 * The lock. Nothing of the app is drawn behind it. With a fingerprint enrolled the phone's prompt opens at once; the
 * passcode is the way in without it. Wrong passcodes are counted and the count is saved before the result is shown;
 * the lockout survives a reload. It fails closed: a lockout that cannot be read is the longest lock, never no lock.
 */
export function LockScreen({ pin, onUnlock }: { pin: PinSettings; onUnlock: () => void }) {
  const { db, settings, activeShip } = useAppState();
  const fingerprint = pin.fingerprint;
  const fingerprintAvailable = useFingerprintAvailable() === true;
  const [view, setView] = useState<'fingerprint' | 'passcode'>(fingerprint ? 'fingerprint' : 'passcode');
  /** The lockout once it has been checked and saved; `undefined` until then, so no passcode is taken before. */
  const [lockout, setLockout] = useState<LockoutView>();
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<Notice>();
  const [checking, setChecking] = useState(false);
  const [prompting, setPrompting] = useState(false);
  const [erasing, setErasing] = useState(false);

  const alive = useRef(true);
  const stored = useRef<unknown>(pin.lockout);
  // Set at once, where the state is only seen by the next render: a second try in between must not start a second check.
  const checkingNow = useRef(false);
  const promptingNow = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const forgotButton = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const messageId = useId();

  useEffect(() => () => {
    alive.current = false;
  }, []);

  /** Looks at the lockout now, saves it if it had to be repaired or cut short, and only then lets the countdown show. */
  async function settle(): Promise<LockoutView> {
    const next = evaluateLockout(stored.current, new Date());
    if (next.persist) {
      stored.current = next.state;
      try {
        await saveLockout(db, next.state);
      } catch (err) {
        reportError(err); // the lock holds in memory all the same
      }
    }
    if (alive.current) setLockout(next);
    return next;
  }

  async function finishUnlock(): Promise<void> {
    stored.current = registerSuccess();
    try {
      await saveLockout(db, registerSuccess());
    } catch (err) {
      reportError(err); // the way in was right; failing to forget the failures must not keep the person out
    }
    onUnlock();
  }

  async function unlockByFingerprint(): Promise<void> {
    if (!fingerprint || promptingNow.current) return;
    promptingNow.current = true;
    setPrompting(true);
    try {
      if (!(await isFingerprintAvailable())) {
        if (alive.current) setView('passcode'); // this phone no longer offers it: the passcode is the way in
        return;
      }
      const ok = await unlockWithFingerprint(fingerprint);
      if (!alive.current) return;
      if (ok) {
        await finishUnlock();
      } else {
        // A fingerprint that is not recognised does not count towards the lockout.
        setNotice({ text: FINGERPRINT_NOT_RECOGNISED, urgent: false });
        setView('passcode');
      }
    } finally {
      promptingNow.current = false;
      if (alive.current) setPrompting(false);
    }
  }

  async function tryPasscode(entered: string): Promise<void> {
    if (checkingNow.current) return;
    checkingNow.current = true;
    setChecking(true);
    try {
      const before = await settle();
      if (before.remainingMs > 0) {
        setNotice(undefined);
        setCode('');
        return;
      }
      if (await verifyPin(entered, pin.hash)) {
        await finishUnlock();
        return;
      }
      const at = new Date();
      const failed = registerFailure(before.state, at);
      stored.current = failed;
      try {
        await saveLockout(db, failed); // saved before the result is shown
      } catch (err) {
        reportError(err);
      }
      if (!alive.current) return;
      const now = evaluateLockout(failed, at);
      setLockout(now);
      // Once the lock is on, the countdown says it; "Wrong passcode." would only come back, stale, when the lock ends.
      setNotice(now.remainingMs > 0 ? undefined : { text: WRONG_PASSCODE, urgent: true });
      setCode('');
    } finally {
      checkingNow.current = false;
      if (alive.current) setChecking(false);
    }
  }

  // Once, on opening: check the saved lockout, and open the phone's fingerprint prompt if one is enrolled.
  useEffect(() => {
    void settle();
    if (fingerprint) void unlockByFingerprint();
  }, []);

  const lockedOut = lockout !== undefined && lockout.remainingMs > 0;

  useEffect(() => {
    if (!lockedOut) return;
    const timer = window.setInterval(() => void settle(), COUNTDOWN_STEP_MS);
    return () => window.clearInterval(timer);
  }, [lockedOut]);

  // The field gets the focus when it opens, when a check is over (a wrong passcode keeps it there) and when a lock ends.
  const canType = view === 'passcode' && lockout !== undefined && !lockedOut && !checking;
  useEffect(() => {
    if (canType) input.current?.focus();
  }, [canType]);

  function submit(event: Event): void {
    event.preventDefault();
    if (!canType) return;
    if (code.length === 4) void tryPasscode(code);
    else setNotice({ text: PASSCODE_FORMAT_ERROR, urgent: true });
  }

  const shipName = activeShip?.particulars.name;
  const showMessage = lockedOut ? (
    <p id={messageId} class="lock-message" role="timer">{lockoutText(lockout.remainingMs)}</p>
  ) : notice ? (
    <p id={messageId} class="lock-message" role={notice.urgent ? 'alert' : 'status'}>{notice.text}</p>
  ) : null;

  return (
    <main class="lock">
      <div class="lock-card">
        <LogoMark size={64} mode={logoMode(settings.theme)} />
        <h1>Masterpiece is locked</h1>
        {shipName && <p class="lock-ship">{shipName}</p>}

        {view === 'fingerprint' ? (
          <div class="lock-actions">
            <button type="button" class="btn btn-primary btn-large" aria-disabled={prompting ? 'true' : undefined} onClick={() => void unlockByFingerprint()}>
              Unlock with fingerprint
            </button>
            <button type="button" class="btn btn-link" onClick={() => setView('passcode')}>Use passcode</button>
          </div>
        ) : (
          <form class="lock-form" onSubmit={submit} noValidate>
            <div class="field">
              <label for={inputId}>Passcode</label>
              <input
                id={inputId} ref={input} class="passcode-input" type="password" inputMode="numeric" maxLength={4} autocomplete="off"
                value={code} readOnly={!canType} aria-describedby={showMessage ? messageId : undefined}
                onInput={(event) => {
                  // Only digits stay; the field is set by hand, because a state that did not change does not draw again.
                  const digits = passcodeDigits(event.currentTarget.value);
                  event.currentTarget.value = digits;
                  setCode(digits);
                  setNotice(undefined);
                  if (canType && digits.length === 4) void tryPasscode(digits);
                }}
              />
            </div>
            {showMessage}
            <button type="submit" class="btn btn-primary btn-large" aria-disabled={canType ? undefined : 'true'}>Unlock</button>
            {fingerprint && fingerprintAvailable && (
              <button type="button" class="btn btn-link" onClick={() => void unlockByFingerprint()}>Use fingerprint</button>
            )}
          </form>
        )}
        {view === 'fingerprint' && showMessage}

        <button ref={forgotButton} type="button" class="btn btn-link" onClick={() => setErasing(true)}>Forgot passcode?</button>
      </div>
      {erasing && <EraseDialog onCancel={() => setErasing(false)} focusFallback={forgotButton} />}
    </main>
  );
}
