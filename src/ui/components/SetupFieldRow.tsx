import { useId } from 'preact/hooks';
// Types only: the forms engine is loaded on demand (see `src/forms/load.ts`).
import type { FieldDef } from '../../forms/types';
import { LINK_GROUPS, linkFromValue, linkName, linkOptions } from '../formLinks';
import { canLink } from '../formsView';
import { Field } from './Field';

/** Made once: the same for every row. */
const OPTIONS = linkOptions();
const OFFERED: ReadonlySet<string> = new Set(OPTIONS.map((o) => o.value));

export interface SetupFieldRowProps {
  /** The field (or a table's column). Its label is read from the form: it is shown as text only. */
  field: FieldDef;
  /** The select value: `you`, `empty` or a link (`link:…`). */
  choice: string;
  onChoose: (choice: string) => void;
  /** The name being typed for an unsure field; the `Name this field` input is shown only when this is given. */
  name?: string;
  nameError?: string;
  onName: (name: string) => void;
  /** The name input lost the focus: its message may show from now on. */
  onNameDone: () => void;
}

/**
 * One field of the setup review: its name, and a select of what fills it in (a link to the ship's data, `You fill` or
 * `Leave empty`). An unsure field also has `Name this field`. The select carries the field's id (`data-field`), so that
 * the screen can give it the focus after the field moved to another section.
 */
export function SetupFieldRow({ field, choice, onChoose, name, nameError, onName, onNameDone }: SetupFieldRowProps) {
  const id = useId();
  const shownName = name?.trim() || field.label;
  const current = linkFromValue(choice);
  // A link this app does not offer (made on another device, say) stays selectable, so that it is kept.
  const unknown = current !== undefined && (!OFFERED.has(choice) || !canLink(field));
  return (
    <li class="field setup-row">
      <label for={id} class="setup-row-name">{shownName}</label>
      <select id={id} data-field={field.id} value={choice} onChange={(event) => onChoose(event.currentTarget.value)}>
        <option value="you">You fill</option>
        <option value="empty">Leave empty</option>
        {unknown && <option value={choice}>{linkName(current)}</option>}
        {canLink(field) && LINK_GROUPS.map((group) => (
          <optgroup key={group} label={group}>
            {OPTIONS.filter((o) => o.group === group).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </optgroup>
        ))}
      </select>
      {name !== undefined && (
        <div onFocusOut={onNameDone}>
          <Field
            label="Name this field" value={name} onInput={onName}
            hint="The form gives this field no name of its own."
            error={nameError === undefined ? undefined : { field: field.id, severity: 'error', message: nameError }}
          />
        </div>
      )}
    </li>
  );
}
