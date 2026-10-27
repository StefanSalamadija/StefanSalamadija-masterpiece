import { useEffect, useRef, useState } from 'preact/hooks';
import type { PinSettings } from '../domain/types';
import { relockDue } from './lockGate';

/**
 * Whether the app is locked in this session. It starts locked whenever a passcode is set (the state is in memory only, so
 * every start and every reload begins locked), and locks again when the app comes back to the front after longer than
 * the lock time in the background. The time it went to the background is kept in memory only.
 */
export function useAppLock(pin: PinSettings | undefined): { locked: boolean; unlock: () => void } {
  const [locked, setLocked] = useState(pin !== undefined);
  const latestPin = useRef(pin);
  latestPin.current = pin;
  const hiddenAt = useRef<string | undefined>(undefined);

  useEffect(() => {
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current ??= new Date().toISOString();
        return;
      }
      if (document.visibilityState !== 'visible') return;
      const since = hiddenAt.current;
      hiddenAt.current = undefined;
      if (relockDue(latestPin.current, since, new Date())) setLocked(true);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // With no passcode there is nothing to be locked by. Forgetting the flag here also means that a passcode set later
  // (in Settings) does not lock the person who has just set it.
  const hasPin = pin !== undefined;
  useEffect(() => {
    if (!hasPin) setLocked(false);
  }, [hasPin]);

  return { locked: locked && hasPin, unlock: () => setLocked(false) };
}
