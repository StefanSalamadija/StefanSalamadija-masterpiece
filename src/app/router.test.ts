import { describe, expect, it } from 'vitest';
import { matchRoute } from './router';

describe('matchRoute', () => {
  it('treats an empty hash as Home', () => {
    for (const hash of ['', '#', '#/', '/']) expect(matchRoute(hash)).toEqual({ path: '/', params: {} });
  });

  it('matches every fixed route', () => {
    const fixed = [
      '/ship/particulars', '/ship/crew', '/ship/crew/new', '/ship/crew/import', '/ship/certificates',
      '/ship/certificates/new', '/ship/reliefs', '/ship/voyage', '/ship/time', '/profiles', '/settings', '/settings/import',
    ];
    for (const path of fixed) expect(matchRoute(`#${path}`), path).toEqual({ path, params: {} });
  });

  it('picks the id out of record routes, but not for the fixed words', () => {
    expect(matchRoute('#/ship/crew/3f2a')).toEqual({ path: '/ship/crew/:id', params: { id: '3f2a' } });
    expect(matchRoute('#/ship/certificates/9c')).toEqual({ path: '/ship/certificates/:id', params: { id: '9c' } });
    expect(matchRoute('#/ship/crew/new').path).toBe('/ship/crew/new');
    expect(matchRoute('#/ship/crew/import').path).toBe('/ship/crew/import');
  });

  it('ignores a trailing slash and a query string', () => {
    expect(matchRoute('#/ship/crew/')).toEqual({ path: '/ship/crew', params: {} });
    expect(matchRoute('#/ship/crew?sort=rank')).toEqual({ path: '/ship/crew', params: {} });
    expect(matchRoute('#/ship/crew/abc?x=1')).toEqual({ path: '/ship/crew/:id', params: { id: 'abc' } });
  });

  it('decodes percent-escapes in the id', () => {
    expect(matchRoute('#/ship/crew/a%20b').params).toEqual({ id: 'a b' });
  });

  it('falls back to Home for unknown routes and bad escapes', () => {
    for (const hash of ['#/nowhere', '#/ship', '#/ship/crew/abc/extra', '#/ship/crew/%E0%A4%A', '#/settings/import/x']) {
      expect(matchRoute(hash), hash).toEqual({ path: '/', params: {} });
    }
  });
});
