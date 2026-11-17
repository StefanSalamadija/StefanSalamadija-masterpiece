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

## SMS forms

Masterpiece fills in your company's own SMS forms (permits, checklists, logs, drills) from Word and Excel files.

1. **Import once.** On the laptop or the phone, open **Forms**, tap **Import form** and pick the company's `.docx`, `.dotx` or `.xlsx` file. You can pick several files at once; they are imported one after another and a summary lists any that could not be read. Forms imported several at a time are saved with the suggested setup; edit it later with **Set up** in the library. A single form opens its setup for review. Review the setup (which fields are filled for you, which you fill, which stay empty) and save it.
2. **Fill on the phone.** Open the form from **Forms** and answer the questions. A draft is kept as you go, and forms you have started are listed on **Home**.
3. **Make the file, print from the laptop.** Tap **Make file** to get the filled form as a `.docx` or `.xlsx`, then open it in Word or Excel on the laptop and print it from there. The made file is the company's own form with your answers in it.
4. **Signatures by hand.** Signature fields are left empty. Print the form and sign it on paper.
5. **Old formats.** A `.doc` or `.xls` cannot be imported. Open it in Word or Excel and save it as `.docx` or `.xlsx` first. Files with macros (`.docm`, `.xlsm`) are refused.

The forms library, your drafts and their photos stay on your devices. Nothing is sent anywhere, and the forms are included in your backups and in a handover file unless you untick **Include forms library**.

## Tools

Home → **Tools**: unit converters (length and drafts in ft + in, mass and volume, density and stowage factor, speed, temperature, pressure, power), volume ↔ mass, and speed · distance · time with the ETA in ship's time. Type a value in any row and every other unit updates. Everything works offline.

## Library

Home → **Library**: your own manuals, procedures and circulars (PDF, Word .docx, Excel .xlsx, JPEG/PNG), stored on this device and searchable offline.

- **Import documents** reads the text of every page once, so search finds words inside the files. Scanned PDFs and images have no text: they are found by title and tags and marked "No searchable text".
- Search ignores case and accents; results show the page and a snippet, and open the document at that page with the words highlighted. PDFs open in the app's own viewer; Word, Excel and images too; anything else opens with **Open with…**.
- Folders, tags, Recently opened; deleted documents stay 30 days in **Recently deleted**.
- One file can be up to 100 MB.
- Normal backups carry only titles, folders and tags. **Library files** (Library → Library files, or Settings) exports the documents themselves as encrypted files of up to 100 MB each; import them on another device in any order.

## Budget

Home → **Budget** (or **+ Expense**, or long-press the app icon → *Add expense*): your personal budget in euros, offline, behind the app lock. It is never in ship files or handovers.

- **Quick add:** amount, category, Save — three taps. Income too (salary, sales, other). Repeat last, favourites, "Same as last time", typing `fuel 60`, and **Catch up** for several entries in a row. Undo for 5 seconds.
- **Month:** your five pots (Needs, Savings & investments, Wants, Debts, Emergency fund) against their targets, categories, and recurring payments and fund set-asides to confirm.
- **Plan:** targets (this month only or from this month on), categories, recurring payments, yearly bills (sinking funds), debts with planned extra payments, goals, assets, your rotation (or from your contract), assumptions, and starting balances.
- **Forecast:** salary for the days onboard, spending and your bank balance month by month through your rotations, with warnings before a home month runs short.
- **Net worth and freedom date:** what you own minus what you owe over time, savings rate, and the date your investments could cover your yearly spending (your own return, withdrawal and inflation rates). *Projection — not a forecast or financial advice.*
- **Scenarios:** compare "what if" plans side by side; **Apply to plan** makes one your real plan.
- **Excel:** import your existing budget workbook once (Budget → Import), and export months or years to Excel.

## Draft survey

Ship → **Draft survey**: draft surveys at the loading and discharging ports, offline, worked exactly as the company's draft-survey workbook works them (its own look-ups and approximations included), so the numbers match the workbook.

1. **Import the ship's data once.** **Ship data** → **Import ship data from workbook**, pick the company workbook (`.xlsx`) and check what was found: the particulars, the hydrostatic table and the look-up ranges. **Save ship data.** The particulars can be edited there later: the app works every survey with them, and the export writes them into the workbook's INITIAL sheet (and FINAL's own dA and LBP), so Excel works with the same ones.
2. **Survey.** **New initial survey** (or **New constant check**), then a **New final** or a **New interim** from it. Type the six draft readings, the density and the deductibles in tonnes; the result and every calculation line show as you type. Nothing is shown while an input is missing or outside the table's range.
3. **Report and workbook.** The report in the workbook's DS Report layout: **Print / Save PDF**. **Export company workbook** gives the company's own workbook with this survey's inputs in it (an initial survey or constant check on INITIAL, a final or interim on FINAL, with its initial survey); Excel recalculates it when it is opened. Only the input cells and the ship's particulars change. A workbook imported before the particulars were written asks you to import it again first. If the stored workbook no longer fits, the export is refused with the reason, and the numbers and the report still work.

Good to know:

- **Difference.** Cargo is always shown positive, as loaded or discharged. The difference is cargo − compared quantity (B/L or shore figure), in tonnes and %. So it differs from the workbook's own difference cell (FINAL Y38, compared quantity − change in nett displacement): when loading it has the opposite sign, and when discharging the workbook's cell does not give the difference at all. The exported file keeps the workbook's own formula.
- **Interims** use the FINAL sheet's formulas against their initial survey. The workbook's "FINAL (2)" sheet is never used or written.
- **LCF source: confirm it.** The workbook's "LCF from midship" and "LCB Tabled" columns look swapped. The app uses the workbook's column by default, so results match the company sheet, and shows the other choice as a check line. Check the LCF against the ship's stability booklet, then set **LCF source** under **Ship data** and tick **Checked against the stability booklet**.
- **Still open:** how Excel's VLOOKUP compares a worked-out draft with the table (whether it sees 0.7 + 0.1 as 0.8) waits for a one-cell test in Excel. Until then the app compares at Excel's 15 significant digits; the two rules differ only when a draft falls a hair below a table row.
- The ship's data and surveys belong to the ship: they are in full backups and handovers, and stay on your devices otherwise.

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
