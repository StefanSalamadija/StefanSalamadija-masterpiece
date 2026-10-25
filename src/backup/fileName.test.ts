import { describe, expect, it } from 'vitest';
import { backupFileName } from './fileName';

describe('backupFileName', () => {
  it('turns a ship name with a slash into a safe lowercase slug', () => {
    expect(backupFileName('full', 'M/V Ocean Star', '2026-10-25T14:32')).toBe('masterpiece-full-m-v-ocean-star-2026-10-25-1432.mpbak');
  });

  it('strips diacritics instead of dropping the letter', () => {
    expect(backupFileName('handover', 'Šibenik Express', '2026-10-25T09:05')).toBe('masterpiece-handover-sibenik-express-2026-10-25-0905.mpbak');
    expect(backupFileName('full', 'Đuro Đaković', '2026-10-25T09:05')).toBe('masterpiece-full-duro-dakovic-2026-10-25-0905.mpbak');
  });

  it('falls back to "ship" when nothing usable is left', () => {
    expect(backupFileName('full', '///', '2026-10-25T09:05')).toBe('masterpiece-full-ship-2026-10-25-0905.mpbak');
    expect(backupFileName('full', '', '2026-10-25T09:05')).toBe('masterpiece-full-ship-2026-10-25-0905.mpbak');
  });

  it('removes every character that is illegal in a file name', () => {
    const name = backupFileName('full', 'A\\B:C*D?E"F<G>H|I  J..K', '2026-10-25T09:05');
    expect(name).toBe('masterpiece-full-a-b-c-d-e-f-g-h-i-j-k-2026-10-25-0905.mpbak');
    expect(name).toMatch(/^[a-z0-9.-]+$/);
  });

  it('caps the ship name part at 60 characters', () => {
    const name = backupFileName('full', 'x'.repeat(100), '2026-10-25T09:05');
    expect(name).toBe(`masterpiece-full-${'x'.repeat(60)}-2026-10-25-0905.mpbak`);
  });

  it('does not leave a dash at the cut when the 60th character ends a word', () => {
    // 59 letters, a space, then more: the slug is cut right after the dash
    const name = backupFileName('full', `${'y'.repeat(59)} tail`, '2026-10-25T09:05');
    expect(name).toBe(`masterpiece-full-${'y'.repeat(59)}-2026-10-25-0905.mpbak`);
  });

  it('keeps a name of exactly 60 characters whole', () => {
    expect(backupFileName('full', 'z'.repeat(60), '2026-10-25T09:05')).toContain(`-${'z'.repeat(60)}-`);
  });
});
