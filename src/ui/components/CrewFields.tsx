import { useId } from 'preact/hooks';
import { RANKS } from '../../domain/catalogues';
import type { FieldError } from '../../domain/types';
import type { CrewControl, CrewForm } from '../crewForm';
import { Field } from './Field';

type TextControl = Exclude<CrewControl, 'rank'>;

function RankSelect({ value, error, selectRef, onChange }: {
  value: CrewForm['rank'];
  error?: FieldError;
  selectRef: (element: HTMLSelectElement | null) => void;
  onChange: (rank: CrewForm['rank']) => void;
}) {
  const id = useId();
  const messageId = `${id}-message`;
  return (
    <div class="field">
      <label for={id}>Rank</label>
      <select
        id={id} ref={selectRef} value={value} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? messageId : undefined}
        onChange={(event) => onChange(event.currentTarget.value as CrewForm['rank'])}
      >
        <option value="">Select a rank</option>
        {RANKS.map((rank) => <option key={rank.key} value={rank.key}>{rank.label}</option>)}
      </select>
      {error && <p id={messageId} class="field-error" role="alert">{error.message}</p>}
    </div>
  );
}

export interface CrewFieldsProps {
  form: CrewForm;
  /** The problem to show at a control, if any. */
  shown: (control: CrewControl) => FieldError | undefined;
  /** A ref callback for a control, for moving the focus to it. */
  refFor: (control: CrewControl) => (element: HTMLElement | null) => void;
  onChange: (control: CrewControl, value: string) => void;
  /** Also the contract length and the planned relief: the crew form has them, the import's fix form does not (a sheet cannot carry them). */
  withContract?: boolean;
}

/** The fields of a crew contract, as the crew form and the import's fix form have them. The caller keeps the state. */
export function CrewFields({ form, shown, refFor, onChange, withContract }: CrewFieldsProps) {
  const textField = (control: TextControl, label: string, type?: 'date', inputMode?: 'numeric') => (
    <Field
      label={label} type={type} inputMode={inputMode} value={form[control]} error={shown(control)} inputRef={refFor(control)}
      onInput={(value) => onChange(control, value)}
    />
  );
  return (
    <div class="form-grid">
      {textField('surname', 'Surname')}
      {textField('givenNames', 'Given names')}
      <RankSelect
        value={form.rank} error={shown('rank')} selectRef={refFor('rank')}
        onChange={(rank) => onChange('rank', rank)}
      />
      {form.rank === 'other' && textField('rankOther', 'Rank (other)')}
      {textField('nationality', 'Nationality')}
      {textField('dateOfBirth', 'Date of birth', 'date')}
      {textField('placeOfBirth', 'Place of birth')}
      {textField('passportNo', 'Passport no.')}
      {textField('passportExpiry', 'Passport expiry', 'date')}
      {textField('seamansBookNo', "Seaman's book no.")}
      {textField('seamansBookExpiry', "Seaman's book expiry", 'date')}
      {textField('signOnDate', 'Sign-on date', 'date')}
      {textField('signOnPort', 'Sign-on port')}
      {withContract && (
        <>
          {textField('contractMonths', 'Contract length (months)', undefined, 'numeric')}
          {textField('reliefPlannedDate', 'Planned relief date', 'date')}
          {textField('reliefPlannedPort', 'Planned relief port')}
        </>
      )}
    </div>
  );
}
