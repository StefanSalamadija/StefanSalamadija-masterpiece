import { useId, useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { onboardAt, fullName } from '../../domain/crew';
import type { ClockChange, CrewMember, FormTemplate } from '../../domain/types';
import type { FormsEngine } from '../../forms/load';
import type { DraftValues, FieldDef, FormValue, RowGroupDef } from '../../forms/types';
import { normaliseLabel } from '../../forms/labels';
import {
  addRow, cellKey, editField, hasPictures, removeRow, setCell, shownValue,
} from '../formFill';
import type { FillSection, FillState } from '../formFill';
import {
  allOkButtons, applyAllOk, lastShown, lastText, newJobRow, nextFreeSlot, nowOffset, placeRows, readingWarning, remarksRule, rowLimit,
} from '../formHelpers';
import type { AllOkButton } from '../formHelpers';
import { ConfirmDialog } from './ConfirmDialog';
import { CrewPicker } from './CrewPicker';
import { FormField } from './FormField';
import { isPhotoTable, PhotoField, PhotoGroup } from './JobLog';
import { RowGroup } from './RowGroup';
import type { RowExtras } from './RowGroup';

/*
 * The questions of the fill screen: the form's sections, with the fields and tables in them and the seven helpers of
 * spec §7 wired to them (Task 16). What each helper does to the values is in `formHelpers.ts` and the engine's
 * `helpers.ts`; this draws the buttons and the warnings, and sends every action through `change`, as an edit is. Text
 * read from the form or from the ship's data is shown as text only.
 */

/** The engine's rules that the helpers use. */
export type HelperEngine = Pick<FormsEngine, 'allOkValues' | 'crewRows' | 'thresholdsOf' | 'checkReading' | 'nowValue' | 'todayRowIndex' | 'jobLogColumns' | 'isJobLogGroup'>;

export interface FillQuestionsProps {
  template: FormTemplate;
  engine: HelperEngine;
  sections: FillSection[];
  state: FillState;
  /** Why a person field has no value, by field id (`No Master onboard`). */
  noteFor: (id: string) => string | undefined;
  /** The error to show for a field or cell key, if any. */
  shown: (key: string) => string | undefined;
  touch: (key: string) => void;
  /** Whether a cell or field was left (a warning is shown from then on). */
  isTouched: (key: string) => boolean;
  change: (update: (current: FillState) => FillState) => void;
  /** The ship's crew, for Add from crew and a job's Responsible. */
  crew: CrewMember[];
  clockChanges: ClockChange[];
  /** The date of the draft: its auto date (R19). The crew onboard then and today's row are for this date. */
  date: string;
  /** The ship's today, for a new job. */
  shipToday: string;
  /** The values of the last file, for `Last: <value>`. */
  last: DraftValues | undefined;
  /** Every day of a day grid is shown (a number that cannot be read is in a day that is hidden). */
  revealAll: boolean;
  photoBusy: boolean;
  photoNotice: { key: string; text: string } | undefined;
  /** Adds a photo: `place` sets the picture field once it is stored; `replaces` is the photo it takes the place of, removed then. */
  onPhoto: (file: File, key: string, place: (photoId: string) => (current: FillState) => FillState, replaces?: string) => void;
  /** Photos no longer used (removed or replaced): their records are removed once the draft no longer holds them. */
  onDrop: (photoIds: string[]) => void;
  /** Tells the person something about what a helper did (shown in the status line). */
  notify: (text: string) => void;
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

/** The id of the photo a picture value holds, if it holds one. */
const photoIdOf = (value: FormValue | undefined): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);
/** The photos a row of a table holds, in its picture columns. */
const photoIdsOf = (group: RowGroupDef, row: Record<string, FormValue> | undefined): string[] =>
  group.columns.flatMap((c) => (c.kind === 'picture' ? [photoIdOf(row?.[c.id])] : [])).filter((id): id is string => id !== undefined);

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
const withValues = (f: (values: DraftValues) => DraftValues) => (current: FillState): FillState => ({ ...current, values: f(current.values) });

export function FillQuestions(p: FillQuestionsProps) {
  const { template, engine, state, change, crew, clockChanges, date, shipToday, last } = p;
  const { schema, setup } = template;
  const [picking, setPicking] = useState<RowGroupDef>();
  const [replacing, setReplacing] = useState<{ button: AllOkButton; differing: number }>();
  const [allDays, setAllDays] = useState<ReadonlySet<string>>(new Set());

  /** Which helper is on for what, and what each one needs from the engine, worked out once for the form's setup. */
  const index = useMemo(() => {
    const on = setup.helpers;
    const groups = new Map(schema.rowGroups.map((g) => [g.id, g]));
    const limits = new Map<string, Map<string, { low?: number; high?: number }>>();
    for (const id of on.thresholds) {
      const group = groups.get(id);
      if (group) limits.set(id, new Map(engine.thresholdsOf(group).map((t) => [t.column, t])));
    }
    const remarks = new Map<string, NonNullable<ReturnType<typeof remarksRule>>>();
    for (const id of on.allOk) {
      const group = groups.get(id);
      const rule = group && remarksRule(group, engine.allOkValues(group, setup.okWord));
      if (rule) remarks.set(id, rule);
    }
    return {
      now: new Set(on.now),
      pickCrew: new Set(on.pickCrew),
      todayRow: new Set(on.todayRow),
      last: new Set(on.startFromLast),
      jobLog: new Set(on.jobLog.filter((id) => { const g = groups.get(id); return g !== undefined && engine.isJobLogGroup(g); })),
      buttons: new Map(allOkButtons(schema, setup, engine.allOkValues).map((b) => [b.section, b])),
      limits,
      remarks,
    };
  }, [schema, setup, engine]);

  const onboard = useMemo(() => onboardAt(crew, date), [crew, date]);
  const names = useMemo(() => onboard.map(fullName), [onboard]);

  /** What `Now` puts in a field: the ship's time, or UTC for a time written in UTC. */
  const nowText = (field: FieldDef): string => {
    const at = new Date();
    return engine.nowValue(at, nowOffset(field, clockChanges, at));
  };

  function allOk(button: AllOkButton): void {
    const plan = applyAllOk(state.values, schema, button, setup.okWord, engine.allOkValues, false);
    change((current) => {
      const done = applyAllOk(current.values, schema, button, setup.okWord, engine.allOkValues, false);
      return { values: done.values, autoIds: current.autoIds.filter((id) => !done.set.includes(id)) };
    });
    if (plan.differing > 0) setReplacing({ button, differing: plan.differing });
  }

  function replaceAll(button: AllOkButton): void {
    setReplacing(undefined);
    change((current) => {
      const done = applyAllOk(current.values, schema, button, setup.okWord, engine.allOkValues, true);
      return { values: done.values, autoIds: current.autoIds.filter((id) => !done.set.includes(id)) };
    });
  }

  function addCrew(group: RowGroupDef, chosen: CrewMember[]): void {
    setPicking(undefined);
    const rows = engine.crewRows(group, chosen);
    const limit = rowLimit(group, template.kind);
    const { placed } = placeRows(state.values, group, rows, limit);
    change(withValues((v) => placeRows(v, group, rows, limit).values));
    if (placed < rows.length) p.notify(`Added ${placed} of ${rows.length}: this form has room for ${limit} rows only.`);
  }

  const extrasFor = (group: RowGroupDef): RowExtras | undefined => {
    const limits = index.limits.get(group.id);
    const jobs = index.jobLog.has(group.id) ? engine.jobLogColumns(group) : undefined;
    const today = index.todayRow.has(group.id) ? engine.todayRowIndex(group, date) : -1;
    const remarks = index.remarks.get(group.id);
    const lastOn = index.last.has(group.id);
    const nowColumns = new Set(group.columns.filter((c) => index.now.has(c.id)).map((c) => c.id));
    const extras: RowExtras = {
      nowColumns: nowColumns.size > 0 ? nowColumns : undefined,
      onNow: (i, column) => change(withValues((v) => setCell(v, group, i, column.id, nowText(column)))),
      // Only once the reading was left, so that `1` on the way to `19.8` is not announced; it stays while the reading is out of range.
      warningFor: limits ? (i, column, value) => {
        const t = limits.get(column.id);
        return t && p.isTouched(cellKey(group.id, i, column.id)) ? readingWarning(column.label, value, t, engine.checkReading) : undefined;
      } : undefined,
      photos: hasPictures(group) ? {
        busy: p.photoBusy,
        errorFor: (i, column) => (p.photoNotice?.key === cellKey(group.id, i, column.id) ? p.photoNotice.text : undefined),
        onFile: (i, column, file) => {
          const old = state.values.rows[group.id]?.[i]?.[column.id];
          p.onPhoto(file, cellKey(group.id, i, column.id), (photoId) => withValues((v) => setCell(v, group, i, column.id, photoId)), photoIdOf(old));
        },
        onRemove: (i, column) => {
          const old = state.values.rows[group.id]?.[i]?.[column.id];
          change(withValues((v) => setCell(v, group, i, column.id, null)));
          p.onDrop(photoIdOf(old) ? [photoIdOf(old)!] : []);
        },
      } : undefined,
      lastFor: lastOn ? (i, column, value) => lastShown(value, lastText(last?.rows[group.id]?.[i]?.[column.id])) : undefined,
      // A job's Responsible is one of the people onboard.
      choicesFor: jobs && names.length > 0 ? (column) => (column.kind === 'text' && normaliseLabel(column.label) === 'responsible' ? names : undefined) : undefined,
      remarks,
      today: today >= 0 ? { row: today, all: allDays.has(group.id) || p.revealAll, onToggle: () => setAllDays((cur) => {
        const next = new Set(cur);
        if (!next.delete(group.id)) next.add(group.id);
        return next;
      }) } : undefined,
      addLabel: jobs ? 'Add job' : undefined,
      onAddCrew: index.pickCrew.has(group.id) ? () => setPicking(group) : undefined,
    };
    return extras;
  };

  const renderField = (field: FieldDef): ComponentChildren => {
    const { id } = field;
    const value = shownValue(state.values, id);
    if (field.kind === 'picture') {
      return (
        <PhotoField
          key={id} field={field} value={value} busy={p.photoBusy} error={p.photoNotice?.key === id ? p.photoNotice.text : undefined}
          onFile={(file) => p.onPhoto(file, id, (photoId) => (current) => editField(current, id, photoId), photoIdOf(value))}
          onRemove={() => {
            change((current) => editField(current, id, null));
            p.onDrop(photoIdOf(value) ? [photoIdOf(value)!] : []);
          }}
        />
      );
    }
    const lastOn = field.block !== undefined && index.last.has(field.block);
    return (
      <FormField
        key={id} field={field} value={value} auto={state.autoIds.includes(id)} dataKey={id}
        note={value === null || value === '' ? p.noteFor(id) : undefined} error={p.shown(id)}
        onChange={(next) => change((current) => editField(current, id, next))} onLeave={() => p.touch(id)}
        onNow={index.now.has(id) ? () => change((current) => editField(current, id, nowText(field))) : undefined}
        last={lastOn ? lastShown(value, lastText(last?.fields[id])) : undefined}
      />
    );
  };

  const renderGroup = (group: RowGroupDef, sectionTitle: string): ComponentChildren => {
    const rows = state.values.rows[group.id] ?? [];
    const showLabel = !sameName(group.label, sectionTitle);
    if (hasPictures(group) && isPhotoTable(group)) {
      const limit = rowLimit(group, template.kind);
      return (
        <PhotoGroup
          key={group.id} group={group} rows={rows} showLabel={showLabel} busy={p.photoBusy}
          error={p.photoNotice?.key === group.id ? p.photoNotice.text : undefined}
          onFile={(file) => {
            if (nextFreeSlot(group, rows, limit) === undefined) {
              p.notify('There is no room for more photos in this form.');
              return;
            }
            p.onPhoto(file, group.id, (photoId) => withValues((v) => {
              const free = nextFreeSlot(group, v.rows[group.id] ?? [], limit);
              return free ? setCell(v, group, free.row, free.slot.picture.id, photoId) : v;
            }));
          }}
          onCells={(i, patch) => {
            change(withValues((v) => Object.entries(patch).reduce((acc, [column, value]) => setCell(acc, group, i, column, value), v)));
            p.onDrop(photoIdsOf(group, rows[i]));
          }}
          onCell={(i, column, value) => change(withValues((v) => setCell(v, group, i, column, value)))}
          onLeave={(i, column) => p.touch(cellKey(group.id, i, column))}
          keyFor={(i, column) => cellKey(group.id, i, column)}
        />
      );
    }
    const jobs = index.jobLog.has(group.id) ? engine.jobLogColumns(group) : undefined;
    return (
      <RowGroup
        key={group.id} group={group} kind={template.kind} rows={rows} showLabel={showLabel} extras={extrasFor(group)}
        onCell={(i, column, next) => change(withValues((v) => setCell(v, group, i, column, next)))}
        onAdd={() => change(withValues((v) => addRow(v, group.id, jobs ? newJobRow(jobs, shipToday, setup.notFinished) : {})))}
        onRemove={(i) => {
          change(withValues((v) => removeRow(v, group.id, i)));
          p.onDrop(photoIdsOf(group, rows[i]));
        }}
        errorFor={(i, column) => p.shown(cellKey(group.id, i, column))}
        onLeave={(i, column) => p.touch(cellKey(group.id, i, column))}
        keyFor={(i, column) => cellKey(group.id, i, column)}
      />
    );
  };

  return (
    <>
      {p.sections.map((section) => {
        const button = index.buttons.get(section.title);
        return (
          <FillSectionBlock key={section.title} title={section.title}>
            {button && (
              <div class="fill-helpers">
                <button type="button" class="btn btn-outline btn-small" onClick={() => allOk(button)}>{button.label}</button>
              </div>
            )}
            {section.items.map((item) => {
              if (item.kind === 'field') return renderField(item.field);
              if (item.kind === 'group') return renderGroup(item.group, section.title);
              return <MatrixBlock key={item.block} title={item.title}>{item.fields.map(renderField)}</MatrixBlock>;
            })}
          </FillSectionBlock>
        );
      })}

      {picking && (
        <CrewPicker people={onboard} date={date} onCancel={() => setPicking(undefined)} onAdd={(chosen) => addCrew(picking, chosen)} />
      )}
      {replacing && (
        <ConfirmDialog
          title="Replace answers already given?" confirmLabel="Replace" onCancel={() => setReplacing(undefined)}
          onConfirm={() => replaceAll(replacing.button)}
          body={(
            <p>
              The empty answers are set. {replacing.differing} other {replacing.differing === 1 ? 'answer' : 'answers'} already given
              would be changed by {replacing.button.label}.
            </p>
          )}
        />
      )}
    </>
  );
}

/** The fields of one Excel matrix under their heading (R14). */
function MatrixBlock({ title, children }: { title: string; children: ComponentChildren }) {
  const id = useId();
  return (
    <div class="fill-group" role="group" aria-labelledby={id}>
      <h4 id={id}>{title}</h4>
      {children}
    </div>
  );
}

