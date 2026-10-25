// The e2e files run in Node, but the project has no @types/node, and adding a dependency needs a plan change.
// This declares the one call they make: writing a test file to disk.
declare module 'node:fs' {
  export const promises: { writeFile(path: string, data: string | Uint8Array): Promise<void> };
}
