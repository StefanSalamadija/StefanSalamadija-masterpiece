/**
 * A loader that runs `load` once and gives every later call the same promise, like `loadFormsEngine`. A failed load is
 * forgotten, so the next call tries again (an app update half done, a chunk the network dropped), and it is told by a
 * plain message instead of the browser's own.
 */
export function onceLoaded<T>(load: () => Promise<T>, failedMessage: string): () => Promise<T> {
  let loading: Promise<T> | undefined;
  return () => {
    loading ??= load().catch((cause: unknown) => {
      loading = undefined;
      throw new Error(failedMessage, { cause });
    });
    return loading;
  };
}

/** Said when a screen that is loaded on demand cannot be. */
export const SCREEN_LOAD_FAILED = "This screen couldn't be loaded. Reload the app and try again.";
