import { describe, expect, it } from 'vitest';
import { ROUTES } from '../../app/router';
import type { RoutePath } from '../../app/router';
import { HUB_TILES } from '../screens/ShipHub';
import { activeTab } from './Nav';
import type { Tab } from './Nav';
import { sectionFor } from './SectionBar';

/** The tab every route lights, as the brief gives it. */
function expectedTab(path: RoutePath): Tab {
  if (path === '/' || path.startsWith('/due')) return 'home';
  if (path === '/ship' || path.startsWith('/ship/')) return 'ship';
  if (path.startsWith('/forms')) return 'forms';
  if (path.startsWith('/budget')) return 'budget';
  return 'more';
}

describe('activeTab', () => {
  it('lights a tab on every route, so a new route cannot be added without one', () => {
    for (const path of ROUTES) {
      expect(activeTab(path), path).toBeDefined();
      expect(activeTab(path), path).toBe(expectedTab(path));
    }
  });

  it('puts the screens with no tab of their own under More', () => {
    for (const path of ['/more', '/tools', '/tools/sdt', '/tools/:group', '/library', '/library/doc/:id', '/profiles', '/settings', '/settings/import'] as const) {
      expect(activeTab(path), path).toBe('more');
    }
  });

  it('keeps Home lit on the Due screens, and Ship on the hub and every section', () => {
    expect(activeTab('/')).toBe('home');
    expect(activeTab('/due')).toBe('home');
    expect(activeTab('/due/port')).toBe('home');
    expect(activeTab('/ship')).toBe('ship');
    expect(activeTab('/ship/crew/:id/documents/new')).toBe('ship');
    expect(activeTab('/ship/crew-documents')).toBe('ship');
  });
});

describe('sectionFor', () => {
  const names = HUB_TILES.map((tile) => tile.name);

  it('names a hub tile for every Ship section route', () => {
    for (const path of ROUTES) {
      if (!path.startsWith('/ship/')) continue;
      expect(names, path).toContain(sectionFor(path));
    }
  });

  it('gives each route the tile that owns it', () => {
    expect(sectionFor('/ship/crew')).toBe('Crew');
    expect(sectionFor('/ship/crew/new')).toBe('Crew');
    expect(sectionFor('/ship/crew/print')).toBe('Crew');
    expect(sectionFor('/ship/crew/:id/documents/new')).toBe('Crew');
    expect(sectionFor('/ship/crew-documents')).toBe('Crew documents');
    expect(sectionFor('/ship/expiring')).toBe('Crew documents');
    expect(sectionFor('/ship/certificates/:id')).toBe('Certificates');
    expect(sectionFor('/ship/reliefs')).toBe('Contracts & reliefs');
    expect(sectionFor('/ship/voyage')).toBe('Voyage');
    expect(sectionFor('/ship/time')).toBe("Ship's time");
    expect(sectionFor('/ship/survey/data')).toBe('Draft survey');
    expect(sectionFor('/ship/survey/:id/report')).toBe('Draft survey');
    expect(sectionFor('/ship/particulars')).toBe('Particulars');
  });
});

describe('HUB_TILES', () => {
  it('lists the eight tiles in order, each opening its section', () => {
    expect(HUB_TILES.map((tile) => [tile.id, tile.name, tile.href])).toEqual([
      ['crew', 'Crew', '#/ship/crew'],
      ['crewDocuments', 'Crew documents', '#/ship/crew-documents'],
      ['certificates', 'Certificates', '#/ship/certificates'],
      ['reliefs', 'Contracts & reliefs', '#/ship/reliefs'],
      ['voyage', 'Voyage', '#/ship/voyage'],
      ['time', "Ship's time", '#/ship/time'],
      ['survey', 'Draft survey', '#/ship/survey'],
      ['particulars', 'Particulars', '#/ship/particulars'],
    ]);
  });
});
