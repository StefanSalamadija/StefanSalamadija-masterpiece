import { bytesOf, utf8 } from './package';
import type { Package } from './package';

/*
 * Taking the macros out of a macro-enabled file at import (R21). The file is kept, as a normal `.docx`, `.dotx`,
 * `.xlsx` or `.xltx`, without its macros; macros are never run or kept. The stripped package is the template from then
 * on: detection runs on it, and the integrity check compares made files with it.
 *
 * What is removed:
 * - the VBA project and the parts that belong to it: a part named `vbaProject.bin`, `vbaData.xml` or
 *   `vbaProjectSignature*.bin`, a part whose Override gives a VBA type, and the target of a relationship of a VBA type;
 * - in a file that had a VBA project, what only runs its macros: a Word key map (`customizations.xml`), Word's attached
 *   toolbars, and a ribbon (`customUI`) that calls a procedure (`onAction`, `getLabel`... are names of macros);
 * - the `.rels` of each removed part, and the parts only those `.rels` point to (`vbaData.xml`, the signatures, a
 *   ribbon's icons), unless a part that stays points to them too;
 * - every relationship to a removed part, and every relationship of a VBA type, in every `.rels` that stays;
 * - the Override of each removed part, and a Default of a removed type (the `bin` one Word gives its project) when no
 *   part that stays relies on it. A `bin` Default of another type, such as Excel's printer settings, stays.
 * The main part's macro-enabled content type becomes the plain one, keeping template or document.
 *
 * `[Content_Types].xml` and the `.rels` are edited as text, an element taken out at a time, so every other byte of
 * them stays. Every other part is left as it is.
 *
 * What stays, on purpose: an Excel `codeName` (on `workbookPr`, `fileVersion` or a sheet), which names the sheet's
 * module and runs nothing; ActiveX controls and form controls, which are controls, not code (one assigned to a macro
 * does nothing once the macro is gone); a ribbon that calls no procedure; a Word document's attached template, which is
 * a path outside the file. Excel 4.0 macro sheets are not stripped: `sniffFormat` refuses a file that has one.
 */

/** What the setup review lists under `Can't be filled here` for a file whose macros were removed. */
export const MACROS_REMOVED = 'Macros were removed from this file.';

const CONTENT_TYPES = '[Content_Types].xml';

/** The macro-enabled main content types and the plain one each becomes. */
const PLAIN_MAIN: readonly [RegExp, string][] = [
  [/application\/vnd\.ms-word\.document\.macroEnabled\.main\+xml/gi, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'],
  [/application\/vnd\.ms-word\.template\.macroEnabledTemplate\.main\+xml/gi, 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml'],
  [/application\/vnd\.ms-excel\.sheet\.macroEnabled\.main\+xml/gi, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'],
  [/application\/vnd\.ms-excel\.template\.macroEnabled\.main\+xml/gi, 'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml'],
];

const VBA_NAME = /(?:^|\/)(?:vbaProject\.bin|vbaData\.xml|vbaProjectSignature[^/]*\.bin)$/i;
/** The project, its signatures (plain, agile, V3) and Word's `vbaData.xml`. */
const VBA_TYPE = /^application\/vnd\.ms-(?:office\.vbaProject(?:Signature(?:Agile|V3)?)?|word\.vbaData\+xml)$/i;
const VBA_REL = /\/relationships\/(?:vbaProject(?:Signature(?:Agile|V3)?)?|wordVbaData)$/i;
/** Word's key maps and attached toolbars: in a macro file, what runs the macros from the keyboard and toolbars. */
const RUNNER_TYPE = /^application\/vnd\.ms-word\.(?:keyMapCustomizations\+xml|attachedToolbars)$/i;
const RUNNER_REL = /\/relationships\/(?:keyMapCustomizations|attachedToolbars)$/i;
const RIBBON_REL = /\/relationships\/ui\/extensibility$/i;
/** A ribbon attribute that names a procedure to call: `onAction`, `onLoad`, `getLabel`, `loadImage`... */
const RIBBON_CALLBACK = /\s(?:on[A-Z]\w*|get[A-Z]\w*|loadImage)\s*=/;

/** What `stripMacros` gives: the package without the removed parts, the edited parts, and the paths removed. */
export interface Stripped {
  pkg: Package;
  changed: Map<string, Uint8Array>;
  removed: string[];
}

/** A relationship as it is written in a `.rels`: its type, the part it points to (lower case), and its text. */
interface Rel { type: string; target: string | undefined; text: string }

const ELEMENT = (name: string): RegExp => new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*?(?:/>|>[\\s\\S]*?</(?:[\\w.-]+:)?${name}\\s*>)`, 'g');

/** An attribute's value in an element's text (either quote), or `undefined`. */
function attr(element: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(element);
  return m ? (m[1] ?? m[2])! : undefined;
}

/** `a/b/../c` as `a/c`, without a leading `/`. */
function normalise(path: string): string {
  const out: string[] = [];
  for (const step of path.split('/')) {
    if (step === '..') out.pop();
    else if (step !== '.' && step !== '') out.push(step);
  }
  return out.join('/');
}

function decoded(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

/** The part a `.rels` belongs to (`''` for the package's own `_rels/.rels`), or `undefined` for a path that is no `.rels`. */
function ownerOf(rels: string): string | undefined {
  const m = /^(.*?)_rels\/([^/]*)\.rels$/i.exec(rels);
  return m ? m[1]! + m[2]! : undefined;
}

/** The `.rels` of a part. */
function relsOf(part: string): string {
  const slash = part.lastIndexOf('/');
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

/** The relationships of a `.rels` whose owner is `owner`, with their targets resolved (lower case). */
function relationships(text: string, owner: string): Rel[] {
  const base = owner.includes('/') ? owner.slice(0, owner.lastIndexOf('/') + 1) : '';
  return Array.from(text.matchAll(ELEMENT('Relationship')), ([element]) => {
    const target = attr(element, 'Target');
    const external = (attr(element, 'TargetMode') ?? '').toLowerCase() === 'external';
    const path = target === undefined || external ? undefined : decoded(target).split('#')[0]!;
    return {
      type: attr(element, 'Type') ?? '',
      target: path === undefined ? undefined : normalise(path.startsWith('/') ? path : base + path).toLowerCase(),
      text: element,
    };
  });
}

/** A part's bytes with `text` in place of its text, keeping a leading byte order mark (which `utf8` drops). */
function reencoded(original: Uint8Array, text: string): Uint8Array {
  const bom = original[0] === 0xef && original[1] === 0xbb && original[2] === 0xbf;
  return bytesOf(bom ? `\uFEFF${text}` : text);
}

const extensionOf = (part: string): string => {
  const name = part.slice(part.lastIndexOf('/') + 1);
  return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
};

/**
 * The package without its macros (see the top of this file), or `undefined` when there is nothing to take out and no
 * content type to change: the file is then stored as it came. `removed` is empty when only the main part's content
 * type changed (a macro-enabled file with no project). `pkg` is not changed.
 */
export function stripMacros(pkg: Package): Stripped | undefined {
  const typesText = pkg.entries.has(CONTENT_TYPES) ? utf8(pkg.entries.get(CONTENT_TYPES)!) : undefined;
  const byLower = new Map(pkg.order.map((name) => [name.toLowerCase(), name]));
  const overrides = new Map<string, string>();
  for (const [element] of (typesText ?? '').matchAll(ELEMENT('Override'))) {
    overrides.set(normalise(attr(element, 'PartName') ?? '').toLowerCase(), attr(element, 'ContentType') ?? '');
  }
  const rels = new Map<string, Rel[]>();
  for (const name of pkg.order) {
    const owner = ownerOf(name);
    if (owner !== undefined) rels.set(name, relationships(utf8(pkg.entries.get(name)!), owner));
  }
  const all = [...rels.values()].flat();

  const removed = new Set<string>();
  const remove = (lower: string | undefined): void => {
    const name = lower === undefined ? undefined : byLower.get(lower);
    if (name !== undefined) removed.add(name);
  };
  for (const name of pkg.order) if (VBA_NAME.test(name) || VBA_TYPE.test(overrides.get(name.toLowerCase()) ?? '')) removed.add(name);
  for (const rel of all) if (VBA_REL.test(rel.type)) remove(rel.target);

  if (removed.size > 0) {
    for (const name of pkg.order) if (RUNNER_TYPE.test(overrides.get(name.toLowerCase()) ?? '')) removed.add(name);
    for (const rel of all) {
      if (RUNNER_REL.test(rel.type)) remove(rel.target);
      if (RIBBON_REL.test(rel.type) && rel.target !== undefined) {
        const ribbon = byLower.get(rel.target);
        if (ribbon !== undefined && RIBBON_CALLBACK.test(utf8(pkg.entries.get(ribbon)!))) removed.add(ribbon);
      }
    }
    // A removed part takes its own `.rels` with it, and what only that `.rels` points to.
    for (let grew = true; grew;) {
      grew = false;
      for (const part of [...removed]) {
        const own = byLower.get(relsOf(part).toLowerCase());
        if (own !== undefined && !removed.has(own)) {
          removed.add(own);
          grew = true;
        }
      }
      const kept = new Set<string>();
      for (const [name, list] of rels) if (!removed.has(name)) for (const rel of list) if (rel.target !== undefined) kept.add(rel.target);
      for (const [name, list] of rels) {
        if (!removed.has(name)) continue;
        for (const rel of list) {
          const target = rel.target === undefined ? undefined : byLower.get(rel.target);
          if (target !== undefined && !removed.has(target) && !kept.has(rel.target!)) {
            removed.add(target);
            grew = true;
          }
        }
      }
    }
  }

  const gone = new Set([...removed].map((name) => name.toLowerCase()));
  const changed = new Map<string, Uint8Array>();
  for (const [name, list] of rels) {
    if (removed.has(name)) continue;
    let text = utf8(pkg.entries.get(name)!);
    const before = text;
    for (const rel of list) {
      if (VBA_REL.test(rel.type) || (rel.target !== undefined && gone.has(rel.target))) text = text.replace(rel.text, '');
    }
    if (text !== before) changed.set(name, reencoded(pkg.entries.get(name)!, text));
  }

  if (typesText !== undefined) {
    let types = typesText;
    for (const [element] of typesText.matchAll(ELEMENT('Override'))) {
      if (gone.has(normalise(attr(element, 'PartName') ?? '').toLowerCase())) types = types.replace(element, '');
    }
    const kept = pkg.order.filter((name) => !removed.has(name) && !overrides.has(name.toLowerCase()));
    for (const [element] of typesText.matchAll(ELEMENT('Default'))) {
      const type = attr(element, 'ContentType') ?? '';
      const extension = (attr(element, 'Extension') ?? '').toLowerCase();
      if ((VBA_TYPE.test(type) || RUNNER_TYPE.test(type)) && !kept.some((name) => extensionOf(name) === extension)) types = types.replace(element, '');
    }
    for (const [macro, plain] of PLAIN_MAIN) types = types.replace(macro, plain);
    if (types !== typesText) changed.set(CONTENT_TYPES, reencoded(pkg.entries.get(CONTENT_TYPES)!, types));
  }

  if (removed.size === 0 && changed.size === 0) return undefined;
  const order = pkg.order.filter((name) => !removed.has(name));
  return {
    pkg: { entries: new Map(order.map((name) => [name, pkg.entries.get(name)!])), order },
    changed,
    removed: [...removed],
  };
}
