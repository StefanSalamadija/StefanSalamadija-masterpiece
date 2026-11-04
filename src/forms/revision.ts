import { defaultSetup } from './helpers';
import { normaliseLabel } from './labels';
import type { DraftValues, FieldDef, FormSchema, FormSetup, FormValue, HelperKey, RowGroupDef } from './types';

/*
 * New revisions (spec §4 step 5). The company re-issues a form; the new file is linked to the old one field by field, so
 * that the setup, the last values and every open draft carry over. A value put in the wrong box is worse than a value
 * lost (a lost one is listed and filled again; a misplaced one is signed off), so every rule here leans towards not
 * linking when in doubt.
 *
 * How fields are linked (`mapRevision`), within each section (sections and labels are compared by `normaliseLabel`):
 * 1. By label: an old and a new field with the same section, label and kind are the same field. A label that repeats
 *    in a section (`Picture` three times) is paired in document order. The placeholder label of a field that has none
 *    (`Field <n>`, `Column <n>`, low confidence) says nothing about the field and is never matched by its text.
 * 2. By place: the fields left over are paired in order, a field only with one of the same kind (the first old date
 *    with the first new date, and so on), and only between the same two fields linked by label. A field removed at the
 *    top and one added at the bottom are therefore never paired; a field renamed in place (`Subject` to `Topic`, between
 *    `Vessel` and `Date`) is. Nor is a field paired across a label-linked field that moved past it.
 * A label of a different kind is never a match. No two old fields are linked to one new field.
 *
 * Row groups are linked by a title of their own, else by their columns (`pairGroups`), never by place alone: an untitled
 * table is named after its section or `Table <n>`, which says nothing about which table it is. The columns of two linked
 * groups are then linked as fields are, within the group. An Excel matrix (R14) is made of plain fields tagged with
 * their `block`: its fields are linked as fields, and the matrix id with them (to the new matrix most of its fields went
 * to).
 *
 * The result is one map from old id to new id, for fields, columns, groups and matrices alike: their ids never clash
 * (`f1`, `g1`, `g1.c1`; `<sheet>!B7`, `<sheet>!g1`, `<sheet>!g1.C`, `<sheet>!m1`).
 */

/** What links an old revision of a form to a new one. */
export interface RevisionMap {
  /** New id by old id, for every field, column, row group and matrix that was linked. */
  map: Record<string, string>;
  /**
   * The new fields that no old field was linked to, by label, for the person to check: a top-level field by its label,
   * a new row group by its label, a new column of a linked group as `<group> · <column>`.
   */
  unmatched: string[];
  /** The old fields that no new field was linked to, named the same way. Their values cannot be carried over. */
  removed: string[];
}

/**
 * What is paired: a field, a column or a row group (which has no kind), with its label and section normalised. A
 * `placeholder` label (empty, `Field <n>` / `Column <n>` given by detection, or a group's fallback label, see
 * `groupItem`) is never matched by its text.
 */
interface Item { id: string; label: string; section: string; kind: string; placeholder: boolean }

const PLACEHOLDER = /^(?:Field|Column) \d+$/;

function fieldItem(f: FieldDef, section = f.section): Item {
  const label = normaliseLabel(f.label);
  return { id: f.id, label, section: normaliseLabel(section), kind: f.kind, placeholder: label === '' || (f.confidence === 'low' && PLACEHOLDER.test(f.label)) };
}

/** The label detection gives a group with no title and no section: `Table <n>`, numbered by place. */
const TABLE_PLACEHOLDER = /^Table \d+$/;

/**
 * A group as an item. Its label is a placeholder unless it is a title of its own: detection names a group with no title
 * after its section, or `Table <n>` when there is no section either, and neither says which table it is.
 */
function groupItem(g: RowGroupDef): Item {
  const label = normaliseLabel(g.label);
  const placeholder = label === '' || TABLE_PLACEHOLDER.test(g.label.trim()) || label === normaliseLabel(g.section);
  return { id: g.id, label, section: normaliseLabel(g.section), kind: '', placeholder };
}

/** Pairs two lists of items in document order (see the rules above). New id by old id. */
function pair(olds: readonly Item[], news: readonly Item[]): Map<string, string> {
  const pairs = byLabel(olds, news);

  // 2. By place: between the same two label-linked neighbours. A gap is named by the old id of the linked item before it
  // in the section ('' at the start of the section); on the new side that is the old partner of the new item before it.
  const oldOf = new Map([...pairs].map(([o, n]) => [n, o]));
  const oldGaps = gapsOf(olds, (i) => (pairs.has(i.id) ? i.id : undefined));
  const newGaps = gapsOf(news, (i) => oldOf.get(i.id));
  for (const [gap, left] of oldGaps) {
    const right = newGaps.get(gap) ?? [];
    // Each kind in its own order: the first old date with the first new date, and so on.
    const byKind = new Map<string, Item[]>();
    for (const n of right) byKind.set(n.kind, [...(byKind.get(n.kind) ?? []), n]);
    for (const o of left) {
      const n = byKind.get(o.kind)?.shift();
      if (n) pairs.set(o.id, n.id);
    }
  }
  return pairs;
}

/** Stage 1 alone: the items with the same section, label and kind (not a placeholder), repeats in document order. */
function byLabel(olds: readonly Item[], news: readonly Item[]): Map<string, string> {
  const pairs = new Map<string, string>();
  const byKey = new Map<string, Item[]>();
  const keyOf = (i: Item) => JSON.stringify([i.section, i.label, i.kind]);
  for (const n of news) if (!n.placeholder) byKey.set(keyOf(n), [...(byKey.get(keyOf(n)) ?? []), n]);
  for (const o of olds) {
    if (o.placeholder) continue;
    const n = byKey.get(keyOf(o))?.shift();
    if (n) pairs.set(o.id, n.id);
  }
  return pairs;
}

const columnItems = (g: RowGroupDef) => g.columns.map((c) => fieldItem(c, ''));

/**
 * Pairs the row groups. Never by place alone: a table's place says nothing once one is added or removed above it.
 * 1. By a title of its own (not a placeholder, see `groupItem`), with the same section; repeats in document order.
 * 2. The rest by their columns: within the same section, two groups are paired when at least one column has the same real
 *    label and kind in both (`byLabel`). The pair with the most such columns goes first; a tie goes to the old group,
 *    then the new group, met first. A group with no column in common with any other is not paired.
 */
function pairGroups(olds: readonly RowGroupDef[], news: readonly RowGroupDef[]): Map<string, string> {
  const pairs = byLabel(olds.map(groupItem), news.map(groupItem));
  const taken = new Set(pairs.values());
  const candidates: { from: string; to: string; shared: number; order: number }[] = [];
  olds.forEach((o, i) => {
    if (pairs.has(o.id)) return;
    news.forEach((n, j) => {
      if (taken.has(n.id) || normaliseLabel(o.section) !== normaliseLabel(n.section)) return;
      const shared = byLabel(columnItems(o), columnItems(n)).size;
      if (shared > 0) candidates.push({ from: o.id, to: n.id, shared, order: i * news.length + j });
    });
  });
  candidates.sort((a, b) => b.shared - a.shared || a.order - b.order);
  for (const { from, to } of candidates) {
    if (pairs.has(from) || taken.has(to)) continue;
    pairs.set(from, to);
    taken.add(to);
  }
  return pairs;
}

/**
 * The items not linked by label, by gap: each under the section and the linked item before it (`linked` gives the old id
 * of a linked item, undefined for one that is not).
 */
function gapsOf(items: readonly Item[], linked: (i: Item) => string | undefined): Map<string, Item[]> {
  const gaps = new Map<string, Item[]>();
  const last = new Map<string, string>();
  for (const i of items) {
    const before = linked(i);
    if (before !== undefined) {
      last.set(i.section, before);
      continue;
    }
    const gap = JSON.stringify([i.section, last.get(i.section) ?? '']);
    gaps.set(gap, [...(gaps.get(gap) ?? []), i]);
  }
  return gaps;
}

/**
 * Links the fields, columns, row groups and matrices of `oldSchema` to those of `newSchema` (see the rules at the top
 * of this file), and lists the new fields nothing was linked to (`unmatched`) and the old ones that are gone (`removed`).
 */
export function mapRevision(oldSchema: FormSchema, newSchema: FormSchema): RevisionMap {
  const map: Record<string, string> = {};
  const fieldPairs = pair(oldSchema.fields.map((f) => fieldItem(f)), newSchema.fields.map((f) => fieldItem(f)));
  for (const [o, n] of fieldPairs) map[o] = n;

  const groupPairs = pairGroups(oldSchema.rowGroups, newSchema.rowGroups);
  const newGroups = new Map(newSchema.rowGroups.map((g) => [g.id, g]));
  for (const g of oldSchema.rowGroups) {
    const n = newGroups.get(groupPairs.get(g.id) ?? '');
    if (!n) continue;
    map[g.id] = n.id;
    // Columns are compared within their group: the group's section is the same for all of them.
    for (const [o, c] of pair(columnItems(g), columnItems(n))) map[o] = c;
  }

  Object.assign(map, mapBlocks(oldSchema.fields, newSchema.fields, fieldPairs));
  return { map, unmatched: leftOver(newSchema, new Set(Object.values(map))), removed: leftOver(oldSchema, new Set(Object.keys(map))) };
}

/**
 * The matrix ids (R14): each old matrix goes to the new matrix that most of its linked fields went to, one to one (the
 * most shared fields first; a tie goes to the one met first).
 */
function mapBlocks(olds: readonly FieldDef[], news: readonly FieldDef[], pairs: ReadonlyMap<string, string>): Record<string, string> {
  const newBlock = new Map(news.map((f) => [f.id, f.block]));
  const votes = new Map<string, { from: string; to: string; count: number }>();
  for (const f of olds) {
    const to = newBlock.get(pairs.get(f.id) ?? '');
    if (f.block === undefined || to === undefined) continue;
    const key = JSON.stringify([f.block, to]);
    const vote = votes.get(key) ?? { from: f.block, to, count: 0 };
    vote.count += 1;
    votes.set(key, vote);
  }
  const map: Record<string, string> = {};
  const used = new Set<string>();
  for (const { from, to } of [...votes.values()].sort((a, b) => b.count - a.count)) {
    if (from in map || used.has(to)) continue;
    map[from] = to;
    used.add(to);
  }
  return map;
}

/** The fields, groups and columns of `schema` whose id is not in `linked`, named as `RevisionMap.unmatched` says. */
function leftOver(schema: FormSchema, linked: ReadonlySet<string>): string[] {
  return [
    ...schema.fields.filter((f) => !linked.has(f.id)).map((f) => f.label),
    ...schema.rowGroups.flatMap((g) => (linked.has(g.id)
      ? g.columns.filter((c) => !linked.has(c.id)).map((c) => `${g.label} · ${c.label}`)
      : [g.label])),
  ];
}

/** A value that says something: not `null`, not `''`, and not an unticked box (which is what an empty box shows anyway). */
function hasValue(v: FormValue | undefined): boolean {
  return v !== null && v !== undefined && v !== '' && v !== false;
}

function definitions(schema: FormSchema): Map<string, FieldDef> {
  return new Map([...schema.fields, ...schema.rowGroups.flatMap((g) => g.columns)].map((f) => [f.id, f]));
}

const sameOptions = (a: readonly string[] | undefined, b: readonly string[] | undefined) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/**
 * The value as the new field takes it, or `undefined` when it cannot. A choice whose options changed keeps only a value
 * that is still one of them: as it is, or written as the new option is when only its case or punctuation changed (and
 * just one option matches). A choice whose options did not change keeps its value, even one typed into a combo box.
 */
function carry(value: FormValue, from: FieldDef | undefined, to: FieldDef | undefined): FormValue | undefined {
  if (to?.kind !== 'choice' || typeof value !== 'string' || value === '' || !to.options?.length) return value;
  if (from && sameOptions(from.options, to.options)) return value;
  if (to.options.includes(value)) return value;
  const same = to.options.filter((o) => normaliseLabel(o) === normaliseLabel(value));
  return same.length === 1 ? same[0] : undefined;
}

/**
 * The new row of each old row: by row label when both groups have them (an inventory item keeps its own values when an
 * item is added above it; a row whose label is gone has no new row), else by place. Rows past the labelled ones keep
 * their place after the new labelled rows.
 */
function rowTargets(from: RowGroupDef | undefined, to: RowGroupDef | undefined, count: number): (number | undefined)[] {
  const oldLabels = from?.rowLabels ?? [];
  const newLabels = to?.rowLabels ?? [];
  if (oldLabels.length === 0 || newLabels.length === 0) return Array.from({ length: count }, (_, i) => i);
  const free = new Map<string, number[]>();
  newLabels.forEach((label, j) => free.set(normaliseLabel(label), [...(free.get(normaliseLabel(label)) ?? []), j]));
  return Array.from({ length: count }, (_, i) => (i < oldLabels.length
    ? free.get(normaliseLabel(oldLabels[i]!))?.shift()
    : newLabels.length + i - oldLabels.length));
}

/**
 * Moves draft values (or last values) to the new revision's ids through `map`. What cannot be carried over is left out
 * and listed in `dropped`: a field's old id, or a row cell's as `<column id>[<row index>]`. Only values that say
 * something are listed (see `hasValue`).
 *
 * With `schemas` (the old and the new revision) it also:
 * - drops a choice value the new options no longer offer (see `carry`);
 * - places rows by their row labels when both groups have them;
 * - drops the rows past the new capacity of a group that cannot grow.
 * Without it, it only renames ids. The values given are not changed.
 */
export function migrateValues(
  values: DraftValues, map: Readonly<Record<string, string>>, schemas?: { from: FormSchema; to: FormSchema },
): { values: DraftValues; dropped: string[] } {
  const dropped: string[] = [];
  const oldDefs = schemas ? definitions(schemas.from) : undefined;
  const newDefs = schemas ? definitions(schemas.to) : undefined;
  const oldGroups = new Map(schemas?.from.rowGroups.map((g) => [g.id, g]));
  const newGroups = new Map(schemas?.to.rowGroups.map((g) => [g.id, g]));

  /** The value under its new id in `into`, or listed as dropped as `name`. */
  const move = (id: string, value: FormValue, name: string, into: Record<string, FormValue>) => {
    const to = map[id];
    const carried = to === undefined || (newDefs && !newDefs.has(to)) ? undefined : carry(value, oldDefs?.get(id), newDefs?.get(to));
    if (to !== undefined && carried !== undefined) into[to] = carried;
    else if (hasValue(value)) dropped.push(name);
  };
  const dropRow = (row: Record<string, FormValue>, i: number) => {
    for (const [col, value] of Object.entries(row)) if (hasValue(value)) dropped.push(`${col}[${i}]`);
  };

  const fields: Record<string, FormValue> = {};
  for (const [id, value] of Object.entries(values.fields)) move(id, value, id, fields);

  const rows: DraftValues['rows'] = {};
  for (const [id, oldRows] of Object.entries(values.rows)) {
    const to = map[id];
    if (to === undefined || (schemas && !newGroups.has(to))) {
      oldRows.forEach(dropRow);
      continue;
    }
    const group = newGroups.get(to);
    const targets = rowTargets(oldGroups.get(id), group, oldRows.length);
    const out: Record<string, FormValue>[] = [];
    oldRows.forEach((row, i) => {
      const j = targets[i];
      if (j === undefined || (group && !group.growable && j >= group.capacity)) {
        dropRow(row, i);
        return;
      }
      const moved: Record<string, FormValue> = {};
      for (const [col, value] of Object.entries(row)) move(col, value, `${col}[${i}]`, moved);
      out[j] = moved;
    });
    rows[to] = Array.from({ length: out.length }, (_, j) => out[j] ?? {});
  }
  return { values: { fields, rows }, dropped };
}

/**
 * The setup of the new revision: the person's choices (links, fields left empty, helpers) moved to the new ids through
 * `map`, and those of old fields that are gone left out. A new field (one no old field was linked to) gets what a fresh
 * import would give it (`defaultSetup`); a linked one keeps the person's choice, even "no link". The OK word and the
 * not-finished status are kept.
 */
export function migrateSetup(setup: FormSetup, map: Readonly<Record<string, string>>, newSchema: FormSchema): FormSetup {
  const linked = new Set(Object.values(map));
  const isNew = (id: string) => !linked.has(id);
  const fresh = defaultSetup(newSchema);
  const moveIds = (ids: readonly string[], defaults: readonly string[]) =>
    [...new Set([...ids.flatMap((id) => (map[id] === undefined ? [] : [map[id]])), ...defaults.filter(isNew)])];

  const links: FormSetup['links'] = {};
  for (const [id, link] of Object.entries(setup.links)) if (map[id] !== undefined) links[map[id]] = link;
  for (const [id, link] of Object.entries(fresh.links)) if (isNew(id) && !(id in links)) links[id] = link;

  const helpers = { ...fresh.helpers };
  for (const key of Object.keys(helpers) as HelperKey[]) helpers[key] = moveIds(setup.helpers[key] ?? [], fresh.helpers[key]);
  return { links, leftEmpty: moveIds(setup.leftEmpty, fresh.leftEmpty), helpers, okWord: setup.okWord, notFinished: setup.notFinished };
}
