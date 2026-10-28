// The e2e files run in Node, but the project has no @types/node, and adding a dependency needs a plan change.
// This declares the few Node calls they (and the test of the form fixtures, which writes to a temporary folder) make.
declare module 'node:fs' {
  export const promises: {
    writeFile(path: string, data: string | Uint8Array): Promise<void>;
    readFile(path: string): Promise<Uint8Array>;
    mkdtemp(prefix: string): Promise<string>;
    rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  };
}
declare module 'node:os' {
  export function tmpdir(): string;
}
