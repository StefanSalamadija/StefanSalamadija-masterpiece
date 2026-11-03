import { useState } from 'preact/hooks';
import { rankLabel } from '../../domain/catalogues';
import { formatDisplayDate } from '../../domain/dates';
import { fullName } from '../../domain/crew';
import type { CrewMember } from '../../domain/types';
import { ConfirmDialog } from './ConfirmDialog';

/*
 * `Add from crew` (spec §7): a dialog that lists the crew onboard at the draft's date, as checkboxes, and gives back the
 * people ticked, in the crew list's order (rank first). Names and ranks are the ship's own data, shown as text.
 */

export interface CrewPickerProps {
  /** The crew onboard at `date`, in the order to list them. */
  people: CrewMember[];
  /** The date they are onboard at (`YYYY-MM-DD`). */
  date: string;
  onAdd: (chosen: CrewMember[]) => void;
  onCancel: () => void;
}

export function CrewPicker({ people, date, onAdd, onCancel }: CrewPickerProps) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string): void => setTicked((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  return (
    <ConfirmDialog
      title="Add from crew" confirmLabel="Add" confirmDisabled={ticked.size === 0}
      onCancel={onCancel} onConfirm={() => onAdd(people.filter((p) => ticked.has(p.id)))}
      body={people.length === 0
        ? <p>No crew onboard on {formatDisplayDate(date)}.</p>
        : (
          <>
            <p>Crew onboard on {formatDisplayDate(date)}. Tick the people to add.</p>
            <ul class="crew-pick" role="list">
              {people.map((p) => (
                <li key={p.id}>
                  <label class="check">
                    <input type="checkbox" checked={ticked.has(p.id)} onChange={() => toggle(p.id)} />
                    <span>{fullName(p)} — {rankLabel(p)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
    />
  );
}
