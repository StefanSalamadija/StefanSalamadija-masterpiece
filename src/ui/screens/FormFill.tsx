import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { describeError, reportError } from '../../app/errors';
import { setFlash } from '../../app/flash';
import { navigate, useRoute } from '../../app/router';
import { fromBase64 } from '../../backup/crypto';
import { shareOrDownload } from '../../backup/share';
import { loadFieldContext } from '../../db/fieldContext';
import { addPhoto, closeDraft, removePhoto, discardDraft, findDraft, lastValuesFor, openDraft, photosFor, saveDraftValues } from '../../db/forms';
import type { FieldContext } from '../../domain/fieldDictionary';
import type { FormDraft, FormTemplate } from '../../domain/types';
import { loadFormsEngine } from '../../forms/load';
import type { FormsEngine } from '../../forms/load';
import type { DraftValues } from '../../forms/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FillQuestions } from '../components/FillQuestions';
import {
  autoAt, DRAFT_DISCARDED, fileMadeText, fileValues, fillHeading, fillProblems, fillSections, fixedState,
  isFixed, makeAndHandOver, rolloverFor, SHARE_CANCELLED, shipDateAt,
} from '../formFill';
import type { FillState } from '../formFill';
import { autoDateFor, withLastValues } from '../formHelpers';
import { downsizeImage, PHOTO_UNREADABLE } from '../photo';
import { useDraftSaver } from '../useDraftSaver';
import { useDialogAction } from '../useDialogAction';
import { useLive } from '../useLive';

/*
 * The fill screen (spec §4 steps 3–4): a draft of a form as a list of questions, grouped by the form's sections, with
 * the auto values in their fields. Opening it stores nothing; the first change fixes the auto values of that moment
 * and stores the draft, and every change after is saved (rulings R18, and `formFill.ts`). `Make file` writes the values
 * into the form, checks the file and hands it to the share sheet (or downloads it); then the draft is closed. A share
 * that is cancelled keeps the draft. The helpers (spec §7) are in `FillQuestions`; every one of them is a change like an edit,
 * so the first helper action fixes the draft's auto values and its values from the last file (R18, R19). Text read from the
 * form is shown as text only.
 */

/** What the screen opens with: the ship's draft of the form, if there is one, and the ship's data for the auto values. */
interface Opened {
  stored: FormDraft | undefined;
  ctx: FieldContext;
  /** The values of the last file made from the form on this ship, which a new draft starts from. */
  last: DraftValues | undefined;
  /** The form's `updatedAt` when opened. A form changed meanwhile (a revision imported in another tab) opens again. */
  basedOn: string;
}

const sameData = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function FillEditor({ template, opened, engine, shipId, liveVersion }: {
  template: FormTemplate;
  opened: Opened;
  engine: FormsEngine;
  shipId: string;
  /** The form's `updatedAt` now. Once it differs from `opened.basedOn` nothing more is saved (the draft is opened again). */
  liveVersion: { current: string };
}) {
  const { db, nowUtc, clockChanges } = useAppState();
  const { schema, setup } = template;
  const ctx = useMemo(() => ({ ...opened.ctx, clockChanges }), [opened.ctx, clockChanges]);
  /** The stored draft, once there is one. */
  const draft = useRef<FormDraft | undefined>(opened.stored);
  /** The period of a draft not stored yet: the ship's at its first change. */
  const period = useRef<string | undefined>(undefined);
  /** The draft as the screen holds it, from its first change on (or from opening, for a draft whose auto values are fixed). */
  const [local, setLocal] = useState<FillState | undefined>(() => (isFixed(opened.stored) ? fixedState(opened.stored, { values: {}, missing: {} }) : undefined));
  const latest = useRef(local);
  /** The values of the last file that a new draft starts from (only the groups and blocks the setup lists, see `withLastValues`). */
  const start = useMemo(() => {
    const values = opened.last ? engine.startFromLast(schema, opened.last) : undefined;
    return values ? (held: DraftValues) => withLastValues(held, schema, setup, values) : undefined;
  }, [engine, schema, setup, opened.last]);
  /** The date of the draft (R19): the ship's today when it is in the draft's period, else the period's first day. */
  const dateAt = (instant: Date, period: string | undefined): string => {
    const today = shipDateAt(clockChanges, instant);
    const todayPeriod = engine.draftPeriod(setup, today);
    return autoDateFor(period ?? todayPeriod, today, todayPeriod);
  };
  const storedPeriod = opened.stored?.period;
  // Until the first change the auto values are those of now, kept fresh as the app's clock moves on.
  const fresh = useMemo(
    () => autoAt(engine.autoValues, schema, setup, ctx, nowUtc, dateAt(nowUtc, storedPeriod)),
    [engine, schema, setup, ctx, nowUtc, storedPeriod],
  );
  const [missing, setMissing] = useState(fresh.auto.missing);
  const state = local ?? fixedState(opened.stored, fresh.auto, start);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [checkFocus, setCheckFocus] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [problem, setProblem] = useState<string>();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoNotice, setPhotoNotice] = useState<{ key: string; text: string }>();
  const photoWorking = useRef(false);
  const [discarding, setDiscarding] = useState(false);
  const discard = useDialogAction();
  const working = useRef(false);
  /** Set once the draft is being closed or discarded: nothing more may be saved to it. */
  const closed = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const makeButton = useRef<HTMLButtonElement>(null);

  /** Stores the draft: the first save makes it (with the auto values fixed at its first change), later ones update it. */
  async function persist(next: FillState): Promise<void> {
    if (draft.current === undefined) {
      const made = await openDraft(db, shipId, template, period.current ?? engine.draftPeriod(setup, fresh.shipDate), next);
      draft.current = made;
      // Another tab made one first: this screen's values go into it.
      if (sameData([made.values, made.autoIds], [next.values, next.autoIds])) return;
    }
    draft.current = await saveDraftValues(db, draft.current.id, next.values, next.autoIds);
  }
  const saver = useDraftSaver(persist, () => !closed.current && liveVersion.current === opened.basedOn);

  const sections = useMemo(() => fillSections(schema), [schema]);
  const problems = fillProblems(schema, state.values);
  const shown = (key: string): string | undefined => (attempted || touched.has(key) ? problems[key] : undefined);
  const touch = (key: string): void => setTouched((current) => (current.has(key) ? current : new Set([...current, key])));

  useEffect(() => {
    if (checkFocus > 0) box.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [checkFocus]);

  /**
   * The state the next change starts from. The first change fixes the auto values of this moment, and the values from the
   * last file, in one step (R18). The auto date is the ship's today if it is in the draft's period, else the period's first
   * day (R19).
   */
  function base(): FillState {
    if (latest.current) return latest.current;
    const now = new Date();
    const periodNow = draft.current?.period ?? engine.draftPeriod(setup, shipDateAt(clockChanges, now));
    const at = autoAt(engine.autoValues, schema, setup, ctx, now, dateAt(now, periodNow));
    period.current = periodNow;
    setMissing(at.auto.missing);
    return fixedState(draft.current, at.auto, start);
  }

  function change(update: (current: FillState) => FillState): void {
    const next = update(base());
    latest.current = next;
    setLocal(next);
    saver.schedule(next);
  }

  /**
   * The id of the stored draft, made now if there is none yet: a first change (which fixes the auto values, R18), then the
   * save. A photo and a made file need a draft to belong to. `undefined` when the save failed (it said so).
   */
  async function storedDraftId(): Promise<string | undefined> {
    if (latest.current === undefined) change((current) => current);
    await saver.flush();
    return draft.current?.id;
  }

  /**
   * Removes photos no longer in the form (taken out, or replaced), so that they stop counting toward storage. The draft
   * is saved first, so that it never refers to a photo that is gone.
   */
  async function dropPhotos(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      await saver.flush();
      for (const id of ids) await removePhoto(db, id);
    } catch (err) {
      reportError(err);
    }
  }

  /** Adds a photo to the draft: downsized, stored with the draft, and put in the picture field `place` sets. */
  async function addPhotoFile(
    file: File, key: string, place: (photoId: string) => (current: FillState) => FillState, replaces?: string,
  ): Promise<void> {
    if (photoWorking.current || working.current) return;
    photoWorking.current = true;
    setPhotoBusy(true);
    setPhotoNotice(undefined);
    setStatus('Adding photo…');
    try {
      let small: Awaited<ReturnType<typeof downsizeImage>>;
      try {
        small = await downsizeImage(file);
      } catch (err) {
        setPhotoNotice({ key, text: err instanceof Error && err.message === PHOTO_UNREADABLE ? err.message : PHOTO_UNREADABLE });
        setStatus('');
        return;
      }
      const draftId = await storedDraftId();
      if (draftId === undefined) {
        setStatus('');
        return; // the save failed, and said so
      }
      const photo = await addPhoto(db, shipId, draftId, small.jpeg, small.width, small.height);
      change(place(photo.id));
      setStatus('Photo added.');
      if (replaces !== undefined) void dropPhotos([replaces]);
    } catch (err) {
      setStatus('');
      reportError(err);
    } finally {
      photoWorking.current = false;
      setPhotoBusy(false);
    }
  }

  async function makeTheFile(): Promise<void> {
    if (working.current || photoWorking.current) return;
    if (Object.keys(fillProblems(schema, base().values)).length > 0) {
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
      // A file made with no change at all still needs its draft: it is stored now, with the auto values of this moment.
      await storedDraftId();
      const current = draft.current;
      if (current === undefined || latest.current === undefined) {
        setStatus(''); // the save failed, and said so
        return;
      }
      const out = fileValues(schema, latest.current.values);
      const date = shipDateAt(clockChanges, new Date()); // the file's date: the ship's, now (R18)
      const photos = await photosFor(db, current.id);
      const bytes = fromBase64(template.fileBase64);
      const outcome = await makeAndHandOver(schema, out, {
        make: (values) => engine.makeFile({ kind: template.kind, fileName: template.fileName, bytes, schema, values, photos, date }),
        isIntegrityError: (err): err is InstanceType<FormsEngine['IntegrityError']> => err instanceof engine.IntegrityError,
        isWriteError: (err): err is InstanceType<FormsEngine['FormWriteError']> => err instanceof engine.FormWriteError,
        // For diagnostics only: the person reads the message, never the reason.
        logIntegrity: (reason) => console.warn('The made form file failed its check:', reason),
        share: shareOrDownload,
        close: async (values) => {
          closed.current = true; // nothing more is saved to the draft from here
          saver.cancel();
          try {
            await closeDraft(db, current.id, values, rolloverFor(schema, setup, values, current.period, date, engine));
          } catch (err) {
            closed.current = false;
            if (latest.current) saver.schedule(latest.current); // what was typed is still saved
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
      } else if (outcome.kind === 'madeNotClosed') {
        // The person has the file: say so, so that it is not made twice, and why the draft is still here.
        setStatus(fileMadeText(outcome.fileName));
        reportError(outcome.error);
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

  /** Discard: a draft that is not stored is only left; a stored one is asked about first. */
  async function askDiscard(): Promise<void> {
    if (working.current) return;
    if (draft.current === undefined) {
      saver.cancel();
      await saver.idle(); // a first save already running may still make the draft
      if (draft.current === undefined) {
        closed.current = true;
        navigate('/forms');
        return;
      }
      if (latest.current) saver.schedule(latest.current);
    }
    setDiscarding(true);
  }

  async function discardIt(): Promise<void> {
    closed.current = true;
    saver.cancel();
    await saver.idle();
    try {
      if (draft.current) await discardDraft(db, draft.current.id);
    } catch (err) {
      closed.current = false;
      if (latest.current) saver.schedule(latest.current); // what was typed is kept
      throw err;
    }
    setFlash(DRAFT_DISCARDED);
    navigate('/forms');
  }

  const periodShown = draft.current?.period ?? period.current ?? engine.draftPeriod(setup, fresh.shipDate);
  return (
    <div ref={box} class="screen fill-form">
      <h2>{fillHeading(template)}</h2>
      <p class="fill-period">{engine.periodLabel(periodShown)}</p>

      {sections.length === 0 && <p class="empty">This form has nothing to fill in here.</p>}
      {/* Nothing can be changed while the file is being made: what the file holds is what the screen shows. */}
      <fieldset class="fill-questions" role="none" disabled={busy}>
        <FillQuestions
          template={template} engine={engine} sections={sections} state={state} change={change}
          noteFor={(id) => (local ? missing : fresh.auto.missing)[id]} shown={shown} touch={touch}
          crew={ctx.crew} clockChanges={clockChanges} date={dateAt(nowUtc, draft.current?.period ?? period.current)}
          shipToday={shipDateAt(clockChanges, nowUtc)} last={opened.last} revealAll={attempted && Object.keys(problems).length > 0}
          photoBusy={photoBusy} photoNotice={photoNotice} notify={setStatus}
          onPhoto={(file, key, place, replaces) => void addPhotoFile(file, key, place, replaces)} onDrop={(ids) => void dropPhotos(ids)}
          isTouched={(key) => touched.has(key)}
        />
      </fieldset>

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
        <button type="button" class="btn btn-outline" aria-disabled={busy ? 'true' : undefined} onClick={() => void askDiscard()}>
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

/** Finds the ship's draft of a form, if there is one (it makes none), and the ship's data for the auto values. */
function FillLoader({ shipId, templateId }: { shipId: string; templateId: string }) {
  const { db } = useAppState();
  // `null` once read and not found, so that it is told apart from still loading (`undefined`).
  const template = useLive(async () => (await db.formTemplates.get(templateId)) ?? null, [db, templateId]);
  const [engine, setEngine] = useState<FormsEngine>();
  const [failed, setFailed] = useState<string>();
  const [opened, setOpened] = useState<Opened>();
  const liveVersion = useRef('');
  liveVersion.current = template?.updatedAt ?? '';

  useEffect(() => {
    loadFormsEngine().then(setEngine, (err: unknown) => setFailed(describeError(err).message));
  }, []);

  const live = template && !template.deleted ? template : undefined;
  useEffect(() => {
    if (!engine || !live) return;
    let gone = false;
    Promise.all([findDraft(db, shipId, live), loadFieldContext(db, shipId, new Date()), lastValuesFor(db, shipId, live)]).then(([stored, ctx, last]) => {
      if (!gone) setOpened({ stored, ctx, last: last?.values, basedOn: live.updatedAt });
    }, (err: unknown) => {
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
  // Drawn only with the draft found for this version of the form, and keyed by it, so that a draft is never shown
  // with another version's fields.
  if (live && engine && opened && opened.basedOn === live.updatedAt) {
    return <FillEditor key={opened.basedOn} template={live} opened={opened} engine={engine} shipId={shipId} liveVersion={liveVersion} />;
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
