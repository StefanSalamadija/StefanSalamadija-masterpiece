import { useEffect, useState } from 'preact/hooks';

/*
 * The Undo toast of quick add (v2 §3.6): one at a time, up for 5 s. It is kept here, outside any screen, so that it
 * stays up when Save moves on to the month the entry went into.
 */

export const UNDO_MS = 5_000;

export interface UndoNotice {
  /** Changes on each new notice, so that a new one with the same text is announced again. */
  key: number;
  message: string;
  undo: () => Promise<void>;
}

let notice: UndoNotice | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let counter = 0;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

/** Clears the toast. */
export function dismissUndo(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  notice = undefined;
  changed();
}

/** Shows `message` with an Undo button for 5 s, replacing any toast before it. */
export function offerUndo(message: string, undo: () => Promise<void>): void {
  if (timer !== undefined) clearTimeout(timer);
  counter += 1;
  notice = { key: counter, message, undo };
  timer = setTimeout(dismissUndo, UNDO_MS);
  changed();
}

/** The toast being shown, if any. */
export function useUndoNotice(): UndoNotice | undefined {
  const [current, setCurrent] = useState(notice);
  useEffect(() => {
    const update = () => setCurrent(notice);
    listeners.add(update);
    update();
    return () => { listeners.delete(update); };
  }, []);
  return current;
}
