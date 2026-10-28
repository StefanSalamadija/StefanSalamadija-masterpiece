import type { RefObject } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import type { FieldError, PinSettings } from '../../domain/types';
import { isFingerprintAvailable, unlockWithFingerprint } from '../../security/fingerprint';
import { isValidPin } from '../../security/pin';
import {
  FINGERPRINT_NOT_RECOGNISED, PASSCODE_FORMAT_ERROR, WRONG_PASSCODE, confirmIntro, confirmTitle, lockoutText, unsavedLockText,
} from '../lockView';
import type { ConfirmPurpose } from '../lockView';
import { useFingerprintAvailable } from '../useFingerprintAvailable';
import { usePasscodeCheck } from '../usePasscodeCheck';
import { ConfirmDialog } from './ConfirmDialog';
import { Field } from './Field';

const problem = (message: string): FieldError => ({ field: 'current', severity: 'error', message });

/**
 * Asks for the current passcode before Settings changes the passcode, turns the lock off or turns the fingerprint on. On a
 * phone with a fingerprint enrolled the fingerprint does as well, except to turn the fingerprint on: only the passcode may
 * add a way in. The passcode is checked the way the lock screen checks it, with the same
 * lockout: every wrong one is counted and saved before it is answered, a lock on is shown with its countdown, and an
 * unreadable lockout is the longest lock. `onConfirmed` is called once, when the right passcode or fingerprint is given.
 */
export function ConfirmPasscodeDialog({ purpose, pin, onConfirmed, onCancel, focusFallback }: {
  purpose: ConfirmPurpose;
  pin: PinSettings;
  onConfirmed: () => void;
  onCancel: () => void;
  /** Gets the focus when the dialog goes away, if the button that opened it is gone. */
  focusFallback?: RefObject<HTMLElement | null>;
}) {
  const { db } = useAppState();
  const fingerprint = pin.fingerprint;
  const fingerprintAvailable = useFingerprintAvailable() === true;
  const offerFingerprint = purpose !== 'fingerprint' && fingerprint !== undefined && fingerprintAvailable;
  const { ready, lockedOut, remainingMs, unsaved, checking, announcement, check, recordSuccess } = usePasscodeCheck(db, pin);
  const [code, setCode] = useState('');
  const [error, setError] = useState<FieldError>();
  const [prompting, setPrompting] = useState(false);
  // Set at once, where the state is only seen by the next render: a second prompt in between must not start a second one.
  const promptingNow = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  const busy = checking || prompting;
  const canType = ready && !lockedOut && !busy;

  async function confirm(): Promise<void> {
    if (!canType) return;
    if (!isValidPin(code)) {
      setError(problem(PASSCODE_FORMAT_ERROR)); // not an attempt: nothing is counted
      input.current?.focus();
      return;
    }
    const result = await check(code);
    if (result === 'right') {
      onConfirmed();
      return;
    }
    if (result === 'ignored') return;
    // A wrong passcode empties the field and leaves the focus in it; a lock that has just started is told by its countdown.
    setCode('');
    setError(result === 'wrong' ? problem(WRONG_PASSCODE) : undefined);
    input.current?.focus();
  }

  async function confirmByFingerprint(): Promise<void> {
    if (!offerFingerprint || !fingerprint || busy || promptingNow.current) return;
    promptingNow.current = true;
    setPrompting(true);
    try {
      // A fingerprint that is not recognised does not count towards the lockout.
      if ((await isFingerprintAvailable()) && (await unlockWithFingerprint(fingerprint))) {
        await recordSuccess();
        onConfirmed();
        return;
      }
      setError(problem(FINGERPRINT_NOT_RECOGNISED));
    } finally {
      promptingNow.current = false;
      setPrompting(false);
    }
  }

  return (
    <ConfirmDialog
      title={confirmTitle(purpose)} confirmLabel="Confirm" busy={busy} confirmDisabled={!canType} focusFallback={focusFallback}
      onConfirm={() => void confirm()} onCancel={onCancel}
      body={
        <>
          <p>{confirmIntro(purpose, offerFingerprint)}</p>
          <Field
            label="Current passcode" type="password" inputMode="numeric" maxLength={4} value={code} error={error}
            inputRef={input} readOnly={!canType}
            onInput={(value) => {
              setCode(value);
              setError(undefined);
            }}
          />
          {lockedOut && (
            <p class="lock-message" role="timer">{unsaved ? unsavedLockText(remainingMs) : lockoutText(remainingMs)}</p>
          )}
          {/* Told once when a lock starts and when it ends; the countdown above is a timer, which is not read out every second. */}
          <p class="visually-hidden" role="status">{announcement}</p>
          {offerFingerprint && (
            <button type="button" class="btn btn-outline" aria-disabled={busy ? 'true' : undefined} onClick={() => void confirmByFingerprint()}>
              Use fingerprint
            </button>
          )}
        </>
      }
    />
  );
}
