import { useAppState } from '../../app/AppState';
import { setFlash, takeFlash } from '../../app/flash';
import { skipProtect, turnOnLock } from '../../security/appLock';
import { LogoMark } from '../components/LogoMark';
import { PasscodeForm } from '../components/PasscodeForm';
import { FINGERPRINT_SETUP_FAILED, protectIntro } from '../lockView';
import { logoMode } from '../theme';
import { useFingerprintAvailable } from '../useFingerprintAvailable';

/**
 * Offered when the first ship has been made on the welcome screen, and again after a restart if it was left unanswered:
 * set a 4-digit passcode, with the fingerprint as well on a phone that has a sensor, or skip. Either answer is kept, so
 * the step does not come back. It covers the whole screen, like the lock, so no ship data is behind it.
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
        <PasscodeForm
          autoFocus fingerprintOffered={fingerprint} submitLabel="Turn on app lock"
          onSubmit={async (pin, withFingerprint) => {
            try {
              // The message waits for the screen that replaces this one: the home screen shows it.
              await turnOnLock(db, pin, withFingerprint, () => setFlash(FINGERPRINT_SETUP_FAILED));
            } catch (err) {
              takeFlash();
              throw err;
            }
          }}
          secondary={{ label: 'Skip for now', onClick: () => skipProtect(db) }}
        />
      </div>
    </main>
  );
}
