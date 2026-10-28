/**
 * Fingerprint unlock with the phone's own WebAuthn platform authenticator, checked entirely on the device: the app keeps
 * the public key from registration and verifies each assertion itself. No server is involved.
 * The lock stops casual access. It does not encrypt the data on the device.
 * Android shows its own prompt and may offer the phone's screen lock instead; that choice belongs to the phone.
 */
import { fromBase64, toBase64 } from '../backup/crypto';
import type { FingerprintCredential } from '../domain/types';
import { constantTimeEqual } from './pin';

const PROMPT_TIMEOUT_MS = 60_000;
/** The challenge is 32 random bytes; anything much shorter is not a challenge worth trusting. */
const MIN_CHALLENGE_BYTES = 16;
const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
/** rpIdHash (32) + flags (1) + signature counter (4). */
const MIN_AUTH_DATA_BYTES = 37;
const P256_COORDINATE_BYTES = 32;

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const standard = text.replace(/-/g, '+').replace(/_/g, '/');
  return fromBase64(standard + '='.repeat((4 - (standard.length % 4)) % 4));
}

const randomBytes = (n: number): Uint8Array<ArrayBuffer> => globalThis.crypto.getRandomValues(new Uint8Array(n));

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data));
}

/** Laptops use the passcode only; the fingerprint is offered on phones and tablets. */
export function isMobileDevice(userAgent: string): boolean {
  return /Android|iPhone|iPad/i.test(userAgent);
}

/** Never throws: no browser, no WebAuthn, a laptop, no enrolled fingerprint or screen lock, or a rejected check all give false. */
export async function isFingerprintAvailable(): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    if (!isMobileDevice(navigator.userAgent)) return false;
    if (!window.PublicKeyCredential) return false;
    return (await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()) === true;
  } catch {
    return false;
  }
}

/** Turns the fingerprint on: asks the phone to create a credential and keeps its id, public key and algorithm. Rejects if that fails. */
export async function registerFingerprint(): Promise<FingerprintCredential> {
  const created = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Masterpiece' },
      user: { id: randomBytes(16), name: 'masterpiece', displayName: 'Masterpiece' },
      challenge: randomBytes(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      attestation: 'none',
      timeout: PROMPT_TIMEOUT_MS,
    },
  })) as PublicKeyCredential | null;
  const response = created?.response as AuthenticatorAttestationResponse | undefined;
  const publicKey = response?.getPublicKey?.();
  if (!created || !response || !publicKey) throw new Error('This browser did not hand over the fingerprint key.');
  const alg = response.getPublicKeyAlgorithm();
  if (alg !== -7 && alg !== -257) throw new Error('This phone chose a fingerprint key type the app cannot check.');
  const spki = new Uint8Array(publicKey);
  try {
    await importVerifyKey(spki, alg);
  } catch {
    throw new Error('The fingerprint key this phone made cannot be used by the app.');
  }
  return { credentialId: toBase64Url(new Uint8Array(created.rawId)), publicKey: toBase64(spki), alg };
}

/** True only when the phone's prompt succeeded and its answer verifies. Cancelled, failed or timed-out prompts give false; never throws. */
export async function unlockWithFingerprint(cred: FingerprintCredential): Promise<boolean> {
  try {
    const challenge = randomBytes(32);
    const got = (await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ type: 'public-key', id: fromBase64Url(cred.credentialId) }],
        userVerification: 'required',
        timeout: PROMPT_TIMEOUT_MS,
      },
    })) as PublicKeyCredential | null;
    const response = got?.response as AuthenticatorAssertionResponse | undefined;
    if (!response) return false;
    return await verifyAssertion({
      cred,
      authenticatorData: new Uint8Array(response.authenticatorData),
      clientDataJSON: new Uint8Array(response.clientDataJSON),
      signature: new Uint8Array(response.signature),
      expectedChallenge: challenge,
      expectedOrigin: location.origin,
      expectedRpId: location.hostname,
    });
  } catch {
    return false;
  }
}

/** Throws if shorter than 37 bytes. */
export function parseAuthenticatorData(bytes: Uint8Array): { rpIdHash: Uint8Array; userPresent: boolean; userVerified: boolean } {
  if (bytes.length < MIN_AUTH_DATA_BYTES) throw new RangeError('Authenticator data is too short');
  const flags = bytes[32];
  return {
    rpIdHash: bytes.slice(0, 32),
    userPresent: (flags & FLAG_USER_PRESENT) !== 0,
    userVerified: (flags & FLAG_USER_VERIFIED) !== 0,
  };
}

/** One DER INTEGER as exactly 32 bytes: leading 0x00 pad bytes removed, short values left-padded with zeros. */
function derIntegerToCoordinate(der: Uint8Array, at: number): { bytes: Uint8Array; next: number } {
  if (der[at] !== 0x02) throw new Error('Expected a DER INTEGER');
  const length = der[at + 1];
  const start = at + 2;
  const end = start + length;
  if (!(length >= 1 && length < 0x80) || end > der.length) throw new Error('Bad DER INTEGER length');
  let from = start;
  while (from < end && der[from] === 0) from++;
  if (end - from > P256_COORDINATE_BYTES) throw new Error('DER INTEGER too large for P-256');
  const out = new Uint8Array(P256_COORDINATE_BYTES);
  out.set(der.subarray(from, end), P256_COORDINATE_BYTES - (end - from));
  return { bytes: out, next: end };
}

/** WebAuthn ES256 signatures are ASN.1 DER; WebCrypto wants raw 64-byte r‖s. Throws on malformed DER. */
export function derToRawEcdsa(der: Uint8Array): Uint8Array {
  if (der.length < 2 || der[0] !== 0x30 || der[1] >= 0x80 || der[1] !== der.length - 2) throw new Error('Expected a DER SEQUENCE');
  const r = derIntegerToCoordinate(der, 2);
  const s = derIntegerToCoordinate(der, r.next);
  if (s.next !== der.length) throw new Error('Unexpected bytes after the signature');
  const raw = new Uint8Array(2 * P256_COORDINATE_BYTES);
  raw.set(r.bytes, 0);
  raw.set(s.bytes, P256_COORDINATE_BYTES);
  return raw;
}

/** ES256 is ECDSA over P-256; RS256 is RSASSA-PKCS1-v1_5. Rejects if the bytes are not a key of that kind. */
function importVerifyKey(spki: Uint8Array<ArrayBuffer>, alg: -7 | -257): Promise<CryptoKey> {
  const { subtle } = globalThis.crypto;
  return alg === -7
    ? subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    : subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

async function signatureMatches(cred: FingerprintCredential, signed: Uint8Array<ArrayBuffer>, signature: Uint8Array): Promise<boolean> {
  const { subtle } = globalThis.crypto;
  if (cred.alg !== -7 && cred.alg !== -257) return false;
  const key = await importVerifyKey(fromBase64(cred.publicKey), cred.alg);
  if (cred.alg === -7) {
    return subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, new Uint8Array(derToRawEcdsa(signature)), signed);
  }
  return subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, new Uint8Array(signature), signed);
}

/** True only if every WebAuthn check passes. Malformed input of any kind gives false; never throws. */
export async function verifyAssertion(input: {
  cred: FingerprintCredential;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
  expectedChallenge: Uint8Array;
  expectedOrigin: string;
  expectedRpId: string;
}): Promise<boolean> {
  try {
    const clientDataJSON = new Uint8Array(input.clientDataJSON);
    const authenticatorData = new Uint8Array(input.authenticatorData);
    const clientData: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(clientDataJSON));
    if (typeof clientData !== 'object' || clientData === null) return false;
    const { type, challenge, origin, crossOrigin } = clientData as Record<string, unknown>;
    if (type !== 'webauthn.get') return false;
    if (input.expectedChallenge.length < MIN_CHALLENGE_BYTES) return false;
    if (challenge !== toBase64Url(input.expectedChallenge)) return false;
    if (origin !== input.expectedOrigin) return false;
    if (crossOrigin === true) return false;

    const auth = parseAuthenticatorData(authenticatorData);
    const expectedRpIdHash = await sha256(new TextEncoder().encode(input.expectedRpId));
    if (!constantTimeEqual(auth.rpIdHash, expectedRpIdHash)) return false;
    if (!auth.userPresent || !auth.userVerified) return false;

    const clientDataHash = await sha256(clientDataJSON);
    const signed = new Uint8Array(authenticatorData.length + clientDataHash.length);
    signed.set(authenticatorData, 0);
    signed.set(clientDataHash, authenticatorData.length);
    return await signatureMatches(input.cred, signed, input.signature);
  } catch {
    return false;
  }
}
