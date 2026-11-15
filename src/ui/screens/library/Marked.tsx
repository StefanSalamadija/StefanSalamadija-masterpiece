import { matchRanges } from '../../../library/highlight';

/** `text` with every occurrence of the words (ignoring case and diacritics) in `<mark>`. Built as elements, never as HTML. */
export function Marked({ text, words }: { text: string; words: string[] }) {
  const ranges = matchRanges(text, words);
  if (ranges.length === 0) return <>{text}</>;
  const out: preact.ComponentChildren[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) out.push(text.slice(at, start));
    out.push(<mark key={start}>{text.slice(start, end)}</mark>);
    at = end;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}
