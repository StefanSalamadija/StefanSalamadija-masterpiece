import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { describeError } from './errors';
import { onceLoaded, SCREEN_LOAD_FAILED } from './lazyLoad';

/**
 * A screen whose code is a chunk of its own, loaded the first time the screen is shown (the fill screen: it keeps the
 * forms' screens out of the main chunk). The service worker precaches every chunk, so it loads offline too. Until it
 * is there the screen says `Loading…`; if it cannot be loaded it says so, and the next visit tries again.
 */
export function lazyScreen(load: () => Promise<ComponentType>): ComponentType {
  const get = onceLoaded(load, SCREEN_LOAD_FAILED);
  let loaded: ComponentType | undefined;
  return function LazyScreen() {
    const [Screen, setScreen] = useState<ComponentType | undefined>(() => loaded);
    const [failed, setFailed] = useState<string>();
    useEffect(() => {
      if (Screen) return;
      get().then((component) => {
        loaded = component;
        setScreen(() => component);
      }, (err: unknown) => setFailed(describeError(err).message));
    }, []);
    if (Screen) return <Screen />;
    if (failed) return <section class="screen"><p class="field-error" role="alert">{failed}</p></section>;
    return <section class="screen"><p class="live" role="status">Loading…</p></section>;
  };
}
