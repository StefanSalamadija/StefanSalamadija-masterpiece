import { matchRoute } from './router';

/** The lists, which are returned to at the place they were left. Every other screen starts at the top. */
const RESTORED_ROUTES: ReadonlySet<string> = new Set(['/ship/crew', '/ship/certificates']);

export interface ScrollMemory {
  /** Notes where `path` (a route pattern) is scrolled to. Only the list routes are kept. */
  remember: (path: string, y: number) => void;
  /** Where to scroll to on arriving at `path`: the last place of a list route, else the top. */
  positionFor: (path: string) => number;
}

export function createScrollMemory(restored: ReadonlySet<string> = RESTORED_ROUTES): ScrollMemory {
  const positions = new Map<string, number>();
  return {
    remember(path, y) {
      if (restored.has(path)) positions.set(path, Math.max(0, y));
    },
    positionFor(path) {
      return positions.get(path) ?? 0;
    },
  };
}

/** The app's one memory, for as long as the page is open. */
export const scrollMemory = createScrollMemory();

/**
 * Notes where a list was scrolled to at the moment the user leaves it. Call it once, before the app is rendered:
 * the router swaps the screen as soon as it sees the `hashchange`, and a shorter screen makes the browser move the
 * page, so this has to be the first listener of the event, to read the place while the old screen is still there.
 * Returns a function that stops noting.
 */
export function rememberPlaceOnLeaving(memory: ScrollMemory): () => void {
  const onLeave = (event: HashChangeEvent): void => {
    memory.remember(matchRoute(new URL(event.oldURL).hash).path, window.scrollY);
  };
  window.addEventListener('hashchange', onLeave, true);
  return () => window.removeEventListener('hashchange', onLeave, true);
}

/**
 * Scrolls the page to `y`. A screen that shows data it is still loading is too short at first, so while it is shorter
 * than `y` needs, the scrolling is repeated as the page grows (up to `timeoutMs`), and given up as soon as the user
 * scrolls themselves. Returns a function that stops it.
 */
export function scrollToWhenTallEnough(y: number, timeoutMs = 3000): () => void {
  if (y <= 0) {
    window.scrollTo(0, 0);
    return () => {};
  }
  const observer = new ResizeObserver(() => attempt());
  const timer = window.setTimeout(() => stop(), timeoutMs);
  const userEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
  let stopped = false;

  function stop(): void {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    window.clearTimeout(timer);
    for (const type of userEvents) window.removeEventListener(type, stop);
  }

  function attempt(): void {
    const room = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.min(y, room));
    if (room >= y) stop();
  }

  for (const type of userEvents) window.addEventListener(type, stop, { passive: true });
  observer.observe(document.body);
  attempt();
  return stop;
}
