import { strToU8, zipSync } from 'fflate';

/**
 * A zip package built from `{ part path: text or bytes }`, for tests. Text is encoded as UTF-8. Parts are written in
 * the order given (except a name that is only digits, which JavaScript lists first). Nothing here is read from a real
 * company form: the callers invent every part.
 */
export function zipOf(files: Record<string, string | Uint8Array>): Uint8Array {
  const parts: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) parts[path] = typeof content === 'string' ? strToU8(content) : content;
  return zipSync(parts);
}
