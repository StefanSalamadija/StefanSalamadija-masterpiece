import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  derToRawEcdsa, fromBase64Url, isFingerprintAvailable, isMobileDevice, parseAuthenticatorData,
  registerFingerprint, toBase64Url, unlockWithFingerprint, verifyAssertion,
} from './fingerprint';
import type { FingerprintCredential } from '../domain/types';

type Input = Parameters<typeof verifyAssertion>[0];
type Bytes = Uint8Array<ArrayBuffer>;

const { subtle } = globalThis.crypto;
const ORIGIN = 'http://localhost:4173';
const RP_ID = 'localhost';
const CHALLENGE: Bytes = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 250) % 256);
const OTHER_CHALLENGE: Bytes = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 3) % 256);

const sha256 = async (data: Uint8Array | string): Promise<Bytes> =>
  new Uint8Array(await subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : (data as Bytes)));
const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const b64url = (bytes: Uint8Array): string => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (value: unknown): Bytes => new TextEncoder().encode(JSON.stringify(value));
const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

/** rpIdHash (32) ‖ flags (1) ‖ signature counter (4), the shape every WebAuthn assertion has. */
async function authData(flags: number, rpId = RP_ID): Promise<Bytes> {
  return concat(await sha256(rpId), Uint8Array.of(flags, 0, 0, 0, 1));
}

/** One ASN.1 INTEGER the way a DER encoder writes it: no needless leading zeros, one 0x00 pad when the top bit is set. */
function derInt(value: Uint8Array): number[] {
  let start = 0;
  while (start < value.length - 1 && value[start] === 0) start++;
  let body = Array.from(value.subarray(start));
  if (body[0] >= 0x80) body = [0, ...body];
  return [0x02, body.length, ...body];
}

/** WebCrypto gives raw r‖s; an authenticator gives DER. This converts the first into the second. */
function rawToDer(raw: Uint8Array): Bytes {
  const r = derInt(raw.subarray(0, 32));
  const s = derInt(raw.subarray(32));
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}

/** Last byte lives inside `s` for ES256 (and inside the big number for RS256): still well-formed, no longer a valid signature. */
function flipByte(bytes: Uint8Array): Bytes {
  const out = new Uint8Array(bytes);
  out[out.length - 1] ^= 0x01;
  return out;
}

interface Signer { cred: FingerprintCredential; sign(data: Uint8Array): Promise<Bytes> }

async function es256Signer(): Promise<Signer> {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = new Uint8Array(await subtle.exportKey('spki', pair.publicKey));
  return {
    cred: { credentialId: 'Y3JlZC0x', publicKey: b64(spki), alg: -7 },
    sign: async (data) => rawToDer(new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, data as Bytes))),
  };
}

async function rs256Signer(): Promise<Signer> {
  const pair = await subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-256' }, true, ['sign', 'verify'],
  );
  const spki = new Uint8Array(await subtle.exportKey('spki', pair.publicKey));
  return {
    cred: { credentialId: 'Y3JlZC0y', publicKey: b64(spki), alg: -257 },
    sign: async (data) => new Uint8Array(await subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, data as Bytes)),
  };
}

interface Made { flags: number; type: string; challenge: Uint8Array; origin: string; rpId: string }

/** A complete assertion whose signature covers whatever the overrides put in it, so each test breaks exactly one rule. */
async function assertion(signer: Signer, made: Partial<Made> = {}): Promise<Input> {
  const m: Made = { flags: 0x05, type: 'webauthn.get', challenge: CHALLENGE, origin: ORIGIN, rpId: RP_ID, ...made };
  const authenticatorData = await authData(m.flags, m.rpId);
  const clientDataJSON = enc({ type: m.type, challenge: b64url(m.challenge), origin: m.origin });
  const signature = await signer.sign(concat(authenticatorData, await sha256(clientDataJSON)));
  return { cred: signer.cred, authenticatorData, clientDataJSON, signature, expectedChallenge: CHALLENGE, expectedOrigin: ORIGIN, expectedRpId: RP_ID };
}

afterEach(() => vi.unstubAllGlobals());

describe('base64url', () => {
  it('uses - and _ and no padding, and round-trips', () => {
    const vectors: [number[], string][] = [[[0xfb, 0xff, 0xfe], '-__-'], [[1], 'AQ'], [[1, 2], 'AQI'], [[1, 2, 3], 'AQID'], [[], '']];
    for (const [bytes, text] of vectors) {
      expect(toBase64Url(Uint8Array.from(bytes))).toBe(text);
      expect(fromBase64Url(text)).toEqual(Uint8Array.from(bytes));
    }
    expect(fromBase64Url(toBase64Url(CHALLENGE))).toEqual(CHALLENGE);
  });

  it('refuses text that is not base64url', () => {
    expect(() => fromBase64Url('ab$d')).toThrow();
    expect(() => fromBase64Url('abcde')).toThrow();
  });
});

describe('isMobileDevice', () => {
  it('is true for Android, iPhone and iPad and false for laptops', () => {
    expect(isMobileDevice('Mozilla/5.0 (Linux; Android 14; Pixel 7)')).toBe(true);
    expect(isMobileDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true);
    expect(isMobileDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe(true);
    expect(isMobileDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
    expect(isMobileDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(false);
  });
});

describe('isFingerprintAvailable', () => {
  const platformCheck = (result: () => Promise<boolean>) => ({ PublicKeyCredential: { isUserVerifyingPlatformAuthenticatorAvailable: result } });
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7)';
  const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

  it('is false where there is no browser (Node)', async () => {
    expect(await isFingerprintAvailable()).toBe(false);
  });

  it('is true on a phone whose platform authenticator is available', async () => {
    vi.stubGlobal('window', platformCheck(async () => true));
    vi.stubGlobal('navigator', { userAgent: ANDROID });
    expect(await isFingerprintAvailable()).toBe(true);
  });

  it('is false on a laptop even when the platform authenticator is available', async () => {
    vi.stubGlobal('window', platformCheck(async () => true));
    vi.stubGlobal('navigator', { userAgent: WINDOWS });
    expect(await isFingerprintAvailable()).toBe(false);
  });

  it('is false on a phone without an enrolled fingerprint or screen lock', async () => {
    vi.stubGlobal('window', platformCheck(async () => false));
    vi.stubGlobal('navigator', { userAgent: ANDROID });
    expect(await isFingerprintAvailable()).toBe(false);
  });

  it('is false, without throwing, when the browser has no WebAuthn or the check rejects', async () => {
    vi.stubGlobal('navigator', { userAgent: ANDROID });
    vi.stubGlobal('window', {});
    expect(await isFingerprintAvailable()).toBe(false);
    vi.stubGlobal('window', platformCheck(async () => { throw new DOMException('blocked', 'NotAllowedError'); }));
    expect(await isFingerprintAvailable()).toBe(false);
  });
});

describe('parseAuthenticatorData', () => {
  it('reads the user-present and user-verified flags', async () => {
    expect(parseAuthenticatorData(await authData(0x05))).toMatchObject({ userPresent: true, userVerified: true });
    expect(parseAuthenticatorData(await authData(0x01))).toMatchObject({ userPresent: true, userVerified: false });
    expect(parseAuthenticatorData(await authData(0x04))).toMatchObject({ userPresent: false, userVerified: true });
    expect(parseAuthenticatorData(await authData(0x00))).toMatchObject({ userPresent: false, userVerified: false });
  });

  it('ignores other flag bits such as attested-credential-data', async () => {
    expect(parseAuthenticatorData(await authData(0x45))).toMatchObject({ userPresent: true, userVerified: true });
    expect(parseAuthenticatorData(await authData(0x40))).toMatchObject({ userPresent: false, userVerified: false });
  });

  it('returns the 32-byte rpIdHash', async () => {
    expect(parseAuthenticatorData(await authData(0x05)).rpIdHash).toEqual(await sha256(RP_ID));
  });

  it('refuses data shorter than 37 bytes', async () => {
    const valid = await authData(0x05);
    expect(() => parseAuthenticatorData(valid.subarray(0, 36))).toThrow();
    expect(() => parseAuthenticatorData(new Uint8Array(0))).toThrow();
  });
});

describe('derToRawEcdsa', () => {
  it('converts a hand-written DER signature to 64 bytes, left-padded', () => {
    const raw = derToRawEcdsa(Uint8Array.of(0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02));
    expect(raw).toHaveLength(64);
    expect(Array.from(raw).filter((b) => b !== 0)).toEqual([1, 2]);
    expect(raw[31]).toBe(1);
    expect(raw[63]).toBe(2);
  });

  it('strips the 0x00 pad that DER puts in front of a value with the top bit set', () => {
    const raw = Uint8Array.from({ length: 64 }, (_, i) => (i === 0 || i === 32 ? 0x80 + i : i + 1));
    const der = rawToDer(raw);
    expect(der.length).toBe(2 + 2 + 33 + 2 + 33);
    expect(derToRawEcdsa(der)).toEqual(raw);
  });

  it('restores leading zero bytes that DER dropped from a short value', () => {
    const raw = Uint8Array.from({ length: 64 }, (_, i) => (i < 2 || (i >= 32 && i < 35) ? 0 : i + 1));
    const der = rawToDer(raw);
    expect(der.length).toBeLessThan(70);
    expect(derToRawEcdsa(der)).toEqual(raw);
  });

  it('round-trips random signatures from the real WebCrypto signer', async () => {
    const signer = await es256Signer();
    for (let i = 0; i < 20; i++) {
      const raw = derToRawEcdsa(await signer.sign(Uint8Array.of(i)));
      expect(raw).toHaveLength(64);
      expect(derToRawEcdsa(rawToDer(raw))).toEqual(raw);
    }
  });

  it('refuses malformed DER', () => {
    const bad: number[][] = [
      [],
      [0x30],
      [0x31, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02],             // not a SEQUENCE
      [0x30, 0x07, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02],             // sequence longer than the data
      [0x30, 0x05, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02],             // sequence shorter than the data
      [0x30, 0x06, 0x03, 0x01, 0x01, 0x02, 0x01, 0x02],             // r is not an INTEGER
      [0x30, 0x06, 0x02, 0x01, 0x01, 0x04, 0x01, 0x02],             // s is not an INTEGER
      [0x30, 0x04, 0x02, 0x00, 0x02, 0x00],                         // empty integers
      [0x30, 0x05, 0x02, 0x01, 0x01, 0x02, 0x05],                   // s runs past the end
      [0x30, 0x08, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02, 0x00, 0x00], // trailing bytes inside the sequence
      [0x30, 0x27, 0x02, 0x22, 0x01, ...new Array(33).fill(7), 0x02, 0x01, 0x01], // r needs more than 32 bytes
    ];
    for (const der of bad) expect(() => derToRawEcdsa(Uint8Array.from(der))).toThrow();
  });
});

describe('verifyAssertion (ES256)', () => {
  let es: Signer;
  let good: Input;
  beforeAll(async () => {
    es = await es256Signer();
    good = await assertion(es);
  });

  it('accepts a genuine assertion', async () => {
    expect(await verifyAssertion(good)).toBe(true);
  });

  it('accepts many genuine assertions, whatever shape their DER takes', async () => {
    for (let i = 0; i < 30; i++) {
      const signed = await assertion(es, { challenge: Uint8Array.of(i, i + 1, i + 2) });
      expect(await verifyAssertion({ ...signed, expectedChallenge: Uint8Array.of(i, i + 1, i + 2) })).toBe(true);
    }
  });

  it('refuses a different challenge', async () => {
    expect(await verifyAssertion({ ...good, expectedChallenge: OTHER_CHALLENGE })).toBe(false);
    expect(await verifyAssertion(await assertion(es, { challenge: OTHER_CHALLENGE }))).toBe(false);
  });

  it('refuses a different origin', async () => {
    expect(await verifyAssertion({ ...good, expectedOrigin: 'https://evil.example' })).toBe(false);
    expect(await verifyAssertion(await assertion(es, { origin: 'https://evil.example' }))).toBe(false);
  });

  it('refuses a different relying party id', async () => {
    expect(await verifyAssertion({ ...good, expectedRpId: 'example.com' })).toBe(false);
    expect(await verifyAssertion(await assertion(es, { rpId: 'example.com' }))).toBe(false);
  });

  it('refuses an assertion that is not a get (for example a registration)', async () => {
    expect(await verifyAssertion(await assertion(es, { type: 'webauthn.create' }))).toBe(false);
    expect(await verifyAssertion(await assertion(es, { type: '' }))).toBe(false);
  });

  it('refuses when the user was not verified (re-signed, so only the flag is wrong)', async () => {
    const noUv = await assertion(es, { flags: 0x01 });
    expect(await verifyAssertion(noUv)).toBe(false);
  });

  it('refuses when the user was not present (re-signed, so only the flag is wrong)', async () => {
    const noUp = await assertion(es, { flags: 0x04 });
    expect(await verifyAssertion(noUp)).toBe(false);
  });

  it('refuses an altered signature, altered authenticator data and altered client data', async () => {
    expect(await verifyAssertion({ ...good, signature: flipByte(good.signature) })).toBe(false);
    const counter = new Uint8Array(good.authenticatorData);
    counter[36] ^= 0x01;
    expect(await verifyAssertion({ ...good, authenticatorData: counter })).toBe(false);
    const extra = enc({ type: 'webauthn.get', challenge: b64url(CHALLENGE), origin: ORIGIN, extra: 1 });
    expect(await verifyAssertion({ ...good, clientDataJSON: extra })).toBe(false);
  });

  it('refuses a signature made by a different key', async () => {
    const other = await es256Signer();
    const forged = await assertion(other);
    expect(await verifyAssertion({ ...forged, cred: es.cred })).toBe(false);
  });

  it('answers false, never throws, for malformed input', async () => {
    const empty = new Uint8Array(0);
    const cases: Input[] = [
      { ...good, clientDataJSON: new TextEncoder().encode('{not json') },
      { ...good, clientDataJSON: new TextEncoder().encode('null') },
      { ...good, clientDataJSON: new TextEncoder().encode('"webauthn.get"') },
      { ...good, clientDataJSON: new TextEncoder().encode('[]') },
      { ...good, clientDataJSON: Uint8Array.of(0xff, 0xfe, 0xfd) },
      { ...good, clientDataJSON: empty },
      { ...good, authenticatorData: good.authenticatorData.subarray(0, 36) },
      { ...good, authenticatorData: empty },
      { ...good, signature: empty },
      { ...good, signature: good.signature.subarray(0, 20) },
      { ...good, signature: Uint8Array.of(0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01) },
      { ...good, cred: { ...es.cred, publicKey: 'AAAA' } },
      { ...good, cred: { ...es.cred, publicKey: '***not base64***' } },
      { ...good, cred: { ...es.cred, publicKey: '' } },
      { ...good, cred: { ...es.cred, alg: -8 as -7 } },
      { ...good, cred: { ...es.cred, alg: -257 } },
      { ...good, clientDataJSON: enc({ type: 'webauthn.get', challenge: 42, origin: ORIGIN }) },
    ];
    for (const input of cases) expect(await verifyAssertion(input)).toBe(false);
  });
});

describe('verifyAssertion (RS256)', () => {
  it('accepts a genuine assertion and refuses an altered one', async () => {
    const rs = await rs256Signer();
    const good = await assertion(rs);
    expect(await verifyAssertion(good)).toBe(true);
    expect(await verifyAssertion({ ...good, signature: flipByte(good.signature) })).toBe(false);
    expect(await verifyAssertion({ ...good, expectedChallenge: OTHER_CHALLENGE })).toBe(false);
    expect(await verifyAssertion(await assertion(rs, { flags: 0x01 }))).toBe(false);
    expect(await verifyAssertion({ ...good, cred: { ...rs.cred, alg: -7 } })).toBe(false);
  });
});

describe('registerFingerprint and unlockWithFingerprint (browser wrappers, stubbed authenticator)', () => {
  const toAB = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;
  const CRED_ID = Uint8Array.from({ length: 16 }, (_, i) => 200 + i);
  let es: Signer;
  beforeAll(async () => { es = await es256Signer(); });

  /** A stand-in for the platform authenticator: signs whatever challenge it is handed. */
  function stubBrowser(sign: Signer, claimed: { origin: string; rpId: string } = { origin: ORIGIN, rpId: RP_ID }) {
    const get = vi.fn(async (options: CredentialRequestOptions) => {
      const challenge = options.publicKey!.challenge as Uint8Array;
      const made = await assertion(sign, { challenge, origin: claimed.origin, rpId: claimed.rpId });
      return {
        rawId: toAB(CRED_ID),
        response: { authenticatorData: toAB(made.authenticatorData), clientDataJSON: toAB(made.clientDataJSON), signature: toAB(made.signature) },
      };
    });
    vi.stubGlobal('navigator', { credentials: { get } });
    vi.stubGlobal('location', { origin: ORIGIN, hostname: RP_ID });
    return get;
  }

  it('unlocks when the authenticator answers the challenge it was given', async () => {
    const get = stubBrowser(es);
    const cred = { ...es.cred, credentialId: b64url(CRED_ID) };
    expect(await unlockWithFingerprint(cred)).toBe(true);
    const pk = get.mock.calls[0][0].publicKey!;
    expect(pk.userVerification).toBe('required');
    expect(pk.timeout).toBe(60_000);
    expect((pk.challenge as Uint8Array).length).toBe(32);
    const allowed = pk.allowCredentials!;
    expect(allowed).toHaveLength(1);
    expect(allowed[0].type).toBe('public-key');
    expect(new Uint8Array(allowed[0].id as ArrayBuffer)).toEqual(CRED_ID);
  });

  it('asks for a fresh challenge every time', async () => {
    const get = stubBrowser(es);
    await unlockWithFingerprint(es.cred);
    await unlockWithFingerprint(es.cred);
    expect(get.mock.calls[0][0].publicKey!.challenge).not.toEqual(get.mock.calls[1][0].publicKey!.challenge);
  });

  it('refuses an answer for another origin or relying party', async () => {
    stubBrowser(es, { origin: 'https://evil.example', rpId: RP_ID });
    expect(await unlockWithFingerprint(es.cred)).toBe(false);
    stubBrowser(es, { origin: ORIGIN, rpId: 'evil.example' });
    expect(await unlockWithFingerprint(es.cred)).toBe(false);
  });

  it('refuses an answer signed by a different key', async () => {
    stubBrowser(await es256Signer());
    expect(await unlockWithFingerprint(es.cred)).toBe(false);
  });

  it('returns false, never throws, when the prompt is cancelled, times out or the browser has no credentials API', async () => {
    for (const name of ['NotAllowedError', 'AbortError', 'SecurityError']) {
      vi.stubGlobal('navigator', { credentials: { get: async () => { throw new DOMException('no', name); } } });
      vi.stubGlobal('location', { origin: ORIGIN, hostname: RP_ID });
      expect(await unlockWithFingerprint(es.cred)).toBe(false);
    }
    vi.stubGlobal('navigator', { credentials: { get: async () => null } });
    expect(await unlockWithFingerprint(es.cred)).toBe(false);
    vi.stubGlobal('navigator', {});
    expect(await unlockWithFingerprint(es.cred)).toBe(false);
  });

  it('registers a platform credential and stores its id, SPKI key and algorithm', async () => {
    const spki = new Uint8Array(await subtle.exportKey('spki', (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify', 'sign'])).publicKey));
    const create = vi.fn(async (_options: CredentialCreationOptions) => ({
      rawId: toAB(CRED_ID),
      response: { getPublicKey: () => toAB(spki), getPublicKeyAlgorithm: () => -7 },
    }));
    vi.stubGlobal('navigator', { credentials: { create } });
    expect(await registerFingerprint()).toEqual({ credentialId: b64url(CRED_ID), publicKey: b64(spki), alg: -7 });

    const pk = create.mock.calls[0][0].publicKey!;
    expect(pk.rp).toEqual({ name: 'Masterpiece' });
    expect(pk.user.name).toBe('masterpiece');
    expect(pk.user.displayName).toBe('Masterpiece');
    expect((pk.user.id as Uint8Array).length).toBe(16);
    expect((pk.challenge as Uint8Array).length).toBe(32);
    expect(pk.pubKeyCredParams).toEqual([{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }]);
    expect(pk.authenticatorSelection).toEqual({ authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' });
    expect(pk.attestation).toBe('none');
    expect(pk.timeout).toBe(60_000);
  });

  it('rejects when the browser cannot hand back the public key or chose an algorithm the app cannot verify', async () => {
    const answer = (response: object) => vi.stubGlobal('navigator', { credentials: { create: async () => ({ rawId: toAB(CRED_ID), response }) } });
    answer({ getPublicKey: () => null, getPublicKeyAlgorithm: () => -7 });
    await expect(registerFingerprint()).rejects.toThrow();
    answer({ getPublicKeyAlgorithm: () => -7 });
    await expect(registerFingerprint()).rejects.toThrow();
    answer({ getPublicKey: () => toAB(Uint8Array.of(1, 2, 3)), getPublicKeyAlgorithm: () => -8 });
    await expect(registerFingerprint()).rejects.toThrow();
    vi.stubGlobal('navigator', { credentials: { create: async () => null } });
    await expect(registerFingerprint()).rejects.toThrow();
  });
});
