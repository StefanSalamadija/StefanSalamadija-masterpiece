import { registerSW } from 'virtual:pwa-register';
import { scheduleUpdateChecks } from './updateSchedule';

const listeners = new Set<() => void>();
let needRefresh = false;

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    needRefresh = true;
    listeners.forEach((cb) => cb());
  },
  onRegisteredSW(_swUrl, registration) {
    // The browser checks for a new version when the app starts; this keeps checking while a phone app stays open for days.
    if (registration) scheduleUpdateChecks(registration, { isOnline: () => navigator.onLine, events: window });
  },
});

/** Subscribe to "a new version is ready". Fires immediately if one is already waiting. Returns an unsubscribe function. */
export function onUpdateAvailable(cb: () => void): () => void {
  listeners.add(cb);
  if (needRefresh) cb();
  return () => {
    listeners.delete(cb);
  };
}

/** Activate the waiting service worker and reload the page. */
export async function applyUpdate(): Promise<void> {
  await updateSW(true);
}
