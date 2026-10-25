import { beforeEach, describe, expect, it } from 'vitest';
import { crewListView, resetCrewListView, resolveAsAt, setCrewListView } from './crewListView';

describe('resolveAsAt', () => {
  it('uses the date that was typed', () => {
    expect(resolveAsAt('2026-10-10', '2026-10-25')).toBe('2026-10-10');
  });
  it('falls back to the ship\'s today when the date was never touched, was emptied, or is not a real date', () => {
    expect(resolveAsAt(undefined, '2026-10-25')).toBe('2026-10-25');
    expect(resolveAsAt('', '2026-10-25')).toBe('2026-10-25');
    expect(resolveAsAt('2026-02-30', '2026-10-25')).toBe('2026-10-25');
    expect(resolveAsAt('275760-09-13', '2026-10-25')).toBe('2026-10-25'); // the largest year a browser date input takes
  });
});

describe('the crew list view, kept while the app is open', () => {
  beforeEach(resetCrewListView);

  it('starts on Onboard, with the date untouched', () => {
    expect(crewListView()).toEqual({ view: 'onboard', asAt: undefined });
  });
  it('keeps what was set, and changes one part at a time', () => {
    setCrewListView({ asAt: '2026-10-10' });
    setCrewListView({ view: 'all' });
    expect(crewListView()).toEqual({ view: 'all', asAt: '2026-10-10' });
  });
  it('keeps an emptied date as typed, so that the input stays empty', () => {
    setCrewListView({ asAt: '' });
    expect(crewListView().asAt).toBe('');
  });
  it('is reset to the start', () => {
    setCrewListView({ view: 'all', asAt: '2026-10-10' });
    resetCrewListView();
    expect(crewListView()).toEqual({ view: 'onboard', asAt: undefined });
  });
  it('returns the new state from a change', () => {
    expect(setCrewListView({ view: 'all' })).toEqual({ view: 'all', asAt: undefined });
  });
});
