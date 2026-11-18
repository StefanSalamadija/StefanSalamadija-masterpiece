import { describe, expect, it } from 'vitest';
import { matchRoute, redirectFor, ROUTES } from './router';

describe('matchRoute', () => {
  it('treats an empty hash as Home', () => {
    for (const hash of ['', '#', '#/', '/']) expect(matchRoute(hash)).toEqual({ path: '/', params: {} });
  });

  it('matches every fixed route', () => {
    const fixed = [
      '/ship/particulars', '/ship/crew', '/ship/crew/new', '/ship/crew/import', '/ship/crew/print', '/ship/certificates',
      '/ship/certificates/new', '/ship/reliefs', '/ship/expiring', '/ship/voyage', '/ship/time', '/forms', '/profiles', '/settings', '/settings/import',
    ];
    for (const path of fixed) expect(matchRoute(`#${path}`), path).toEqual({ path, params: {} });
  });

  it('picks the id out of record routes, but not for the fixed words', () => {
    expect(matchRoute('#/ship/crew/3f2a')).toEqual({ path: '/ship/crew/:id', params: { id: '3f2a' } });
    expect(matchRoute('#/ship/certificates/9c')).toEqual({ path: '/ship/certificates/:id', params: { id: '9c' } });
    expect(matchRoute('#/ship/crew/new').path).toBe('/ship/crew/new');
    expect(matchRoute('#/ship/crew/import').path).toBe('/ship/crew/import');
    expect(matchRoute('#/ship/crew/print').path).toBe('/ship/crew/print');
  });

  it('picks the survey out of the draft survey report route', () => {
    expect(matchRoute('#/ship/survey/s1/report')).toEqual({ path: '/ship/survey/:id/report', params: { id: 's1' } });
    expect(matchRoute('#/ship/survey/s1')).toEqual({ path: '/ship/survey/:id', params: { id: 's1' } });
    expect(matchRoute('#/ship/survey/data').path).toBe('/ship/survey/data');
  });

  it('picks the crew member and the document out of the document routes, and the fixed word new before the document id', () => {
    expect(matchRoute('#/ship/crew/3f2a/documents/new')).toEqual({ path: '/ship/crew/:id/documents/new', params: { id: '3f2a' } });
    expect(matchRoute('#/ship/crew/3f2a/documents/d9')).toEqual({ path: '/ship/crew/:id/documents/:docId', params: { id: '3f2a', docId: 'd9' } });
    expect(matchRoute('#/ship/crew/a%20b/documents/c%2Fd').params).toEqual({ id: 'a b', docId: 'c/d' });
  });

  it('picks the form out of the form routes', () => {
    expect(matchRoute('#/forms/t%201/setup')).toEqual({ path: '/forms/:id/setup', params: { id: 't 1' } });
    expect(matchRoute('#/forms/abc/fill')).toEqual({ path: '/forms/:id/fill', params: { id: 'abc' } });
    for (const hash of ['#/forms/abc', '#/forms/abc/other', '#/forms/abc/setup/x']) expect(matchRoute(hash), hash).toEqual({ path: '/', params: {} });
  });

  it('knows the budget routes', () => {
    expect(matchRoute('#/budget/add/same/e1')).toEqual({ path: '/budget/add/same/:id', params: { id: 'e1' } });
    for (const path of ['/budget', '/budget/add', '/budget/add/income', '/budget/catch-up', '/budget/forecast', '/budget/net-worth', '/budget/scenarios', '/budget/plan',
      '/budget/trends', '/budget/import', '/budget/export']) expect(matchRoute(`#${path}`), path).toEqual({ path, params: {} });
    expect(matchRoute('#/budget/month/2026-10')).toEqual({ path: '/budget/month/:ym', params: { ym: '2026-10' } });
    expect(matchRoute('#/budget/scenarios/s1')).toEqual({ path: '/budget/scenarios/:id', params: { id: 's1' } });
    expect(matchRoute('#/budget/plan/start')).toEqual({ path: '/budget/plan/start', params: {} });
    expect(matchRoute('#/budget/plan/debts')).toEqual({ path: '/budget/plan/:section', params: { section: 'debts' } });
    expect(matchRoute('#/budget/month')).toEqual({ path: '/', params: {} });
  });

  it('knows the Ship hub and More', () => {
    expect(matchRoute('#/ship')).toEqual({ path: '/ship', params: {} });
    expect(matchRoute('#/more')).toEqual({ path: '/more', params: {} });
    expect(matchRoute('#/ship/')).toEqual({ path: '/ship', params: {} });
  });

  it('opens Settings with the section asked for in the query', () => {
    expect(matchRoute('#/settings?at=lock')).toEqual({ path: '/settings', params: {} });
    expect(matchRoute('#/settings?at=backup')).toEqual({ path: '/settings', params: {} });
  });

  it('knows the Expiring route', () => {
    expect(matchRoute('#/ship/expiring')).toEqual({ path: '/ship/expiring', params: {} });
  });

  it('knows the Due routes and the crew documents', () => {
    expect(matchRoute('#/due/port').path).toBe('/due/port');
    expect(matchRoute('#/due')).toEqual({ path: '/due', params: {} });
    expect(matchRoute('#/ship/crew-documents')).toEqual({ path: '/ship/crew-documents', params: {} });
  });

  it('ignores a trailing slash and a query string', () => {
    expect(matchRoute('#/ship/crew/')).toEqual({ path: '/ship/crew', params: {} });
    expect(matchRoute('#/ship/crew?sort=rank')).toEqual({ path: '/ship/crew', params: {} });
    expect(matchRoute('#/ship/crew/abc?x=1')).toEqual({ path: '/ship/crew/:id', params: { id: 'abc' } });
    expect(matchRoute('#/ship/crew/print?asAt=2026-10-01')).toEqual({ path: '/ship/crew/print', params: {} });
  });

  it('decodes percent-escapes in the id', () => {
    expect(matchRoute('#/ship/crew/a%20b').params).toEqual({ id: 'a b' });
  });

  it('falls back to Home for unknown routes and bad escapes', () => {
    for (const hash of ['#/nowhere', '#/ship/nowhere', '#/more/x', '#/ship/crew/abc/extra', '#/ship/crew/abc/documents', '#/ship/crew/abc/documents/d/extra', '#/ship/crew/abc/other/d', '#/ship/crew/%E0%A4%A', '#/settings/import/x']) {
      expect(matchRoute(hash), hash).toEqual({ path: '/', params: {} });
    }
  });
});

describe('redirectFor', () => {
  it('sends the old Expiring screen to Due, before the next port, and nothing else anywhere', () => {
    expect(redirectFor('/ship/expiring')).toBe('/due/port');
    for (const path of ROUTES) if (path !== '/ship/expiring') expect(redirectFor(path), path).toBeUndefined();
    expect(ROUTES).toContain('/ship/expiring');
  });

  it('sends a redirect to a route that is not itself redirected', () => {
    for (const path of ROUTES) {
      const target = redirectFor(path);
      if (target !== undefined) expect(redirectFor(target), path).toBeUndefined();
      if (target !== undefined) expect(matchRoute(`#${target}`).path).toBe(target);
    }
  });
});
