import { identityFromText } from '../identity';
import { partText } from '../package';
import type { Package } from '../package';
import type { FormIdentity } from '../types';
import { parseXml } from '../xml';
import { hasWords, labelText, segment } from './fields';
import { W, Walker, child, clean, isEl, kids, paragraphsIn, textOf, wVal } from './walk';
import type { Block, Para, Token } from './walk';

/*
 * The parts of a Word form other than the body's own text: the headers and footers (the form's identity, and fields
 * that can't be filled here) and the floating text boxes of the body (fields that can't be filled here).
 */

const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const HEADER_OR_FOOTER = /^word\/(header|footer)(\d*)\.xml$/;
/** How much of a text box's text names it in the list of what can't be filled. */
const SHORT = 40;

/** The first 40 characters of a text, with `…` when there is more. */
function short(text: string): string {
  return text.length > SHORT ? `${text.slice(0, SHORT).trimEnd()}…` : text;
}

/** The header and footer parts, `header1.xml` before `header2.xml` before `header10.xml`, headers before footers. */
function headerAndFooterParts(pkg: Package): { path: string; kind: 'header' | 'footer' }[] {
  return [...pkg.entries.keys()]
    .flatMap((path) => {
      const m = HEADER_OR_FOOTER.exec(path);
      return m ? [{ path, kind: m[1] as 'header' | 'footer', n: Number(m[2] || 0) }] : [];
    })
    .sort((a, b) => (a.kind === b.kind ? a.n - b.n : a.kind === 'header' ? -1 : 1))
    .map(({ path, kind }) => ({ path, kind }));
}

/** Every paragraph of a story, its text boxes' included. */
function allParagraphs(blocks: readonly Block[], textBoxes: readonly Block[][]): Para[] {
  return [...paragraphsIn(blocks), ...textBoxes.flatMap((box) => [...paragraphsIn(box)])];
}

/** What a field in a header or footer is called in the list of what can't be filled: the text before it in its paragraph. */
function headerFieldNote(kind: 'header' | 'footer', tokens: readonly Token[], i: number): string {
  const word = kind === 'header' ? 'Header field' : 'Footer field';
  const token = tokens[i];
  const before = segment(tokens, i - 1, -1, true);
  const alias = token.t === 'field' && token.field.kind === 'sdt' ? wVal(token.field.sdtPr, 'alias') : undefined;
  const name = hasWords(before) ? before : hasWords(alias) ? alias : undefined;
  return name === undefined ? word : `${word}: "${short(labelText(name))}"`;
}

/**
 * The lines of text a person sees in a part, one per paragraph, as the header gives the form's identity: field
 * results (a page number) are read, prompts of content controls and deleted text are not, and a text box is read once.
 */
function visibleLines(root: Element): string[] {
  const lines: string[] = [];
  const skip = (el: Element): boolean => (el.namespaceURI === MC && el.localName === 'Fallback')
    || isEl(el, W, 'del') || isEl(el, W, 'moveFrom') || isEl(el, W, 'instrText')
    || (isEl(el, W, 'sdt') && !!child(child(el, W, 'sdtPr'), W, 'showingPlcHdr'));
  const paragraph = (p: Element): void => {
    const parts: string[] = [];
    const boxes: Element[] = [];
    const collect = (el: Element): void => {
      for (const k of kids(el)) {
        if (skip(k)) continue;
        const name = k.namespaceURI === W ? k.localName : '';
        if (name === 'txbxContent') boxes.push(k);
        else if (name === 't') parts.push(k.textContent ?? '');
        else if (name === 'tab' || name === 'br') parts.push(' ');
        else collect(k);
      }
    };
    collect(p);
    lines.push(clean(parts.join('')));
    for (const box of boxes) visit(box);
  };
  const visit = (el: Element): void => {
    for (const k of kids(el)) {
      if (skip(k)) continue;
      if (isEl(k, W, 'p')) paragraph(k);
      else visit(k);
    }
  };
  visit(root);
  return lines.filter((line) => line !== '');
}

/**
 * The identity (from the text of `word/header*.xml`) and what can't be filled here: each text box of the body that
 * holds a field or an empty tick box, then each field in a header or footer, as a short sentence.
 */
export function otherStories(pkg: Package, bodyTextBoxes: readonly Block[][], fileName: string): { identity: FormIdentity; unsupported: string[] } {
  const unsupported: string[] = [];
  for (const box of bodyTextBoxes) {
    const tokens = [...paragraphsIn(box)].flatMap((p): Token[] => [...p.tokens, { t: 'break' }]);
    if (!tokens.some((t) => t.t === 'field' || t.t === 'box')) continue;
    const text = textOf(tokens);
    unsupported.push(text === '' ? 'Text box' : `Text box: "${short(text)}"`);
  }

  const headerLines: string[] = [];
  for (const { path, kind } of headerAndFooterParts(pkg)) {
    const root = parseXml(partText(pkg, path)!).documentElement;
    if (kind === 'header') headerLines.push(...visibleLines(root));
    const walker = new Walker();
    for (const p of allParagraphs(walker.blocks(root), walker.textBoxes)) {
      p.tokens.forEach((t, i) => {
        if (t.t === 'field') unsupported.push(headerFieldNote(kind, p.tokens, i));
      });
    }
  }
  return { identity: identityFromText(headerLines, fileName), unsupported };
}
