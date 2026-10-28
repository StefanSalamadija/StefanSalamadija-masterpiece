import type Dexie from 'dexie';

/**
 * What is wrong with the app's connection to its database, if anything:
 * - `blocked`: this version of the app is upgrading the database and another tab, running an older version, still has it open;
 * - `outdated`: another tab upgraded the database while this one had it open, so the code in this tab is for a database
 *   that no longer exists as it knows it;
 * - `erased`: another tab deleted the database ("Erase everything"), so there is no data left for this tab to show.
 */
export type ConnectionProblem = 'blocked' | 'outdated' | 'erased';

export interface ConnectionWatch {
  /** Starts listening to the database's connection events. */
  watch: (db: Dexie) => void;
  problem: () => ConnectionProblem | undefined;
  /** Calls `listener` whenever the problem changes. Returns an unsubscribe function. */
  subscribe: (listener: () => void) => () => void;
}

/**
 * Keeps track of the connection problems of the databases it watches. `outdated` and `erased` are final: the connection
 * is closed and not reopened, so that this tab can write nothing more, and only a reload (which loads the newer code, or
 * starts from nothing) ends them; the first of the two that is heard is kept. `blocked` lasts until the database is open.
 */
export function createConnectionWatch(): ConnectionWatch {
  let current: ConnectionProblem | undefined;
  const listeners = new Set<() => void>();

  function set(next: ConnectionProblem | undefined): void {
    if (next === current) return;
    current = next;
    listeners.forEach((listener) => listener());
  }

  return {
    watch(db) {
      // Dexie's own handler closes the connection too, but lets the next use open it again, now at the version it finds,
      // which this code knows nothing about: it would go on writing records the newer code expects to be different. Returning
      // `false` stops the chain, so that Dexie's handler (which runs after this one) cannot turn the reopening back on.
      // A deletion is told from an upgrade by its new version, which is `null`.
      db.on('versionchange', (event) => {
        db.close({ disableAutoOpen: true });
        if (!isFinal(current)) set(event.newVersion === null ? 'erased' : 'outdated');
        return false;
      });
      db.on('blocked', () => {
        if (!isFinal(current)) set('blocked');
      });
      db.on('ready', () => {
        if (current === 'blocked') set(undefined);
      });
    },
    problem: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Whether a problem ends this tab's use of the database for good. */
function isFinal(problem: ConnectionProblem | undefined): boolean {
  return problem === 'outdated' || problem === 'erased';
}

/** The app's one watch, on the app's one database (see `getDb`). */
export const connectionWatch = createConnectionWatch();
