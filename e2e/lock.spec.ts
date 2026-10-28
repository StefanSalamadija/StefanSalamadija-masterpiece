import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { allowWrites, expectNoHorizontalScroll, failWrites, freshApp, setupShip } from './helpers';

// Opening a passcode takes a moment (100,000 PBKDF2 rounds): every wait below is on what the page shows, never a sleep.
// The clock is the one `freshApp` installs, so a lockout and the time in the background are moved with `page.clock`.

const SHIP = 'MV OCEAN STAR';
const PIN = '2580';

const lockedHeading = (page: Page) => page.getByRole('heading', { name: 'Masterpiece is locked' });
const banner = (page: Page) => page.getByRole('banner');
const passcode = (page: Page) => page.getByLabel('Passcode');
const countdown = (page: Page) => page.getByText(/Too many attempts\. Try again in \d+ s\./);

/** The seconds the lock screen says are left. */
async function secondsLeft(page: Page): Promise<number> {
  const text = (await countdown(page).textContent()) ?? '';
  return Number(/in (\d+) s/.exec(text)?.[1]);
}

/** Answers the protect step with a passcode, and waits for the app behind it. */
async function turnOnFromProtectStep(page: Page, pin = PIN): Promise<void> {
  await page.getByLabel('New passcode').fill(pin);
  await page.getByLabel('Repeat passcode').fill(pin);
  await page.getByRole('button', { name: 'Turn on app lock' }).click();
  await expect(banner(page)).toContainText(SHIP);
}

/** A fresh device with a ship and the lock on (passcode 2580), unlocked, as it is right after the protect step. */
async function deviceWithLock(page: Page): Promise<void> {
  await freshApp(page);
  await setupShip(page, SHIP, 'UTC+03:00', { skipLock: false });
  await turnOnFromProtectStep(page);
}

/** Hides the app, lets `time` pass (such as '06:00'), and shows it again. */
async function backgroundFor(page: Page, time: string | number): Promise<void> {
  const setVisibility = (state: string) =>
    page.evaluate((value) => {
      Object.defineProperty(document, 'visibilityState', { value, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
  await setVisibility('hidden');
  await page.clock.fastForward(time);
  await setVisibility('visible');
}

/** The device settings as stored in IndexedDB, to see what was really written. */
function deviceSettings(page: Page): Promise<Record<string, any>> {
  return page.evaluate(() => new Promise<Record<string, any>>((resolve, reject) => {
    const open = indexedDB.open('masterpiece');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = open.result.transaction('settings').objectStore('settings').get('device');
      request.onsuccess = () => { open.result.close(); resolve(request.result); };
    };
  }));
}

const dialog = (page: Page) => page.getByRole('dialog');

/** In the confirmation that Settings asks for: types the current passcode and presses Confirm. */
async function confirmWith(page: Page, code: string): Promise<void> {
  await page.getByLabel('Current passcode').fill(code);
  await dialog(page).getByRole('button', { name: 'Confirm' }).click();
}

const BACKUP_PASSWORD = 'lozinka-ćevapi';
const CRYPTO = { timeout: 20_000 }; // 600,000 PBKDF2 rounds to seal or open a backup

/** Exports a full backup from Settings and returns the file the browser saved. */
async function exportToFile(page: Page): Promise<string> {
  await page.goto('./#/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export full backup' }).click();
  await dialog(page).getByLabel('Backup password').fill(BACKUP_PASSWORD);
  await dialog(page).getByLabel('Repeat password').fill(BACKUP_PASSWORD);
  await dialog(page).getByRole('button', { name: 'Export', exact: true }).click();
  const file = await (await download).path();
  await expect(dialog(page)).toHaveCount(0, CRYPTO);
  if (file === null) throw new Error('The download has no file.');
  return file;
}

/** Wipes the device, and opens `file` on the import screen, ready for Apply import. */
async function wipeAndOpenImport(page: Page, file: string): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => { const q = indexedDB.deleteDatabase('masterpiece'); q.onsuccess = q.onerror = q.onblocked = resolve; }));
  await page.reload();
  await page.getByRole('link', { name: 'Import a backup' }).click();
  await page.getByLabel('Backup file').setInputFiles(file);
  await page.getByLabel('Password').fill(BACKUP_PASSWORD);
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('button', { name: 'Apply import' })).toBeVisible(CRYPTO);
}

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
}

test('protect step and passcode lock (laptop: no fingerprint offered)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await freshApp(page); await setupShip(page, SHIP, 'UTC+03:00', { skipLock: false });
  await expect(page.getByRole('heading', { name: 'Protect Masterpiece' })).toBeVisible();
  await expect(page.getByText('Set a 4-digit passcode to open the app.', { exact: true })).toBeVisible();
  // Spec 4.10: the app says, when the lock is set up, that a forgotten passcode means erasing the device, and what the lock is not.
  await expect(page.getByText(/the only way back in is to erase all data on this device and restore a backup\./)).toBeVisible();
  await expect(page.getByText(/does not encrypt the data on this device/)).toBeVisible();
  await expectNoHorizontalScroll(page);                                    // 360 px, with the notes on screen
  await expect(page.getByLabel('Also unlock with fingerprint')).toHaveCount(0);
  await page.getByLabel('New passcode').fill('123'); await page.getByLabel('Repeat passcode').fill('123');
  await page.getByRole('button', { name: 'Turn on app lock' }).click();
  await expect(page.getByRole('alert')).toHaveText('Use exactly 4 digits.');
  await page.getByLabel('New passcode').fill('2580'); await page.getByLabel('Repeat passcode').fill('2580');
  await page.getByRole('button', { name: 'Turn on app lock' }).click();
  await expect(banner(page)).toContainText(SHIP); // the passcode is saved once the app shows
  await page.reload(); await expect(lockedHeading(page)).toBeVisible();
  for (let i = 0; i < 5; i++) await page.getByLabel('Passcode').fill('0000');   // auto-submits at 4 digits
  await expect(page.getByText(/Too many attempts\. Try again in \d+ s\./)).toBeVisible();
  await page.clock.fastForward(31_000);
  await page.getByLabel('Passcode').fill('2580');
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');
  const setVis = (v: string) => page.evaluate(v => { Object.defineProperty(document, 'visibilityState', { value: v, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, v);
  await setVis('hidden'); await page.clock.fastForward('06:00'); await setVis('visible');
  await expect(page.getByRole('heading', { name: 'Masterpiece is locked' })).toBeVisible();
  await page.getByRole('button', { name: 'Forgot passcode?' }).click();
  await page.getByRole('button', { name: 'Erase everything' }).click();
  await expect(page.getByRole('button', { name: 'Create your first ship' })).toBeVisible();
});

test('phone: fingerprint first, passcode as fallback', async ({ page }, info) => {
  test.skip(info.project.name !== 'android');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await freshApp(page); await setupShip(page, SHIP, 'UTC+03:00', { skipLock: false });
  await expect(page.getByText('Set a 4-digit passcode to open the app. You can also unlock with your fingerprint.')).toBeVisible();
  await expect(page.getByLabel('Also unlock with fingerprint')).toBeChecked();
  await page.getByLabel('New passcode').fill('2580'); await page.getByLabel('Repeat passcode').fill('2580');
  await page.getByRole('button', { name: 'Turn on app lock' }).click();
  await expect(banner(page)).toContainText(SHIP);                           // the lock is saved once the app shows
  await page.reload();                                                      // fingerprint prompt runs on open and succeeds
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
  await page.reload();
  await expect(page.getByText('Fingerprint not recognised — enter your passcode.')).toBeVisible();
  await page.getByLabel('Passcode').fill('2580');
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');
});

test('skip for now does not ask again', async ({ page }) => {
  await freshApp(page); await setupShip(page, SHIP, 'UTC+03:00', { skipLock: false });
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(banner(page)).toContainText(SHIP);                           // the answer is saved once the app shows
  await page.reload();
  await expect(page.getByRole('banner')).toContainText('MV OCEAN STAR');
  await expect(page.getByRole('heading', { name: 'Protect Masterpiece' })).toHaveCount(0);
  await expect(lockedHeading(page)).toHaveCount(0);
});

test('the protect step comes back after a restart until it is answered', async ({ page }) => {
  await freshApp(page); await setupShip(page, SHIP, 'UTC+03:00', { skipLock: false });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Protect Masterpiece' })).toBeVisible();
  await expect(banner(page)).toHaveCount(0);                              // nothing of the app behind it
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(banner(page)).toContainText(SHIP);
  await page.reload();
  await expect(banner(page)).toContainText(SHIP);
});

test.describe('on a phone: a fingerprint that cannot be set up, and the fingerprint switch in Settings', () => {
  test.skip(({ isMobile }) => !isMobile, 'needs a phone');

  async function virtualFingerprint(page: Page, isUserVerified: boolean) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified, automaticPresenceSimulation: true } });
    return { cdp, authenticatorId };
  }

  test('the passcode is kept and the message is shown when the phone will not make a fingerprint key', async ({ page }) => {
    await virtualFingerprint(page, false); // present, but every fingerprint check fails
    await freshApp(page); await setupShip(page, SHIP, 'UTC+03:00', { skipLock: false });
    await expect(page.getByLabel('Also unlock with fingerprint')).toBeChecked();
    await turnOnFromProtectStep(page);
    await expect(page.getByText("Fingerprint couldn't be set up. You can try again in Settings.")).toBeVisible();

    await page.reload();                                   // locked by the passcode alone: no fingerprint prompt, no fingerprint button
    await expect(lockedHeading(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unlock with fingerprint' })).toHaveCount(0);
    await passcode(page).fill(PIN);
    await expect(banner(page)).toContainText(SHIP);
  });

  test('the fingerprint can be switched off and on again in Settings', async ({ page }) => {
    await virtualFingerprint(page, true);
    await freshApp(page); await setupShip(page, SHIP, 'UTC+03:00', { skipLock: false });
    await turnOnFromProtectStep(page);
    await openSettings(page);
    const toggle = page.getByLabel('Unlock with fingerprint');
    await expect(toggle).toBeChecked();

    await toggle.uncheck();
    await expect(page.getByText('Fingerprint unlock is off.')).toBeVisible();
    await page.reload();                                   // no fingerprint enrolled: straight to the passcode
    await expect(lockedHeading(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unlock with fingerprint' })).toHaveCount(0);
    await passcode(page).fill(PIN);
    await expect(banner(page)).toContainText(SHIP);

    await openSettings(page);
    await page.getByLabel('Unlock with fingerprint').click();   // adding a way in asks for the passcode first
    await confirmWith(page, PIN);
    await expect(page.getByText('Fingerprint unlock is on.')).toBeVisible();
    await expect(page.getByLabel('Unlock with fingerprint')).toBeChecked();
    await page.reload();                                   // the fingerprint opens it again
    await expect(banner(page)).toContainText(SHIP);
  });

  test('turning the fingerprint on asks for the current passcode: a wrong one is refused and nothing is enrolled', async ({ page }) => {
    await virtualFingerprint(page, true);
    await freshApp(page); await setupShip(page, SHIP, 'UTC+03:00', { skipLock: false });
    await page.getByLabel('Also unlock with fingerprint').uncheck();     // a lock with the passcode only
    await turnOnFromProtectStep(page);
    expect((await deviceSettings(page)).pin.fingerprint).toBeUndefined();
    await openSettings(page);
    const toggle = page.getByLabel('Unlock with fingerprint');
    await expect(toggle).not.toBeChecked();

    await toggle.click();
    await expect(dialog(page).getByRole('heading', { name: 'Turn on fingerprint unlock?' })).toBeVisible();
    await expect(dialog(page).getByText('To turn on fingerprint unlock, enter your current passcode.', { exact: true })).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: 'Use fingerprint' })).toHaveCount(0);
    await confirmWith(page, '1111');
    await expect(dialog(page).getByRole('alert')).toHaveText('Wrong passcode.');
    expect((await deviceSettings(page)).pin.fingerprint).toBeUndefined();   // nothing enrolled
    expect((await deviceSettings(page)).pin.lockout.failures).toBe(1);      // and counted, like any wrong passcode
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(toggle).not.toBeChecked();
    expect((await deviceSettings(page)).pin.fingerprint).toBeUndefined();

    // The way round that the review found: a fingerprint added without the passcode would have turned the lock off without it.
    await page.getByRole('button', { name: 'Turn off app lock' }).click();
    await expect(dialog(page).getByRole('button', { name: 'Use fingerprint' })).toHaveCount(0);
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();

    await toggle.click();
    await confirmWith(page, PIN);
    await expect(page.getByText('Fingerprint unlock is on.')).toBeVisible();
    await expect(toggle).toBeChecked();
    expect((await deviceSettings(page)).pin.fingerprint).toBeDefined();
    // Taking it away again asks for nothing.
    await toggle.click();
    await expect(page.getByText('Fingerprint unlock is off.')).toBeVisible();
    expect((await deviceSettings(page)).pin.fingerprint).toBeUndefined();
  });

  test('the fingerprint view puts the focus on its first control', async ({ page }) => {
    const { cdp, authenticatorId } = await virtualFingerprint(page, true);
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { focused: string[] }).focused = seen;
      document.addEventListener('focusin', (event) => seen.push((event.target as HTMLElement).textContent ?? ''));
    });
    await freshApp(page); await setupShip(page, SHIP, 'UTC+03:00', { skipLock: false });
    await turnOnFromProtectStep(page);
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
    await page.reload();                                                    // the prompt fails, the passcode view follows
    await expect(page.getByText('Fingerprint not recognised — enter your passcode.')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { focused: string[] }).focused)).toContain('Unlock with fingerprint');
  });

  test('on a restored phone whose fingerprint cannot be set up, Import complete. is kept beside the fingerprint message', async ({ page }) => {
    await freshApp(page); await setupShip(page);
    const file = await exportToFile(page);
    await wipeAndOpenImport(page, file);
    await virtualFingerprint(page, false);                                  // present, but every fingerprint check fails
    await page.getByRole('button', { name: 'Apply import' }).click();
    await expect(page.getByRole('heading', { name: 'Protect Masterpiece' })).toBeVisible();
    await expect(page.getByLabel('Also unlock with fingerprint')).toBeChecked();
    await turnOnFromProtectStep(page);
    await expect(page.getByText("Import complete. Fingerprint couldn't be set up. You can try again in Settings.", { exact: true })).toBeVisible();
  });

  test('the fingerprint confirms turning the lock off; one that is not recognised changes nothing and counts for nothing', async ({ page }) => {
    const { cdp, authenticatorId } = await virtualFingerprint(page, true);
    await freshApp(page); await setupShip(page, SHIP, 'UTC+03:00', { skipLock: false });
    await turnOnFromProtectStep(page);
    await openSettings(page);
    await page.getByRole('button', { name: 'Turn off app lock' }).click();
    await expect(dialog(page).getByText('To turn off the app lock, enter your current passcode or use your fingerprint.')).toBeVisible();

    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
    await dialog(page).getByRole('button', { name: 'Use fingerprint' }).click();
    await expect(dialog(page).getByRole('alert')).toHaveText('Fingerprint not recognised — enter your passcode.');
    expect((await deviceSettings(page)).pin).toBeDefined();
    expect((await deviceSettings(page)).pin.lockout.failures).toBe(0);

    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true });
    await dialog(page).getByRole('button', { name: 'Use fingerprint' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByText('App lock is off.')).toBeVisible();
    await page.reload();
    await expect(banner(page)).toContainText(SHIP);
    expect(Object.keys(await deviceSettings(page))).not.toContain('pin');
  });
});

test('a lockout survives a reload, and the countdown goes on', async ({ page }) => {
  await deviceWithLock(page);
  await page.reload();
  await expect(lockedHeading(page)).toBeVisible();
  for (let i = 0; i < 5; i++) await passcode(page).fill('0000');
  await expect(countdown(page)).toBeVisible();
  const first = await secondsLeft(page);
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThanOrEqual(30);

  // A reload does not give the attempts back: the lock is still on, and no passcode is taken.
  await page.reload();
  await expect(countdown(page)).toBeVisible();
  const afterReload = await secondsLeft(page);
  expect(afterReload).toBeGreaterThan(0);
  expect(afterReload).toBeLessThanOrEqual(first);
  await expect(passcode(page)).toHaveAttribute('readonly', '');

  // The countdown goes on from where it was: ten seconds later it is ten seconds lower.
  await page.clock.fastForward(10_000);
  await expect.poll(async () => (await countdown(page).isVisible() ? await secondsLeft(page) : 0)).toBeLessThanOrEqual(afterReload - 9);

  // The next wrong passcode after the lock is the 6th: the lock is 60 s, not 30.
  await page.clock.fastForward(31_000);
  await expect(countdown(page)).toHaveCount(0);
  await passcode(page).fill('0000');
  await expect(countdown(page)).toBeVisible();
  expect(await secondsLeft(page)).toBeGreaterThan(30);
  expect(await secondsLeft(page)).toBeLessThanOrEqual(60);

  await page.clock.fastForward(61_000);
  await expect(countdown(page)).toHaveCount(0);
  await passcode(page).fill(PIN);
  await expect(banner(page)).toContainText(SHIP);

  // A right passcode forgets the failures: after a reload the first five wrong ones are free again.
  await page.reload();
  for (let i = 0; i < 4; i++) await passcode(page).fill('0000');
  await expect(page.getByRole('alert')).toHaveText('Wrong passcode.');
  await expect(countdown(page)).toHaveCount(0);
  await passcode(page).fill(PIN);
  await expect(banner(page)).toContainText(SHIP);
});

test('a wrong passcode empties the field and leaves the focus in it', async ({ page }) => {
  await deviceWithLock(page);
  await page.reload();
  await expect(passcode(page)).toHaveAttribute('type', 'password');
  await expect(passcode(page)).toHaveAttribute('inputmode', 'numeric');
  await expect(passcode(page)).toHaveAttribute('maxlength', '4');
  await expect(passcode(page)).toHaveAttribute('autocomplete', 'off');
  await expect(passcode(page)).toBeFocused();
  await expectNoHorizontalScroll(page);

  await passcode(page).fill('1111');
  await expect(page.getByRole('alert')).toHaveText('Wrong passcode.');
  await expect(passcode(page)).toHaveValue('');
  await expect(passcode(page)).toBeFocused();

  // Only digits are taken; the Unlock button says so when there are fewer than four.
  await passcode(page).pressSequentially('25a8');
  await expect(passcode(page)).toHaveValue('258');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toHaveText('Use exactly 4 digits.');
  await passcode(page).fill(PIN);
  await expect(banner(page)).toContainText(SHIP);
});

test('Settings: turning the app lock off asks for the current passcode; the wrong one is refused, the right one turns it off', async ({ page }) => {
  await deviceWithLock(page);
  await page.reload();
  await passcode(page).fill(PIN);
  await openSettings(page);
  await expect(page.getByText("Don't reuse your bank card or SIM PIN.")).toBeVisible();

  // Cancel: nothing changes, and the focus goes back to the button.
  await page.getByRole('button', { name: 'Turn off app lock' }).click();
  await expect(dialog(page).getByRole('heading', { name: 'Turn off app lock?' })).toBeVisible();
  await expect(dialog(page).getByText('To turn off the app lock, enter your current passcode.')).toBeVisible();
  await expect(page.getByLabel('Current passcode')).toHaveAttribute('type', 'password');
  await expect(page.getByLabel('Current passcode')).toHaveAttribute('inputmode', 'numeric');
  await expect(page.getByLabel('Current passcode')).toHaveAttribute('maxlength', '4');
  await expect(page.getByLabel('Current passcode')).toBeFocused();
  await expectNoHorizontalScroll(page);
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Turn off app lock' })).toBeFocused();

  // A wrong passcode is refused; the dialog stays, the field is empty and keeps the focus, and the lock is still on.
  await page.getByRole('button', { name: 'Turn off app lock' }).click();
  await confirmWith(page, '1111');
  await expect(dialog(page).getByRole('alert')).toHaveText('Wrong passcode.');
  await expect(page.getByLabel('Current passcode')).toHaveValue('');
  await expect(page.getByLabel('Current passcode')).toBeFocused();
  expect((await deviceSettings(page)).pin).toBeDefined();
  await expect(page.getByText('App lock is off.')).toHaveCount(0);
  // Fewer than four digits is not an attempt: it is said so and nothing is counted.
  await confirmWith(page, '25');
  await expect(dialog(page).getByRole('alert')).toHaveText('Use exactly 4 digits.');
  expect((await deviceSettings(page)).pin.lockout.failures).toBe(1);

  // The right one turns it off, and the failures are forgotten with it.
  await confirmWith(page, PIN);
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByText('App lock is off.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn on app lock' })).toBeVisible();

  await page.reload();
  await expect(banner(page)).toContainText(SHIP);
  await expect(lockedHeading(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Protect Masterpiece' })).toHaveCount(0); // it was answered once
  // The hash and the lockout are gone from the device settings, not just hidden.
  const stored = await deviceSettings(page);
  expect(Object.keys(stored)).not.toContain('pin');
  expect(stored.lockPrompted).toBe(true);

  // And back on, from Settings, with the same fields as the protect step.
  await openSettings(page);
  await page.getByRole('button', { name: 'Turn on app lock' }).click();
  await page.getByLabel('New passcode').fill('1234');
  await page.getByLabel('Repeat passcode').fill('1235');
  await page.getByRole('button', { name: 'Turn on app lock' }).click();
  await expect(page.getByRole('alert')).toHaveText("The passcodes don't match.");
  await page.getByLabel('Repeat passcode').fill('1234');
  await page.getByRole('button', { name: 'Turn on app lock' }).click();
  await expect(page.getByText('App lock is on.')).toBeVisible();
  await page.reload();
  await expect(lockedHeading(page)).toBeVisible();
  await passcode(page).fill('1234');
  await expect(banner(page)).toContainText(SHIP);
});

test('Settings: changing the passcode asks for the current one; then the old one fails and the new one works', async ({ page }) => {
  await deviceWithLock(page);
  await openSettings(page);
  await page.getByRole('button', { name: 'Change passcode' }).click();
  await expect(dialog(page).getByRole('heading', { name: 'Change passcode?' })).toBeVisible();

  // Without the current passcode there is no way to the new one.
  await confirmWith(page, '1111');
  await expect(dialog(page).getByRole('alert')).toHaveText('Wrong passcode.');
  await expect(page.getByLabel('New passcode')).toHaveCount(0);
  await confirmWith(page, PIN);
  await expect(dialog(page)).toHaveCount(0);

  await expect(page.getByLabel('New passcode')).toBeFocused();
  await expectNoHorizontalScroll(page);
  await page.getByLabel('New passcode').fill('13');
  await page.getByLabel('Repeat passcode').fill('13');
  await page.getByRole('button', { name: 'Set new passcode' }).click();
  await expect(page.getByRole('alert')).toHaveText('Use exactly 4 digits.');
  await page.getByLabel('New passcode').fill('1357');
  await page.getByLabel('Repeat passcode').fill('1358');
  await page.getByRole('button', { name: 'Set new passcode' }).click();
  await expect(page.getByRole('alert')).toHaveText("The passcodes don't match.");
  await page.getByLabel('Repeat passcode').fill('1357');
  await page.getByRole('button', { name: 'Set new passcode' }).click();
  await expect(page.getByText('Passcode changed.')).toBeVisible();

  // The old passcode now fails and the new one works, on the lock screen.
  await page.reload();
  await passcode(page).fill(PIN);
  await expect(page.getByRole('alert')).toHaveText('Wrong passcode.');
  await passcode(page).fill('1357');
  await expect(banner(page)).toContainText(SHIP);

  // Asking again wants the new one: the old one no longer opens the way.
  await openSettings(page);
  await page.getByRole('button', { name: 'Change passcode' }).click();
  await confirmWith(page, PIN);
  await expect(dialog(page).getByRole('alert')).toHaveText('Wrong passcode.');
  await confirmWith(page, '1357');
  await expect(page.getByLabel('New passcode')).toBeVisible();
});

test('Settings: a wrong current passcode counts towards the same lockout as the lock screen, and a lock is shown with its countdown', async ({ page }) => {
  await deviceWithLock(page);
  await openSettings(page);
  await page.getByRole('button', { name: 'Turn off app lock' }).click();
  for (let i = 0; i < 3; i++) await confirmWith(page, '0000');
  await expect(dialog(page).getByRole('alert')).toHaveText('Wrong passcode.');
  expect((await deviceSettings(page)).pin.lockout.failures).toBe(3);   // saved before it was answered
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();

  // Two more on the lock screen make the fifth: the failures were not forgotten with the dialog.
  await page.reload();
  await passcode(page).fill('0000');
  await expect(page.getByRole('alert')).toHaveText('Wrong passcode.');
  await passcode(page).fill('0000');
  await expect(countdown(page)).toBeVisible();
  await page.clock.fastForward(31_000);
  await expect(countdown(page)).toHaveCount(0);
  await passcode(page).fill(PIN);
  await expect(banner(page)).toContainText(SHIP);

  // The same from the dialog: the fifth wrong one there locks, the dialog says so, and nothing can be tried.
  expect((await deviceSettings(page)).pin.lockout.failures).toBe(0);
  await openSettings(page);
  await page.getByRole('button', { name: 'Change passcode' }).click();
  for (let i = 0; i < 5; i++) await confirmWith(page, '0000');
  await expect(dialog(page).getByText(/Too many attempts\. Try again in \d+ s\./)).toBeVisible();
  await expect(page.getByLabel('Current passcode')).toHaveAttribute('readonly', '');
  await expect(dialog(page).getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await expect(dialog(page).getByRole('alert')).toHaveCount(0);

  // A reload does not give the attempts back, and the right passcode is not taken until the lock is over.
  await page.reload();
  await expect(countdown(page)).toBeVisible();
  await expect(passcode(page)).toHaveAttribute('readonly', '');
  await page.clock.fastForward(31_000);
  await passcode(page).fill(PIN);
  await expect(banner(page)).toContainText(SHIP);

  // And the countdown in the dialog ends: the right passcode is then taken.
  await openSettings(page);
  await page.getByRole('button', { name: 'Turn off app lock' }).click();
  for (let i = 0; i < 5; i++) await confirmWith(page, '0000');
  await expect(dialog(page).getByText(/Too many attempts/)).toBeVisible();
  await page.clock.fastForward(31_000);
  await expect(dialog(page).getByText(/Too many attempts/)).toHaveCount(0);
  await confirmWith(page, PIN);
  await expect(page.getByText('App lock is off.')).toBeVisible();
});

test('Settings: the lock time, and the app locking after it', async ({ page }) => {
  await deviceWithLock(page);
  await openSettings(page);
  const minutes = page.getByLabel('Lock after (minutes in background)');
  await expect(minutes).toHaveValue('5');
  await expect(minutes).toHaveAttribute('type', 'text');
  await expect(minutes).toHaveAttribute('inputmode', 'numeric');
  for (const bad of ['61', '-1', '1.5', 'abc', '']) {
    await minutes.fill(bad);
    await page.getByRole('button', { name: 'Set lock time' }).click();
    await expect(page.getByRole('alert')).toHaveText('Enter a number of minutes from 0 to 60.');
    await expect(minutes).toBeFocused();
  }
  await minutes.fill('1');
  await page.getByRole('button', { name: 'Set lock time' }).click();
  await expect(page.getByText('The app locks after 1 minute in the background.')).toBeVisible();

  await backgroundFor(page, '00:50');                     // less than the lock time
  await expect(lockedHeading(page)).toHaveCount(0);
  await expect(banner(page)).toContainText(SHIP);
  await backgroundFor(page, '01:10');                     // more than it
  await expect(lockedHeading(page)).toBeVisible();
});

test('no ship data is in the page while the app is locked: at start, after a reload, and on coming back', async ({ page }) => {
  // Records every element the app adds to the page, from before its first script: the app (header, shell) must never be among them while locked.
  await page.addInitScript(() => {
    const seen = window as unknown as { appDrawn: boolean };
    seen.appDrawn = false;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && (node.matches('.shell, .app-header') || node.querySelector('.shell, .app-header'))) seen.appDrawn = true;
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const appDrawn = () => page.evaluate(() => (window as unknown as { appDrawn: boolean }).appDrawn);

  await freshApp(page); await setupShip(page, SHIP, 'UTC+03:00');
  // Some data to find: a crew member.
  await page.goto('./#/ship/crew/new');
  await page.getByLabel('Surname').fill('PETROVIĆ');
  await page.getByLabel('Given names').fill('Ivan');
  await page.getByLabel('Rank').selectOption({ label: 'Master' });
  await page.getByLabel('Date of birth').fill('1985-01-05');
  await page.getByLabel('Passport expiry').fill('2030-01-01');
  await page.getByLabel("Seaman's book expiry").fill('2030-01-01');
  await page.getByLabel('Sign-on date').fill('2026-06-01');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('list', { name: 'Crew' })).toContainText('PETROVIĆ');
  await openSettings(page);
  await page.getByRole('button', { name: 'Turn on app lock' }).click();
  await page.getByLabel('New passcode').fill(PIN);
  await page.getByLabel('Repeat passcode').fill(PIN);
  await page.getByRole('button', { name: 'Turn on app lock' }).click();
  await expect(page.getByText('App lock is on.')).toBeVisible();

  /** Nothing of the app is in the page: no header, no navigation, no crew; the ship's name only on the lock screen itself. */
  async function expectNothingBehindTheLock(): Promise<void> {
    await expect(lockedHeading(page)).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByTestId('ship-clock')).toHaveCount(0);
    const html = await page.content();
    expect(html).not.toContain('PETROVIĆ');
    expect(html).not.toContain('Crew');
    expect(html.match(new RegExp(SHIP, 'g'))).toHaveLength(1);        // the one on the lock screen
    expect(await page.locator('.lock').innerHTML()).toContain(SHIP);
  }

  // After a reload.
  await page.reload();
  await expectNothingBehindTheLock();
  expect(await appDrawn()).toBe(false);

  // Unlocked: the app is there.
  await passcode(page).fill(PIN);
  await expect(banner(page)).toContainText(SHIP);
  expect(await appDrawn()).toBe(true);

  // On coming back from the background, the app goes before the lock does: it is never drawn under it.
  await page.evaluate(() => { (window as unknown as { appDrawn: boolean }).appDrawn = false; });
  await backgroundFor(page, '06:00');
  await expectNothingBehindTheLock();
  expect(await appDrawn()).toBe(false);
});

test('a ship that is not made yet is never locked, and the lock is not asked for before the first ship', async ({ page }) => {
  await freshApp(page);
  await expect(page.getByRole('button', { name: 'Create your first ship' })).toBeVisible();
  await expect(lockedHeading(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Protect Masterpiece' })).toHaveCount(0);
  await setupShip(page, SHIP, 'UTC+03:00', { skipLock: false });
  await expect(page.getByRole('heading', { name: 'Protect Masterpiece' })).toBeVisible();
  await expect(banner(page)).toHaveCount(0);                              // nothing of the app behind the protect step either
});

test('Forgot passcode: Cancel keeps everything, and Erase everything leaves nothing behind', async ({ page }) => {
  await deviceWithLock(page);
  await page.reload();
  await page.getByRole('button', { name: 'Forgot passcode?' }).click();
  await expect(page.getByRole('heading', { name: 'Erase everything on this device?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Forgot passcode?' })).toBeFocused();
  await expect(lockedHeading(page)).toBeVisible();

  await page.getByRole('button', { name: 'Forgot passcode?' }).click();
  await page.getByRole('button', { name: 'Erase everything' }).click();
  await expect(page.getByRole('button', { name: 'Create your first ship' })).toBeVisible();
  // What was erased is gone for good: a new ship starts from nothing, and the protect step is asked again.
  await setupShip(page, 'MV SEA BREEZE', 'UTC+03:00', { skipLock: false });
  await expect(page.getByRole('heading', { name: 'Protect Masterpiece' })).toBeVisible();
});

test('two tabs share one lockout: wrong passcodes add up across them, and a tab that did not know cannot undo or pass a lock', async ({ page }) => {
  await deviceWithLock(page);
  await page.reload();
  const other = await page.context().newPage();
  const stale = await page.context().newPage();
  // This tab does not hear what the others save (as a tab that has been asleep does not): it works from a stale lockout.
  await stale.addInitScript(() => {
    (window as unknown as { BroadcastChannel: unknown }).BroadcastChannel = class {
      onmessage = null; onmessageerror = null;
      postMessage(): void {}
      close(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    };
  });
  await other.goto('./');
  await stale.goto('./');
  for (const tab of [page, other, stale]) await expect(lockedHeading(tab)).toBeVisible();
  for (const tab of [page, other, stale]) await expect(passcode(tab)).not.toHaveAttribute('readonly', '');

  // 3 wrong passcodes in one tab and 2 in another make 5: the stored lockout is the sum, and it is a lock, in both.
  for (let i = 0; i < 3; i++) await passcode(page).fill('0000');
  await expect(page.getByRole('alert')).toHaveText('Wrong passcode.');
  for (let i = 0; i < 2; i++) await passcode(other).fill('0000');
  await expect(countdown(other)).toBeVisible();
  await expect(countdown(page)).toBeVisible();        // the tab that was not typing is locked too, without being touched
  const locked = (await deviceSettings(page)).pin.lockout;
  expect(locked.failures).toBe(5);
  expect(typeof locked.lockedUntil).toBe('string');

  // The third tab has heard nothing: it still offers a field. A wrong passcode there leaves the lock exactly as it was
  // (it neither counts nor shortens), and the right one does not pass it.
  await expect(passcode(stale)).not.toHaveAttribute('readonly', '');
  await passcode(stale).fill('0000');
  await expect(passcode(stale)).toHaveValue('');
  expect((await deviceSettings(page)).pin.lockout).toEqual(locked);
  await passcode(stale).fill(PIN);
  await expect(passcode(stale)).toHaveValue('');
  expect((await deviceSettings(page)).pin.lockout).toEqual(locked);
  await expect(banner(stale)).toHaveCount(0);
  await expect(lockedHeading(stale)).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
  await stale.close();
  await other.close();

  // Once the lock is over the right passcode opens the app, and the failures are gone.
  await page.clock.fastForward(31_000);
  await expect(countdown(page)).toHaveCount(0);
  await passcode(page).fill(PIN);
  await expect(banner(page)).toContainText(SHIP);
  expect((await deviceSettings(page)).pin.lockout).toEqual({ failures: 0 });
});

test('the lock time changed in another tab shows in this one', async ({ page }) => {
  await deviceWithLock(page);
  await openSettings(page);
  const minutes = page.getByLabel('Lock after (minutes in background)');
  await expect(minutes).toHaveValue('5');
  const other = await page.context().newPage();
  await other.goto('./');
  await other.getByLabel('Passcode').fill(PIN);
  await openSettings(other);
  await other.getByLabel('Lock after (minutes in background)').fill('9');
  await other.getByRole('button', { name: 'Set lock time' }).click();
  await expect(other.getByText('The app locks after 9 minutes in the background.')).toBeVisible();
  await expect(minutes).toHaveValue('9');
});

test('a wrong passcode that cannot be saved holds the longest lock, and says so', async ({ page }) => {
  await deviceWithLock(page);
  await page.reload();
  await expect(lockedHeading(page)).toBeVisible();
  await expect(passcode(page)).not.toHaveAttribute('readonly', '');
  await failWrites(page);                                  // from now on every write fails the way a full disk does
  await passcode(page).fill('0000');
  await expect(page.getByRole('timer')).toHaveText("Couldn't save \u2014 locked for safety. Try again in 300 s.");
  await expect(passcode(page)).toHaveAttribute('readonly', '');
  await expect(page.getByRole('alert')).toContainText('Storage on this device is full');   // the error toast, not a passcode message
  await expect(banner(page)).toHaveCount(0);

  // Nothing opens it while it is on, not even the right passcode; once it is over, and writes work, the right one does.
  await allowWrites(page);
  await page.clock.fastForward(301_000);
  await expect(page.getByRole('timer')).toHaveCount(0);
  await passcode(page).fill(PIN);
  await expect(banner(page)).toContainText(SHIP);
});

test('a damaged passcode setting keeps the app locked, and the only way out is to erase it', async ({ page }) => {
  await freshApp(page);
  // What is in the setting, and whether the lock can ever be tried again (a setting with nothing readable in it never can).
  const damages: { value: unknown; triesAgain: boolean }[] = [
    { value: null, triesAgain: false },
    { value: 'garbage', triesAgain: true },
    { value: {}, triesAgain: true },
  ];
  for (const { value, triesAgain } of damages) {
    await setupShip(page, SHIP, 'UTC+03:00', { skipLock: false });
    await turnOnFromProtectStep(page);
    await page.evaluate((damaged) => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('masterpiece');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const store = open.result.transaction('settings', 'readwrite').objectStore('settings');
        store.get('device').onsuccess = (event) => {
          const settings = (event.target as IDBRequest).result;
          store.put({ ...settings, pin: damaged }).onsuccess = () => { open.result.close(); resolve(); };
        };
      };
    }), value);
    await page.reload();
    await expect(lockedHeading(page)).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByRole('timer')).toHaveText('Too many attempts. Try again in 300 s.');
    await expect(passcode(page)).toHaveAttribute('readonly', '');

    await page.clock.fastForward(301_000);
    if (triesAgain) {
      // The lock is over, but no passcode matches what is left of the setting: the right one is a wrong one, and it
      // locks for the longest time at once (an unreadable lockout was made the 7th failure).
      await expect(passcode(page)).not.toHaveAttribute('readonly', '');
      await passcode(page).fill(PIN);
      await expect(page.getByRole('timer')).toHaveText('Too many attempts. Try again in 300 s.');
    } else {
      await expect(page.getByRole('timer')).toHaveText('Too many attempts. Try again in 300 s.');   // time does not open it either
    }
    await expect(lockedHeading(page)).toBeVisible();
    await expect(banner(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Forgot passcode?' }).click();
    await page.getByRole('button', { name: 'Erase everything' }).click();
    await expect(page.getByRole('button', { name: 'Create your first ship' })).toBeVisible();
  }
});

test('the app locks on coming back when the clock was set back while it was in the background', async ({ page }) => {
  await deviceWithLock(page);
  const setVisibility = (state: string) =>
    page.evaluate((value) => {
      Object.defineProperty(document, 'visibilityState', { value, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
  await setVisibility('hidden');
  await page.clock.fastForward('30:00');                  // half an hour away ...
  await page.clock.setSystemTime('2026-10-25T08:59:00Z'); // ... and the clock then set back to before it left (it was 09:00)
  await setVisibility('visible');
  await expect(lockedHeading(page)).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});

test('a screen reader is told once when a lock starts and once when it ends', async ({ page }) => {
  await deviceWithLock(page);
  await page.reload();
  const announcement = page.locator('.lock .visually-hidden');
  await expect(announcement).toHaveAttribute('role', 'status');
  await expect(announcement).toHaveText('');
  for (let i = 0; i < 4; i++) await passcode(page).fill('0000');
  await expect(page.getByRole('alert')).toHaveText('Wrong passcode.');
  await expect(announcement).toHaveText('');               // a wrong passcode on its own is the alert, not this
  await passcode(page).fill('0000');
  await expect(announcement).toHaveText(/^Locked after too many attempts\. You can try again in (30|29) seconds\.$/);
  await expect(page.getByRole('timer')).toHaveText(/^Too many attempts\. Try again in \d+ s\.$/);   // the countdown is the timer, once
  await page.clock.fastForward(31_000);
  await expect(announcement).toHaveText('You can try again now.');
});

test('Erase everything: when another page keeps the database open, the dialog says the erase will finish when it lets go, cannot be cancelled, and the erase goes through then', async ({ page }) => {
  await deviceWithLock(page);
  await page.reload();
  // A page of an old version, say: it holds its connection and does not close it when asked.
  const other = await page.context().newPage();
  await other.goto('./');
  await other.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('masterpiece');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => { (window as unknown as { stubborn: IDBDatabase }).stubborn = open.result; resolve(); };
  }));

  await page.getByRole('button', { name: 'Forgot passcode?' }).click();
  await page.getByRole('button', { name: 'Erase everything' }).click();
  // The delete is queued and cannot be taken back, so the dialog stays busy: no "try again", no Cancel, Escape does nothing.
  await expect(dialog(page).getByRole('status')).toHaveText('The erase will finish when Masterpiece is closed in your other tabs.');
  await expect(dialog(page).getByRole('alert')).toHaveCount(0);
  await expect(dialog(page).getByRole('button', { name: 'Erase everything' })).toBeDisabled();
  await expect(dialog(page).getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');                 // a second one is the browser's own close, which the dialog also refuses
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('status')).toBeVisible();
  await expectNoHorizontalScroll(page);

  // The other page lets go: the delete that was asked for goes through, and this page starts again from nothing.
  await other.evaluate(() => (window as unknown as { stubborn: IDBDatabase }).stubborn.close());
  await expect(page.getByRole('button', { name: 'Create your first ship' })).toBeVisible();
});
