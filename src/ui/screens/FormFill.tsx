import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { useAppState } from '../../app/AppState';
import { describeError, reportError } from '../../app/errors';
import { setFlash } from '../../app/flash';
import { navigate, useRoute } from '../../app/router';
import { fromBase64 } from '../../backup/crypto';
import { shareOrDownload } from '../../backup/share';
import { loadFieldContext } from '../../db/fieldContext';
import { closeDraft, discardDraft, openDraft, photosFor, saveDraftValues } from '../../db/forms';
import type { MasterpieceDB } from '../../db/schema';
import type { FormDraft, FormTemplate } from '../../domain/types';
import { loadFormsEngine } from '../../forms/load';
import type { FormsEngine } from '../../forms/load';
import type { DraftValues } from '../../forms/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FormField } from '../components/FormField';
import { RowGroup } from '../components/RowGroup';
import {
  addRow, cellKey, DRAFT_DISCARDED, draftValuesOf, fileMadeText, fileValues, fillHeading, fillProblems, fillSections, isAuto,
  makeAndHandOver, removeRow, rolloverFor, setCell, setField, SHARE_CANCELLED, shownValue,
} from '../formFill';
import type { AutoFill } from '../formFill';
import { useDialogAction } from '../useDialogAction';
import { useLive } from '../useLive';

/*
 * The fill screen (spec §4 steps 3–4): a draft of a form as a list of questions, grouped by the form's sections, with
 * the auto values in their fields; every change is saved to the draft. `Make file` writes the values into the form,
 * checks the file and hands it to the share sheet (or downloads it); then the draft is closed. A share that is
 * cancelled keeps the draft. Text read from the form is shown as text only.
 */

/** How long typing has to pause before the draft is saved. */
const SAVE_DELAY_MS = 300;

/** A draft as it was opened: its auto values, and the ship's date and form version they are for. */
interface Opened {
  draft: FormDraft;
  auto: AutoFill;
  /** The ship's date when the draft was opened: the auto values' date and the file's date. */
  date: string;
  /** The form's `updatedAt` when opened. A form changed meanwhile (a revision imported in another tab) opens again. */
  basedOn: string;
}

/**
 * Saves a draft's values 300 ms after the last change, one save after another, and at once when the screen is left, the
 * app is hidden or the page goes away. `canSave` is asked before each save: never after the draft is closed.
 */
function useDraftSaver(db: MasterpieceDB, draftId: string, canSave: () => boolean) {
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<DraftValues | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const allowed = useRef(canSave);
  allowed.current = canSave;

  const saver = useMemo(() => {
    const flush = (): Promise<void> => {
      window.clearTimeout(timer.current);
      timer.current = undefined;
      const values = pending.current;
      pending.current = undefined;
      if (values !== undefined && allowed.current()) {
        chain.current = chain.current.then(async () => {
          await saveDraftValues(db, draftId, values);
        }).catch(reportError);
      }
      return chain.current;
    };
    return {
      schedule(values: DraftValues): void {
        pending.current = values;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
      },
      flush,
      /** Drops a save that is waiting (the draft is about to be closed). */
      cancel(): void {
        window.clearTimeout(timer.current);
        timer.current = undefined;
        pending.current = undefined;
      },
    };
  }, [db, draftId]);

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') void saver.flush();
    };
    const onPageHide = (): void => void saver.flush();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      void saver.flush(); // the screen is left
    };
  }, [saver]);
  return saver;
}

/** A section of the form, with its heading as a region; what is under no heading comes first, without one. */
function FillSectionBlock({ title, children }: { title: string; children: ComponentChildren }) {
  const id = useId();
  if (title === '') return <div class="fill-section">{children}</div>;
  return (
    <section class="fill-section" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  );
}

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

function FillEditor({ template, opened, engine, liveVersion }: {
  template: FormTemplate;
  opened: Opened;
  engine: FormsEngine;
  /** The form's `updatedAt` now. Once it differs from `opened.basedOn` nothing more is saved (the draft is opened again). */
  liveVersion: { current: string };
}) {
  const { db } = useAppState();
  const schema = template.schema;
  const { draft, auto, date } = opened;
  const [values, setValues] = useState(() => draftValuesOf(draft.values));
  const latest = useRef(values);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [checkFocus, setCheckFocus] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [problem, setProblem] = useState<string>();
  const [discarding, setDiscarding] = useState(false);
  const discard = useDialogAction();
  const working = useRef(false);
  /** Set once the draft is being closed or discarded: nothing more may be saved to it. */
  const closed = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const makeButton = useRef<HTMLButtonElement>(null);
  const saver = useDraftSaver(db, draft.id, () => !closed.current && liveVersion.current === opened.basedOn);

  const sections = useMemo(() => fillSections(schema), [schema]);
  const problems = fillProblems(schema, values);
  const shown = (key: string): string | undefined => (attempted || touched.has(key) ? problems[key] : undefined);
  const touch = (key: string): void => setTouched((current) => (current.has(key) ? current : new Set([...current, key])));

  useEffect(() => {
    if (checkFocus > 0) box.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [checkFocus]);

  function change(update: (current: DraftValues) => DraftValues): void {
    const next = update(latest.current);
    latest.current = next;
    setValues(next);
    saver.schedule(next);
  }

  async function makeTheFile(): Promise<void> {
    if (working.current) return;
    if (Object.keys(fillProblems(schema, latest.current)).length > 0) {
      setAttempted(true);
      setCheckFocus((n) => n + 1);
      return;
    }
    working.current = true;
    setBusy(true);
    setProblem(undefined);
    setStatus('Making the file…');
    let leaving = false;
    try {
      await saver.flush();
      const out = fileValues(schema, latest.current, auto);
      const photos = await photosFor(db, draft.id);
      const bytes = fromBase64(template.fileBase64);
      const outcome = await makeAndHandOver(schema, out, {
        make: (values) => engine.makeFile({ kind: template.kind, fileName: template.fileName, bytes, schema, values, photos, date }),
        isIntegrityError: (err): err is Error => err instanceof engine.IntegrityError,
        isWriteError: (err): err is Error => err instanceof engine.FormWriteError,
        share: shareOrDownload,
        close: async (values) => {
          closed.current = true; // nothing more is saved to the draft from here
          saver.cancel();
          try {
            await closeDraft(db, draft.id, values, rolloverFor(schema, template.setup, values, draft.period, date, engine));
          } catch (err) {
            closed.current = false;
            saver.schedule(latest.current); // what was typed is still saved
            throw err;
          }
        },
      });
      if (outcome.kind === 'problem') {
        // The draft stays as it is; what went wrong is said here, beside the button.
        setProblem(outcome.message);
        setStatus('');
      } else if (outcome.kind === 'cancelled') {
        setStatus(SHARE_CANCELLED);
      } else {
        setFlash(fileMadeText(outcome.fileName));
        navigate('/forms');
        leaving = true; // stays busy until the screen is replaced, so that a second tap cannot make the file again
      }
    } catch (err) {
      setStatus('');
      reportError(err);
    } finally {
      if (!leaving) {
        working.current = false;
        setBusy(false);
      }
    }
  }

  async function discardIt(): Promise<void> {
    closed.current = true;
    saver.cancel();
    try {
      await discardDraft(db, draft.id);
    } catch (err) {
      closed.current = false;
      saver.schedule(latest.current); // what was typed is kept
      throw err;
    }
    setFlash(DRAFT_DISCARDED);
    navigate('/forms');
  }

  return (
    <div ref={box} class="screen fill-form">
      <h2>{fillHeading(template)}</h2>
      <p class="fill-period">{engine.periodLabel(draft.period)}</p>

      {sections.length === 0 && <p class="empty">This form has nothing to fill in here.</p>}
      {sections.map((section) => (
        <FillSectionBlock key={section.title} title={section.title}>
          {section.items.map((item) => {
            if (item.kind === 'field') {
              const { id } = item.field;
              const value = shownValue(values, auto, id);
              return (
                <FormField
                  key={id} field={item.field} value={value} auto={isAuto(values, auto, id)} dataKey={id}
                  note={value === null || value === '' ? auto.missing[id] : undefined} error={shown(id)}
                  onChange={(next) => change((current) => setField(current, id, next))} onLeave={() => touch(id)}
                />
              );
            }
            const { group } = item;
            return (
              <RowGroup
                key={group.id} group={group} kind={template.kind} rows={values.rows[group.id] ?? []}
                showLabel={!sameName(group.label, section.title)}
                onCell={(i, column, next) => change((current) => setCell(current, group, i, column, next))}
                onAdd={() => change((current) => addRow(current, group.id))}
                onRemove={(i) => change((current) => removeRow(current, group.id, i))}
                errorFor={(i, column) => shown(cellKey(group.id, i, column))}
                onLeave={(i, column) => touch(cellKey(group.id, i, column))}
                keyFor={(i, column) => cellKey(group.id, i, column)}
              />
            );
          })}
        </FillSectionBlock>
      ))}

      {/* Always on the page, with its text set after it is there, so that it is announced. */}
      <p class="live" role="status">{status}</p>
      {problem && <p class="field-error" role="alert">{problem}</p>}
      <div class="form-actions">
        <button
          ref={makeButton} type="button" class="btn btn-primary" aria-disabled={busy ? 'true' : undefined}
          onClick={() => void makeTheFile()}
        >
          Make file
        </button>
        <button
          type="button" class="btn btn-outline" aria-disabled={busy ? 'true' : undefined}
          onClick={() => {
            if (!working.current) setDiscarding(true);
          }}
        >
          Discard draft
        </button>
      </div>

      {discarding && (
        <ConfirmDialog
          title="Discard this draft?" confirmLabel="Discard draft" danger busy={discard.busy} error={discard.failure}
          focusFallback={makeButton} onCancel={() => setDiscarding(false)}
          onConfirm={() => void discard.run(discardIt)}
          body={<p>Everything entered in this form is thrown away, and no file is made.</p>}
        />
      )}
    </div>
  );
}

/** Opens the ship's draft of a form (making one if there is none) with its auto values, and shows it. */
function FillLoader({ shipId, templateId }: { shipId: string; templateId: string }) {
  const { db, nowUtc, shipToday } = useAppState();
  // `null` once read and not found, so that it is told apart from still loading (`undefined`).
  const template = useLive(async () => (await db.formTemplates.get(templateId)) ?? null, [db, templateId]);
  const [engine, setEngine] = useState<FormsEngine>();
  const [failed, setFailed] = useState<string>();
  const [opened, setOpened] = useState<Opened>();
  const liveVersion = useRef('');
  liveVersion.current = template?.updatedAt ?? '';
  // The moment the draft is opened: its auto values are for this instant and the ship's date then.
  const clock = useRef({ nowUtc, shipToday });
  clock.current = { nowUtc, shipToday };

  useEffect(() => {
    loadFormsEngine().then(setEngine, (err: unknown) => setFailed(describeError(err).message));
  }, []);

  const live = template && !template.deleted ? template : undefined;
  useEffect(() => {
    if (!engine || !live) return;
    let gone = false;
    const { nowUtc: at, shipToday: date } = clock.current;
    (async () => {
      const draft = await openDraft(db, shipId, live, engine.draftPeriod(live.setup, date));
      const ctx = await loadFieldContext(db, shipId, at);
      const auto = engine.autoValues(live.schema, live.setup.links, ctx, date);
      if (!gone) setOpened({ draft, auto, date, basedOn: live.updatedAt });
    })().catch((err: unknown) => {
      if (!gone) reportError(err);
    });
    return () => {
      gone = true;
    };
  }, [engine, live?.id, live?.updatedAt]);

  if (template === null || template?.deleted) {
    return (
      <section class="screen">
        <h2>Fill</h2>
        <p class="empty">This form is not in the library. <a href="#/forms">Go to Forms</a></p>
      </section>
    );
  }
  if (failed) {
    return (
      <section class="screen">
        <h2>{template ? fillHeading(template) : 'Fill'}</h2>
        <p class="field-error" role="alert">{failed}</p>
      </section>
    );
  }
  // Drawn only with the draft opened for this version of the form, and keyed by both, so that a draft is never shown
  // with another form's fields.
  if (live && engine && opened && opened.basedOn === live.updatedAt) {
    return <FillEditor key={`${opened.draft.id}:${opened.basedOn}`} template={live} opened={opened} engine={engine} liveVersion={liveVersion} />;
  }
  return <section class="screen"><p class="live" role="status">Loading…</p></section>;
}

/** The fill screen of the form in the route (`/forms/:id/fill`, the template's id), for the active ship. */
export function FormFill() {
  const { activeShip } = useAppState();
  const { params } = useRoute();
  if (!activeShip) return null;
  // Keyed by ship and form, so that a draft is never carried to another ship or form.
  return <FillLoader key={`${activeShip.id}:${params.id ?? ''}`} shipId={activeShip.id} templateId={params.id ?? ''} />;
}
