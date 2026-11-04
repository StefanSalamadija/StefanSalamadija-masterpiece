import {
  BODY_IMAGE_RID, Controls, TEXT_WIDTH, emptyRows, headerBlock, headerRow, heading, p, row, run, table, tickBox, titleRow, wordPackage,
} from './wordXml';

/*
 * Synthetic Word forms for the tests of the forms engine. Every text in them is invented: the only words they share
 * with real forms are generic ones (Vessel, Date, Yes, No, N/A, Signature). The package, header and field XML come
 * from `wordXml.ts`; each builder here only lays out its form.
 */

const REVISION = '00 / 01.01.2026';

export interface ToolboxTalkOptions {
  /** The revision in the header. */
  revision?: string;
  /** Names the `Subject:` label this instead, as a later revision of the form might. */
  renameSubjectTo?: string;
  /** Adds a row with this label and a field, after the subject. */
  extraFieldLabel?: string;
}

/**
 * `TST-01 Toolbox Talk`: a details table (`Vessel:`, `Subject:`, `Date:` with `Time:`) of FORMTEXT fields, a
 * `Participants` table of 12 empty rows, and a signature cell.
 */
export function toolboxTalkDocx(options: ToolboxTalkOptions = {}): Uint8Array {
  const c = new Controls();
  const widths = [1700, 3300, 1500, 3138];
  const field = (content: string) => ({ content: p(content), span: 3 });
  const details = table(widths, [
    row(widths, ['Vessel:', field(c.formText())]),
    row(widths, [`${options.renameSubjectTo ?? 'Subject'}:`, field(c.formText())]),
    ...(options.extraFieldLabel ? [row(widths, [`${options.extraFieldLabel}:`, field(c.formText())])] : []),
    // The date field is told its format by the field itself, not by its label. The time's label shares its cell with the field.
    row(widths, ['Date:', { content: p(c.formText({ type: 'date', format: 'dd/MMM/yyyy' })) }, { content: p(run('Time: ') + c.formText()), span: 2 }]),
  ]);

  const people = [4000, 2500, 3138];
  const participants = table(people, [headerRow(people, ['Name', 'Rank', 'Signature']), ...emptyRows(people, 12)]);
  const signature = table([TEXT_WIDTH], [
    row([TEXT_WIDTH], [{ content: p(run('Signature:')) + p(run('(Person in charge)')) }], { height: 900 }),
  ]);

  return wordPackage({
    kind: 'docx',
    header: headerBlock(c, { title: 'Toolbox Talk', code: 'TST-01', revision: options.revision ?? REVISION }),
    body: details + p() + heading('Participants') + participants + p() + signature + p(),
  });
}

/**
 * `TST-02 Demo Permit`: two Yes / No / N/A tick-box sections, a gas table with two alarm rows and 10 reading rows,
 * a personnel table of 8 rows, and a legacy checkbox.
 */
export function permitDocx(): Uint8Array {
  const c = new Controls();
  const widths = [5438, 1400, 1400, 1400];
  const ticks = [{ content: p(tickBox(), { center: true }) }, { content: p(tickBox(), { center: true }) }, { content: p(tickBox(), { center: true }) }];
  const checks = (section: number, count: number) => Array.from({ length: count }, (_, i) => row(widths, [`Check ${section}.${i + 1}`, ...ticks]));
  const choiceHeader = headerRow(widths, ['', 'Yes', 'No', 'N/A']);

  // Section 1 is titled by a row across its table, section 2 by a bold paragraph above it: forms use both.
  const section1 = table(widths, [titleRow(widths, 'Section 1 – Checks'), choiceHeader, ...checks(1, 4)]);
  const section2 = table(widths, [choiceHeader, ...checks(2, 3)]);

  const gasWidths = [2438, 2400, 2400, 2400];
  const gas = table(gasWidths, [
    titleRow(gasWidths, 'Gas readings'),
    headerRow(gasWidths, ['Time', 'O2 [Vol.%]', 'CO [ppm]', 'H2S [ppm]']),
    row(gasWidths, ['Alarm 1', '19.5', '25', '5']),
    row(gasWidths, ['Alarm 2', '23', '50', '10']),
    ...emptyRows(gasWidths, 10),
  ]);

  const peopleWidths = [5238, 2200, 2200];
  const personnel = table(peopleWidths, [headerRow(peopleWidths, ['Name / Rank', 'Time IN', 'Time OUT']), ...emptyRows(peopleWidths, 8)]);

  const confirmWidths = [5438, 4200];
  const confirm = table(confirmWidths, [row(confirmWidths, ['Checks completed:', { content: p(c.formCheckbox()) }])]);

  return wordPackage({
    kind: 'docx',
    header: headerBlock(c, { title: 'Demo Permit', code: 'TST-02', revision: REVISION }),
    body: section1 + p() + heading('Section 2 – Entry') + section2 + p() + gas + p() + heading('Personnel') + personnel + p() + confirm + p(),
  });
}

/**
 * `TST-03 Demo Weekly Jobs`, a template (`.dotx`): three FORMTEXT fields, a `Jobs` table whose rows are a repeating
 * section of 3 items (content controls, and a FORMDROPDOWN for the status), and a `Pictures` repeating section of one
 * item: a row of 3 picture controls, each with a FORMDROPDOWN.
 */
export function weeklyJobsDotx(): Uint8Array {
  const c = new Controls();
  const detailWidths = [2700, 6938];
  const details = table(detailWidths, ['Vessel:', 'Year / Week No.:', 'Date (from to):'].map((label) => row(detailWidths, [label, { content: p(c.formText()) }])));

  const jobWidths = [1300, 1500, 3138, 1500, 2200];
  const prompt = 'Click or tap here to enter text.';
  const job = () => row(jobWidths, [
    { content: p(c.dateControl({ alias: 'Job date', tag: 'jobDate', format: 'dd.MM.yyyy', text: 'Click or tap to enter a date.', placeholder: true })) },
    { content: p(c.textControl({ alias: 'Responsible', tag: 'jobResponsible', text: prompt, placeholder: true })) },
    { content: p(c.textControl({ alias: 'Description', tag: 'jobDescription', text: prompt, placeholder: true, multiLine: true })) },
    { content: p(c.formDropdown(['_ choose', 'Pending', 'Completed'])) },
    { content: p(c.textControl({ alias: 'Remarks', tag: 'jobRemarks', text: prompt, placeholder: true, multiLine: true })) },
  ]);
  const jobs = table(jobWidths, [
    headerRow(jobWidths, ['Date', 'Responsible', 'Description', 'Status', 'Remarks']),
    c.repeatingSection({ alias: 'Jobs', tag: 'jobs', title: 'Job', items: [job(), job(), job()] }),
  ]);

  const pictureWidths = [3213, 3213, 3212];
  const picture = (n: number) => ({
    content: c.pictureControl({ alias: 'Picture', tag: `picture${n}`, rId: BODY_IMAGE_RID, cx: 1800000, cy: 1350000 })
      + p(run('Photo: ') + c.formDropdown(['_ choose', 'Before', 'After'], { name: `Photo${n}` })),
  });
  const pictures = table(pictureWidths, [
    c.repeatingSection({ alias: 'Pictures', tag: 'pictures', items: [row(pictureWidths, [picture(1), picture(2), picture(3)])] }),
  ]);

  return wordPackage({
    kind: 'dotx',
    bodyUsesImage: true,
    header: headerBlock(c, { title: 'Demo Weekly Jobs', code: 'TST-03', revision: REVISION }),
    body: details + p() + heading('Jobs') + jobs + p() + heading('Pictures') + pictures + p(),
  });
}

/**
 * `TST-05 Demo Jobs With Photos`, a template (`.dotx`): one `Jobs` repeating section whose rows hold Date, Responsible,
 * Description and Status controls and, in the same row, a picture control with a Before / After drop-down. This is the
 * shape in which a job log carries its photos in the jobs table itself (the weekly fixture keeps them in a table of
 * their own).
 */
export function jobsWithPhotosDotx(): Uint8Array {
  const c = new Controls();
  const widths = [1300, 1500, 2438, 1300, 1700, 1400];
  const prompt = 'Click or tap here to enter text.';
  const job = () => row(widths, [
    { content: p(c.dateControl({ alias: 'Job date', tag: 'jobDate', format: 'dd.MM.yyyy', text: 'Click or tap to enter a date.', placeholder: true })) },
    { content: p(c.textControl({ alias: 'Responsible', tag: 'jobResponsible', text: prompt, placeholder: true })) },
    { content: p(c.textControl({ alias: 'Description', tag: 'jobDescription', text: prompt, placeholder: true, multiLine: true })) },
    { content: p(c.formDropdown(['_ choose', 'Pending', 'Completed'])) },
    { content: c.pictureControl({ alias: 'Picture', tag: 'jobPicture', rId: BODY_IMAGE_RID, cx: 1200000, cy: 900000 }) },
    { content: p(c.formDropdown(['_ choose', 'Before', 'After'])) },
  ]);
  const jobs = table(widths, [
    headerRow(widths, ['Date', 'Responsible', 'Description', 'Status', 'Picture', 'Photo']),
    c.repeatingSection({ alias: 'Jobs', tag: 'jobs', title: 'Job', items: [job(), job()] }),
  ]);
  return wordPackage({
    kind: 'dotx',
    bodyUsesImage: true,
    header: headerBlock(c, { title: 'Demo Jobs With Photos', code: 'TST-05', revision: REVISION }),
    body: heading('Jobs') + jobs + p(),
  });
}

/**
 * `TST-04 Demo Content Controls`: one control of each kind in a two-column table: text, date (`dd/MMM/yyyy`, a control of
 * its own between paragraphs), drop-down, combo box, `w14:checkbox`, and a text control that still shows its prompt.
 */
export function contentControlsDocx(): Uint8Array {
  const c = new Controls();
  const widths = [3000, 6638];
  const items: [string, string][] = [['First', '1'], ['Second', '2'], ['Third', '3']];
  const inParagraph = (control: string) => ({ content: p(control) });
  const controls = table(widths, [
    row(widths, ['Name:', inParagraph(c.textControl({ alias: 'Name', tag: 'name', text: 'Sample name' }))]),
    row(widths, ['Date:', { content: c.dateControl({ alias: 'Date', tag: 'date', format: 'dd/MMM/yyyy', text: '01/Jan/2026', date: '2026-01-01', block: true }) }]),
    row(widths, ['Option:', inParagraph(c.dropdownControl({ alias: 'Option', tag: 'option', items, selected: 0 }))]),
    row(widths, ['Entry:', inParagraph(c.comboControl({ alias: 'Entry', tag: 'entry', items, shown: 'Typed entry' }))]),
    row(widths, ['Confirmed:', inParagraph(c.checkboxControl({ alias: 'Confirmed', tag: 'confirmed' }))]),
    row(widths, ['Notes:', inParagraph(c.textControl({ alias: 'Notes', tag: 'notes', text: 'Click or tap here to enter text.', placeholder: true, multiLine: true }))]),
  ]);

  return wordPackage({
    kind: 'docx',
    header: headerBlock(c, { title: 'Demo Content Controls', code: 'TST-04', revision: REVISION }),
    body: controls + p(),
  });
}

/**
 * `TST-05 Demo Odd Layouts`: the places a field's label is hard to find. A field with nothing before it; two fields beside
 * a vertically merged `Contact` cell; two fields under `Port` and `Berth` cells; a field in a floating text box; and
 * a field in the page header.
 */
export function oddLayoutsDocx(): Uint8Array {
  const c = new Controls();
  const unlabelled = p(c.formText());

  const merged = [2000, 7638];
  const mergedLabel = table(merged, [
    row(merged, [{ text: 'Contact', vMerge: 'restart' }, { content: p(c.formText()) }]),
    row(merged, [{ vMerge: 'continue' }, { content: p(c.formText()) }]),
  ]);

  const above = [4819, 4819];
  const labelAbove = table(above, [
    row(above, ['Port', 'Berth']),
    row(above, [{ content: p(c.formText()) }, { content: p(c.formText()) }]),
  ]);

  const textBox = p(run('A box floats beside this line. ') + c.textBox(p(run('Box note: ') + c.formText())));

  return wordPackage({
    kind: 'docx',
    header: headerBlock(c, { title: 'Demo Odd Layouts', code: 'TST-05', revision: REVISION, extra: p(run('Ref: ') + c.formText()) }),
    body: unlabelled + mergedLabel + p() + labelAbove + p() + textBox,
  });
}

/**
 * `TST-06 Demo Short Dates`: date fields whose own format has no year, as a weekly form writes the days of its week.
 * A details table of `Day:` (one FORMTEXT date, `dd.MM`), `Date (from - to):` (one FORMTEXT date, `dd.MM`, that holds
 * the whole period) and `Date (from to):` (two FORMTEXT dates, `dd.MM`, with ` - ` between them: the first and the last
 * day).
 */
export function shortDatesDocx(): Uint8Array {
  const c = new Controls();
  const widths = [2700, 6938];
  const date = () => c.formText({ type: 'date', format: 'dd.MM' });
  const details = table(widths, [
    row(widths, ['Day:', { content: p(date()) }]),
    row(widths, ['Date (from - to):', { content: p(date()) }]),
    row(widths, ['Date (from to):', { content: p(date() + run(' - ') + date()) }]),
  ]);
  return wordPackage({
    kind: 'docx',
    header: headerBlock(c, { title: 'Demo Short Dates', code: 'TST-06', revision: REVISION }),
    body: details + p(),
  });
}

/**
 * `TST-09 Demo Times`: Word's time field and its neighbours. A details table of `Time:` (a FORMTEXT of type date whose
 * own format is `HH:mm`, which is how Word makes a time field), `Checked on:` (a FORMTEXT date in `dd/MM/yyyy HH:mm`,
 * a date and a time), and `Total:` (a FORMTEXT of type calculated, which Word works out itself). Then `Readings`: the
 * header `Tank | Before | After | Difference` over 3 rows of an empty Tank cell, a number FORMTEXT under Before and
 * under After, and a calculated FORMTEXT under Difference.
 */
export function timesDocx(): Uint8Array {
  const c = new Controls();
  const widths = [2700, 6938];
  const details = table(widths, [
    row(widths, ['Time:', { content: p(c.formText({ type: 'date', format: 'HH:mm' })) }]),
    row(widths, ['Checked on:', { content: p(c.formText({ type: 'date', format: 'dd/MM/yyyy HH:mm' })) }]),
    row(widths, ['Total:', { content: p(c.formText({ type: 'calculated' })) }]),
  ]);
  const number = () => ({ content: p(c.formText({ type: 'number' })) });
  const readingWidths = [3000, 2213, 2213, 2212];
  const readings = table(readingWidths, [
    headerRow(readingWidths, ['Tank', 'Before', 'After', 'Difference']),
    ...Array.from({ length: 3 }, () => row(readingWidths, ['', number(), number(), { content: p(c.formText({ type: 'calculated' })) }])),
  ]);
  return wordPackage({
    kind: 'docx',
    header: headerBlock(c, { title: 'Demo Times', code: 'TST-09', revision: REVISION }),
    body: details + p() + readings + p(),
  });
}

/**
 * `TST-08 Demo Uneven Rows`: a table of empty rows whose last empty rows are drawn differently. Under the bold header
 * `Step | Demo task | Lower | Upper | Outcome` (Outcome two grid columns wide), 3 empty rows of the same cells; then an
 * empty row of as many cells whose first is two grid columns wide; then an empty row of two wide cells. Only the 3 rows
 * laid out like the first are rows of the table.
 */
export function unevenRowsDocx(): Uint8Array {
  const c = new Controls();
  const widths = [800, 2400, 1600, 1600, 1600, 1638];
  const empty = (spans: number[]): string => row(widths, spans.map((span) => ({ span })), { height: 400 });
  const titles = ['Step', 'Demo task', 'Lower', 'Upper', 'Outcome'];
  const checks = table(widths, [
    row(widths, titles.map((text, i) => ({ text, bold: true, span: i === 4 ? 2 : 1 }))),
    empty([1, 1, 1, 1, 2]),
    empty([1, 1, 1, 1, 2]),
    empty([1, 1, 1, 1, 2]),
    empty([2, 1, 1, 1, 1]),
    empty([3, 3]),
  ]);
  return wordPackage({
    kind: 'docx',
    header: headerBlock(c, { title: 'Demo Uneven Rows', code: 'TST-08', revision: REVISION }),
    body: heading('Demo steps') + checks + p(),
  });
}

/**
 * `TST-16 Demo Merged Rows`: tables whose empty rows hold cells that continue a vertical merge, which Word does not show.
 * - `Shifts`: the bold header `Shift | Demo task | Hours | Demo notes`, whose `Demo notes` cell is merged down over all 4
 *   empty rows below it; in those rows, the `Shift` cell of the first opens a merge that the other 3 continue.
 * - `Demo blocks`: a bold header of three cells, each merged down over the 2 empty rows below it.
 * - `Demo margins`: `Demo note` merged down over two rows, beside a FORMTEXT in each; the second row's merged cell also holds a
 *   FORMTEXT, which Word does not show.
 */
export function mergedRowsDocx(): Uint8Array {
  const c = new Controls();
  const widths = [2000, 3000, 2000, 2638];
  const shifts = table(widths, [
    row(widths, [{ text: 'Shift', bold: true }, { text: 'Demo task', bold: true }, { text: 'Hours', bold: true }, { text: 'Demo notes', bold: true, vMerge: 'restart' }]),
    row(widths, [{ vMerge: 'restart' }, '', '', { vMerge: 'continue' }], { height: 400 }),
    ...Array.from({ length: 3 }, () => row(widths, [{ vMerge: 'continue' }, '', '', { vMerge: 'continue' }], { height: 400 })),
  ]);
  const thirds = [3213, 3213, 3212];
  const blocks = table(thirds, [
    row(thirds, ['Demo left', 'Demo mid', 'Demo right'].map((text) => ({ text, bold: true, vMerge: 'restart' as const }))),
    ...Array.from({ length: 2 }, () => row(thirds, thirds.map(() => ({ vMerge: 'continue' as const })), { height: 400 })),
  ]);
  const halves = [4819, 4819];
  const notes = table(halves, [
    row(halves, [{ text: 'Demo note', vMerge: 'restart' }, { content: p(c.formText()) }]),
    row(halves, [{ vMerge: 'continue', content: p(c.formText()) }, { content: p(c.formText()) }]),
  ]);
  return wordPackage({
    kind: 'docx',
    header: headerBlock(c, { title: 'Demo Merged Rows', code: 'TST-16', revision: REVISION }),
    body: heading('Shifts') + shifts + p() + heading('Demo blocks') + blocks + p() + heading('Demo margins') + notes + p(),
  });
}

/**
 * `TST-15 Demo Far Labels`: FORMTEXT fields in table cells whose label is neither before them in their cell, nor in the
 * cell before them, nor in a header just above. Each table holds one layout and the cases its rule must leave alone.
 * - `Demo tour`: the header ` | Seen | Jottings` (the first cell two columns wide); a title row `Demo first round` over
 *   items `n. | item | printed tick box | [field]`; a title row `Demo second round:` over rows whose item is a field.
 * - `Demo flows`: the header `Fluid | Gentle | Steady | Brisk` over rows of a fluid and three `[field] u/h` cells.
 * - `Demo cargo`: `Courier: [field] | Mass | Scale | Crates` over `Buyer: [field] | [field] | [field] | [field]`; then
 *   `Gate: [field] | Demo lane | [field]` over `Exit: [field] | [field] | [field]`.
 * - `Demo zones`: the header `Ref | Zone | Looked at`, two rows `Z-1 | Demo shed | [field]`, and a free row of three
 *   fields.
 * - `Demo counts`: `Counted: | [field] small | [field] large` and `Opens: | [field] (day) | [field] (time of day)`, the
 *   caption of each in a paragraph of its own; then `[field] plus [field] |  | ` with nothing else near.
 * - `Demo boxes`: a title row `Demo account` over one field across the table; a title row `Demo pictures` over two
 *   rows that each hold one field in their second cell; a title row `Demo twins` over a row of two fields.
 * - `Demo spans`: the header `Demo part | Demo state` (two columns wide), a title row `Demo block`, and
 *   `Demo valve | [field] | [field]`.
 * - a table of one row `X |  | [field]`.
 */
export function farLabelsDocx(): Uint8Array {
  const c = new Controls();
  const field = (after = '') => ({ content: p(c.formText() + (after ? run(after) : '')) });
  const captioned = (caption: string) => ({ content: p(c.formText()) + p(run(caption)) });
  const bold = (text: string, span = 1) => ({ text, bold: true, span });

  const listWidths = [700, 4300, 900, 3738];
  const checklist = table(listWidths, [
    row(listWidths, [bold('', 2), bold('Seen'), bold('Jottings')]),
    titleRow(listWidths, 'Demo first round'),
    row(listWidths, ['1.', 'Demo shutters: look for gaps', { content: p(tickBox()) }, field()]),
    row(listWidths, ['2.', 'Demo ropes', { content: p(tickBox()) }, field()]),
    titleRow(listWidths, 'Demo second round:'),
    row(listWidths, ['3.', field(), { content: p(tickBox()) }, field()]),
    row(listWidths, ['4.', field(), { content: p(tickBox()) }, field()]),
  ]);

  const quarter = [2400, 2400, 2400, 2438];
  const rates = table(quarter, [
    row(quarter, [bold('Fluid'), bold('Gentle'), bold('Steady'), bold('Brisk')]),
    row(quarter, ['Demo fluid A', field(' u/h'), field(' u/h'), field(' u/h')]),
    row(quarter, ['Demo fluid B', field(' u/h'), field(' u/h'), field(' u/h')]),
  ]);
  const labelled = (label: string) => ({ content: p(run(label) + c.formText()) });
  const cargo = table(quarter, [
    row(quarter, [labelled('Courier: '), 'Mass', 'Scale', 'Crates']),
    row(quarter, [labelled('Buyer: '), field(), field(), field()]),
  ]);
  const thirds = [3000, 3000, 3638];
  const gates = table(thirds, [
    row(thirds, [labelled('Gate: '), 'Demo lane', field()]),
    row(thirds, [labelled('Exit: '), field(), field()]),
  ]);

  const areaWidths = [1200, 4000, 4438];
  const zones = table(areaWidths, [
    row(areaWidths, [bold('Ref'), bold('Zone'), bold('Looked at')]),
    row(areaWidths, ['Z-1', 'Demo shed', field()]),
    row(areaWidths, ['Z-2', 'Demo yard', field()]),
    row(areaWidths, [field(), field(), field()]),
  ]);

  const counts = table(thirds, [
    row(thirds, ['Counted:', field(' small'), field(' large')]),
    row(thirds, ['Opens:', captioned('(day)'), captioned('(time of day)')]),
    row(thirds, [{ content: p(c.formText() + run(' plus ') + c.formText()) }, '', '']),
  ]);

  const halves = [4819, 4819];
  const boxes = table(halves, [
    titleRow(halves, 'Demo account'),
    row(halves, [{ content: p(c.formText()), span: 2 }]),
    titleRow(halves, 'Demo pictures'),
    row(halves, ['', field()]),
    row(halves, ['', field()]),
    titleRow(halves, 'Demo twins'),
    row(halves, [field(), field()]),
  ]);

  const spans = table(thirds, [
    row(thirds, [bold('Demo part'), bold('Demo state', 2)]),
    titleRow(thirds, 'Demo block'),
    row(thirds, ['Demo valve', field(), field()]),
  ]);

  const markWidths = [800, 800, 8038];
  const mark = table(markWidths, [row(markWidths, ['X', '', field()])]);

  return wordPackage({
    kind: 'docx',
    header: headerBlock(c, { title: 'Demo Far Labels', code: 'TST-15', revision: REVISION }),
    body: heading('Demo tour') + checklist + p() + heading('Demo flows') + rates + p() + heading('Demo cargo') + cargo + p() + gates + p()
      + heading('Demo zones') + zones + p() + heading('Demo counts') + counts + p() + heading('Demo boxes') + boxes + p()
      + heading('Demo spans') + spans + p() + mark + p(),
  });
}

/**
 * `TST-07 Demo Field Rows`: tables whose rows already hold a FORMTEXT in each cell to fill.
 * - `Attendees`: a title row, the header `Name | Function / Rank | Signature`, and 4 rows with a FORMTEXT under Name
 *   and under Function / Rank and an empty Signature cell.
 * - `Documents`: the header `No. | Document | Issued | Expires`; a first row whose Expires cell says `N/A` instead of
 *   holding a field; then 3 rows with the number and name of a document and a FORMTEXT date (`dd/MM/yyyy`) under
 *   Issued and under Expires.
 * - `Contacts`: the header `Item | Details` over rows of a label and one field each, which name their own fields.
 * - `Place`: the header `Port | Berth | Agent` over a single row of fields.
 */
export function fieldRowsDocx(): Uint8Array {
  const c = new Controls();
  const field = () => ({ content: p(c.formText()) });
  const date = () => ({ content: p(c.formText({ type: 'date', format: 'dd/MM/yyyy' })) });

  const crewWidths = [4000, 3000, 2638];
  const attendees = table(crewWidths, [
    titleRow(crewWidths, 'Attendees'),
    headerRow(crewWidths, ['Name', 'Function / Rank', 'Signature']),
    ...Array.from({ length: 4 }, () => row(crewWidths, [field(), field(), ''])),
  ]);

  const docWidths = [800, 4838, 2000, 2000];
  const documents = ['Demo register', 'Demo survey', 'Demo permit'];
  const register = table(docWidths, [
    headerRow(docWidths, ['No.', 'Document', 'Issued', 'Expires']),
    row(docWidths, ['1', 'Demo letter', date(), 'N/A']),
    ...documents.map((name, i) => row(docWidths, [String(i + 2), name, date(), date()])),
  ]);

  const contactWidths = [3000, 6638];
  const contacts = table(contactWidths, [
    headerRow(contactWidths, ['Item', 'Details']),
    row(contactWidths, ['Vessel:', field()]),
    row(contactWidths, ['Port:', field()]),
  ]);

  const placeWidths = [3213, 3213, 3212];
  const place = table(placeWidths, [headerRow(placeWidths, ['Port', 'Berth', 'Agent']), row(placeWidths, [field(), field(), field()])]);

  return wordPackage({
    kind: 'docx',
    header: headerBlock(c, { title: 'Demo Field Rows', code: 'TST-07', revision: REVISION }),
    body: attendees + p() + heading('Documents') + register + p() + contacts + p() + place + p(),
  });
}
