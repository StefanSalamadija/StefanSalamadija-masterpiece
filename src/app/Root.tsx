import { useEffect, useState } from 'preact/hooks';
import { connectionWatch } from '../db/connection';
import { DatabaseNotice } from '../ui/screens/DatabaseNotice';
import { App } from './App';
import { startupNotice, startupState, subscribeStartup } from './startup';

/**
 * The app, once its data is open, or the reason it cannot be shown. The app is not drawn until the data is open, and is
 * taken away for good when another tab updates the database under it.
 */
export function Root() {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const changed = (): void => setVersion((version) => version + 1);
    const stops = [connectionWatch.subscribe(changed), subscribeStartup(changed)];
    changed(); // something may have changed between the first render and this effect
    return () => stops.forEach((stop) => stop());
  }, []);

  const startup = startupState();
  const notice = startupNotice(connectionWatch.problem(), startup);
  if (notice) return <DatabaseNotice notice={notice} />;
  return startup.status === 'ready' ? <App /> : null;
}
