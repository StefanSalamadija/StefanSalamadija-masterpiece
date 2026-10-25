/** The 4-digit passcode: hashing, checking, wrong-attempt lockout and relock timing. Pure rules plus WebCrypto; no storage here. */
import { SALT_BYTES, fromBase64, toBase64 } from '../backup/crypto';
import type { LockoutState, PinHash } from '../domain/types';

const PIN_ITERATIONS = 100_000;
const HASH_BYTES = 32;
/** From the 5th wrong passcode on: 30 s, then 60 s, then 300 s for the 7th and every later one. */
const LOCK_AFTER_FAILURES = 5;
const LOCK_MS = [30_000, 60_000, 300_000] as const;
const MAX_LOCK_MS = LOCK_MS[LOCK_MS.length - 1];

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const { subtle } = globalThis.crypto;
  const material = await subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, HASH_BYTES * 8);
  return new Uint8Array(bits);
}

export async function hashPin(pin: string, opts: { iterations?: number } = {}): Promise<PinHash> {
  const iterations = opts.iterations ?? PIN_ITERATIONS;
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(pin, salt, iterations);
  return { salt: toBase64(salt), hash: toBase64(hash), iterations };
}

/** Compares every byte, so the time taken does not reveal how many leading bytes matched. Different lengths are never equal. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** False for a wrong passcode, and also for a stored hash that cannot be used (never throws). */
export async function verifyPin(pin: string, h: PinHash): Promise<boolean> {
  try {
    const actual = await derive(pin, fromBase64(h.salt), h.iterations);
    return constantTimeEqual(actual, fromBase64(h.hash));
  } catch {
    return false;
  }
}

export function registerFailure(s: LockoutState, now: Date): LockoutState {
  const failures = s.failures + 1;
  if (failures < LOCK_AFTER_FAILURES) return { failures };
  const lockMs = LOCK_MS[Math.min(failures - LOCK_AFTER_FAILURES, LOCK_MS.length - 1)];
  return { failures, lockedUntil: new Date(now.getTime() + lockMs).toISOString() };
}

export function registerSuccess(): LockoutState {
  return { failures: 0 };
}

/**
 * Milliseconds until another passcode may be tried; 0 when not locked. Capped at the longest lock, so a ship's clock
 * that jumps backwards cannot leave the app locked for hours.
 */
export function lockRemainingMs(s: LockoutState, now: Date): number {
  if (!s.lockedUntil) return 0;
  const remaining = Date.parse(s.lockedUntil) - now.getTime();
  return remaining > 0 ? Math.min(remaining, MAX_LOCK_MS) : 0;
}

/** True once the app has been hidden for more than `relockMinutes`. Never hidden: false. Unreadable time: true (stay locked). */
export function shouldRelock(hiddenAt: string | undefined, now: Date, relockMinutes: number): boolean {
  if (hiddenAt === undefined) return false;
  const hidden = Date.parse(hiddenAt);
  if (Number.isNaN(hidden)) return true;
  return now.getTime() - hidden > relockMinutes * 60_000;
}
