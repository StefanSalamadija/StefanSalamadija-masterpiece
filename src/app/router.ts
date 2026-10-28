import { useEffect, useMemo, useState } from 'preact/hooks';

/**
 * Every route of the app, as hash paths. Fixed words come before the `:id` pattern of their parent, because the
 * first match wins.
 */
const ROUTES = [
  '/',
  '/ship/particulars',
  '/ship/crew',
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
  '/ship/expiring',
  '/ship/voyage',
  '/ship/time',
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

/** Goes to `path` (for example `/ship/crew/new`); the browser's Back button returns to where the user was. */
export function navigate(path: string): void {
  window.location.hash = path.startsWith('#') ? path : `#${path}`;
}

/** The current route. The component re-renders when the hash changes. */
export function useRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const update = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', update);
    update(); // the hash may have changed between the first render and this effect
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return useMemo(() => matchRoute(hash), [hash]);
}
