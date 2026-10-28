import { liveQuery } from 'dexie';
import { useEffect, useState } from 'preact/hooks';
import { reportError } from '../app/errors';

/**
 * The result of a Dexie query, kept up to date: the component re-renders whenever the data the query read changes.
 * `undefined` while the first result is loading, and again while a new one loads after `deps` change.
 * The query must only read; a failure is shown in the error toast.
 */
export function useLive<T>(query: () => Promise<T>, deps: unknown[]): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    setValue(undefined);
    const subscription = liveQuery(query).subscribe({ next: (result) => setValue(() => result), error: reportError });
    return () => subscription.unsubscribe();
  }, deps);
  return value;
}
