import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../db/schema';
import type { MasterpieceDB } from '../db/schema';
import { getSettings } from '../db/settings';
import { createShip } from '../db/ships';
import { readHeader } from './envelope';
import { exportAndShare } from './exportFlow';
import { forgetPassword, getRememberedPassword, rememberPassword } from './passwordCache';
import { shareOrDownload } from './share';

vi.mock('./share', () => ({ shareOrDownload: vi.fn() }));

const share = vi.mocked(shareOrDownload);
const PW = 'pw-12345678';
const FAST = { iterations: 1000 };

let db: MasterpieceDB;
let shipId: string;

/** The text of the backup file that `shareOrDownload` was given: a backup is always shared as text. */
function sharedText(call: Parameters<typeof shareOrDownload>): string {
  const [, data] = call;
  if (typeof data !== 'string') throw new Error('The backup was not shared as text.');
  return data;
}

beforeEach(async () => {
  share.mockReset();
  forgetPassword();
  db = openDb(`t-${crypto.randomUUID()}`);
  shipId = (await createShip(db, 'MV OCEAN STAR', 180)).id;
});

describe('exportAndShare, a full backup', () => {
  it.each(['shared', 'downloaded'] as const)('records the backup once the file has been %s', async (outcome) => {
    share.mockResolvedValue(outcome);
    expect(await exportAndShare(db, { kind: 'full', password: PW, shipId, remember: true, ...FAST })).toBe(outcome);
    const [fileName] = share.mock.calls[0];
    expect(fileName).toMatch(/^masterpiece-full-mv-ocean-star-\d{4}-\d{2}-\d{2}-\d{4}\.mpbak$/);
    const settings = await getSettings(db);
    expect(settings.lastExportAt).toBe(readHeader(sharedText(share.mock.calls[0])).exportedAt);
    expect(settings.firstExportDone).toBe(true);
  });

  it('records nothing when the user closed the share sheet: no backup was made', async () => {
    share.mockResolvedValue('cancelled');
    expect(await exportAndShare(db, { kind: 'full', password: PW, shipId, remember: true, ...FAST })).toBe('cancelled');
    expect(share).toHaveBeenCalledOnce();
    const settings = await getSettings(db);
    expect(settings.lastExportAt).toBeUndefined();
    expect(settings.firstExportDone).toBeUndefined();
  });

  it('records nothing when the file was not made, and shares nothing', async () => {
    await expect(exportAndShare(db, { kind: 'full', password: 'short', shipId, remember: true, ...FAST })).rejects.toThrow('Use at least 8 characters.');
    await expect(exportAndShare(db, { kind: 'full', password: PW, shipId: 'nope', remember: true, ...FAST })).rejects.toThrow('Ship not found: nope');
    expect(share).not.toHaveBeenCalled();
    expect((await getSettings(db)).lastExportAt).toBeUndefined();
    expect(getRememberedPassword()).toBeUndefined();
  });

  it('records nothing when sharing fails, and the error reaches the caller', async () => {
    share.mockRejectedValue(new Error('disk full'));
    await expect(exportAndShare(db, { kind: 'full', password: PW, shipId, remember: true, ...FAST })).rejects.toThrow('disk full');
    expect((await getSettings(db)).lastExportAt).toBeUndefined();
  });

  it('remembers the password for this session when asked to', async () => {
    share.mockResolvedValue('downloaded');
    await exportAndShare(db, { kind: 'full', password: PW, shipId, remember: true, ...FAST });
    expect(getRememberedPassword()).toBe(PW);
  });

  it('still remembers it when the user closed the share sheet: the password was fine', async () => {
    share.mockResolvedValue('cancelled');
    await exportAndShare(db, { kind: 'full', password: PW, shipId, remember: true, ...FAST });
    expect(getRememberedPassword()).toBe(PW);
  });

  it('forgets the password it had remembered when it is not asked to remember the new one', async () => {
    rememberPassword('old-password-1');
    share.mockResolvedValue('downloaded');
    await exportAndShare(db, { kind: 'full', password: PW, shipId, remember: false, ...FAST });
    expect(getRememberedPassword()).toBeUndefined();
  });
});

describe('exportAndShare, a handover file', () => {
  it('is not a full backup: it records nothing, whatever happened to the file', async () => {
    for (const outcome of ['shared', 'downloaded', 'cancelled'] as const) {
      share.mockResolvedValue(outcome);
      await exportAndShare(db, { kind: 'handover', password: 'relief-pass-1', shipId, remember: false, ...FAST });
    }
    const settings = await getSettings(db);
    expect(settings.lastExportAt).toBeUndefined();
    expect(settings.firstExportDone).toBeUndefined();
  });

  it('never remembers its password, and leaves the remembered backup password alone, even if asked to remember', async () => {
    rememberPassword(PW);
    share.mockResolvedValue('downloaded');
    await exportAndShare(db, { kind: 'handover', password: 'relief-pass-1', shipId, remember: true, ...FAST });
    expect(getRememberedPassword()).toBe(PW);
    forgetPassword();
    await exportAndShare(db, { kind: 'handover', password: 'relief-pass-1', shipId, remember: true, ...FAST });
    expect(getRememberedPassword()).toBeUndefined();
  });

  it('shares a handover file named after the ship', async () => {
    share.mockResolvedValue('downloaded');
    await exportAndShare(db, { kind: 'handover', password: 'relief-pass-1', shipId, remember: false, ...FAST });
    const [fileName] = share.mock.calls[0];
    expect(fileName).toMatch(/^masterpiece-handover-mv-ocean-star-/);
    expect(readHeader(sharedText(share.mock.calls[0])).kind).toBe('handover');
  });
});
