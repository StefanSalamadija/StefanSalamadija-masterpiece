import { useEffect, useMemo, useRef } from 'preact/hooks';
import { reportError } from '../app/errors';

/** How long typing has to pause before the draft is saved. */
export const SAVE_DELAY_MS = 300;

export interface DraftSaver<T> {
  /** Saves `state` once typing has paused for `SAVE_DELAY_MS` (a later call replaces a waiting one). */
  schedule(state: T): void;
  /** Saves a waiting state now; resolves once every save so far has finished (a failure is reported, not thrown). */
  flush(): Promise<void>;
  /** Drops a waiting state (the draft is about to be closed or discarded). */
  cancel(): void;
  /** Resolves once the saves already running have finished, without starting the waiting one. */
  idle(): Promise<void>;
}

/**
 * Saves a draft 300 ms after the last change, one save after another, and at once when the screen is left, the app is
 * hidden or the page goes away. `persist` does the saving (the first one may create the draft); `canSave` is asked
 * before each save, so nothing is saved once the draft is closed. A failed save goes to the error toast.
 */
export function useDraftSaver<T>(persist: (state: T) => Promise<void>, canSave: () => boolean): DraftSaver<T> {
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<{ state: T } | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef({ persist, canSave });
  latest.current = { persist, canSave };

  const saver = useMemo<DraftSaver<T>>(() => {
    const stopTimer = (): void => {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    };
    const flush = (): Promise<void> => {
      stopTimer();
      const waiting = pending.current;
      pending.current = undefined;
      if (waiting !== undefined && latest.current.canSave()) {
        chain.current = chain.current.then(() => latest.current.persist(waiting.state)).catch(reportError);
      }
      return chain.current;
    };
    return {
      schedule(state) {
        pending.current = { state };
        stopTimer();
        timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
      },
      flush,
      cancel() {
        stopTimer();
        pending.current = undefined;
      },
      idle: () => chain.current,
    };
  }, []);

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') void saver.flush();
    };
    const onPageHide = (): void => void saver.flush();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      void saver.flush(); // the screen is left
    };
  }, [saver]);
  return saver;
}
