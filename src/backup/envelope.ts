import { TABLE_NAMES } from '../domain/types';
import type { SyncRecord, Tables } from '../domain/types';
import {
  IV_BYTES, SALT_BYTES, TAG_BYTES, base64ByteLength, decryptBytes, encryptBytes, isBase64, isValidIterations,
} from './crypto';
import type { EncryptedBlob } from './crypto';

export type { KdfParams } from './crypto';

export interface BackupHeader {
  format: 'masterpiece-backup';
  version: 1;
  kind: 'full' | 'handover';
  deviceId: string;
  deviceName: string;
  exportedAt: string;
}
export interface BackupPayload { tables: Tables }

const FORMAT = 'masterpiece-backup';
const KINDS: readonly string[] = ['full', 'handover'];
const MIN_PASSWORD_LENGTH = 8;

/** Base of every backup failure, so the UI can show `err.message` for any of them. */
export class BackupError extends Error {
  constructor(message: string, name: string) {
    super(message);
    this.name = name; // literal strings, not `new.target.name`, which a minifier would mangle
  }
}
export class NotABackupError extends BackupError {
  constructor() { super("This isn't a Masterpiece backup file.", 'NotABackupError'); }
}
export class NewerVersionError extends BackupError {
  constructor() {
    super('This backup was made by a newer version of Masterpiece. Connect to the internet and reopen the app to update it, then try again.', 'NewerVersionError');
  }
}
export class WrongPasswordError extends BackupError {
  constructor() { super('Wrong password, or the file is damaged. Nothing was changed.', 'WrongPasswordError'); }
}
export class DamagedFileError extends BackupError {
  constructor() { super("The file is damaged and can't be read. Nothing was changed.", 'DamagedFileError'); }
}

export function validatePassword(pw: string): string | null {
  return Array.from(pw).length < MIN_PASSWORD_LENGTH ? `Use at least ${MIN_PASSWORD_LENGTH} characters.` : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The six header fields in their fixed order: the order is part of the file format (it defines the authenticated data). */
function orderedHeader(h: BackupHeader): BackupHeader {
  return { format: h.format, version: h.version, kind: h.kind, deviceId: h.deviceId, deviceName: h.deviceName, exportedAt: h.exportedAt };
}

/** The header is authenticated, not encrypted, so a tampered header makes decryption fail. */
function headerAad(h: BackupHeader): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(orderedHeader(h)));
}

/** Checks 1 to 3: JSON, backup marker and header field types, version. Needs no password. */
function parseFile(text: string): { header: BackupHeader; file: Record<string, unknown> } {
  let file: unknown;
  try {
    file = JSON.parse(text.trim()); // trim() also removes a leading BOM (U+FEFF counts as whitespace)
  } catch {
    throw new NotABackupError();
  }
  if (!isObject(file) || file.format !== FORMAT || typeof file.version !== 'number'
    || typeof file.kind !== 'string' || typeof file.deviceId !== 'string'
    || typeof file.deviceName !== 'string' || typeof file.exportedAt !== 'string') {
    throw new NotABackupError();
  }
  if (file.version > 1) throw new NewerVersionError();
  if (file.version !== 1 || !KINDS.includes(file.kind)) throw new DamagedFileError();
  const header = orderedHeader(file as unknown as BackupHeader);
  return { header, file };
}

/** The encrypted part of the file. A tampered header must not be able to force a weak or unusual KDF. */
function parseEncrypted(file: Record<string, unknown>): EncryptedBlob {
  const { kdf, iv, ciphertext } = file;
  if (!isObject(kdf) || typeof iv !== 'string' || typeof ciphertext !== 'string') throw new DamagedFileError();
  const { name, hash, iterations, salt } = kdf;
  if (name !== 'PBKDF2' || hash !== 'SHA-256') throw new DamagedFileError();
  if (!isValidIterations(iterations)) throw new DamagedFileError();
  if (typeof salt !== 'string' || !isBase64(salt) || base64ByteLength(salt) !== SALT_BYTES) throw new DamagedFileError();
  if (!isBase64(iv) || base64ByteLength(iv) !== IV_BYTES) throw new DamagedFileError();
  if (!isBase64(ciphertext) || base64ByteLength(ciphertext) < TAG_BYTES) throw new DamagedFileError();
  return { kdf: { name, hash, iterations, salt }, iv, ciphertext };
}

function isRecordShape(value: unknown): value is SyncRecord {
  return isObject(value) && typeof value.id === 'string' && typeof value.updatedAt === 'string';
}

function parsePayload(value: unknown): BackupPayload {
  if (!isObject(value) || !isObject(value.tables)) throw new DamagedFileError();
  const tables = {} as Tables;
  for (const name of TABLE_NAMES) {
    const rows = value.tables[name];
    if (!Array.isArray(rows) || !rows.every(isRecordShape)) throw new DamagedFileError();
    tables[name] = rows;
  }
  return { tables };
}

/** The file is the header fields, then `kdf`, `iv`, `ciphertext`. The payload is encrypted with AES-GCM under a password-derived key. */
export async function sealBackup(
  header: BackupHeader,
  payload: BackupPayload,
  password: string,
  opts?: { iterations?: number },
): Promise<string> {
  const plain = new TextEncoder().encode(JSON.stringify({ tables: payload.tables }));
  const { kdf, iv, ciphertext } = await encryptBytes(plain, password, headerAad(header), opts);
  return JSON.stringify({ ...orderedHeader(header), kdf, iv, ciphertext });
}

export function readHeader(text: string): BackupHeader {
  return parseFile(text).header;
}

export async function openBackup(text: string, password: string): Promise<{ header: BackupHeader; payload: BackupPayload }> {
  const { header, file } = parseFile(text);
  const encrypted = parseEncrypted(file);
  let plain: Uint8Array;
  try {
    plain = await decryptBytes(encrypted, password, headerAad(header));
  } catch {
    throw new WrongPasswordError();
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new DamagedFileError();
  }
  return { header, payload: parsePayload(decoded) };
}
