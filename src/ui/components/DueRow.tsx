import type { DueRowView } from '../dueView';

/**
 * One row of a Due list, as a list item: the whole row is the link to the record. The chip says the days in words, and its
 * tone is its shape too (overdue filled, due soon outlined), so the status never rests on colour alone.
 */
export function DueRow({ row }: { row: DueRowView }) {
  return (
    <li>
      <a class="list-row" data-tone={row.tone} href={row.href}>
        <span class="list-row-text">
          <span class="list-row-title">{row.title}</span>
          <span class="list-row-meta">{row.meta}</span>
        </span>
        <span class="status" data-tone={row.tone}>{row.chip}</span>
      </a>
    </li>
  );
}
