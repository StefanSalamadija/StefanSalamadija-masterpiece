import { useAppState } from '../../app/AppState';
import { addFlash, dropFlash } from '../../app/flash';
import { skipProtect, turnOnLock } from '../../security/appLock';
import { LogoMark } from '../components/LogoMark';
import { PasscodeForm } from '../components/PasscodeForm';
import {
  FINGERPRINT_SETUP_FAILED, LOCK_FORGOTTEN_NOTE, LOCK_LIMITS_NOTE, LOCK_NO_REUSE_NOTE, protectIntro,
} from '../lockView';
import { logoMode } from '../theme';
import { useFingerprintAvailable } from '../useFingerprintAvailable';

/**
 * Offered when there is a ship, no passcode and no answer yet: after the first ship is made, after a backup is restored
 * onto an empty device, and again after a restart if it was left unanswered:
 * set a 4-digit passcode, with the fingerprint as well on a phone that has a sensor, or skip. Either answer is kept, so
 * the step does not come back. It covers the whole screen, like the lock, so no ship data is behind it. It says what a
 * forgotten passcode means and what the lock is not (spec 4.10), before the passcode is set rather than after.
 */
export function ProtectApp() {
  const { db, settings } = useAppState();
  const fingerprint = useFingerprintAvailable() === true;

  return (
    <main class="lock">
      <div class="lock-card">
        <LogoMark size={64} mode={logoMode(settings.theme)} />
        <h1>Protect Masterpiece</h1>
        <p class="lock-intro">{protectIntro(fingerprint)}</p>
        <div class="lock-notes">
          <p class="helper-text">{LOCK_FORGOTTEN_NOTE}</p>
          <p class="helper-text">{LOCK_LIMITS_NOTE}</p>
          <p class="helper-text">{LOCK_NO_REUSE_NOTE}</p>
        </div>
        <PasscodeForm
          autoFocus fingerprintOffered={fingerprint} submitLabel="Turn on app lock"
          onSubmit={async (pin, withFingerprint) => {
            try {
              // The message waits for the screen that replaces this one: the home screen shows it, after any message that
              // is already waiting ("Import complete." on a phone restored from a backup).
              await turnOnLock(db, pin, withFingerprint, () => addFlash(FINGERPRINT_SETUP_FAILED));
            } catch (err) {
              dropFlash(FINGERPRINT_SETUP_FAILED); // the lock was not saved after all: its message is not true; the others stay
              throw err;
            }
          }}
          secondary={{ label: 'Skip for now', onClick: () => skipProtect(db) }}
        />
      </div>
    </main>
  );
}
