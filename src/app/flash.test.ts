import { describe, expect, it } from 'vitest';
import { addFlash, dropFlash, setFlash, takeFlash } from './flash';

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

  describe('more than one message', () => {
    it('addFlash keeps what is already waiting and puts its message after it, so neither is lost', () => {
      setFlash('Import complete.');
      addFlash("Fingerprint couldn't be set up. You can try again in Settings.");
      expect(takeFlash()).toBe("Import complete. Fingerprint couldn't be set up. You can try again in Settings.");
      expect(takeFlash()).toBeUndefined();
    });

    it('addFlash with nothing waiting is the same as setFlash', () => {
      addFlash('only');
      expect(takeFlash()).toBe('only');
    });

    it('setFlash still replaces everything that was waiting', () => {
      setFlash('one');
      addFlash('two');
      setFlash('three');
      expect(takeFlash()).toBe('three');
    });

    it('dropFlash takes back one message that was added, and leaves the others', () => {
      setFlash('Import complete.');
      addFlash('second');
      dropFlash('second');
      expect(takeFlash()).toBe('Import complete.');
    });

    it('dropFlash of the only message leaves nothing, and of one that is not there changes nothing', () => {
      setFlash('a');
      dropFlash('b');
      dropFlash('a');
      expect(takeFlash()).toBeUndefined();
    });

    it('dropFlash takes back one copy of a message that was added twice, the last', () => {
      setFlash('x');
      addFlash('y');
      addFlash('x');
      dropFlash('x');
      expect(takeFlash()).toBe('x y');
    });
  });
});
