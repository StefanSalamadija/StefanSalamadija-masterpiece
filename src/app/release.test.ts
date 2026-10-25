import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import release from '../../release.json';

describe('release.json', () => {
  it('has the same version as package.json, and a one-sentence release note', () => {
    expect(release.version).toBe(pkg.version);
    expect(release.whatsNew.trim()).not.toBe('');
  });
});
