import { useEffect, useId, useState } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { fromBase64 } from '../../backup/crypto';
import { isOpenCell } from '../../forms/cells';
import type { FieldDef, FormValue, RowGroupDef } from '../../forms/types';
import { rowTitle, visibleColumns } from '../formFill';
import { photoSlots } from '../formHelpers';
import type { PhotoSlot } from '../formHelpers';
import { FormField } from './FormField';

/*
 * Photos in a form (spec §7, job log): a picture column holds the id of a photo kept with the draft (`addPhoto`), and
 * the `Photo` choice next to it says Before or After. `Add photo` opens the phone's camera (a file input that takes a
 * picture); the screen downsizes the picture and stores it, and these components show what is there: a small thumbnail
 * (read from the draft's photos through an object URL, which is revoked when it is no longer shown), the choice, and
 * `Remove photo`.
 */

const blank = (v: FormValue | undefined): boolean => v === undefined || v === null || v === '';

/** A thumbnail of a stored photo. The picture is read from the database once, and its object URL is revoked on the way out. */
export function PhotoThumb({ photoId }: { photoId: string }) {
  const { db } = useAppState();
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let gone = false;
    let made: string | undefined;
    db.formPhotos.get(photoId).then((photo) => {
      if (gone || !photo || photo.deleted || photo.jpegBase64 === '') return;
      made = URL.createObjectURL(new Blob([fromBase64(photo.jpegBase64) as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }));
      setUrl(made);
    }, () => undefined);
    return () => {
      gone = true;
      if (made !== undefined) URL.revokeObjectURL(made);
    };
  }, [db, photoId]);
  return url === undefined ? <p class="helper-text">Photo saved.</p> : <img class="photo-thumb" src={url} alt="Photo" />;
}

/** The `Add photo` button: a label on a file input, so that a tap opens the camera (or the gallery where there is no camera). */
export function AddPhoto({ label = 'Add photo', busy, onFile }: { label?: string; busy: boolean; onFile: (file: File) => void }) {
  const id = useId();
  return (
    <>
      <input
        id={id} type="file" class="file-input" accept="image/*" capture="environment" disabled={busy}
        onChange={(event) => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          input.value = ''; // the same picture can be chosen again
          if (file && !busy) onFile(file);
        }}
      />
      <label for={id} class="btn btn-outline btn-small">{label}</label>
    </>
  );
}

export interface PhotoGroupProps {
  group: RowGroupDef;
  rows: Record<string, FormValue>[];
  showLabel: boolean;
  /** A photo is being added: another cannot be started. */
  busy: boolean;
  /** Why the last photo could not be added. */
  error?: string;
  onFile: (file: File) => void;
  /** Sets cells of a row together (removing a photo clears its picture and its choice). */
  onCells: (index: number, patch: Record<string, FormValue>) => void;
  onCell: (index: number, columnId: string, value: FormValue) => void;
  onLeave: (index: number, columnId: string) => void;
  keyFor: (index: number, columnId: string) => string;
}

/** Whether a table is only photos: picture columns, each with at most the choice next to it. */
export function isPhotoTable(group: RowGroupDef): boolean {
  const slots = photoSlots(group);
  const choices = new Set(slots.flatMap((s) => (s.choice ? [s.choice.id] : [])));
  return slots.length > 0 && visibleColumns(group).every((c) => choices.has(c.id));
}

/** A table of photos: the photos taken, each with its thumbnail and its Before / After choice, and `Add photo`. */
export function PhotoGroup({ group, rows, showLabel, busy, error, onFile, onCells, onCell, onLeave, keyFor }: PhotoGroupProps) {
  const headingId = useId();
  const slots = photoSlots(group);
  // A picture cell that continues a vertical merge (R22) is not on the form: it is neither shown nor offered.
  const shown = (index: number): PhotoSlot[] => slots.filter((s) => isOpenCell(group, index, s.picture.id) && !blank(rows[index]?.[s.picture.id]));
  const used = rows.flatMap((_, index) => (shown(index).length > 0 ? [index] : []));
  return (
    <div class="fill-group" aria-labelledby={showLabel ? headingId : undefined} role={showLabel ? 'group' : undefined}>
      {showLabel && <h4 id={headingId}>{group.label}</h4>}
      {used.length === 0 && <p class="empty">No photos yet.</p>}
      {used.map((index) => (
        <fieldset key={index} class="fill-row" data-row={index}>
          <legend>{rowTitle(group, index)}</legend>
          {shown(index).map((slot) => {
            const photoId = rows[index][slot.picture.id] as string;
            const choice = slot.choice as FieldDef | undefined;
            return (
              <div key={slot.picture.id} class="fill-field">
                <PhotoThumb photoId={photoId} />
                {choice && (
                  <FormField
                    field={choice} value={rows[index][choice.id] ?? null} dataKey={keyFor(index, choice.id)}
                    onChange={(value) => onCell(index, choice.id, value)} onLeave={() => onLeave(index, choice.id)}
                  />
                )}
                <div class="fill-row-actions">
                  <button
                    type="button" class="btn btn-outline btn-small"
                    onClick={() => onCells(index, { [slot.picture.id]: null, ...(choice ? { [choice.id]: null } : {}) })}
                  >
                    Remove photo
                  </button>
                </div>
              </div>
            );
          })}
        </fieldset>
      ))}
      {error && <p class="field-error" role="alert">{error}</p>}
      <div class="fill-row-actions"><AddPhoto busy={busy} onFile={onFile} /></div>
    </div>
  );
}

export interface PhotoFieldProps {
  field: FieldDef;
  /** The id of the photo, if there is one. */
  value: FormValue;
  busy: boolean;
  error?: string;
  onFile: (file: File) => void;
  onRemove: () => void;
}

/** A picture field of its own (outside a table): its photo, and `Add photo` or `Replace photo`. */
export function PhotoField({ field, value, busy, error, onFile, onRemove }: PhotoFieldProps) {
  const has = typeof value === 'string' && value !== '';
  return (
    <div class="field fill-field">
      <div class="field-head"><span class="field-label">{field.label}</span></div>
      {has && <PhotoThumb photoId={value} />}
      {error && <p class="field-error" role="alert">{error}</p>}
      <div class="fill-row-actions">
        <AddPhoto label={has ? 'Replace photo' : 'Add photo'} busy={busy} onFile={onFile} />
        {has && <button type="button" class="btn btn-outline btn-small" onClick={onRemove}>Remove photo</button>}
      </div>
    </div>
  );
}
