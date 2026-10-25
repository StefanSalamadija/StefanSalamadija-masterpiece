import { registerSW } from 'virtual:pwa-register';

const listeners = new Set<() => void>();
let needRefresh = false;

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    needRefresh = true;
    listeners.forEach((cb) => cb());
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
