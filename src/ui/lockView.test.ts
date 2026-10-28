import { describe, expect, it } from 'vitest';
import {
  FINGERPRINT_NOT_RECOGNISED, FINGERPRINT_SETUP_FAILED, LOCK_FORGOTTEN_NOTE, LOCK_LIMITS_NOTE, LOCK_MINUTES_ERROR,
  LOCK_NO_REUSE_NOTE, PASSCODE_FORMAT_ERROR, PASSCODE_MISMATCH, WRONG_PASSCODE, confirmIntro, confirmTitle, lockoutText,
  LOCK_ENDED_ANNOUNCEMENT, lockStartedAnnouncement, parseLockMinutes, passcodeDigits, passcodeProblem, protectIntro, unsavedLockText,
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

describe('the confirmation of the current passcode in Settings', () => {
  it('names what it is for, and offers the fingerprint only where one is enrolled and available', () => {
    expect(confirmTitle('change')).toBe('Change passcode?');
    expect(confirmTitle('off')).toBe('Turn off app lock?');
    expect(confirmIntro('change', false)).toBe('To set a new passcode, enter your current passcode.');
    expect(confirmIntro('off', false)).toBe('To turn off the app lock, enter your current passcode.');
    expect(confirmIntro('off', true)).toBe('To turn off the app lock, enter your current passcode or use your fingerprint.');
  });

  it('asks only for the passcode before the fingerprint is turned on: there is no fingerprint yet to ask with', () => {
    expect(confirmTitle('fingerprint')).toBe('Turn on fingerprint unlock?');
    expect(confirmIntro('fingerprint', false)).toBe('To turn on fingerprint unlock, enter your current passcode.');
  });
});

describe('the lock that could not be saved', () => {
  it('says so, in these words, with the seconds left', () => {
    expect(unsavedLockText(300_000)).toBe("Couldn't save \u2014 locked for safety. Try again in 300 s.");
    expect(unsavedLockText(29_001)).toBe("Couldn't save \u2014 locked for safety. Try again in 30 s.");
    expect(unsavedLockText(1)).toBe("Couldn't save \u2014 locked for safety. Try again in 1 s.");
  });
});

describe('what a screen reader is told when a lock starts and ends', () => {
  it('is said once at the start, with the whole time, in words that are not the countdown on the screen', () => {
    expect(lockStartedAnnouncement(30_000, false)).toBe('Locked after too many attempts. You can try again in 30 seconds.');
    expect(lockStartedAnnouncement(1_000, false)).toBe('Locked after too many attempts. You can try again in 1 second.');
    expect(lockStartedAnnouncement(300_000, true)).toBe(
      "Couldn't save the attempt, so the app is locked for safety. You can try again in 300 seconds.",
    );
    // The countdown on the screen is the one element with these words; a second element with them would be found twice.
    expect(lockStartedAnnouncement(30_000, false)).not.toMatch(/Too many attempts\. Try again in/);
    expect(lockStartedAnnouncement(30_000, true)).not.toContain(unsavedLockText(30_000));
  });

  it('is said once at the end', () => {
    expect(LOCK_ENDED_ANNOUNCEMENT).toBe('You can try again now.');
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
