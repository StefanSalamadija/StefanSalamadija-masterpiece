import { isValidLocalDateTime } from '../domain/dates';
import { isValidOffset } from '../domain/shipTime';
import type { FieldError, Voyage } from '../domain/types';
import type { VoyageFields } from '../domain/voyage';

/** What is typed in the voyage form: text as typed, and the ETA's UTC offset as chosen. */
export interface VoyageForm {
  voyageNo: string;
  lastPort: string;
  nextPort: string;
  /** `YYYY-MM-DDTHH:mm`, as a `datetime-local` input gives it; empty when there is no ETA. */
  etaLocal: string;
  /** Minutes from UTC, which the ETA is in (the port's time, not necessarily the ship's). */
  etaOffsetMinutes: number;
  cargo: string;
  charterers: string;
  agents: string;
}

export type VoyageControl = keyof VoyageForm;

/** The controls of the form, top to bottom: the first one with a problem gets the focus. */
export const VOYAGE_CONTROLS: readonly VoyageControl[] = [
  'voyageNo', 'lastPort', 'nextPort', 'etaLocal', 'etaOffsetMinutes', 'cargo', 'charterers', 'agents',
];

export const ETA_INVALID = 'ETA is not a valid date and time.';

/** A form with nothing typed. `etaOffsetMinutes` is where the offset select starts: the ship's offset now. */
export function blankVoyageForm(etaOffsetMinutes: number): VoyageForm {
  return { voyageNo: '', lastPort: '', nextPort: '', etaLocal: '', etaOffsetMinutes, cargo: '', charterers: '', agents: '' };
}

/** The form for a saved voyage. An ETA offset that a ship cannot have (a damaged record) is replaced by `fallbackOffset`. */
export function voyageFormOf(v: Voyage, fallbackOffset: number): VoyageForm {
  return {
    voyageNo: v.voyageNo, lastPort: v.lastPort, nextPort: v.nextPort, etaLocal: v.etaLocal,
    etaOffsetMinutes: isValidOffset(v.etaOffsetMinutes) ? v.etaOffsetMinutes : fallbackOffset,
    cargo: v.cargo, charterers: v.charterers, agents: v.agents,
  };
}

/** The fields the form stands for, with the text trimmed (line breaks inside a text stay). */
export function voyageFieldsOf(form: VoyageForm): VoyageFields {
  return {
    voyageNo: form.voyageNo.trim(), lastPort: form.lastPort.trim(), nextPort: form.nextPort.trim(), etaLocal: form.etaLocal,
    etaOffsetMinutes: form.etaOffsetMinutes, cargo: form.cargo.trim(), charterers: form.charterers.trim(), agents: form.agents.trim(),
  };
}

/** Everything wrong with the form. Nothing is required: only an ETA that was entered has to be a date and time. */
export function voyageProblems(form: VoyageForm): FieldError[] {
  if (form.etaLocal !== '' && !isValidLocalDateTime(form.etaLocal)) {
    return [{ field: 'etaLocal', severity: 'error', message: ETA_INVALID }];
  }
  return [];
}
