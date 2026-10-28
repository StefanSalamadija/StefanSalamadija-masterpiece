# Masterpiece

Masterpiece is your ship's office in your pocket: crew, certificates, voyage details and expiry warnings on your phone or laptop.
It works fully offline once installed, with no account and no signal needed.

Your data stays on your device and only leaves it in files you export or share yourself.

Open the app at **https://stefansalamadija.github.io/StefanSalamadija-masterpiece/** (needs internet only for the first visit and for updates).
The exact address is shown in the repository's **Settings**, then **Pages**, after the first deploy; use that one if it differs from the address here.

## Install on Android

1. Open the address above in Chrome while you have a connection.
2. Tap the menu (the three dots, top right), then **Install app**.
3. Open Masterpiece from your home screen. From now on it works without a signal.

## Install on a laptop

1. Open the address above in Chrome or Edge while you have a connection.
2. Click the install icon at the right-hand end of the address bar, then **Install**.
3. Open Masterpiece from your desktop, Start menu or Applications folder.

## Moving data between devices

1. On the device that has your data, go to **Settings**, then **Export full backup**, and choose a password.
2. Send the file to the other device: email, a messaging app, a USB stick or a cloud drive.
3. On the other device, open Masterpiece, choose **Import a backup** (on the welcome screen) or **Settings**, then **Import backup**. Pick the file and type its password.
4. Read the review, which says what will be added, changed or removed, and tap **Apply import**.

If both devices changed the same thing, you choose which version to keep. Importing the same file twice changes nothing the second time.
Masterpiece saves a snapshot of your data before every import, so you can go back from **Settings**, then **Restore snapshot**.

## Backups and passwords

A backup is one encrypted file holding everything on the device, for every ship. Keep a copy somewhere other than the device itself.
Masterpiece reminds you when your last full backup is getting old (7 days by default; you can change this in **Settings**).

The password must be at least 8 characters. **A forgotten password cannot be recovered**: nobody can open that backup, not even Masterpiece.
Write the password down and keep it somewhere safe and separate from the file.

## Handover file for your relief

A handover file holds one ship only, with a password of its own, so your relief can pick up where you left off.

1. In **Settings**, choose the ship, then **Export handover file**, and choose a password.
2. Send the file to your relief and give them the password separately, not in the same message.
3. Your relief installs Masterpiece, chooses **Import a backup**, picks the file and types the password.

## Enabling GitHub Pages

This is done once, by the owner of the repository. In the repository settings, go to **Pages** and set **Source** to **GitHub Actions**.
After the next merge to `main`, the app is published at `https://stefansalamadija.github.io/StefanSalamadija-masterpiece/`.
After the first deploy, the exact address is shown in the repository's **Settings**, then **Pages**. The capital letters in the repository name are not checked here, so use the address shown there if it differs.

## Releasing a new version

1. Bump `version` in `package.json` and `release.json`.
2. Write the one-sentence `whatsNew` in `release.json`.
3. Merge to `main` only after the owner approves the plain-language summary.
4. To roll back: revert the merge commit on `main`.

Merging to `main` checks and publishes the app automatically. Devices that already have Masterpiece installed show a banner with the `whatsNew` sentence and an **Update** button, and keep working as they are until you tap it.

## Development

Needs Node 22.

```
npm i              # install (SheetJS comes from cdn.sheetjs.com, so this needs internet)
npm run dev        # start the app locally
npm test           # unit tests
npm run test:e2e   # browser tests (builds the app first)
```

Also useful: `npm run typecheck`, `npm run build` (writes `dist/`) and `npm run preview`.
The browser tests run in Chromium through Playwright; on a new machine run `npx playwright install chromium` once.

The build uses relative paths (`base: './'`), so the app works from the repository sub-path on GitHub Pages as well as from the root of any host.
