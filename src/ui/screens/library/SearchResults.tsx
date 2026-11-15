import type { LibraryDoc } from '../../../domain/types';
import { docHref } from '../../../library/highlight';
import { highlightRanges, queryWords } from '../../../library/search';
import type { SearchHit } from '../../../library/search';
import { statusLabel } from '../../libraryView';

/** A snippet (already normalised text) with the query words in `<mark>`. */
function Snippet({ text, words }: { text: string; words: string[] }) {
  const out: preact.ComponentChildren[] = [];
  let at = 0;
  for (const [start, end] of highlightRanges(text, words)) {
    if (start > at) out.push(text.slice(at, start));
    out.push(<mark key={start}>{text.slice(start, end)}</mark>);
    at = end;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

interface Props { hits: SearchHit[]; docs: Map<string, LibraryDoc>; withFile: Set<string>; query: string }

/** The matches of a library search: the title (opens page 1), each matching page or sheet with its snippet, and how many more. */
export function SearchResults({ hits, docs, withFile, query }: Props) {
  const words = queryWords(query);
  if (hits.length === 0) return <p class="empty">No documents match.</p>;
  return (
    <ul class="lib-list" role="list" aria-label="Search results">
      {hits.map((hit) => {
        const doc = docs.get(hit.docId);
        if (!doc) return null;
        const flag = statusLabel(doc, withFile.has(doc.id));
        return (
          <li key={doc.id} class="card lib-row">
            <a class="lib-link" href={docHref(doc.id, 1, query)}>{doc.title}</a>
            {hit.byMeta && <span class="lib-meta">Matches the title, tags or folder</span>}
            {flag && <span class="lib-flag">{flag}</span>}
            {hit.parts.map((p) => (
              <a key={p.part} class="lib-part" href={docHref(doc.id, p.part, query)}>
                <strong>{p.label}</strong> — <Snippet text={p.snippet} words={words} />
              </a>
            ))}
            {hit.moreParts > 0 && <span class="lib-meta">+{hit.moreParts} more {hit.parts[0]?.label.startsWith('Sheet') ? 'sheets' : 'pages'}</span>}
          </li>
        );
      })}
    </ul>
  );
}
