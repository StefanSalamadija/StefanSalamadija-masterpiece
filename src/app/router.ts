import { useEffect, useMemo, useState } from 'preact/hooks';

/**
 * Every route of the app, as hash paths. Fixed words come before the `:id` pattern of their parent, because the
 * first match wins.
 */
export const ROUTES = [
  '/',
  '/due',
  '/more',
  // The Ship hub. Its sections, below, all have more segments, so their order against it does not matter.
  '/ship',
  '/due/port',
  '/ship/particulars',
  '/ship/crew',
  '/ship/crew-documents',
  '/ship/crew/new',
  '/ship/crew/import',
  '/ship/crew/print',
  '/ship/crew/:id',
  '/ship/crew/:id/documents/new',
  '/ship/crew/:id/documents/:docId',
  '/ship/certificates',
  '/ship/certificates/new',
  '/ship/certificates/:id',
  '/ship/reliefs',
  // The Expiring screen of before piece 7, now Due before the next port: see `redirectFor`.
  '/ship/expiring',
  '/ship/voyage',
  '/ship/time',
  '/ship/survey',
  '/ship/survey/data',
  '/ship/survey/:id',
  '/ship/survey/:id/report',
  '/forms',
  '/forms/:id/setup',
  '/forms/:id/fill',
  '/tools',
  '/tools/sdt',
  '/tools/volume-mass',
  '/tools/:group',
  '/library',
  '/library/deleted',
  '/library/files',
  '/library/doc/:id',
  '/budget',
  '/budget/add',
  '/budget/add/income',
  '/budget/add/same/:id',
  '/budget/catch-up',
  '/budget/month/:ym',
  '/budget/forecast',
  '/budget/net-worth',
  '/budget/scenarios',
  '/budget/scenarios/:id',
  '/budget/plan',
  '/budget/plan/start',
  '/budget/plan/:section',
  '/budget/trends',
  '/budget/import',
  '/budget/export',
  '/profiles',
  '/settings',
  '/settings/import',
] as const;

export type RoutePath = (typeof ROUTES)[number];

/** `path` is the route pattern that matched (`/ship/crew/:id`, not the id itself); `params` holds the `:name` parts. */
export interface Route {
  path: RoutePath;
  params: Record<string, string>;
}

const HOME: Route = { path: '/', params: {} };

function segments(path: string): string[] {
  return path.split('/').filter((s) => s !== '');
}

function matchPattern(pattern: string, parts: string[]): Record<string, string> | undefined {
  const wanted = segments(pattern);
  if (wanted.length !== parts.length) return undefined;
  const params: Record<string, string> = {};
  for (const [i, want] of wanted.entries()) {
    if (want.startsWith(':')) params[want.slice(1)] = parts[i];
    else if (want !== parts[i]) return undefined;
  }
  return params;
}

/** The route for a `location.hash` such as `#/ship/crew/abc`. A query string and a trailing slash are ignored; anything unknown is Home. */
export function matchRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').split('?')[0];
  let parts: string[];
  try {
    parts = segments(path).map(decodeURIComponent);
  } catch {
    return HOME; // a malformed %-escape
  }
  for (const pattern of ROUTES) {
    const params = matchPattern(pattern, parts);
    if (params) return { path: pattern, params };
  }
  return HOME;
}

/** The route that `path` (a route pattern) has moved to, if it has: an old link or bookmark still opens its screen. */
export function redirectFor(path: string): string | undefined {
  return path === '/ship/expiring' ? '/due/port' : undefined;
}

/** Goes to `path` (for example `/ship/crew/new`); the browser's Back button returns to where the user was. */
export function navigate(path: string): void {
  window.location.hash = path.startsWith('#') ? path : `#${path}`;
}

/**
 * The current route. The component re-renders when the hash changes. A route that has moved (`redirectFor`) is the route
 * it moved to at once, and the address is replaced with it, so the old one leaves the history and Back does not return to it.
 */
export function useRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const update = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', update);
    update(); // the hash may have changed between the first render and this effect
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const route = useMemo(() => matchRoute(hash), [hash]);
  const target = redirectFor(route.path);
  useEffect(() => {
    if (target) window.location.replace(`#${target}`);
  }, [target]);
  return useMemo(() => (target ? matchRoute(target) : route), [route, target]);
}
