import type { RefObject } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { ERASE_WAITING_MESSAGE, eraseDeviceData } from '../../app/eraseDevice';
import type { PinSettings } from '../../domain/types';
import { isFingerprintAvailable, unlockWithFingerprint } from '../../security/fingerprint';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LogoMark } from '../components/LogoMark';
import {
  FINGERPRINT_NOT_RECOGNISED, PASSCODE_FORMAT_ERROR, WRONG_PASSCODE, lockoutText, passcodeDigits, unsavedLockText,
} from '../lockView';
import { logoMode } from '../theme';
import { useDialogAction } from '../useDialogAction';
import { useFingerprintAvailable } from '../useFingerprintAvailable';
import { usePasscodeCheck } from '../usePasscodeCheck';

interface Notice {
  text: string;
  /** Announced at once (a wrong passcode), or politely. */
  urgent: boolean;
}

function EraseDialog({ onCancel, focusFallback }: { onCancel: () => void; focusFallback: RefObject<HTMLElement | null> }) {
  const { db } = useAppState();
  const { busy, failure, run } = useDialogAction();
  // Another page keeps the database open, so the delete is queued. It cannot be taken back, so from here the dialog only waits.
  const [waiting, setWaiting] = useState(false);
  return (
    <ConfirmDialog
      title="Erase everything on this device?" confirmLabel="Erase everything" danger busy={busy} error={failure}
      focusFallback={focusFallback}
      // On success the page starts again from nothing, so the dialog is never closed here. While the delete waits for
      // another page the dialog stays busy (no Cancel, Escape does nothing) until the delete goes through and the page reloads.
      onConfirm={() => void run(async () => {
        try {
          await eraseDeviceData(db, { onBlocked: () => setWaiting(true) });
        } catch (err) {
          setWaiting(false); // the queued delete failed after all: the data is still here and the dialog is free again
          throw err;
        }
        window.location.reload();
      })}
      onCancel={onCancel}
      body={
        <>
          <p>This deletes every ship, crew member, certificate and snapshot on this device, and the passcode. It cannot be undone.</p>
          <p>The only way to get your data back is to restore a backup you exported earlier.</p>
          {waiting && <p role="status" class="dialog-waiting">{ERASE_WAITING_MESSAGE}</p>}
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
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<Notice>();
  const [prompting, setPrompting] = useState(false);
  const [erasing, setErasing] = useState(false);
  const { ready, lockedOut, remainingMs, unsaved, checking, announcement, check, recordSuccess } = usePasscodeCheck(db, pin);

  const alive = useRef(true);
  // Set at once, where the state is only seen by the next render: a second prompt in between must not start a second one.
  const promptingNow = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const forgotButton = useRef<HTMLButtonElement>(null);
  const fingerprintButton = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const messageId = useId();

  useEffect(() => () => {
    alive.current = false;
  }, []);

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
        await recordSuccess();
        onUnlock();
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
    const result = await check(entered);
    if (result === 'ignored' || !alive.current) return;
    if (result === 'right') {
      onUnlock();
      return;
    }
    // Once the lock is on, the countdown says it; "Wrong passcode." would only come back, stale, when the lock ends.
    setNotice(result === 'wrong' ? { text: WRONG_PASSCODE, urgent: true } : undefined);
    setCode('');
  }

  // Once, on opening: open the phone's fingerprint prompt if one is enrolled.
  useEffect(() => {
    if (fingerprint) void unlockByFingerprint();
  }, []);

  // The fingerprint view puts the focus on its first control when it opens (the phone's own prompt opens over it).
  useEffect(() => {
    if (view === 'fingerprint') fingerprintButton.current?.focus();
  }, [view]);

  // The field gets the focus when it opens, when a check is over (a wrong passcode keeps it there) and when a lock ends.
  const canType = view === 'passcode' && ready && !lockedOut && !checking;
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
    <p id={messageId} class="lock-message" role="timer">{unsaved ? unsavedLockText(remainingMs) : lockoutText(remainingMs)}</p>
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
            <button
              ref={fingerprintButton} type="button" class="btn btn-primary btn-large" aria-disabled={prompting ? 'true' : undefined}
              onClick={() => void unlockByFingerprint()}
            >
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
        {/* Told once when a lock starts and when it ends; the countdown above is a timer, which is not read out every second. */}
        <p class="visually-hidden" role="status">{announcement}</p>
      </div>
      {erasing && <EraseDialog onCancel={() => setErasing(false)} focusFallback={forgotButton} />}
    </main>
  );
}
