import type { FormIdentity } from './types';

/**
 * A label of a form's header: `Form:`, `Revision:`, `Page:` or `Approved:` (or `Approved by:`), in any case. It is a
 * whole word followed by a colon, so `Platform:` is not one. Not global: it is used as the pattern of `matchAll`.
 */
const LABEL = /\b(form|revision|page|approved(?:\s+by)?)\s*:/gi;
/** A line that is only a label, as a header table gives it when the colon is left out: `Approved`. */
const LABEL_ONLY = /^(form|revision|page|approved(?:\s+by)?)$/i;

type LabelName = 'form' | 'revision' | 'page' | 'approved';

interface Found {
  /** What comes before the first label in the line. */
  lead: string;
  /** Each label in the line and the text after it, up to the next label. */
  labels: { name: LabelName; value: string }[];
}

function nameOf(label: string): LabelName {
  return label.toLowerCase().split(/\s+/)[0] as LabelName;
}

function labelsIn(line: string): Found {
  const marks = [...line.matchAll(LABEL)];
  if (marks.length === 0) {
    const only = LABEL_ONLY.exec(line);
    return only ? { lead: '', labels: [{ name: nameOf(only[1]), value: '' }] } : { lead: line, labels: [] };
  }
  return {
    lead: line.slice(0, marks[0].index).trim(),
    labels: marks.map((mark, i) => ({
      name: nameOf(mark[1]),
      value: line.slice(mark.index + mark[0].length, marks[i + 1]?.index ?? line.length).trim(),
    })),
  };
}

/** The file name without its last extension. A name that is only an extension (`.docx`) is kept whole. */
function withoutExtension(fileName: string): string {
  const stem = fileName.replace(/\.[^./\\]*$/, '').trim();
  return stem === '' ? fileName : stem;
}

/**
 * The identity of a form, from the lines of text of its header (the paragraphs and cells, in order) and the name of its
 * file.
 * - `code` is the first word after `Form:`, on the same line or the next. It is `''` when the header has none.
 * - `revision` is the text after `Revision:`, up to the next label (`00 / 01.01.2026`). Same line or the next.
 * - `title` is the longest line that is not a label or the value of one (`Approved`, `Page`, `Form`, `Revision`); the first
 *   of lines equally long. With no code, or with no such line, it is the file name without its extension.
 *
 * Labels are matched in any case. When a header is repeated, the first value of a label is the one used.
 */
export function identityFromText(lines: readonly string[], fileName: string): FormIdentity {
  const values: { form?: string; revision?: string } = {};
  const candidates: string[] = [];
  // The label whose value is on the next line, when the label's own line has none.
  let waiting: LabelName | undefined;

  const take = (name: LabelName, value: string): void => {
    if (name === 'form' || name === 'revision') values[name] ??= value;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (line === '') continue;
    const { lead, labels } = labelsIn(line);
    if (waiting !== undefined && labels.length === 0) {
      take(waiting, line);
      waiting = undefined;
      continue;
    }
    waiting = undefined;
    if (lead !== '') candidates.push(lead);
    labels.forEach(({ name, value }, i) => {
      if (value !== '') take(name, value);
      else if (i === labels.length - 1) waiting = name;
    });
  }

  const code = values.form?.split(' ')[0] ?? '';
  const longest = candidates.reduce<string>((best, line) => (line.length > best.length ? line : best), '');
  return {
    code,
    title: code === '' || longest === '' ? withoutExtension(fileName) : longest,
    revision: values.revision ?? '',
  };
}
