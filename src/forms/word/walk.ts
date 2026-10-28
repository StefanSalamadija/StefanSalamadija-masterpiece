/*
 * The traversal of a WordprocessingML story (the body, a header, a footer, a text box): its paragraphs, tables, rows
 * and cells in document order, with the text a person sees and the form fields in it. Detection (`detect.ts`) applies
 * its rules to this model; nothing here decides what a field is called or which rows make a group.
 *
 * What is left out, so that it is never mistaken for a label or a field of the body:
 * - the `mc:Fallback` of every `mc:AlternateContent` (Word writes a text box twice, once as a drawing and once as VML);
 * - the content of floating text boxes, which is walked on its own and collected in `Walker.textBoxes`;
 * - deleted text (`w:del`, `w:moveFrom`, `w:delText`) and field instructions;
 * - the result of a form field and the content of a content control (a placeholder or a value, never a label).
 */

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
export const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
export const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const VML = 'urn:schemas-microsoft-com:vml';

/** What a content control is, from the one element of `w:sdtPr` that says so. */
export type ControlType = 'text' | 'richText' | 'date' | 'dropDownList' | 'comboBox' | 'checkbox' | 'picture';

/** A form field as found: a legacy one (its `begin` `w:fldChar`, which holds `w:ffData`) or a content control (its `w:sdt`). */
export type RawField =
  | { kind: 'legacy'; type: 'FORMTEXT' | 'FORMCHECKBOX' | 'FORMDROPDOWN'; begin: Element; ffData: Element }
  | { kind: 'sdt'; control: ControlType; sdt: Element; sdtPr: Element };

/**
 * One thing in a paragraph or cell, in order:
 * - `text`: text a person sees outside any field (`bold` when its run is bold);
 * - `field`: a form field or content control;
 * - `box`: an empty tick box (a box symbol, or the text `☐` or `□`);
 * - `object`: anything else that is there but is not text (a picture, another symbol);
 * - `break`: the end of a paragraph;
 * - `table`, `repeat`: a table or a paragraph-level repeating section inside a cell (only in `flatTokens`).
 */
export type Token =
  | { t: 'text'; s: string; bold: boolean }
  | { t: 'field'; field: RawField }
  | { t: 'box' }
  | { t: 'object' }
  | { t: 'break' }
  | { t: 'table'; table: Table }
  | { t: 'repeat'; repeat: Repeat };

export interface Para {
  /** The `w:p`, or the `w:sdt` of a control that stands between paragraphs (its only token is the field). */
  el: Element;
  tokens: Token[];
  /** The paragraph style, such as `Heading1`. */
  style: string;
}

/** A repeating section: its `w:sdt` and its items (`w15:repeatingSectionItem` controls), each with what it holds. */
export interface Repeat {
  section: Element;
  items: { el: Element; blocks: Block[] }[];
}

export type Block = { t: 'p'; p: Para } | { t: 'table'; table: Table } | { t: 'repeat'; repeat: Repeat };

export interface Cell {
  el: Element;
  /** The first grid column the cell covers (0-based), and how many it covers. */
  grid: number;
  span: number;
  /** A vertically merged cell: `restart` opens the merge, `continue` is each (empty) cell below it. */
  vMerge?: 'restart' | 'continue';
  blocks: Block[];
}

export interface Row {
  el: Element;
  cells: Cell[];
  /** Marked to repeat as the table's header on each page (`w:tblHeader`). */
  tblHeader: boolean;
  /** For a row inside a repeating section: the section's `w:sdt`, and the item's. */
  repeat?: { section: Element; item: Element };
}

export interface Table {
  el: Element;
  /** The number of grid columns: the table's `w:tblGrid`, or the widest row when that is missing or narrower. */
  gridCols: number;
  /** Every row in document order, including rows inside content controls. */
  rows: Row[];
}

const FORM_FIELDS = new Set(['FORMTEXT', 'FORMCHECKBOX', 'FORMDROPDOWN']);
/** `w:sym` characters of an empty box: Wingdings `F0A8` and `F06F`, and `F071`. */
const BOX_CHARS = new Set(['F0A8', 'F06F', 'F071']);
/** The text of an empty box: `☐` and `□`. The group keeps each box when a text is split by it. */
const BOX_TEXT = /([☐□])/;
/** Content-control types that are fields. `w15:repeatingSection` and the rest (`w:docPartObj`, `w:group` and the like) are not. */
const CONTROL_TYPES: [ns: string, name: string, type: ControlType][] = [
  [W, 'text', 'text'], [W, 'date', 'date'], [W, 'dropDownList', 'dropDownList'], [W, 'comboBox', 'comboBox'],
  [W14, 'checkbox', 'checkbox'], [W, 'picture', 'picture'],
];
/** `w:sdtPr` children that make a control something other than rich text, whether or not it is a field. */
const NOT_RICH_TEXT = new Set(['docPartObj', 'docPartList', 'group', 'citation', 'bibliography', 'equation', 'repeatingSection', 'repeatingSectionItem']);

// ---------------------------------------------------------------------------------------------------------------
// Element helpers (xmldom: no `children`, `querySelector` or `nextElementSibling`)

export function isEl(node: Node | null | undefined, ns: string, name: string): node is Element {
  return !!node && node.nodeType === 1 && (node as Element).localName === name && (node as Element).namespaceURI === ns;
}

/** The child elements of `el`, in order. */
export function kids(el: Element): Element[] {
  const out: Element[] = [];
  for (let node = el.firstChild; node; node = node.nextSibling) if (node.nodeType === 1) out.push(node as Element);
  return out;
}

/**
 * The child elements of `el` as a reader of this file sees them: an `mc:AlternateContent` is replaced by the children
 * of its first `mc:Choice` (its `mc:Fallback`, the same content again for older readers, is never read).
 */
export function contentKids(el: Element): Element[] {
  const out: Element[] = [];
  for (const k of kids(el)) {
    if (isEl(k, MC, 'AlternateContent')) {
      const choice = child(k, MC, 'Choice');
      if (choice) out.push(...contentKids(choice));
    } else {
      out.push(k);
    }
  }
  return out;
}

/** The item controls (`w15:repeatingSectionItem`) of a repeating section's `w:sdt`, in order. */
export function itemsOf(section: Element): Element[] {
  const content = child(section, W, 'sdtContent');
  return content ? kids(content).filter(isItem) : [];
}

/** Whether `el` is the `w:sdt` of an item of a repeating section. */
export function isItem(el: Element): boolean {
  return isEl(el, W, 'sdt') && !!child(child(el, W, 'sdtPr'), W15, 'repeatingSectionItem');
}

export function child(el: Element | undefined, ns: string, name: string): Element | undefined {
  if (!el) return undefined;
  for (let node = el.firstChild; node; node = node.nextSibling) if (isEl(node, ns, name)) return node;
  return undefined;
}

/** A `w:` attribute, or `undefined`. */
export function wAttr(el: Element | undefined, name: string): string | undefined {
  return el?.getAttributeNS(W, name) ?? undefined;
}

/** `w:val` of the `w:` child `name`. */
export function wVal(el: Element | undefined, name: string): string | undefined {
  return wAttr(child(el, W, name), 'val');
}

/** An on/off property (`w:b`, `w:tblHeader`): on when present, unless its `w:val` says off. */
function isOn(el: Element | undefined): boolean {
  if (!el) return false;
  const val = wAttr(el, 'val');
  return val === undefined || !['0', 'false', 'off'].includes(val);
}

/** The text of a run of text, with every kind of white space as one space and no space at the ends. */
export function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------------------------------------------
// Content controls

/** What a `w:sdt` is: a field (with its type), a repeating section, an item, or a container whose content is walked. */
function classifySdt(sdt: Element): { as: 'field'; type: ControlType; sdtPr: Element } | { as: 'repeat' } | { as: 'container' } {
  const sdtPr = child(sdt, W, 'sdtPr');
  if (child(sdtPr, W15, 'repeatingSection')) return { as: 'repeat' };
  for (const [ns, name, type] of CONTROL_TYPES) if (child(sdtPr, ns, name)) return { as: 'field', type, sdtPr: sdtPr! };
  if (!sdtPr || kids(sdtPr).some((el) => NOT_RICH_TEXT.has(el.localName))) return { as: 'container' };
  // A rich text control is a field only while it is empty or shows its prompt. One that holds text (instructions,
  // a heading kept from being edited) is part of the form, and its text is read as the form's own.
  const content = child(sdt, W, 'sdtContent');
  const holds = (name: string): boolean => !!content && content.getElementsByTagNameNS(W, name).length > 0;
  const showsPrompt = !!child(sdtPr, W, 'showingPlcHdr');
  if (holds('tbl') || holds('sdt') || holds('fldChar')) return { as: 'container' };
  return showsPrompt || clean(content?.textContent ?? '') === '' ? { as: 'field', type: 'richText', sdtPr } : { as: 'container' };
}

// ---------------------------------------------------------------------------------------------------------------
// The walker

interface OpenField { begin: Element; ffData?: Element; instruction: string; inResult: boolean; emitted: boolean }

/**
 * Walks one story. Complex fields (`begin` … `separate` … `end`) may span runs and paragraphs, so the stack of open
 * fields belongs to the walker, not to a paragraph. Text boxes found on the way are walked with a stack of their own
 * and kept in `textBoxes`, in the order they are met.
 */
export class Walker {
  readonly textBoxes: Block[][] = [];
  private open: OpenField[] = [];

  /** The blocks of a container: `w:body`, `w:tc`, `w:sdtContent`, `w:txbxContent`, `w:hdr`, `w:ftr`. */
  blocks(container: Element): Block[] {
    const out: Block[] = [];
    for (const el of contentKids(container)) {
      if (el.namespaceURI !== W) continue;
      switch (el.localName) {
        case 'p': out.push({ t: 'p', p: this.paragraph(el) }); break;
        case 'tbl': out.push({ t: 'table', table: this.table(el) }); break;
        case 'customXml': out.push(...this.blocks(el)); break;
        case 'sdt': {
          const kind = classifySdt(el);
          const content = child(el, W, 'sdtContent');
          if (kind.as === 'field') out.push({ t: 'p', p: { el, tokens: [{ t: 'field', field: { kind: 'sdt', control: kind.type, sdt: el, sdtPr: kind.sdtPr } }], style: '' } });
          else if (kind.as === 'repeat') out.push({ t: 'repeat', repeat: { section: el, items: itemsOf(el).map((item) => ({ el: item, blocks: this.blocks(child(item, W, 'sdtContent') ?? item) })) } });
          else if (content) out.push(...this.blocks(content));
          break;
        }
        default: break; // sectPr, bookmarks, proofing marks and the like
      }
    }
    return out;
  }

  paragraph(p: Element): Para {
    const tokens: Token[] = [];
    this.inline(p, tokens);
    return { el: p, tokens, style: wVal(child(p, W, 'pPr'), 'pStyle') ?? '' };
  }

  /** The content of a paragraph or of anything that holds runs (a hyperlink, a run-level control). */
  private inline(parent: Element, tokens: Token[]): void {
    for (const el of contentKids(parent)) {
      if (el.namespaceURI !== W) continue;
      switch (el.localName) {
        case 'r': this.run(el, tokens); break;
        case 'hyperlink': case 'smartTag': case 'customXml': case 'ins': case 'moveTo': case 'fldSimple': case 'dir': case 'bdo':
          this.inline(el, tokens);
          break;
        case 'sdt': {
          const kind = classifySdt(el);
          const content = child(el, W, 'sdtContent');
          if (kind.as === 'field') {
            if (!this.hidden()) tokens.push({ t: 'field', field: { kind: 'sdt', control: kind.type, sdt: el, sdtPr: kind.sdtPr } });
          } else if (content) {
            this.inline(content, tokens);
          }
          break;
        }
        default: break; // pPr, bookmarks, w:del, w:moveFrom, proofing marks, maths
      }
    }
  }

  /** Inside the instruction of any field, or the result of a form field: nothing there is the form's own text. */
  private hidden(): boolean {
    return this.open.some((f) => !f.inResult || isFormField(f));
  }

  private run(r: Element, tokens: Token[]): void {
    const bold = isOn(child(child(r, W, 'rPr'), W, 'b'));
    const text = (s: string): void => {
      if (this.hidden()) return;
      for (const piece of s.split(BOX_TEXT)) {
        if (piece === '') continue;
        tokens.push(BOX_TEXT.test(piece) ? { t: 'box' } : { t: 'text', s: piece, bold });
      }
    };
    this.runContent(r, tokens, text);
  }

  private runContent(parent: Element, tokens: Token[], text: (s: string) => void): void {
    for (const el of contentKids(parent)) {
      if (el.namespaceURI !== W) continue;
      switch (el.localName) {
        case 't': text(el.textContent ?? ''); break;
        case 'tab': case 'ptab': case 'br': case 'cr': text(' '); break;
        case 'noBreakHyphen': text('-'); break;
        case 'sym':
          if (!this.hidden()) tokens.push(BOX_CHARS.has((wAttr(el, 'char') ?? '').toUpperCase()) ? { t: 'box' } : { t: 'object' });
          break;
        case 'fldChar': this.fldChar(el, tokens); break;
        case 'instrText': { const top = this.open.at(-1); if (top) top.instruction += el.textContent ?? ''; break; }
        case 'drawing': case 'pict': case 'object': {
          const boxes = outermostTextBoxes(el);
          for (const box of boxes) this.textBox(box);
          if (boxes.length === 0 && !this.hidden()) tokens.push({ t: 'object' });
          break;
        }
        default: break; // rPr, delText, footnote references and the like
      }
    }
  }

  private fldChar(el: Element, tokens: Token[]): void {
    const type = wAttr(el, 'fldCharType');
    if (type === 'begin') {
      this.open.push({ begin: el, ffData: child(el, W, 'ffData'), instruction: '', inResult: false, emitted: false });
      return;
    }
    const top = this.open.at(-1);
    if (!top) return;
    if (type === 'separate') top.inResult = true;
    if (type === 'separate' || type === 'end') this.emit(top, tokens);
    if (type === 'end') this.open.pop();
  }

  /** Gives the field its token once its instruction is known, unless it sits where nothing is the form's own. */
  private emit(field: OpenField, tokens: Token[]): void {
    if (field.emitted || !isFormField(field)) return;
    field.emitted = true;
    const outer = this.open.slice(0, -1);
    if (outer.some((f) => !f.inResult || isFormField(f))) return;
    tokens.push({ t: 'field', field: { kind: 'legacy', type: formType(field)!, begin: field.begin, ffData: field.ffData! } });
  }

  private textBox(content: Element): void {
    const open = this.open;
    this.open = [];
    this.textBoxes.push(this.blocks(content));
    this.open = open;
  }

  table(tbl: Element): Table {
    const rows: Row[] = [];
    const collect = (parent: Element, repeat?: Row['repeat']): void => {
      for (const el of kids(parent)) {
        if (isEl(el, W, 'tr')) rows.push(this.row(el, repeat));
        else if (isEl(el, W, 'customXml')) collect(el, repeat);
        else if (isEl(el, W, 'sdt')) {
          const content = child(el, W, 'sdtContent');
          if (!content) continue;
          if (classifySdt(el).as === 'repeat') {
            for (const item of itemsOf(el)) collect(child(item, W, 'sdtContent') ?? item, { section: el, item });
          } else {
            collect(content, repeat);
          }
        }
      }
    };
    collect(tbl);
    const declared = kids(child(tbl, W, 'tblGrid') ?? tbl).filter((el) => isEl(el, W, 'gridCol')).length;
    const widest = rows.reduce((max, row) => Math.max(max, row.cells.reduce((end, cell) => Math.max(end, cell.grid + cell.span), 0)), 0);
    return { el: tbl, gridCols: Math.max(declared, widest), rows };
  }

  private row(tr: Element, repeat?: Row['repeat']): Row {
    const trPr = child(tr, W, 'trPr');
    let grid = Number(wVal(trPr, 'gridBefore') ?? 0) || 0;
    const cells: Cell[] = [];
    const collect = (parent: Element): void => {
      for (const el of kids(parent)) {
        if (isEl(el, W, 'tc')) {
          const tcPr = child(el, W, 'tcPr');
          const span = Math.max(1, Number(wVal(tcPr, 'gridSpan') ?? 1) || 1);
          const vMergeEl = child(tcPr, W, 'vMerge');
          const vMerge = vMergeEl ? (wAttr(vMergeEl, 'val') === 'restart' ? 'restart' : 'continue') : undefined;
          cells.push({ el, grid, span, vMerge, blocks: this.blocks(el) });
          grid += span;
        } else if (isEl(el, W, 'sdt') || isEl(el, W, 'customXml')) {
          collect(isEl(el, W, 'sdt') ? child(el, W, 'sdtContent') ?? el : el);
        }
      }
    };
    collect(tr);
    return { el: tr, cells, tblHeader: isOn(child(trPr, W, 'tblHeader')), repeat };
  }
}

function formType(field: OpenField): 'FORMTEXT' | 'FORMCHECKBOX' | 'FORMDROPDOWN' | undefined {
  const word = field.instruction.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
  return FORM_FIELDS.has(word) ? (word as 'FORMTEXT' | 'FORMCHECKBOX' | 'FORMDROPDOWN') : undefined;
}

function isFormField(field: OpenField): boolean {
  return !!field.ffData && formType(field) !== undefined;
}

/** The `w:txbxContent` of each text box under `el` (a drawing, or VML), not those nested in another, and none in a fallback. */
function outermostTextBoxes(el: Element): Element[] {
  const found: Element[] = [];
  const visit = (node: Element): void => {
    for (const k of kids(node)) {
      if (k.namespaceURI === MC && k.localName === 'Fallback') continue;
      if (isEl(k, W, 'txbxContent') && (isEl(node, WPS, 'txbx') || isEl(node, VML, 'textbox'))) {
        found.push(k);
        continue;
      }
      visit(k);
    }
  };
  visit(el);
  return found;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the model

/**
 * The tokens of some blocks as one list: each paragraph's tokens then a `break`; a table or repeating section inside
 * is one token, not opened.
 */
export function flatTokens(blocks: readonly Block[]): Token[] {
  const out: Token[] = [];
  for (const block of blocks) {
    if (block.t === 'p') out.push(...block.p.tokens, { t: 'break' });
    else if (block.t === 'table') out.push({ t: 'table', table: block.table });
    else out.push({ t: 'repeat', repeat: block.repeat });
  }
  return out;
}

/** Every paragraph under some blocks, in document order, going into tables and repeating sections. */
export function* paragraphsIn(blocks: readonly Block[]): Generator<Para> {
  for (const block of blocks) {
    if (block.t === 'p') yield block.p;
    else if (block.t === 'table') for (const row of block.table.rows) for (const cell of row.cells) yield* paragraphsIn(cell.blocks);
    else for (const item of block.repeat.items) yield* paragraphsIn(item.blocks);
  }
}

/** The text of tokens, as one line. */
export function textOf(tokens: readonly Token[]): string {
  return clean(tokens.map((t) => (t.t === 'text' ? t.s : t.t === 'break' ? ' ' : '')).join(''));
}
