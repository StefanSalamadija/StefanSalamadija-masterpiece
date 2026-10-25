import { describe, expect, it } from 'vitest';
import { setFlash, takeFlash } from './flash';

describe('flash', () => {
  it('hands over the message once, and then there is none', () => {
    setFlash('Imported 3 crew.');
    expect(takeFlash()).toBe('Imported 3 crew.');
    expect(takeFlash()).toBeUndefined();
  });

  it('has nothing to hand over before one is set', () => {
    expect(takeFlash()).toBeUndefined();
  });

  it('keeps only the latest message', () => {
    setFlash('first');
    setFlash('second');
    expect(takeFlash()).toBe('second');
  });
});
