import type { RefObject } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { reportError } from '../../app/errors';
import { listForShip } from '../../db/records';
import { saveCurrentVoyage, startNewVoyage } from '../../db/voyages';
import type { FieldError, Voyage as VoyageRecord } from '../../domain/types';
import { currentVoyage, previousVoyages, voyageSummary } from '../../domain/voyage';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { OffsetSelect } from '../components/OffsetSelect';
import { blankVoyageForm, VOYAGE_CONTROLS, voyageFieldsOf, voyageFormOf, voyageProblems } from '../voyageForm';
import type { VoyageControl } from '../voyageForm';
import { useDialogAction } from '../useDialogAction';
import { useLive } from '../useLive';

const SAVED = 'Saved';
const STARTED = 'New voyage started.';

function StartVoyageDialog({ shipId, etaOffsetMinutes, onClose, onStarted, focusFallback }: {
  shipId: string;
  /** The new voyage's ETA offset: the ship's offset now. */
  etaOffsetMinutes: number;
  onClose: () => void;
  onStarted: () => void;
  focusFallback: RefObject<HTMLElement | null>;
}) {
  const { db } = useAppState();
  const { busy, failure, run } = useDialogAction();
  return (
    <ConfirmDialog
      title="Start new voyage?" confirmLabel="Start new voyage" busy={busy} error={failure} focusFallback={focusFallback}
      // A failure stays in the dialog and the voyage stays as it was. On success the dialog is closed here.
      onConfirm={() => void run(async () => {
        await startNewVoyage(db, shipId, etaOffsetMinutes);
        onStarted();
      })}
      onCancel={onClose}
      body={<p>This ends the current voyage, which moves to Previous voyages, and starts a blank one.</p>}
    />
  );
}

/**
 * The form for the ship's current voyage (`voyage` absent while it has none). What is typed is a draft that is made
 * once, so a change to the record elsewhere does not overwrite it. A problem shows once its field has been changed, and
 * all of them after a Save that found any; Save itself is always on, and moves the focus to the first field with a
 * problem. With no voyage yet, Save begins one.
 */
function VoyageForm({ shipId, voyage, offsetMinutes, status, setStatus, onStartNew, startButton }: {
  shipId: string;
  voyage?: VoyageRecord;
  /** The ship's offset now: where the ETA offset starts for a voyage that has none of its own. */
  offsetMinutes: number;
  status: string;
  setStatus: (text: string) => void;
  onStartNew: () => void;
  startButton: RefObject<HTMLButtonElement | null>;
}) {
  const { db } = useAppState();
  const [form, setForm] = useState(() => (voyage ? voyageFormOf(voyage, offsetMinutes) : blankVoyageForm(offsetMinutes)));
  const [changed, setChanged] = useState<ReadonlySet<VoyageControl>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const controls = useRef<Partial<Record<VoyageControl, HTMLElement | null>>>({});

  const problems = new Map<string, FieldError>(voyageProblems(form).map((problem) => [problem.field, problem]));
  const shown = (control: VoyageControl): FieldError | undefined => {
    const found = problems.get(control);
    return found && (attempted || changed.has(control)) ? found : undefined;
  };
  const refFor = (control: VoyageControl) => (element: HTMLElement | null): void => {
    controls.current[control] = element;
  };
  const change = <C extends VoyageControl>(control: C, value: (typeof form)[C]): void => {
    setForm((current) => ({ ...current, [control]: value }));
    setChanged((current) => new Set(current).add(control));
    setStatus('');
  };
  const textField = (control: Exclude<VoyageControl, 'etaOffsetMinutes'>, label: string, extra: { multiline?: boolean; type?: 'datetime-local' } = {}) => (
    <Field
      label={label} value={form[control]} error={shown(control)} inputRef={refFor(control)} {...extra}
      onInput={(value) => change(control, value)}
    />
  );

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const firstWrong = VOYAGE_CONTROLS.find((control) => problems.get(control)?.severity === 'error');
    if (firstWrong) {
      setAttempted(true);
      controls.current[firstWrong]?.focus();
      return;
    }
    setBusy(true);
    try {
      await saveCurrentVoyage(db, shipId, voyageFieldsOf(form));
      setStatus(SAVED);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="voyage-form" onSubmit={save} noValidate>
      <div class="form-grid">
        {textField('voyageNo', 'Voyage no.')}
        {textField('lastPort', 'Last port')}
        {textField('nextPort', 'Next port')}
        {textField('etaLocal', 'ETA (local)', { type: 'datetime-local' })}
        <OffsetSelect label="ETA UTC offset" value={form.etaOffsetMinutes} onChange={(minutes) => change('etaOffsetMinutes', minutes)} />
        {textField('cargo', 'Cargo')}
        {textField('charterers', 'Charterers')}
        {textField('agents', 'Agents at next port', { multiline: true })}
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" disabled={busy}>Save</button>
        {voyage && (
          <button ref={startButton} type="button" class="btn btn-outline" disabled={busy} onClick={onStartNew}>Start new voyage</button>
        )}
        <p class="save-status" role="status">{status}</p>
      </div>
    </form>
  );
}

function VoyageScreen({ shipId }: { shipId: string }) {
  const { db, offsetMinutes } = useAppState();
  const voyages = useLive(() => listForShip<VoyageRecord>(db, 'voyages', shipId), [db, shipId]);
  const [status, setStatus] = useState('');
  const [starting, setStarting] = useState(false);
  const startButton = useRef<HTMLButtonElement>(null);
  if (!voyages) return null;

  const current = currentVoyage(voyages);
  const previous = previousVoyages(voyages);
  return (
    <>
      {/*
        The form is made again when a voyage is started (the number of earlier voyages grows), so that it starts blank, but not
        when the first voyage is saved: the person keeps their place.
      */}
      <VoyageForm
        key={previous.length} shipId={shipId} voyage={current} offsetMinutes={offsetMinutes} status={status}
        setStatus={setStatus} onStartNew={() => setStarting(true)} startButton={startButton}
      />
      <div class="form-section">
        <h3>Previous voyages</h3>
        {previous.length === 0 && <p class="empty">No previous voyages yet.</p>}
        {previous.length > 0 && (
          <ul class="voyage-list" role="list" aria-label="Previous voyages">
            {previous.map((voyage) => <li key={voyage.id} class="card">{voyageSummary(voyage)}</li>)}
          </ul>
        )}
      </div>
      {starting && (
        <StartVoyageDialog
          shipId={shipId} etaOffsetMinutes={offsetMinutes} focusFallback={startButton} onClose={() => setStarting(false)}
          onStarted={() => {
            setStarting(false);
            setStatus(STARTED);
          }}
        />
      )}
    </>
  );
}

/** The active ship's current voyage and the earlier ones. Start new voyage ends the current one and begins a blank one. */
export function Voyage() {
  const { activeShip } = useAppState();
  if (!activeShip) return null;
  return (
    <section class="screen">
      <h2>Voyage</h2>
      {/* Keyed by ship, so that switching ships does not carry a draft or a dialog across. */}
      <VoyageScreen key={activeShip.id} shipId={activeShip.id} />
    </section>
  );
}
