import { useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { addClockChange, cancelScheduledChange, setClockOffset, stepClock } from '../../db/clockChanges';
import { formatOffset, stepOffset, toShipLocal } from '../../domain/shipTime';
import type { FieldError } from '../../domain/types';
import { Field } from '../components/Field';
import { OffsetSelect } from '../components/OffsetSelect';
import { historyRows, readingHint, scheduleTarget } from '../shipTimeView';

const HOUR = 60;

/**
 * Buttons here that are busy or at the end of their range are `aria-disabled`, not `disabled`: a button that becomes
 * `disabled` while it has the focus loses it, and the keyboard user is thrown back to the top of the page. The click
 * handlers do nothing in those states.
 */
function ShipTimeScreen({ shipId }: { shipId: string }) {
  const { db, offsetMinutes, nowUtc, clockChanges } = useAppState();
  // An offset chosen in a select; until one is, the select shows the offset the ship is on.
  const [setTo, setSetTo] = useState<number>();
  const [when, setWhen] = useState('');
  const [whenError, setWhenError] = useState<FieldError>();
  const [scheduleTo, setScheduleTo] = useState<number>();
  const [busy, setBusy] = useState(false);
  // Set at once, where `busy` is only seen by the next render: a second tap in between must not get through.
  const working = useRef(false);
  const whenInput = useRef<HTMLInputElement>(null);
  const setOffsetSelect = useRef<HTMLSelectElement>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);

  /** Runs one write at a time. A failure is shown in the error toast and leaves everything as it was. */
  async function guarded(action: () => Promise<unknown>): Promise<void> {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      await action();
    } catch (err) {
      reportError(err);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  // The 1 h buttons are off at the ends of the range, where the clock cannot be moved any further that way.
  const canStep = (delta: number): boolean => stepOffset(offsetMinutes, delta) !== offsetMinutes;
  const step = (delta: number): void => {
    if (canStep(delta)) void guarded(() => stepClock(db, shipId, delta));
  };

  const chosenSet = setTo ?? offsetMinutes;
  const chosenSchedule = scheduleTo ?? offsetMinutes;

  function apply(): void {
    if (chosenSet === offsetMinutes) return;
    void guarded(async () => {
      await setClockOffset(db, shipId, chosenSet);
      setSetTo(undefined);
      // Apply has nothing left to do now (the clock is on the offset), so the focus goes to the select it applied.
      setOffsetSelect.current?.focus();
    });
  }

  function schedule(event: Event): void {
    event.preventDefault();
    if (working.current) return;
    // The time is the ship's time when it comes, read on the timeline of the changes already scheduled.
    const target = scheduleTarget(when, clockChanges, new Date());
    if ('problem' in target) {
      setWhenError(target.problem);
      whenInput.current?.focus();
      return;
    }
    void guarded(async () => {
      await addClockChange(db, shipId, chosenSchedule, target.instant);
      setWhen('');
      setScheduleTo(undefined);
    });
  }

  const rows = historyRows(clockChanges, nowUtc);
  return (
    <>
      <p class="time-now">
        Ship's time {toShipLocal(nowUtc, offsetMinutes).time} ({formatOffset(offsetMinutes)})
      </p>
      <div class="time-section">
        <div class="time-actions">
          <button
            type="button" class="btn btn-primary" aria-disabled={busy || !canStep(HOUR) ? 'true' : undefined}
            onClick={() => step(HOUR)}
          >
            Advance 1 h
          </button>
          <button
            type="button" class="btn btn-primary" aria-disabled={busy || !canStep(-HOUR) ? 'true' : undefined}
            onClick={() => step(-HOUR)}
          >
            Retard 1 h
          </button>
        </div>
        <div class="inline-form">
          <OffsetSelect label="Set offset" value={chosenSet} onChange={setSetTo} selectRef={setOffsetSelect} />
          <button
            type="button" class="btn btn-outline" disabled={chosenSet === offsetMinutes} aria-disabled={busy ? 'true' : undefined}
            onClick={apply}
          >
            Apply
          </button>
        </div>
      </div>
      <form class="time-section" onSubmit={schedule} noValidate>
        <h3>Schedule clock change</h3>
        <Field
          label="Change at (ship's time)" type="datetime-local" value={when} error={whenError} inputRef={whenInput}
          hint={readingHint(when, clockChanges, nowUtc)}
          onInput={(value) => {
            setWhen(value);
            setWhenError(undefined);
          }}
        />
        <OffsetSelect label="New offset" value={chosenSchedule} onChange={setScheduleTo} />
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" aria-disabled={busy ? 'true' : undefined}>Schedule</button>
        </div>
      </form>
      <div class="time-section">
        <h3 ref={historyHeading} tabIndex={-1}>History</h3>
        {rows.length === 0 && <p class="empty">No clock changes yet.</p>}
        {rows.length > 0 && (
          <ul class="history-list" role="list" aria-label="History">
            {rows.map((row) => (
              <li key={row.id} class="card history-row">
                <span class="history-text">{row.text}</span>
                {row.scheduled && <span class="badge">Scheduled</span>}
                {row.scheduled && (
                  <button
                    type="button" class="btn btn-outline btn-small" aria-label={`Cancel change at ${row.when}`}
                    aria-disabled={busy ? 'true' : undefined}
                    // The button goes with its row, so the focus moves to the heading, where it is not lost.
                    onClick={() => void guarded(async () => {
                      await cancelScheduledChange(db, row.id);
                      historyHeading.current?.focus();
                    })}
                  >
                    Cancel
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/** The active ship's clock: its time now, moving it an hour or to any offset, scheduling a change, and the history of changes. */
export function ShipTime() {
  const { activeShip } = useAppState();
  if (!activeShip) return null;
  return (
    <section class="screen">
      <h2>Ship's time</h2>
      {/* Keyed by ship, so that switching ships does not carry what was typed across. */}
      <ShipTimeScreen key={activeShip.id} shipId={activeShip.id} />
    </section>
  );
}
