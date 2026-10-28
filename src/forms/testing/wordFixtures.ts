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
