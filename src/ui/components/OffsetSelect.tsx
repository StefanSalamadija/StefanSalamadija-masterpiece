import { useId } from 'preact/hooks';
import { formatOffset, OFFSET_OPTIONS } from '../../domain/shipTime';

/** The ship's-time picker: every UTC offset a ship's clock can be set to, in minutes from UTC. */
export function OffsetSelect({ value, onChange }: { value: number; onChange: (minutes: number) => void }) {
  const id = useId();
  return (
    <div class="field">
      <label for={id}>Ship's time (UTC offset)</label>
      <select id={id} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))}>
        {OFFSET_OPTIONS.map((minutes) => (
          <option key={minutes} value={minutes}>{formatOffset(minutes)}</option>
        ))}
      </select>
    </div>
  );
}
