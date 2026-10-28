import type { MasterpieceDB } from '../db/schema';
import { forgetPassword, rememberPassword } from './passwordCache';
import { shareOrDownload } from './share';
import { exportBackup, recordFullBackup } from './service';

/** What became of the file: the share sheet took it, the browser downloaded it, or the user closed the share sheet. */
export type ExportOutcome = 'shared' | 'downloaded' | 'cancelled';

export interface ExportRequest {
  kind: 'full' | 'handover';
  password: string;
  /** The ship the file is named after; for a handover also the one ship it holds. */
  shipId: string;
  /** Keep the password in memory until the app is closed, so the next full export can use it. Never done for a handover. */
  remember: boolean;
  /** Only for tests: the key derivation takes a moment at its real cost. */
  iterations?: number;
}

/**
 * Makes the backup file and hands it to the share sheet, or downloads it. A full backup is recorded (which resets the
 * backup reminder) only when the file really left the app: the share sheet took it, or the browser downloaded it. When the
 * user closed the share sheet no backup was made, and nothing is recorded. A handover file is not a full backup and is
 * never recorded. The password of a handover file is its own: it is never remembered, and the remembered one is left alone.
 */
export async function exportAndShare(db: MasterpieceDB, request: ExportRequest): Promise<ExportOutcome> {
  const { kind, password, shipId, remember, iterations } = request;
  const { fileName, text, exportedAt } = await exportBackup(db, kind, password, { shipId, iterations });
  if (kind === 'full') {
    if (remember) rememberPassword(password);
    else forgetPassword();
  }
  const outcome = await shareOrDownload(fileName, text);
  if (kind === 'full' && outcome !== 'cancelled') await recordFullBackup(db, exportedAt);
  return outcome;
}
