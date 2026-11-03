/*
 * The one way the app's screens reach the forms engine. Everything under `src/forms` (with fflate and @xmldom/xmldom) is
 * loaded here, on demand, through dynamic `import()`, so that it is a chunk of its own and not in the app's main chunk.
 * The service worker precaches that chunk, so it loads offline too. A screen may import types from `src/forms` (`import
 * type`), never its code: only this file.
 */

/**
 * The engine (import, make file), auto-fill, the helpers, revisions, and the error classes (so that a screen can tell a
 * `FormFileError`, whose message is for the person, from any other failure).
 */
export type FormsEngine = typeof import('./engine') & typeof import('./autofill') & typeof import('./helpers')
  & typeof import('./revision') & typeof import('./errors');

/** Said when the chunk cannot be loaded (an app update half done, say). */
export const ENGINE_LOAD_FAILED = "The forms engine couldn't be loaded. Reload the app and try again.";

let loading: Promise<FormsEngine> | undefined;

/** Loads the forms engine once; later calls get the same modules. A failed load is tried again on the next call. */
export function loadFormsEngine(): Promise<FormsEngine> {
  loading ??= Promise.all([import('./engine'), import('./autofill'), import('./helpers'), import('./revision'), import('./errors')])
    .then(([engine, autofill, helpers, revision, errors]) => ({ ...engine, ...autofill, ...helpers, ...revision, ...errors }))
    .catch((cause: unknown) => {
      loading = undefined;
      throw new Error(ENGINE_LOAD_FAILED, { cause });
    });
  return loading;
}
