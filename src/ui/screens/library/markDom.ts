import { matchRanges } from '../../../library/highlight';

/** Takes the `<mark>`s this file made out of `root` again, leaving its text as it was. */
export function clearMarks(root: Element): void {
  for (const mark of Array.from(root.querySelectorAll('mark'))) mark.replaceWith(...Array.from(mark.childNodes));
  root.normalize();
}

/**
 * Wraps every occurrence of the words in `<mark>` inside the text nodes of `root` (the text layer pdf.js builds), by
 * splitting the text nodes. Matching ignores case and diacritics. Returns how many marks it made.
 */
export function markWords(root: Element, words: string[]): number {
  if (words.length === 0) return 0;
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  let count = 0;
  for (const node of nodes) {
    const ranges = matchRanges(node.data, words);
    if (ranges.length === 0) continue;
    const fragment = document.createDocumentFragment();
    let at = 0;
    for (const [start, end] of ranges) {
      if (start > at) fragment.append(node.data.slice(at, start));
      const mark = document.createElement('mark');
      mark.textContent = node.data.slice(start, end);
      fragment.append(mark);
      count += 1;
      at = end;
    }
    if (at < node.data.length) fragment.append(node.data.slice(at));
    node.replaceWith(fragment);
  }
  return count;
}
