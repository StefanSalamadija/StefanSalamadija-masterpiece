import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScrollMemory, rememberPlaceOnLeaving } from './scrollMemory';

describe('scroll memory', () => {
  it('gives back the position of the list routes', () => {
    const memory = createScrollMemory();
    memory.remember('/ship/crew', 1200);
    memory.remember('/ship/certificates', 300);
    memory.remember('/ship/reliefs', 700);
    expect(memory.positionFor('/ship/crew')).toBe(1200);
    expect(memory.positionFor('/ship/certificates')).toBe(300);
    expect(memory.positionFor('/ship/reliefs')).toBe(700);
  });
  it('keeps the latest position, and a route of its own for each', () => {
    const memory = createScrollMemory();
    memory.remember('/ship/crew', 1200);
    memory.remember('/ship/crew', 40);
    expect(memory.positionFor('/ship/crew')).toBe(40);
    expect(memory.positionFor('/ship/certificates')).toBe(0);
  });
  it('is at the top for a route not seen yet', () => {
    expect(createScrollMemory().positionFor('/ship/crew')).toBe(0);
  });
  it('sends every other route to the top', () => {
    const memory = createScrollMemory();
    for (const path of ['/', '/ship/crew/new', '/ship/crew/:id', '/ship/particulars', '/profiles', '/settings']) {
      memory.remember(path, 500);
      expect(memory.positionFor(path)).toBe(0);
    }
  });
  it('never remembers a position above the top', () => {
    const memory = createScrollMemory();
    memory.remember('/ship/crew', -80); // an overscroll bounce
    expect(memory.positionFor('/ship/crew')).toBe(0);
  });
  it('is separate for each memory', () => {
    const a = createScrollMemory();
    a.remember('/ship/crew', 700);
    expect(createScrollMemory().positionFor('/ship/crew')).toBe(0);
  });
});

describe('rememberPlaceOnLeaving', () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeWindow() {
    const fake = { scrollY: 640, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('window', fake);
    vi.stubGlobal('history', { scrollRestoration: 'auto' });
    return fake;
  }
  const leaving = (fake: ReturnType<typeof fakeWindow>) => fake.addEventListener.mock.calls[0][1] as (e: { oldURL: string }) => void;

  it('listens first, in the capture phase, and stops when told to', () => {
    const fake = fakeWindow();
    const stop = rememberPlaceOnLeaving(createScrollMemory());
    expect(fake.addEventListener).toHaveBeenCalledWith('hashchange', expect.any(Function), true);
    stop();
    expect(fake.removeEventListener).toHaveBeenCalledWith('hashchange', leaving(fake), true);
  });
  it('notes the scroll position under the route that was left', () => {
    const fake = fakeWindow();
    const memory = createScrollMemory();
    rememberPlaceOnLeaving(memory);
    leaving(fake)({ oldURL: 'http://localhost:4173/#/ship/crew' });
    expect(memory.positionFor('/ship/crew')).toBe(640);
    fake.scrollY = 90;
    leaving(fake)({ oldURL: 'http://localhost:4173/#/ship/crew/abc-123' }); // an edit screen: never kept
    leaving(fake)({ oldURL: 'http://localhost:4173/' });
    expect(memory.positionFor('/ship/crew')).toBe(640);
    leaving(fake)({ oldURL: 'http://localhost:4173/?x=1#/ship/certificates' });
    expect(memory.positionFor('/ship/certificates')).toBe(90);
  });
  it('takes over the restoring of the scroll position from the browser, and gives it back when it stops', () => {
    // On Back and Forward the browser would otherwise move the page to the screen it is going to before `hashchange`.
    fakeWindow();
    const stop = rememberPlaceOnLeaving(createScrollMemory());
    expect(history.scrollRestoration).toBe('manual');
    stop();
    expect(history.scrollRestoration).toBe('auto');
  });
});
