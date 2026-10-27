import { describe, expect, it } from 'vitest';
import {
  FINGERPRINT_NOT_RECOGNISED, FINGERPRINT_SETUP_FAILED, LOCK_FORGOTTEN_NOTE, LOCK_LIMITS_NOTE, LOCK_MINUTES_ERROR,
  LOCK_NO_REUSE_NOTE, PASSCODE_FORMAT_ERROR, PASSCODE_MISMATCH, WRONG_PASSCODE, lockoutText, parseLockMinutes,
  passcodeDigits, passcodeProblem, protectIntro,
} from './lockView';

describe('the lock texts', () => {
  it('are the exact texts of the spec', () => {
    expect(PASSCODE_FORMAT_ERROR).toBe('Use exactly 4 digits.');
    expect(PASSCODE_MISMATCH).toBe("The passcodes don't match.");
    expect(WRONG_PASSCODE).toBe('Wrong passcode.');
    expect(FINGERPRINT_NOT_RECOGNISED).toBe('Fingerprint not recognised — enter your passcode.');
    expect(FINGERPRINT_SETUP_FAILED).toBe("Fingerprint couldn't be set up. You can try again in Settings.");
    expect(LOCK_LIMITS_NOTE).toBe(
      "The lock stops casual access. It does not encrypt the data on this device — your phone's screen lock and encryption are the real protection.",
    );
    expect(LOCK_FORGOTTEN_NOTE).toBe(
      "If you can't unlock (forgotten passcode and no fingerprint), the only way back in is to erase all data on this device and restore a backup.",
    );
    expect(LOCK_NO_REUSE_NOTE).toBe("Don't reuse your bank card or SIM PIN.");
  });

  it('say what the protect step offers: the fingerprint sentence only where there is a sensor', () => {
    expect(protectIntro(false)).toBe('Set a 4-digit passcode to open the app.');
    expect(protectIntro(true)).toBe('Set a 4-digit passcode to open the app. You can also unlock with your fingerprint.');
  });
});

describe('lockoutText', () => {
  it('counts whole seconds, rounding up, so a lock never shows 0 s while it is on', () => {
    expect(lockoutText(30_000)).toBe('Too many attempts. Try again in 30 s.');
    expect(lockoutText(29_001)).toBe('Too many attempts. Try again in 30 s.');
    expect(lockoutText(1_000)).toBe('Too many attempts. Try again in 1 s.');
    expect(lockoutText(1)).toBe('Too many attempts. Try again in 1 s.');
    expect(lockoutText(300_000)).toBe('Too many attempts. Try again in 300 s.');
  });
});

describe('passcodeProblem', () => {
  it('is nothing for two equal passcodes of exactly 4 digits', () => {
    expect(passcodeProblem('2580', '2580')).toBeUndefined();
    expect(passcodeProblem('0000', '0000')).toBeUndefined();
  });

  it('puts a passcode that is not 4 digits on the first field, whatever the repeat says', () => {
    for (const bad of ['', '123', '12345', '12a4', ' 258', '2580 ']) {
      expect(passcodeProblem(bad, bad)).toEqual({ field: 'pin', message: 'Use exactly 4 digits.' });
      expect(passcodeProblem(bad, '2580')).toEqual({ field: 'pin', message: 'Use exactly 4 digits.' });
    }
  });

  it('puts a mismatch on the repeat field, only once the passcode itself is fine', () => {
    expect(passcodeProblem('2580', '2581')).toEqual({ field: 'repeat', message: "The passcodes don't match." });
    expect(passcodeProblem('2580', '')).toEqual({ field: 'repeat', message: "The passcodes don't match." });
  });
});

describe('passcodeDigits', () => {
  it('keeps the digits typed, at most four, and drops everything else', () => {
    expect(passcodeDigits('2580')).toBe('2580');
    expect(passcodeDigits('25a8-0')).toBe('2580');
    expect(passcodeDigits('258012')).toBe('2580');
    expect(passcodeDigits(' ')).toBe('');
    expect(passcodeDigits('٢٥٨٠')).toBe(''); // Arabic-Indic digits are not accepted by isValidPin either
  });
});

describe('parseLockMinutes', () => {
  it('reads a whole number of minutes from 0 to 60', () => {
    expect(parseLockMinutes('5')).toBe(5);
    expect(parseLockMinutes(' 15 ')).toBe(15);
    expect(parseLockMinutes('0')).toBe(0);
    expect(parseLockMinutes('60')).toBe(60);
  });

  it('refuses anything else: no sign, point, exponent or letters, nothing over 60', () => {
    for (const bad of ['', ' ', '61', '-1', '5.5', '1e1', 'abc', '5 min', '+5']) expect(parseLockMinutes(bad)).toBeUndefined();
    expect(LOCK_MINUTES_ERROR).toBe('Enter a number of minutes from 0 to 60.');
  });
});
