import { CONTENT_TYPE, PNG_1X1, REL_TYPE, XML_DECLARATION, contentTypesXml, escapeXml, relationshipsXml, zipOf } from './zip';

/*
 * Hand-written WordprocessingML, in the shapes Word itself writes: tables with a grid, legacy form fields (a run
 * sequence with an `ffData` block, wrapped in a bookmark), content controls (`w:sdt`), repeating sections, picture
 * controls, a header part. Every text, name and number in it is invented.
 */

const NAMESPACES = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  o: 'urn:schemas-microsoft-com:office:office',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  v: 'urn:schemas-microsoft-com:vml',
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  w15: 'http://schemas.microsoft.com/office/word/2012/wordml',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
};
/** The namespace declarations of a root element. `w14` and `w15` are extensions an older reader may skip, so they are `mc:Ignorable`. */
const ROOT_ATTRIBUTES = `${Object.entries(NAMESPACES).map(([prefix, uri]) => `xmlns:${prefix}="${uri}"`).join(' ')} mc:Ignorable="w14 w15"`;

/** What an empty FORMTEXT shows: five en spaces, U+2002. Written as a character reference, never as the character itself. */
const EN_SPACES = '&#x2002;'.repeat(5);
/** The page: A4 with 2 cm side margins, so the text is 9,638 twips wide. */
export const TEXT_WIDTH = 9638;
/** The relationship id of the image in `word/document.xml.rels`, for a body that shows it (the header's own logo is `rId1` in its rels). */
export const BODY_IMAGE_RID = 'rId3';
const HEADER_SHADE = 'D9D9D9';

// ---------------------------------------------------------------------------------------------------------------
// Text, paragraphs, tables

/** A run of text. The text is escaped. */
export function run(text: string, properties = ''): string {
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

/** A paragraph of runs (XML). `center` and `spaceAfter` are its only formatting. */
export function p(content = '', format: { center?: boolean; spaceAfter?: number } = {}): string {
  const properties = (format.spaceAfter === undefined ? '' : `<w:spacing w:after="${format.spaceAfter}"/>`) + (format.center ? '<w:jc w:val="center"/>' : '');
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${content}</w:p>`;
}

/** A paragraph of bold text, which is how these forms mark a heading. */
export function heading(text: string): string {
  return p(run(text, '<w:b/><w:bCs/>'), { spaceAfter: 60 });
}

/** One cell. `text` becomes its one paragraph; `content` (paragraph XML) is used instead when given. */
export interface Cell {
  text?: string;
  content?: string;
  bold?: boolean;
  shade?: string;
  /** `gridSpan`: the number of grid columns the cell covers. */
  span?: number;
  /** A vertically merged cell: `restart` opens the merge, `continue` is each cell below it. */
  vMerge?: 'restart' | 'continue';
}

/**
 * A table row. `widths` are the table's grid columns; a cell that spans several is as wide as they are together.
 * A string is a cell of plain text, `''` an empty one.
 */
export function row(widths: number[], cells: (string | Cell)[], options: { height?: number } = {}): string {
  let column = 0;
  const xml = cells.map((entry) => {
    const cell: Cell = typeof entry === 'string' ? { text: entry } : entry;
    const span = cell.span ?? 1;
    const width = widths.slice(column, column + span).reduce((sum, w) => sum + w, 0);
    column += span;
    const properties = `<w:tcW w:w="${width}" w:type="dxa"/>`
      + (span > 1 ? `<w:gridSpan w:val="${span}"/>` : '')
      + (cell.vMerge === 'restart' ? '<w:vMerge w:val="restart"/>' : cell.vMerge === 'continue' ? '<w:vMerge/>' : '')
      + (cell.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${cell.shade}"/>` : '');
    const content = cell.content ?? p(cell.text ? run(cell.text, cell.bold ? '<w:b/><w:bCs/>' : '') : '');
    return `<w:tc><w:tcPr>${properties}</w:tcPr>${content}</w:tc>`;
  });
  const properties = options.height ? `<w:trPr><w:trHeight w:val="${options.height}"/></w:trPr>` : '';
  return `<w:tr>${properties}${xml.join('')}</w:tr>`;
}

/** A header row: bold, shaded texts. */
export function headerRow(widths: number[], texts: string[]): string {
  return row(widths, texts.map((text) => ({ text, bold: true, shade: HEADER_SHADE })));
}

/** A row that is one cell across the whole table, which is how these forms title a block of rows. */
export function titleRow(widths: number[], text: string): string {
  return row(widths, [{ text, bold: true, span: widths.length }]);
}

/** `count` rows whose cells are all empty: no text, no field, no symbol. */
export function emptyRows(widths: number[], count: number): string[] {
  return Array.from({ length: count }, () => row(widths, widths.map(() => ''), { height: 400 }));
}

/** A table with a thin border on every side and between cells. `rows` may hold the XML of row-level content controls. */
export function table(widths: number[], rows: string[]): string {
  const border = (side: string): string => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`;
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('');
  const width = widths.reduce((sum, w) => sum + w, 0);
  return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/>`
    + '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>'
    + `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`;
}

/** An empty box symbol, `F0A8` in Wingdings, which is how these forms print a tick box. */
export function tickBox(): string {
  return '<w:r><w:sym w:font="Wingdings" w:char="F0A8"/></w:r>';
}

/** A field that Word fills itself (`PAGE`, `NUMPAGES`): not a form field, so it has no `ffData`. */
function pageField(instruction: string): string {
  return '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
    + `<w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r>`
    + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
    + '<w:r><w:rPr><w:noProof/></w:rPr><w:t>1</w:t></w:r>'
    + '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
}

// ---------------------------------------------------------------------------------------------------------------
// Form fields and content controls

const FIELD_FONT = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>';
const FIELD_SIZE = '<w:sz w:val="20"/><w:szCs w:val="20"/>';
/** Run properties of every run of a form field: the result run keeps them, which is what a writer copies. */
const FIELD_RUN = `${FIELD_FONT}${FIELD_SIZE}`;
const FIELD_RESULT_RUN = `${FIELD_FONT}<w:noProof/>${FIELD_SIZE}`;

/** What Word calls an unnamed field: `Text1`, `Check1`, `Dropdown1`. */
type NamePrefix = 'Text' | 'Check' | 'Dropdown';

export interface TextFieldOptions {
  /** `w:textInput/w:type`: left out for a plain text field. */
  type?: 'number' | 'date' | 'currentDate' | 'currentTime';
  /** `w:textInput/w:format`, such as the date format of a `date` field. */
  format?: string;
}

/**
 * Makes the ids Word makes up (bookmarks, content controls, drawings) and the form fields and controls built on
 * them. One per document, so that the ids are unique in it and the same call always makes the same file.
 */
export class Controls {
  private bookmarks = 0;
  private drawings = 0;
  private random = 4711;
  private names: Record<NamePrefix, number> = { Text: 0, Check: 0, Dropdown: 0 };

  /** A content control's `w:id`: a different 31-bit number each time, in an order that never changes. */
  private nextId(): number {
    this.random = (Math.imul(this.random, 1103515245) + 12345) & 0x7fffffff;
    return this.random;
  }

  private nextName(prefix: NamePrefix): string {
    this.names[prefix] += 1;
    return `${prefix}${this.names[prefix]}`;
  }

  // ----- legacy form fields

  /** begin (with `ffData`), the instruction, separate, the result, end: the sequence Word writes, in a bookmark of the field's name. */
  private legacyField(name: string, choice: string, instruction: string, result: string): string {
    const id = this.bookmarks;
    this.bookmarks += 1;
    const ffData = `<w:ffData><w:name w:val="${escapeXml(name)}"/><w:enabled/><w:calcOnExit w:val="0"/>${choice}</w:ffData>`;
    const fldChar = (type: string, inner = ''): string => `<w:r><w:rPr>${FIELD_RUN}</w:rPr><w:fldChar w:fldCharType="${type}"${inner ? `>${inner}</w:fldChar>` : '/>'}</w:r>`;
    return `<w:bookmarkStart w:id="${id}" w:name="${escapeXml(name)}"/>`
      + fldChar('begin', ffData)
      + `<w:r><w:rPr>${FIELD_RUN}</w:rPr><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r>`
      + fldChar('separate')
      + result
      + fldChar('end')
      + `<w:bookmarkEnd w:id="${id}"/>`;
  }

  /** `FORMTEXT`, empty: five en spaces. */
  formText(options: TextFieldOptions = {}): string {
    const input = (options.type ? `<w:type w:val="${options.type}"/>` : '') + (options.format ? `<w:format w:val="${escapeXml(options.format)}"/>` : '');
    const result = `<w:r><w:rPr>${FIELD_RESULT_RUN}</w:rPr><w:t>${EN_SPACES}</w:t></w:r>`;
    return this.legacyField(this.nextName('Text'), `<w:textInput>${input}</w:textInput>`, 'FORMTEXT', result);
  }

  /** `FORMCHECKBOX`, unchecked. Word writes no result run for it. */
  formCheckbox(): string {
    return this.legacyField(this.nextName('Check'), '<w:checkBox><w:sizeAuto/><w:default w:val="0"/></w:checkBox>', 'FORMCHECKBOX', '');
  }

  /** `FORMDROPDOWN` with these entries, none chosen yet, named `Dropdown<n>` unless `name` is given. Word writes no result run for it. */
  formDropdown(entries: string[], options: { name?: string } = {}): string {
    const list = `<w:ddList>${entries.map((entry) => `<w:listEntry w:val="${escapeXml(entry)}"/>`).join('')}</w:ddList>`;
    return this.legacyField(options.name ?? this.nextName('Dropdown'), list, 'FORMDROPDOWN', '');
  }

  // ----- content controls

  /**
   * A `w:sdt`: `type` is the one element of `w:sdtPr` that says what kind of control it is. `content` is what
   * `w:sdtContent` holds: runs for a control inside a paragraph, or, with `block`, a control of its own between
   * paragraphs, which holds a paragraph. A control that is `placeholder` shows prompt text and carries `w:showingPlcHdr`.
   */
  private sdt(o: { alias: string; tag: string; type: string; content: string; placeholder?: boolean; block?: boolean }): string {
    return `<w:sdt><w:sdtPr><w:alias w:val="${escapeXml(o.alias)}"/><w:tag w:val="${escapeXml(o.tag)}"/><w:id w:val="${this.nextId()}"/>`
      + `${o.placeholder ? '<w:showingPlcHdr/>' : ''}${o.type}</w:sdtPr><w:sdtContent>${o.block ? p(o.content) : o.content}</w:sdtContent></w:sdt>`;
  }

  /** The run a control holds: plain text, or grey prompt text in Word's `PlaceholderText` style. */
  private shown(text: string, placeholder?: boolean): string {
    return run(text, placeholder ? '<w:rStyle w:val="PlaceholderText"/>' : '');
  }

  /** A plain-text control; `multiLine` lets it take line breaks. */
  textControl(o: { alias: string; tag: string; text: string; placeholder?: boolean; multiLine?: boolean }): string {
    const type = o.multiLine ? '<w:text w:multiLine="1"/>' : '<w:text/>';
    return this.sdt({ alias: o.alias, tag: o.tag, type, placeholder: o.placeholder, content: this.shown(o.text, o.placeholder) });
  }

  /** A date picker. With `date` (ISO) it holds `w:fullDate`; `text` is what it shows, in `format`. */
  dateControl(o: { alias: string; tag: string; format: string; text: string; date?: string; placeholder?: boolean; block?: boolean }): string {
    const full = o.date ? ` w:fullDate="${o.date}T00:00:00Z"` : '';
    const type = `<w:date${full}><w:dateFormat w:val="${escapeXml(o.format)}"/><w:lid w:val="en-GB"/><w:storeMappedDataAs w:val="dateTime"/><w:calendar w:val="gregorian"/></w:date>`;
    return this.sdt({ alias: o.alias, tag: o.tag, type, placeholder: o.placeholder, block: o.block, content: this.shown(o.text, o.placeholder) });
  }

  /**
   * A drop-down list: Word's own first entry (`Choose an item.`), then `items` as `[displayText, value]`. With
   * `selected` (an index into `items`) it shows that item; without, it shows the prompt.
   */
  dropdownControl(o: { alias: string; tag: string; items: [string, string][]; selected?: number }): string {
    const items = o.items.map(([displayText, value]) => `<w:listItem w:displayText="${escapeXml(displayText)}" w:value="${escapeXml(value)}"/>`).join('');
    const chosen = o.selected === undefined ? undefined : o.items[o.selected];
    const last = chosen ? ` w:lastValue="${escapeXml(chosen[1])}"` : '';
    const type = `<w:dropDownList${last}><w:listItem w:value="Choose an item."/>${items}</w:dropDownList>`;
    return this.sdt({ alias: o.alias, tag: o.tag, type, placeholder: !chosen, content: this.shown(chosen ? chosen[0] : 'Choose an item.', !chosen) });
  }

  /** A combo box: a list that also takes free text, which is what `shown` is. */
  comboControl(o: { alias: string; tag: string; items: [string, string][]; shown: string }): string {
    const items = o.items.map(([displayText, value]) => `<w:listItem w:displayText="${escapeXml(displayText)}" w:value="${escapeXml(value)}"/>`).join('');
    return this.sdt({ alias: o.alias, tag: o.tag, type: `<w:comboBox>${items}</w:comboBox>`, content: this.shown(o.shown) });
  }

  /** A `w14:checkbox`, unchecked: ☐ (U+2610) in MS Gothic, which becomes ☒ (U+2612) when checked. */
  checkboxControl(o: { alias: string; tag: string }): string {
    const type = '<w14:checkbox><w14:checked w14:val="0"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox>';
    const glyph = '<w:r><w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic" w:hint="eastAsia"/></w:rPr><w:t>&#x2610;</w:t></w:r>';
    return this.sdt({ alias: o.alias, tag: o.tag, type, content: glyph });
  }

  /** A picture control showing its placeholder picture (a block-level control: it holds a paragraph). `rId` is the image relationship. */
  pictureControl(o: { alias: string; tag: string; rId: string; cx: number; cy: number }): string {
    const picture = this.inlinePicture({ name: o.alias, rId: o.rId, cx: o.cx, cy: o.cy });
    return this.sdt({ alias: o.alias, tag: o.tag, type: '<w:picture/>', placeholder: true, content: p(`<w:r><w:rPr><w:noProof/></w:rPr>${picture}</w:r>`) });
  }

  /**
   * A repeating section: the outer control, and inside it one `w15:repeatingSectionItem` control for each of `items`
   * (table rows, or paragraphs). Build each item with its own call so that its controls get their own ids.
   */
  repeatingSection(o: { alias: string; tag: string; title?: string; items: string[] }): string {
    const title = o.title ? `<w15:sectionTitle w15:val="${escapeXml(o.title)}"/>` : '';
    const items = o.items.map((item) => `<w:sdt><w:sdtPr><w:id w:val="${this.nextId()}"/><w15:repeatingSectionItem/></w:sdtPr><w:sdtContent>${item}</w:sdtContent></w:sdt>`);
    return this.sdt({ alias: o.alias, tag: o.tag, type: `<w15:repeatingSection>${title}</w15:repeatingSection>`, content: items.join('') });
  }

  // ----- drawings

  /** A picture in the text: `wp:inline` with its extent, and `a:blip r:embed` pointing at relationship `rId`. */
  inlinePicture(o: { name: string; rId: string; cx: number; cy: number }): string {
    this.drawings += 1;
    const id = this.drawings;
    return '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
      + `<wp:extent cx="${o.cx}" cy="${o.cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="${escapeXml(o.name)} ${id}"/>`
      + '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
      + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
      + `<pic:nvPicPr><pic:cNvPr id="${id}" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr>`
      + `<pic:blipFill><a:blip r:embed="${o.rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
      + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${o.cx}" cy="${o.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
      + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
  }

  /**
   * A floating text box holding `content` (paragraph XML), written as Word writes it: the `wps:txbx` drawing in
   * `mc:Choice`, and the same content again in a VML `v:textbox` in `mc:Fallback`.
   */
  textBox(content: string): string {
    this.drawings += 1;
    const id = this.drawings;
    const cx = 2160000;
    const cy = 540000;
    const drawing = '<w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251659264" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">'
      + '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>3200400</wp:posOffset></wp:positionH>'
      + '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>'
      + `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/>`
      + `<wp:docPr id="${id}" name="Text Box ${id}"/><wp:cNvGraphicFramePr/>`
      + '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/>'
      + `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>`
      + `<wps:txbx><w:txbxContent>${content}</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>`;
    const fallback = '<w:pict><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>'
      + `<v:shape id="Text Box ${id}" o:spid="_x0000_s${1025 + id}" type="#_x0000_t202" style="position:absolute;margin-left:252pt;margin-top:0;width:170pt;height:42.5pt;z-index:251659264;visibility:visible;mso-wrap-style:square">`
      + `<v:textbox><w:txbxContent>${content}</w:txbxContent></v:textbox></v:shape></w:pict>`;
    return `<w:r><mc:AlternateContent><mc:Choice Requires="wps">${drawing}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent></w:r>`;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The package

/**
 * The page header every form has: a table with the logo, the title, and the form code, revision and page. Anything in
 * `extra` (paragraph XML) goes under the page number.
 */
export function headerBlock(controls: Controls, o: { title: string; code: string; revision: string; extra?: string }): string {
  const widths = [2200, 4238, 3200];
  const logo = p(`<w:r><w:rPr><w:noProof/></w:rPr>${controls.inlinePicture({ name: 'Logo', rId: 'rId1', cx: 1080000, cy: 540000 })}</w:r>`);
  const title = p(run(o.title, '<w:b/><w:bCs/><w:sz w:val="32"/><w:szCs w:val="32"/>'), { center: true });
  const identity = p(run(`Form: ${o.code}`)) + p(run(`Revision: ${o.revision}`))
    + p(run('Page: ') + pageField('PAGE') + run(' of ') + pageField('NUMPAGES')) + (o.extra ?? '');
  return table(widths, [row(widths, [{ content: logo }, { content: title }, { content: identity }])]) + p();
}

export interface WordPackageParts {
  kind: 'docx' | 'dotx';
  /** The XML between `<w:body>` and the section properties. It must end with a paragraph. */
  body: string;
  /** The XML inside `<w:hdr>`. It must end with a paragraph. */
  header: string;
  /** Whether the body shows the image (as `BODY_IMAGE_RID`): the same picture as the logo. */
  bodyUsesImage?: boolean;
}

const STYLES = `${XML_DECLARATION}<w:styles xmlns:w="${NAMESPACES.w}">`
  + '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>'
  + '<w:style w:type="character" w:styleId="PlaceholderText"><w:name w:val="Placeholder Text"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:semiHidden/><w:rPr><w:color w:val="808080"/></w:rPr></w:style>'
  + '</w:styles>';

/**
 * The zip of a Word form: content types, relationships, `word/document.xml`, its header (`word/header1.xml`, reached
 * through `w:headerReference` in `w:sectPr`), the styles, and the 1 by 1 logo `word/media/image1.png`.
 * Relationship ids: `rId1` styles, `rId2` the header, `BODY_IMAGE_RID` (`rId3`) the image, there only when `bodyUsesImage`.
 */
export function wordPackage(parts: WordPackageParts): Uint8Array {
  const sectPr = '<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/>'
    + '<w:pgMar w:top="1701" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>';
  const documentRels: Record<string, [string, string]> = {
    rId1: [REL_TYPE.styles, 'styles.xml'],
    rId2: [REL_TYPE.header, 'header1.xml'],
  };
  if (parts.bodyUsesImage) documentRels[BODY_IMAGE_RID] = [REL_TYPE.image, 'media/image1.png'];

  return zipOf({
    '[Content_Types].xml': contentTypesXml({
      'word/document.xml': parts.kind === 'dotx' ? CONTENT_TYPE.dotx : CONTENT_TYPE.docx,
      'word/styles.xml': CONTENT_TYPE.wordStyles,
      'word/header1.xml': CONTENT_TYPE.wordHeader,
    }),
    '_rels/.rels': relationshipsXml({ rId1: [REL_TYPE.officeDocument, 'word/document.xml'] }),
    'word/document.xml': `${XML_DECLARATION}<w:document ${ROOT_ATTRIBUTES}><w:body>${parts.body}${sectPr}</w:body></w:document>`,
    'word/_rels/document.xml.rels': relationshipsXml(documentRels),
    'word/header1.xml': `${XML_DECLARATION}<w:hdr ${ROOT_ATTRIBUTES}>${parts.header}</w:hdr>`,
    'word/_rels/header1.xml.rels': relationshipsXml({ rId1: [REL_TYPE.image, 'media/image1.png'] }),
    'word/styles.xml': STYLES,
    'word/media/image1.png': PNG_1X1,
  });
}
