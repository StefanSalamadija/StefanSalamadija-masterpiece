import { partText } from '../package';
import type { Package } from '../package';
import { parseXml } from '../xml';

/*
 * Relationships of a Word part (`word/_rels/document.xml.rels` for `word/document.xml`): the lookup the reader uses to
 * say which media part a picture shows, and the paths the writer adds a picture's relationship and media part at.
 */

/** The directory of a part path (`word` for `word/document.xml`, `''` for a part at the root). */
export function dirOf(part: string): string {
  const slash = part.lastIndexOf('/');
  return slash < 0 ? '' : part.slice(0, slash);
}

/** Where the relationships of a part are: `word/document.xml` has them in `word/_rels/document.xml.rels`. */
export function relsPathOf(part: string): string {
  const slash = part.lastIndexOf('/');
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

/** The part path a relationship target means, from the part that owns the relationships (`/x` is from the root; `.` and `..` are resolved). */
export function resolveTarget(part: string, target: string): string {
  const segments = target.startsWith('/') ? [] : dirOf(part).split('/').filter((s) => s !== '');
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return segments.join('/');
}

/** The internal relationships of a part: id to the part path it points at. Empty when the part has none. */
export function readRels(pkg: Package, part: string): Map<string, string> {
  const out = new Map<string, string>();
  const text = partText(pkg, relsPathOf(part));
  if (text === undefined) return out;
  for (const rel of Array.from(parseXml(text).getElementsByTagName('Relationship'))) {
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (id && target && rel.getAttribute('TargetMode') !== 'External') out.set(id, resolveTarget(part, target));
  }
  return out;
}
