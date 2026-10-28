import type { Ref } from 'preact';
import { useId } from 'preact/hooks';
import { formatOffset, OFFSET_OPTIONS } from '../../domain/shipTime';

export interface OffsetSelectProps {
  value: number;
  onChange: (minutes: number) => void;
  /** What the select is called; by default the ship's time, which is what most of the app picks an offset for. */
  label?: string;
  /** For moving focus to the select, such as after the button that acts on it has been used. */
  selectRef?: Ref<HTMLSelectElement>;
}

/** A UTC offset picker: every offset a ship's clock can be set to, in minutes from UTC. */
export function OffsetSelect({ value, onChange, label = "Ship's time (UTC offset)", selectRef }: OffsetSelectProps) {
  const id = useId();
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <select id={id} ref={selectRef} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))}>
        {OFFSET_OPTIONS.map((minutes) => (
          <option key={minutes} value={minutes}>{formatOffset(minutes)}</option>
        ))}
      </select>
    </div>
  );
}
