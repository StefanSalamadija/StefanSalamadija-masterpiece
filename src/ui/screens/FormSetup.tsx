import type { ComponentChildren } from 'preact';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { describeError, reportError } from '../../app/errors';
import { setFlash } from '../../app/flash';
import { navigate, useRoute } from '../../app/router';
import { removeTemplate, saveSetup, SETUP_STALE } from '../../db/forms';
import type { FormTemplate } from '../../domain/types';
import { loadFormsEngine } from '../../forms/load';
import type { FormsEngine } from '../../forms/load';
import type { FormSetup as Setup, HelperKey } from '../../forms/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { SetupFieldRow } from '../components/SetupFieldRow';
import {
  applyChoice, choiceOf, confirmName, FORM_REMOVED, foundSummary, helperSwitches, removePrompt, savedSchema, setHelper, setupHeading,
  setupProblems, setupSections, showsNotFinished,
} from '../formsView';
import type { NameReview, SetupEntry } from '../formsView';
import { useDialogAction } from '../useDialogAction';
import { useLive } from '../useLive';

/*
 * The setup review (spec §4 step 2): what was found in a form, where each field is filled in from, which helpers are on,
 * and the words the helpers write. Every label, title and sentence here is read from the form, so it is shown as text only.
 */

/** What the setup says on opening, left by the screen that sent the person here (after a revision replaced a form). */
const notices = new Map<string, string[]>();

/** Leaves lines for the setup of `templateId` to show once, such as `New fields to check: Location`. */
export function leaveSetupNotice(templateId: string, lines: string[]): void {
  if (lines.length > 0) notices.set(templateId, lines);
  else notices.delete(templateId);
}

function takeSetupNotice(templateId: string): string[] {
  const lines = notices.get(templateId) ?? [];
  notices.delete(templateId);
  return lines;
}

/** A section of the review, with its own heading, so that it is a region a screen reader can go to. */
function Section({ title, children }: { title: string; children: ComponentChildren }) {
  const id = useId();
  return (
    <section class="setup-section" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  );
}

/** The fields of a section: the form's own first, then the columns of each table under the table's heading. */
function EntryList({ entries, render }: { entries: SetupEntry[]; render: (entry: SetupEntry) => ComponentChildren }) {
  const top = entries.filter((e) => e.group === undefined);
  const groups = [...new Map(entries.flatMap((e) => (e.group ? [[e.group.id, e.group] as const] : []))).values()];
  return (
    <>
      {top.length > 0 && <ul class="setup-list" role="list">{top.map(render)}</ul>}
      {groups.map((group) => (
        <div key={group.id} class="setup-group">
          <h4>{group.label}</h4>
          <ul class="setup-list" role="list">{entries.filter((e) => e.group?.id === group.id).map(render)}</ul>
        </div>
      ))}
    </>
  );
}

function SetupEditor({ template, engine }: { template: FormTemplate; engine: FormsEngine }) {
  const { db } = useAppState();
  const schema = template.schema;
  const [setup, setSetup] = useState<Setup>(() => template.setup);
  /** Names typed for fields, by id. */
  const [labels, setLabels] = useState<Record<string, string>>({});
  /** The unsure fields confirmed or renamed, and the links suggested for their names (R24). */
  const [names, setNames] = useState<Omit<NameReview, 'setup'>>({ confirmed: {}, suggested: {} });
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice] = useState(() => takeSetupNotice(template.id));
  /** The form as it was when the review opened: a save is refused if it has changed since. */
  const [basedOn] = useState(template.updatedAt);
  const saving = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  /** The field whose choice just moved it to another section, to give it the focus there. */
  const [moved, setMoved] = useState<{ id: string }>();
  const [checkFocus, setCheckFocus] = useState(0);
  /** `Remove form` asks first (R26). */
  const [removing, setRemoving] = useState(false);
  const remove = useDialogAction();
  const saveButton = useRef<HTMLButtonElement>(null);

  const suggested = useMemo<Record<HelperKey, string[]>>(() => engine.suggestHelpers(schema), [engine, schema]);
  const sections = setupSections(schema, setup);
  const switches = helperSwitches(schema, setup, suggested);
  // Only the fields being named (unsure ones that the person fills, or that a confirmed name linked) can hold up the save.
  const naming = new Set([...sections.you, ...sections.filled].filter((e) => e.field.confidence === 'low').map((e) => e.field.id));
  const problems = setupProblems({
    okWord: setup.okWord, labels: Object.fromEntries(Object.entries(labels).filter(([id]) => naming.has(id))),
    notFinished: showsNotFinished(setup) ? setup.notFinished : undefined,
  });
  // The form changed since this review opened (a new revision, in another tab): saving would be refused, so say so now.
  const stale = template.updatedAt !== basedOn && !saving.current;
  const shown = (key: string): string | undefined => (attempted || touched.has(key) ? problems[key] : undefined);
  const touch = (key: string): void => setTouched((current) => (current.has(key) ? current : new Set([...current, key])));

  // A field whose choice moved it is drawn anew in its new section, and the focus it had is lost: it is given back there,
  // at once (before anything else can take the focus) and only if nothing has it, so that it is never taken from another control.
  useLayoutEffect(() => {
    if (!moved) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    form.current?.querySelector<HTMLElement>(`select[data-field="${CSS.escape(moved.id)}"]`)?.focus();
  }, [moved]);
  useEffect(() => {
    if (checkFocus > 0) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [checkFocus]);

  function choose(id: string, choice: string): void {
    setSetup((current) => applyChoice(current, id, choice));
    setMoved({ id });
  }

  const entryOf = (id: string): SetupEntry | undefined => [...sections.you, ...sections.filled].find((e) => e.field.id === id);
  const typedName = (id: string): string | undefined => labels[id]?.trim() || undefined;

  /**
   * The review with the unsure fields `ids` confirmed under the names shown (R24): each is named, and the link for its name
   * is suggested, for the person to see and change.
   */
  function confirmed(ids: string[], from: NameReview): NameReview {
    return ids.reduce((review, id) => {
      const entry = entryOf(id);
      if (!entry) return review;
      const name = labels[id] ?? entry.field.label; // an emptied name confirms nothing
      return confirmName(review, entry.field, name, (named) => engine.suggestLinkFor(named, entry.group !== undefined));
    }, from);
  }

  function confirm(id: string): void {
    const review = confirmed([id], { setup, ...names });
    setNames({ confirmed: review.confirmed, suggested: review.suggested });
    if (review.setup !== setup) {
      setSetup(review.setup);
      if (choiceOf(review.setup, id) !== choiceOf(setup, id)) setMoved({ id });
    }
  }

  /** A name typed and left: a new name is taken as confirmed (R24). */
  function nameDone(id: string): void {
    touch(id);
    const name = typedName(id);
    if (name !== undefined && name !== names.confirmed[id]) confirm(id);
  }

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    if (saving.current) return;
    if (Object.keys(problems).length > 0) {
      setAttempted(true);
      setCheckFocus((n) => n + 1);
      return;
    }
    // A name typed but not yet confirmed (the form sent with Enter from its input) is confirmed now. When that suggests a
    // link, nothing is saved yet: the person sees the link first, and can change it (R24).
    const pending = [...naming].filter((id) => typedName(id) !== undefined && typedName(id) !== names.confirmed[id]);
    const review = confirmed(pending, { setup, ...names });
    if (pending.length > 0) {
      setNames({ confirmed: review.confirmed, suggested: review.suggested });
      if (JSON.stringify(review.setup) !== JSON.stringify(setup)) {
        setSetup(review.setup);
        return;
      }
    }
    saving.current = true;
    setBusy(true);
    try {
      const final: Setup = { ...setup, okWord: setup.okWord.trim(), notFinished: setup.notFinished.trim() };
      await saveSetup(db, template.id, basedOn, final, savedSchema(schema, final, labels, new Set(Object.keys(review.confirmed))));
      setFlash('Form saved.');
      navigate('/forms');
      return; // stays busy until the screen is replaced, so that a second tap cannot save again
    } catch (err) {
      reportError(err);
    }
    saving.current = false;
    setBusy(false);
  }

  /** Removes the form, its drafts, their photos and its last values (R26), then goes back to the library. */
  async function removeIt(): Promise<void> {
    await removeTemplate(db, template.id);
    setFlash(FORM_REMOVED);
    navigate('/forms');
  }

  const okWordError = shown('okWord');
  const notFinishedError = shown('notFinished');
  const row = (entry: SetupEntry) => {
    const { id } = entry.field;
    const unsure = naming.has(id);
    return (
      <SetupFieldRow
        key={id} field={entry.field} choice={choiceOf(setup, id)} onChoose={(choice) => choose(id, choice)}
        name={unsure ? labels[id] ?? entry.field.label : undefined} nameError={shown(id)}
        onName={(value) => setLabels((current) => ({ ...current, [id]: value }))} onNameDone={() => nameDone(id)}
        confirmed={id in names.confirmed} onConfirm={() => confirm(id)}
      />
    );
  };

  return (
    <>
      <form ref={form} class="screen setup-form" onSubmit={(event) => void save(event)} noValidate>
        <h2>{setupHeading(template)}</h2>
        <p class="setup-identity">{[template.title, template.revision === '' ? '' : `Rev ${template.revision}`].filter(Boolean).join(' · ')}</p>
        <p class="helper-text">{foundSummary(schema)}</p>
        {stale && <p class="field-error" role="alert">{SETUP_STALE}</p>}
        {notice.length > 0 && (
          <div class="setup-notice" role="status">
            {notice.map((line) => <p key={line}>{line}</p>)}
          </div>
        )}

        <Section title="Filled for you">
          {sections.filled.length === 0 && <p class="empty">No field is filled in by itself. Link one below.</p>}
          <EntryList entries={sections.filled} render={row} />
        </Section>
        <Section title="You fill">
          {sections.you.length === 0 && <p class="empty">Nothing is left for you to fill in.</p>}
          <EntryList entries={sections.you} render={row} />
        </Section>
        <Section title="Left empty">
          <p class="helper-text">Signatures and stamps are left empty, for the printed form.</p>
          {sections.empty.length === 0 && <p class="empty">No field is left empty.</p>}
          <EntryList entries={sections.empty} render={row} />
        </Section>
        <Section title="Can't be filled here">
          {schema.unsupported.length === 0 && <p class="empty">Every part of this form can be filled here.</p>}
          {schema.unsupported.length > 0 && (
            <ul class="setup-unsupported">{schema.unsupported.map((line, i) => <li key={i}>{line}</li>)}</ul>
          )}
        </Section>
        <Section title="Helpers">
          {switches.length === 0 && <p class="empty">No helper applies to this form.</p>}
          {switches.map((helper) => (
            <label key={`${helper.key}:${helper.ids.join(',')}`} class="check">
              <input
                type="checkbox" role="switch" checked={helper.on}
                onChange={(event) => setSetup((current) => setHelper(current, helper, event.currentTarget.checked))}
              />
              <span>{helper.label}</span>
            </label>
          ))}
        </Section>
        {/* Each is one field, labelled by its name: no heading of its own, so that the name is said once. */}
        <div class="setup-section" onFocusOut={() => touch('okWord')}>
          <Field
            label="OK word" value={setup.okWord} hint="What All OK writes in a field that has no Yes or OK option."
            error={okWordError === undefined ? undefined : { field: 'okWord', severity: 'error', message: okWordError }}
            onInput={(okWord) => setSetup((current) => ({ ...current, okWord }))}
          />
        </div>
        {showsNotFinished(setup) && (
          <div class="setup-section" onFocusOut={() => touch('notFinished')}>
            <Field
              label="Not finished value" value={setup.notFinished}
              hint="Jobs with this status are carried over to next week's form."
              error={notFinishedError === undefined ? undefined : { field: 'notFinished', severity: 'error', message: notFinishedError }}
              onInput={(notFinished) => setSetup((current) => ({ ...current, notFinished }))}
            />
          </div>
        )}

        <div class="form-actions">
          <button ref={saveButton} type="submit" class="btn btn-primary" aria-disabled={busy ? 'true' : undefined}>Save form</button>
          <button type="button" class="btn btn-outline" aria-disabled={busy ? 'true' : undefined} onClick={() => !busy && setRemoving(true)}>
            Remove form
          </button>
        </div>
      </form>
      {/* Outside the setup's form: the dialog has a form of its own, whose submit must not save the setup. */}
      {removing && (
        <ConfirmDialog
          title={removePrompt(template)} confirmLabel="Remove form" danger busy={remove.busy} error={remove.failure}
          focusFallback={saveButton} onCancel={() => setRemoving(false)}
          onConfirm={() => void remove.run(removeIt)}
          body={<p>The form leaves the library. Its drafts, their photos and the values of its last file are deleted.</p>}
        />
      )}
    </>
  );
}

/** The setup review of the form in the route (`/forms/:id/setup`). */
export function FormSetup() {
  const { db } = useAppState();
  const { params } = useRoute();
  const id = params.id ?? '';
  // `null` once read and not found, so that it is told apart from still loading (`undefined`).
  const template = useLive(async () => (await db.formTemplates.get(id)) ?? null, [db, id]);
  const [engine, setEngine] = useState<FormsEngine>();
  const [failed, setFailed] = useState<string>();

  useEffect(() => {
    loadFormsEngine().then(setEngine, (err: unknown) => setFailed(describeError(err).message));
  }, []);

  if (template === null || template?.deleted) {
    return (
      <section class="screen">
        <h2>Set up</h2>
        <p class="empty">This form is not in the library. <a href="#/forms">Go to Forms</a></p>
      </section>
    );
  }
  if (failed) {
    return (
      <section class="screen">
        <h2>{template ? setupHeading(template) : 'Set up'}</h2>
        <p class="field-error" role="alert">{failed}</p>
      </section>
    );
  }
  // Keyed by form, so that what was chosen for one form is never shown for another.
  if (template && engine) return <SetupEditor key={template.id} template={template} engine={engine} />;
  return <section class="screen"><p class="live" role="status">Loading…</p></section>;
}
