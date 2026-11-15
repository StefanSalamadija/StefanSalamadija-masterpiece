import { describe, expect, it } from 'vitest';
import { entryLinksOk } from './validate';

describe('entryLinksOk', () => {
  it('accepts an entry whose links are absent or text', () => {
    expect(entryLinksOk({})).toBe(true);
    expect(entryLinksOk({ categoryId: 'c', fundId: 'f', debtId: 'd', soldAssetId: 'a', recurringId: 'r' })).toBe(true);
    expect(entryLinksOk({ debtId: undefined })).toBe(true);
  });

  it('refuses a link that is not text', () => {
    for (const key of ['categoryId', 'fundId', 'debtId', 'soldAssetId', 'recurringId']) {
      expect(entryLinksOk({ [key]: 7 })).toBe(false);
      expect(entryLinksOk({ [key]: null })).toBe(false);
    }
  });
});
