/** How often a running app asks the server whether a newer version exists. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface UpdateEnvironment {
  isOnline(): boolean;
  /** Fires `online` when the connection comes back. */
  events: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
}

/**
 * Keeps looking for a new version while the app stays open: every 60 minutes while online, and once each time the
 * connection comes back. (The browser itself checks when the app starts.) A failed check is ignored; the next one
 * tries again. Returns a function that stops the checks.
 */
export function scheduleUpdateChecks(registration: { update(): Promise<unknown> }, env: UpdateEnvironment): () => void {
  const check = async (): Promise<void> => {
    try {
      await registration.update();
    } catch {
      // Offline or the server is unreachable: nothing to do until the next check.
    }
  };
  const timer = setInterval(() => {
    if (env.isOnline()) void check();
  }, UPDATE_CHECK_INTERVAL_MS);
  const onOnline = (): void => void check();
  env.events.addEventListener('online', onOnline);
  return () => {
    clearInterval(timer);
    env.events.removeEventListener('online', onOnline);
  };
}
