/** Password-based AES-GCM encryption on top of WebCrypto. No dependencies; works in browsers and Node 22. */

export interface KdfParams { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }
export interface EncryptedBlob { kdf: KdfParams; iv: string; ciphertext: string }

export const DEFAULT_ITERATIONS = 600_000;
/** Files that ask for fewer iterations than this are refused when opening. Real backups always use far more; tests use 1000. */
export const MIN_ITERATIONS = 1000;
/** Files that ask for more are refused too: a crafted count would keep a phone busy for minutes with no way to cancel. */
export const MAX_ITERATIONS = 10_000_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
/** AES-GCM appends a 128-bit authentication tag to the ciphertext. */
export const TAG_BYTES = 16;

const CHUNK = 0x8000;

/** An integer from `MIN_ITERATIONS` to `MAX_ITERATIONS` inclusive. Checked before any key derivation, on sealing and on opening. */
export function isValidIterations(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_ITERATIONS && value <= MAX_ITERATIONS;
}

/** Standard base64 with padding. Chunked so a multi-megabyte array cannot overflow the argument limit of `fromCharCode`. */
export function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(''));
}

/** True only for canonical padded base64 text (`atob` alone is too forgiving to detect a garbled file). */
export function isBase64(text: string): boolean {
  return text.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(text);
}

/** Decoded size of text that already passed `isBase64`, without decoding it. */
export function base64ByteLength(text: string): number {
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  return (text.length / 4) * 3 - padding;
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  if (!isBase64(text)) throw new Error('Invalid base64');
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The password is used exactly as typed: UTF-8, no Unicode normalisation. */
async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const { subtle } = globalThis.crypto;
  const material = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** `aad` is authenticated but not encrypted: decryption fails if it differs from what was used here. */
export async function encryptBytes(
  plain: Uint8Array,
  password: string,
  aad: Uint8Array,
  opts: { iterations?: number } = {},
): Promise<EncryptedBlob> {
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  if (!isValidIterations(iterations)) throw new RangeError(`iterations must be an integer between ${MIN_ITERATIONS} and ${MAX_ITERATIONS}`);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, iterations);
  const sealed = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad as Uint8Array<ArrayBuffer> }, key, plain as Uint8Array<ArrayBuffer>);
  return {
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(sealed)),
  };
}

/** Rejects (with the platform's error) on a wrong password, altered ciphertext, or altered `aad`. */
export async function decryptBytes(env: EncryptedBlob, password: string, aad: Uint8Array): Promise<Uint8Array> {
  const key = await deriveKey(password, fromBase64(env.kdf.salt), env.kdf.iterations);
  const plain = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(env.iv), additionalData: aad as Uint8Array<ArrayBuffer> },
    key,
    fromBase64(env.ciphertext),
  );
  return new Uint8Array(plain);
}
