import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
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

function StartVoyageDialog({ shipId, etaOffsetMinutes, unsaved, onClose, onStarted, focusFallback }: {
  shipId: string;
  /** The new voyage's ETA offset: the ship's offset now. */
  etaOffsetMinutes: number;
  /** The form has changes that were not saved: they are not part of the voyage that is ended. */
  unsaved: boolean;
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
      body={
        <>
          <p>This ends the current voyage, which moves to Previous voyages, and starts a blank one.</p>
          {unsaved && <p>Changes you have not saved will be lost.</p>}
        </>
      }
    />
  );
}

/**
 * The form for the ship's current voyage (`voyage` absent while it has none). What is typed is a draft that is made
 * once, so a change to the record elsewhere does not overwrite it. A problem shows once its field has been changed, and
 * all of them after a Save that found any; Save itself is always on, and moves the focus to the first field with a
 * problem. With no voyage yet, Save begins one. After a Save the form shows what was kept (the text trimmed).
 *
 * Save and Start new voyage are `aria-disabled` while a save runs, not `disabled`, which would take the focus from
 * the button that was pressed.
 */
function VoyageForm({ shipId, voyage, offsetMinutes, status, setStatus, setUnsaved, voyageNoRef, onStartNew, startButton }: {
  shipId: string;
  voyage?: VoyageRecord;
  /** The ship's offset now: where the ETA offset starts for a voyage that has none of its own. */
  offsetMinutes: number;
  status: string;
  setStatus: (text: string) => void;
  /** Tells whether the form holds changes that were not saved. */
  setUnsaved: (unsaved: boolean) => void;
  /** The voyage number's input, for the screen to move the focus to after a new voyage is started. */
  voyageNoRef: { current: HTMLElement | null };
  onStartNew: () => void;
  startButton: RefObject<HTMLButtonElement | null>;
}) {
  const { db } = useAppState();
  const [form, setForm] = useState(() => (voyage ? voyageFormOf(voyage, offsetMinutes) : blankVoyageForm(offsetMinutes)));
  const [changed, setChanged] = useState<ReadonlySet<VoyageControl>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  // Set at once, where `busy` is only seen by the next render: a second Enter in between must not save twice.
  const saving = useRef(false);
  const controls = useRef<Partial<Record<VoyageControl, HTMLElement | null>>>({});

  // A form that is made fresh (a new voyage, or the draft discarded) has nothing unsaved.
  useEffect(() => setUnsaved(false), []);

  const problems = new Map<string, FieldError>(voyageProblems(form).map((problem) => [problem.field, problem]));
  const shown = (control: VoyageControl): FieldError | undefined => {
    const found = problems.get(control);
    return found && (attempted || changed.has(control)) ? found : undefined;
  };
  const refFor = (control: VoyageControl) => (element: HTMLElement | null): void => {
    controls.current[control] = element;
    if (control === 'voyageNo') voyageNoRef.current = element;
  };
  const change = <C extends VoyageControl>(control: C, value: (typeof form)[C]): void => {
    setForm((current) => ({ ...current, [control]: value }));
    setChanged((current) => new Set(current).add(control));
    setStatus('');
    setUnsaved(true);
  };
  const textField = (control: Exclude<VoyageControl, 'etaOffsetMinutes'>, label: string, extra: { multiline?: boolean; type?: 'datetime-local' } = {}) => (
    <Field
      label={label} value={form[control]} error={shown(control)} inputRef={refFor(control)} {...extra}
      onInput={(value) => change(control, value)}
    />
  );

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    if (saving.current) return;
    const firstWrong = VOYAGE_CONTROLS.find((control) => problems.get(control)?.severity === 'error');
    if (firstWrong) {
      setAttempted(true);
      controls.current[firstWrong]?.focus();
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
      const saved = await saveCurrentVoyage(db, shipId, voyageFieldsOf(form));
      setForm(voyageFormOf(saved, offsetMinutes));
      setUnsaved(false);
      setStatus(SAVED);
    } catch (err) {
      reportError(err);
    } finally {
      saving.current = false;
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
        <button type="submit" class="btn btn-primary" aria-disabled={busy ? 'true' : undefined}>Save</button>
        {voyage && (
          <button
            ref={startButton} type="button" class="btn btn-outline" aria-disabled={busy ? 'true' : undefined}
            onClick={() => {
              if (!saving.current) onStartNew();
            }}
          >
            Start new voyage
          </button>
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
  const [unsaved, setUnsaved] = useState(false);
  const [starting, setStarting] = useState(false);
  // Once a new voyage is started: the voyage that was ended, until the blank form of the new one has been given the focus.
  const [startedFrom, setStartedFrom] = useState<string>();
  const startButton = useRef<HTMLButtonElement>(null);
  const voyageNoInput = useRef<HTMLElement | null>(null);

  const current = voyages && currentVoyage(voyages);
  // The button that started the voyage is gone with the old form, and the dialog closes before the new form is there,
  // so the focus is given to the first field of the new form once both have happened, in either order.
  useEffect(() => {
    if (startedFrom === undefined || starting || !current || current.id === startedFrom) return;
    voyageNoInput.current?.focus();
    setStartedFrom(undefined);
  });

  if (!voyages) return null;
  const previous = previousVoyages(voyages);
  return (
    <>
      {/*
        Made again when a voyage is started (the number of earlier voyages grows), so that it starts blank, but not
        when the first voyage is saved: the person keeps their place. An import or a sync that adds a past voyage
        changes the number too, and the draft is discarded then.
      */}
      <VoyageForm
        key={previous.length} shipId={shipId} voyage={current} offsetMinutes={offsetMinutes} status={status}
        setStatus={setStatus} setUnsaved={setUnsaved} voyageNoRef={voyageNoInput} onStartNew={() => setStarting(true)}
        startButton={startButton}
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
          shipId={shipId} etaOffsetMinutes={offsetMinutes} unsaved={unsaved} focusFallback={startButton}
          onClose={() => setStarting(false)}
          onStarted={() => {
            setStarting(false);
            setStartedFrom(current?.id);
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
