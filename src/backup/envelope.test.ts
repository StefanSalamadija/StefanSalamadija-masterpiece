import { describe, expect, it, vi } from 'vitest';
import { MAX_ITERATIONS, MIN_ITERATIONS, decryptBytes, encryptBytes, isValidIterations } from './crypto';
import {
  BackupError, DamagedFileError, NewerVersionError, NotABackupError, WrongPasswordError,
  openBackup, readHeader, sealBackup, validatePassword,
} from './envelope';
import type { BackupHeader, BackupPayload } from './envelope';
import type { CrewMember } from '../domain/types';

const PW = 'lozinka-ćevapi';
const FAST = { iterations: 1000 };
const enc = new TextEncoder();

function crewRec(patch: Partial<CrewMember> = {}): CrewMember {
  return {
    id: 'crew-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: 'dev-A', deleted: false,
    scope: 'ship', shipId: 'ship-1', surname: 'Petrović', givenNames: 'Ivan', rank: 'master', nationality: 'Croatian',
    dateOfBirth: '1980-03-14', placeOfBirth: 'Split', passportNo: 'P1234567', passportExpiry: '2030-01-01',
    seamansBookNo: 'SB-998', seamansBookExpiry: '2030-01-01', signOnDate: '2026-06-01', signOnPort: 'Rijeka',
    ...patch,
  };
}

const H: BackupHeader = {
  format: 'masterpiece-backup', version: 1, kind: 'full', deviceId: 'dev-A', deviceName: 'Android device', exportedAt: '2026-10-25T10:00:00.000Z',
};
const P: BackupPayload = { tables: { ships: [], crew: [crewRec({ surname: 'Šašić' })], voyages: [], certificates: [], clockChanges: [] } };

/** Replace one character in the middle of a base64 string with a different base64 character. */
function flipChar(s: string): string {
  const i = Math.floor(s.length / 2);
  return s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
}

/** The header exactly as the spec defines the authenticated data: fixed key order, UTF-8 JSON. */
function specAad(h: BackupHeader): Uint8Array {
  return enc.encode(JSON.stringify({
    format: h.format, version: h.version, kind: h.kind, deviceId: h.deviceId, deviceName: h.deviceName, exportedAt: h.exportedAt,
  }));
}

let sealed: Promise<string> | undefined;
/** One cheap sealed file shared by the tests that only need to read it. */
const sealedText = (): Promise<string> => (sealed ??= sealBackup(H, P, PW, FAST));
const parsed = async (): Promise<Record<string, any>> => JSON.parse(await sealedText());

/** Build a file whose plaintext is arbitrary bytes, correctly encrypted for header H. */
async function fileWithPlaintext(plain: string): Promise<string> {
  const body = await encryptBytes(enc.encode(plain), PW, specAad(H), FAST);
  return JSON.stringify({ ...H, ...body });
}

describe('sealBackup / openBackup', () => {
  it('round-trips a backup with diacritics, with and without BOM and trailing whitespace', async () => {
    const text = await sealedText();
    expect(await openBackup(text, PW)).toEqual({ header: H, payload: P });
    expect(await openBackup('\uFEFF' + text + '\r\n', PW)).toEqual({ header: H, payload: P });
    expect(await openBackup('  \n' + text, PW)).toEqual({ header: H, payload: P });
  });

  it('writes the header fields in the documented order, then kdf, iv, ciphertext', async () => {
    const j = await parsed();
    expect(Object.keys(j)).toEqual(['format', 'version', 'kind', 'deviceId', 'deviceName', 'exportedAt', 'kdf', 'iv', 'ciphertext']);
    expect(j.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: 1000 });
  });

  it('uses a 16-byte salt and a 12-byte IV, fresh for every seal', async () => {
    const j = await parsed();
    expect(atob(j.kdf.salt).length).toBe(16);
    expect(atob(j.iv).length).toBe(12);
    const other = JSON.parse(await sealBackup(H, P, PW, FAST));
    expect(other.kdf.salt).not.toBe(j.kdf.salt);
    expect(other.iv).not.toBe(j.iv);
    expect(other.ciphertext).not.toBe(j.ciphertext);
  });

  it('does not leak personal data into the file in clear text', async () => {
    const text = await sealedText();
    expect(text).not.toContain('Šašić');
    expect(text).not.toContain('P1234567');
    expect(text).not.toContain('1980-03-14');
  });

  it('seals with 600000 PBKDF2 iterations by default', async () => {
    expect(JSON.parse(await sealBackup(H, P, 'pw-12345678')).kdf.iterations).toBe(600000);
  }, 30_000);

  it('handles a payload of several megabytes', async () => {
    const crew = Array.from({ length: 12_000 }, (_, i) => crewRec({ id: `crew-${i}`, givenNames: `Ivan ${'x'.repeat(200)}` }));
    const big: BackupPayload = { tables: { ...P.tables, crew } };
    const text = await sealBackup(H, big, PW, FAST);
    expect(text.length).toBeGreaterThan(3_000_000);
    const opened = await openBackup(text, PW);
    expect(opened.payload.tables.crew).toHaveLength(12_000);
    expect(opened.payload).toEqual(big);
  });

  it('keeps the password exactly as typed: no Unicode normalisation', async () => {
    const decomposed = 'lozinka-ćevapi';
    expect(decomposed).not.toBe(PW);
    await expect(openBackup(await sealedText(), decomposed)).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('pins the authenticated data to the header as UTF-8 JSON in the documented key order', async () => {
    const j = await parsed();
    const bytes = await decryptBytes({ kdf: j.kdf, iv: j.iv, ciphertext: j.ciphertext }, PW, specAad(H));
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(P);
    await expect(decryptBytes({ kdf: j.kdf, iv: j.iv, ciphertext: j.ciphertext }, PW, enc.encode('{}'))).rejects.toThrow();
  });

  describe('wrong password, tampering', () => {
    it('rejects a wrong password', async () => {
      await expect(openBackup(await sealedText(), 'wrong-password')).rejects.toBeInstanceOf(WrongPasswordError);
    });

    it('rejects a flipped ciphertext character as a wrong password', async () => {
      const j = await parsed();
      await expect(openBackup(JSON.stringify({ ...j, ciphertext: flipChar(j.ciphertext) }), PW)).rejects.toBeInstanceOf(WrongPasswordError);
    });

    it('rejects a flipped IV or salt character as a wrong password', async () => {
      const j = await parsed();
      await expect(openBackup(JSON.stringify({ ...j, iv: flipChar(j.iv) }), PW)).rejects.toBeInstanceOf(WrongPasswordError);
      await expect(openBackup(JSON.stringify({ ...j, kdf: { ...j.kdf, salt: flipChar(j.kdf.salt) } }), PW)).rejects.toBeInstanceOf(WrongPasswordError);
    });

    it.each([
      ['deviceName', 'Evil'],
      ['deviceId', 'dev-B'],
      ['kind', 'handover'],
      ['exportedAt', '2026-10-26T10:00:00.000Z'],
    ])('rejects a tampered %s because the header is authenticated', async (key, value) => {
      const j = await parsed();
      await expect(openBackup(JSON.stringify({ ...j, [key]: value }), PW)).rejects.toBeInstanceOf(WrongPasswordError);
    });

    it('tells the user the exact wrong-password message', async () => {
      await expect(openBackup(await sealedText(), 'wrong-password')).rejects.toThrow('Wrong password, or the file is damaged. Nothing was changed.');
    });
  });

  describe('not a backup', () => {
    it.each([
      ['an unrelated JSON object', '{"foo":1}'],
      ['text that is not JSON', 'not json'],
      ['an empty string', ''],
      ['a JSON array', '[]'],
      ['JSON null', 'null'],
      ['a JSON number', '5'],
    ])('rejects %s', async (_label, text) => {
      await expect(openBackup(text, 'x')).rejects.toBeInstanceOf(NotABackupError);
      expect(() => readHeader(text)).toThrow(NotABackupError);
    });

    it('rejects a wrong format marker', async () => {
      const j = await parsed();
      await expect(openBackup(JSON.stringify({ ...j, format: 'something-else' }), PW)).rejects.toBeInstanceOf(NotABackupError);
    });

    it.each(['format', 'version', 'kind', 'deviceId', 'deviceName', 'exportedAt'])('rejects a header without %s', async (key) => {
      const j = await parsed();
      delete j[key];
      await expect(openBackup(JSON.stringify(j), PW)).rejects.toBeInstanceOf(NotABackupError);
      expect(() => readHeader(JSON.stringify(j))).toThrow(NotABackupError);
    });

    it.each([
      ['version', '1'],
      ['deviceId', 7],
      ['deviceName', null],
      ['exportedAt', 20261025],
      ['kind', ['full']],
    ])('rejects a header whose %s has the wrong type', async (key, value) => {
      const j = await parsed();
      await expect(openBackup(JSON.stringify({ ...j, [key]: value }), PW)).rejects.toBeInstanceOf(NotABackupError);
    });

    it('uses the exact message', () => {
      expect(() => readHeader('{}')).toThrow("This isn't a Masterpiece backup file.");
    });
  });

  describe('newer version', () => {
    it('rejects a file with a newer version before looking at the rest', async () => {
      const j = await parsed();
      await expect(openBackup(JSON.stringify({ ...j, version: 2 }), 'x')).rejects.toBeInstanceOf(NewerVersionError);
      await expect(openBackup(JSON.stringify({ ...j, version: 2, kdf: 'garbled', iv: 5 }), 'x')).rejects.toBeInstanceOf(NewerVersionError);
      expect(() => readHeader(JSON.stringify({ ...j, version: 2 }))).toThrow(NewerVersionError);
    });

    it('still calls a file without the format marker "not a backup", even with a newer version', async () => {
      const j = await parsed();
      await expect(openBackup(JSON.stringify({ ...j, format: 'x', version: 2 }), 'x')).rejects.toBeInstanceOf(NotABackupError);
    });

    it('uses the exact message', async () => {
      const j = await parsed();
      expect(() => readHeader(JSON.stringify({ ...j, version: 2 }))).toThrow(
        'This backup was made by a newer version of Masterpiece. Connect to the internet and reopen the app to update it, then try again.',
      );
    });
  });

  describe('damaged file', () => {
    it.each([
      ['version 0', { version: 0 }],
      ['a fractional version', { version: 0.5 }],
      ['a negative version', { version: -1 }],
      ['an unknown kind', { kind: 'banana' }],
    ])('rejects %s in the header', async (_label, patch) => {
      const j = await parsed();
      await expect(openBackup(JSON.stringify({ ...j, ...patch }), PW)).rejects.toBeInstanceOf(DamagedFileError);
      expect(() => readHeader(JSON.stringify({ ...j, ...patch }))).toThrow(DamagedFileError);
    });

    it.each(['kdf', 'iv', 'ciphertext'])('rejects a file without %s', async (key) => {
      const j = await parsed();
      delete j[key];
      await expect(openBackup(JSON.stringify(j), PW)).rejects.toBeInstanceOf(DamagedFileError);
    });

    it.each([
      ['kdf that is a string', { kdf: 'PBKDF2' }],
      ['kdf that is null', { kdf: null }],
      ['iv that is a number', { iv: 12 }],
      ['ciphertext that is empty', { ciphertext: '' }],
      ['ciphertext that is not base64', { ciphertext: 'not base64 at all!' }],
      ['ciphertext with broken padding', { ciphertext: 'QUJD=' }],
      ['an iv of the wrong length', { iv: btoa('too short') }],
      ['an iv that is not base64', { iv: '!!!!!!!!!!!!' }],
      ['ciphertext shorter than a GCM tag', { ciphertext: btoa('short') }],
    ])('rejects %s', async (_label, patch) => {
      const j = await parsed();
      await expect(openBackup(JSON.stringify({ ...j, ...patch }), PW)).rejects.toBeInstanceOf(DamagedFileError);
    });

    it.each([
      ['a salt that is not base64', { salt: '***' }],
      ['a salt of the wrong length', { salt: btoa('short') }],
      ['a missing salt', { salt: undefined }],
      ['a different KDF name', { name: 'scrypt' }],
      ['a different hash', { hash: 'SHA-1' }],
      ['iterations as a string', { iterations: '1000' }],
      ['fractional iterations', { iterations: 1000.5 }],
      ['missing iterations', { iterations: undefined }],
      ['iterations of 999', { iterations: 999 }],
      ['iterations of zero', { iterations: 0 }],
      ['negative iterations', { iterations: -600000 }],
    ])('rejects a tampered header with %s', async (_label, patch) => {
      const j = await parsed();
      await expect(openBackup(JSON.stringify({ ...j, kdf: { ...j.kdf, ...patch } }), PW)).rejects.toBeInstanceOf(DamagedFileError);
    });

    it('accepts iterations of exactly 1000', async () => {
      const j = await parsed();
      expect(j.kdf.iterations).toBe(1000);
      await expect(openBackup(JSON.stringify(j), PW)).resolves.toBeDefined();
    });

    it('opens (and fails to decrypt) a file whose iterations were changed from 1000 to 1001', async () => {
      const j = await parsed();
      await expect(openBackup(JSON.stringify({ ...j, kdf: { ...j.kdf, iterations: 1001 } }), PW)).rejects.toBeInstanceOf(WrongPasswordError);
    });

    it.each([
      ['one more than the maximum', MAX_ITERATIONS + 1],
      ['the largest 32-bit count', 2 ** 32 - 1],
      ['a count beyond 32 bits', 2 ** 40],
    ])('rejects iterations of %s before any key derivation runs', async (_label, iterations) => {
      const j = await parsed();
      const derive = vi.spyOn(globalThis.crypto.subtle, 'deriveKey');
      try {
        await expect(openBackup(JSON.stringify({ ...j, kdf: { ...j.kdf, iterations } }), PW)).rejects.toBeInstanceOf(DamagedFileError);
        expect(derive).not.toHaveBeenCalled();
      } finally {
        derive.mockRestore();
      }
    });

    it('lets iterations of exactly the maximum through validation (the derivation itself is stubbed out)', async () => {
      const j = await parsed();
      const derive = vi.spyOn(globalThis.crypto.subtle, 'deriveKey').mockRejectedValue(new Error('stubbed'));
      try {
        await expect(openBackup(JSON.stringify({ ...j, kdf: { ...j.kdf, iterations: MAX_ITERATIONS } }), PW)).rejects.toBeInstanceOf(WrongPasswordError);
        expect(derive).toHaveBeenCalledOnce();
        expect(derive.mock.calls[0]?.[0]).toMatchObject({ iterations: MAX_ITERATIONS });
      } finally {
        derive.mockRestore();
      }
    });

    it('rejects a decrypted payload that is not JSON', async () => {
      await expect(openBackup(await fileWithPlaintext('not json'), PW)).rejects.toBeInstanceOf(DamagedFileError);
    });

    it('rejects a payload with a missing table', async () => {
      const bad = await sealBackup(H, { tables: { ships: [{ nope: 1 }] } } as never, 'pw-12345678', FAST);
      await expect(openBackup(bad, 'pw-12345678')).rejects.toBeInstanceOf(DamagedFileError);
      const { ships, ...rest } = P.tables;
      await expect(openBackup(await sealBackup(H, { tables: rest } as never, PW, FAST), PW)).rejects.toBeInstanceOf(DamagedFileError);
    });

    it.each([
      ['a payload that is null', 'null'],
      ['a payload that is an array', '[]'],
      ['a payload without tables', '{}'],
      ['tables that is an array', '{"tables":[]}'],
      ['a table that is not an array', JSON.stringify({ tables: { ...P.tables, crew: {} } })],
      ['a record that is null', JSON.stringify({ tables: { ...P.tables, crew: [null] } })],
      ['a record that is an array', JSON.stringify({ tables: { ...P.tables, crew: [[]] } })],
      ['a record without an id', JSON.stringify({ tables: { ...P.tables, crew: [{ updatedAt: 'x' }] } })],
      ['a record without updatedAt', JSON.stringify({ tables: { ...P.tables, crew: [{ id: 'x' }] } })],
      ['a record with a numeric id', JSON.stringify({ tables: { ...P.tables, voyages: [{ id: 1, updatedAt: 'x' }] } })],
    ])('rejects %s', async (_label, plain) => {
      await expect(openBackup(await fileWithPlaintext(plain), PW)).rejects.toBeInstanceOf(DamagedFileError);
    });

    it('uses the exact message', async () => {
      await expect(openBackup(await fileWithPlaintext('not json'), PW)).rejects.toThrow("The file is damaged and can't be read. Nothing was changed.");
    });
  });
});

describe('readHeader', () => {
  it('returns the header only, with or without BOM and whitespace, without a password', async () => {
    const text = await sealedText();
    expect(readHeader(text)).toEqual(H);
    expect(readHeader('\uFEFF  ' + text + '\n')).toEqual(H);
    expect(Object.keys(readHeader(text))).toEqual(['format', 'version', 'kind', 'deviceId', 'deviceName', 'exportedAt']);
  });

  it('reports a handover kind', async () => {
    const handover: BackupHeader = { ...H, kind: 'handover' };
    expect(readHeader(await sealBackup(handover, P, PW, FAST))).toEqual(handover);
  });
});

describe('error classes', () => {
  it.each([
    [new NotABackupError(), 'NotABackupError'],
    [new NewerVersionError(), 'NewerVersionError'],
    [new WrongPasswordError(), 'WrongPasswordError'],
    [new DamagedFileError(), 'DamagedFileError'],
  ])('%s extends BackupError with its name set', (err, name) => {
    expect(err).toBeInstanceOf(BackupError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe(name);
    expect(err.message.length).toBeGreaterThan(0);
  });
});

describe('validatePassword', () => {
  it('requires at least 8 characters', () => {
    expect(validatePassword('1234567')).toBe('Use at least 8 characters.');
    expect(validatePassword('')).toBe('Use at least 8 characters.');
    expect(validatePassword('12345678')).toBeNull();
    expect(validatePassword('lozinka-ćevapi')).toBeNull();
  });

  it('counts characters, not UTF-16 code units', () => {
    expect(validatePassword('😀😀😀😀😀😀😀')).toBe('Use at least 8 characters.');
    expect(validatePassword('😀😀😀😀😀😀😀😀')).toBeNull();
  });
});

describe('encryptBytes / decryptBytes', () => {
  it('round-trips raw bytes, including a large array', async () => {
    const plain = new Uint8Array(300_000).map((_, i) => i % 251);
    const aad = enc.encode('aad');
    const env = await encryptBytes(plain, 'pw-12345678', aad, FAST);
    expect(env.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: 1000 });
    expect(await decryptBytes(env, 'pw-12345678', aad)).toEqual(plain);
  });

  it('fails when the associated data differs', async () => {
    const env = await encryptBytes(enc.encode('secret'), 'pw-12345678', enc.encode('a'), FAST);
    await expect(decryptBytes(env, 'pw-12345678', enc.encode('b'))).rejects.toThrow();
  });

  it.each([
    ['999', 999],
    ['0', 0],
    ['a negative number', -1000],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['1.5', 1.5],
    ['1000.5', 1000.5],
    ['one more than the maximum', MAX_ITERATIONS + 1],
  ])('refuses to seal with iterations of %s', async (_label, iterations) => {
    const message = 'iterations must be an integer between 1000 and 10000000';
    await expect(encryptBytes(enc.encode('x'), 'pw-12345678', enc.encode('a'), { iterations })).rejects.toThrow(new RangeError(message));
    await expect(encryptBytes(enc.encode('x'), 'pw-12345678', enc.encode('a'), { iterations })).rejects.toBeInstanceOf(RangeError);
    await expect(sealBackup(H, P, 'pw-12345678', { iterations })).rejects.toBeInstanceOf(RangeError);
  });

  it('seals with the smallest allowed count', async () => {
    const env = await encryptBytes(enc.encode('x'), 'pw-12345678', enc.encode('a'), { iterations: MIN_ITERATIONS });
    expect(env.kdf.iterations).toBe(MIN_ITERATIONS);
  });
});

describe('isValidIterations', () => {
  it('accepts integers from 1000 to 10,000,000 inclusive and nothing else', () => {
    expect(MIN_ITERATIONS).toBe(1000);
    expect(MAX_ITERATIONS).toBe(10_000_000);
    expect(isValidIterations(1000)).toBe(true);
    expect(isValidIterations(600_000)).toBe(true);
    expect(isValidIterations(10_000_000)).toBe(true);
    for (const bad of [999, 10_000_001, 0, -1, 1000.5, NaN, Infinity, 2 ** 32 - 1, '1000', null, undefined]) {
      expect(isValidIterations(bad)).toBe(false);
    }
  });
});
