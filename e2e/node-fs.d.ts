// The e2e files run in Node, but the project has no @types/node, and adding a dependency needs a plan change.
// This declares the two calls they make: writing a test file to disk, and reading a downloaded one.
declare module 'node:fs' {
  export const promises: {
    writeFile(path: string, data: string | Uint8Array): Promise<void>;
    readFile(path: string): Promise<Uint8Array>;
  };
}
