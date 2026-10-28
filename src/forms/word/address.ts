import type { FieldDef, FormSchema, RowGroupDef } from '../types';
import { W, child, isEl, kids, wAttr } from './walk';

/*
 * Where a field is in a Word part: its `loc` (rulings R1).
 *
 * Encoding: `<part path>#<path>`, where a path is the index of each child element on the way from the part's root
 * element down to the node, counting elements only (text, comments and processing instructions are not counted),
 * joined by `/`. `word/document.xml#0/2/3/1/1` is: the root's child 0 (`w:body`), its child 2 (a `w:tbl`), its child 3
 * (a `w:tr`), its child 1 (a `w:tc`), its child 1 (a `w:p`).
 *
 * A field that is several nodes (a row of tick cells) has several paths, joined by `+`, in option order:
 * `word/document.xml#0/2/3/2+0/2/3/3+0/2/3/4`.
 *
 * The column of a row group is addressed from the row: the same paths, with no part and no `#` (`2`, or `1/0/3/1/1`).
 * The row is a `w:tr` for a plain group, and the item's `w:sdt` (`w15:repeatingSectionItem`) for a repeating section.
 *
 * What each address points at:
 * - a legacy form field: its `begin` `w:fldChar` (the one holding `w:ffData`);
 * - a content control: its `w:sdt`;
 * - a tick field: the `w:tc` of each option;
 * - a column of a plain group: the `w:tc`;
 * - a row group: its first `w:tr`, or its first item `w:sdt`. Row `i` is the `i`-th element sibling after it.
 */

/** Where a field or group is in a parsed part. `begin` is the `w:fldChar` of type `begin`; `cells` are in option order. */
export type WordTarget =
  | { kind: 'formtext' | 'formcheck' | 'formdrop'; begin: Element }
  | { kind: 'sdt'; sdt: Element }
  | { kind: 'tick'; cells: Element[] }
  | { kind: 'cell'; tc: Element }
  | { kind: 'group'; rows: Element[]; repeating?: Element };

/** Makes addresses for the nodes of one parsed part. The index of each child is worked out once per parent. */
export class Addresser {
  private index = new Map<Element, number>();

  constructor(readonly part: string, private root: Element) {}

  /** The path from `from` (the part's root by default) down to `el`. */
  path(el: Element, from: Element = this.root): number[] {
    const out: number[] = [];
    for (let node = el; node !== from; node = node.parentNode as Element) {
      if (!node.parentNode || node.parentNode.nodeType !== 1) throw new Error('The node is not inside the element it is addressed from.');
      out.push(this.indexOf(node));
    }
    return out.reverse();
  }

  /** The `loc` of one node, or of several (a tick row), in the part. */
  loc(...els: Element[]): string {
    return `${this.part}#${els.map((el) => this.path(el).join('/')).join('+')}`;
  }

  /** The `loc` of a node from a row (a column's address). */
  relative(row: Element, ...els: Element[]): string {
    return els.map((el) => this.path(el, row).join('/')).join('+');
  }

  /** The element index of `el` among its parent's children. */
  indexOf(el: Element): number {
    let found = this.index.get(el);
    if (found === undefined) {
      kids(el.parentNode as Element).forEach((k, i) => this.index.set(k, i));
      found = this.index.get(el)!;
    }
    return found;
  }
}

function parsePaths(text: string): number[][] | undefined {
  const paths = text.split('+').map((p) => (p === '' ? [] : p.split('/').map(Number)));
  return paths.every((p) => p.every((n) => Number.isInteger(n) && n >= 0)) ? paths : undefined;
}

/** The part and paths of a stored `loc`, or `undefined` for one that is not a Word address. */
export function parseLoc(loc: string): { part: string; paths: number[][] } | undefined {
  const hash = loc.indexOf('#');
  if (hash <= 0) return undefined;
  const paths = parsePaths(loc.slice(hash + 1));
  return paths && { part: loc.slice(0, hash), paths };
}

/** Finds elements by path, keeping each parent's child list for the next lookup. */
class Resolver {
  private children = new Map<Element, Element[]>();

  constructor(private root: Element) {}

  resolve(path: readonly number[], from: Element = this.root): Element | undefined {
    let node: Element | undefined = from;
    for (const i of path) {
      if (!node) return undefined;
      let list = this.children.get(node);
      if (!list) {
        list = kids(node);
        this.children.set(node, list);
      }
      node = list[i];
    }
    return node;
  }
}

/** The target a field's nodes make, or `undefined` when they are not the kind of node the field was made for. */
function targetOf(nodes: (Element | undefined)[], field: FieldDef): WordTarget | undefined {
  if (nodes.length === 0 || nodes.some((n) => n === undefined)) return undefined;
  const els = nodes as Element[];
  if (els.length > 1) return field.kind === 'choice' && els.every((el) => isEl(el, W, 'tc')) ? { kind: 'tick', cells: els } : undefined;
  const [el] = els;
  if (isEl(el, W, 'sdt')) return { kind: 'sdt', sdt: el };
  if (isEl(el, W, 'tc')) return { kind: 'cell', tc: el };
  if (isEl(el, W, 'fldChar') && wAttr(el, 'fldCharType') === 'begin') {
    const ffData = child(el, W, 'ffData');
    if (child(ffData, W, 'textInput')) return { kind: 'formtext', begin: el };
    if (child(ffData, W, 'checkBox')) return { kind: 'formcheck', begin: el };
    if (child(ffData, W, 'ddList')) return { kind: 'formdrop', begin: el };
  }
  return undefined;
}

/** A group's clones: the addresses under `parent` after index `last` move on by `extra`. */
interface Shift { parent: number[]; last: number; extra: number }

function shiftOf(group: RowGroupDef, part: string, extra: number): Shift | undefined {
  const loc = parseLoc(group.loc);
  if (!loc || loc.part !== part || loc.paths.length !== 1 || loc.paths[0].length === 0 || !(extra > 0)) return undefined;
  const path = loc.paths[0];
  return { parent: path.slice(0, -1), last: path[path.length - 1] + group.capacity - 1, extra };
}

/** A template path as it is in an output where the writer cloned rows (compared with the template's own indices). */
function shifted(path: readonly number[], shifts: readonly Shift[]): number[] {
  const out = [...path];
  for (const s of shifts) {
    const k = s.parent.length;
    if (path.length > k && s.parent.every((n, i) => path[i] === n) && path[k] > s.last) out[k] += s.extra;
  }
  return out;
}

/**
 * Resolves the stored addresses of a schema's fields and groups in a parsed part (`doc` is `part` parsed): the
 * template, or an output written from it. `extraRows[groupId]` is the number of rows or items the writer cloned
 * after that group's last row (`max(0, rows written − capacity)`); every later address under the same parent moves on
 * by that many, and the group's target has `capacity + extraRows` rows.
 *
 * Only the ids addressed in `part` are in the map. An address that does not lead to the kind of node it was made for
 * (a damaged or different file) is left out, so the caller can see what is missing; nothing is guessed.
 * Columns are resolved per row with `locateColumn`.
 */
export function locateWord(doc: Document, part: string, schema: FormSchema, extraRows: Record<string, number> = {}): Map<string, WordTarget> {
  const resolver = new Resolver(doc.documentElement);
  const shifts = schema.rowGroups.flatMap((g) => shiftOf(g, part, extraRows[g.id] ?? 0) ?? []);
  const targets = new Map<string, WordTarget>();

  for (const field of schema.fields) {
    const loc = parseLoc(field.loc);
    if (!loc || loc.part !== part) continue;
    const target = targetOf(loc.paths.map((p) => resolver.resolve(shifted(p, shifts))), field);
    if (target) targets.set(field.id, target);
  }

  for (const group of schema.rowGroups) {
    const loc = parseLoc(group.loc);
    if (!loc || loc.part !== part || loc.paths.length !== 1) continue;
    const first = resolver.resolve(shifted(loc.paths[0], shifts));
    if (!first || !(isEl(first, W, 'tr') || isEl(first, W, 'sdt'))) continue;
    const rows: Element[] = [];
    const extra = extraRows[group.id] ?? 0;
    const wanted = group.capacity + (extra > 0 ? extra : 0);
    for (let node: Node | null = first; node && rows.length < wanted; node = node.nextSibling) {
      if (node.nodeType !== 1) continue;
      if (!isEl(node, W, first.localName)) break;
      rows.push(node as Element);
    }
    if (rows.length !== wanted) continue;
    const section = first.parentNode?.parentNode;
    targets.set(group.id, isEl(first, W, 'sdt') && isEl(section, W, 'sdt') ? { kind: 'group', rows, repeating: section } : { kind: 'group', rows });
  }
  return targets;
}

/** Where a column of a row group is in one of its rows (`row` is a `w:tr`, or an item `w:sdt`), or `undefined`. */
export function locateColumn(row: Element, column: FieldDef): WordTarget | undefined {
  const paths = parsePaths(column.loc);
  if (!paths) return undefined;
  const resolver = new Resolver(row);
  return targetOf(paths.map((p) => resolver.resolve(p)), column);
}
