// The forms engine is only ever imported for its types here: `src/db` is in the main bundle, the engine is loaded on demand.
import { fromBase64, toBase64 } from '../backup/crypto';
import type { BaseRecord, FormDraft, FormLastValues, FormPhoto, FormTemplate } from '../domain/types';
import type { DraftValues, FormKind, FormSchema, FormSetup } from '../forms/types';
import { createRecord, tombstoneOf, updateRecord } from './records';
import type { MasterpieceDB } from './schema';
import { getSettings } from './settings';
import { guardWrite } from './storage';

/*
 * The forms' data: the library of templates (personal, not tied to a ship), and for each ship its drafts, the values of
 * the last file made from each form, and the photos of the open drafts. Binary data is kept as standard base64 text
 * (`fileBase64`, `jpegBase64`), so that it goes through JSON backups as it is.
 *
 * Every write goes through `guardWrite` (a full disk is a `StorageFullError`), and every write of more than one record
 * is one transaction: if one record cannot be written, none is.
 */

const EMPTY_VALUES: DraftValues = { fields: {}, rows: {} };

/** What `saveTemplate` stores: the file as it was imported, what detection found in it, and the setup chosen for it. */
export interface TemplateInput { fileName: string; bytes: Uint8Array; kind: FormKind; schema: FormSchema; setup: FormSetup }

/** Newest first: the one changed last, then the one created last, then by id, so the order never depends on the table's. */
function newestFirst<T extends BaseRecord>(a: T, b: T): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function newest<T extends BaseRecord>(records: T[]): T | undefined {
  return [...records].sort(newestFirst)[0];
}

/** The stamp of a change made now on this device. */
async function stampNow(db: MasterpieceDB): Promise<Pick<BaseRecord, 'updatedAt' | 'updatedBy'>> {
  const { deviceId } = await getSettings(db);
  return { updatedAt: new Date().toISOString(), updatedBy: deviceId };
}

/** Adds a form to the library. Its code, title and revision are the schema's identity. */
export function saveTemplate(db: MasterpieceDB, input: TemplateInput): Promise<FormTemplate> {
  const { code, title, revision } = input.schema.identity;
  return createRecord<FormTemplate>(db, 'formTemplates', {
    code, title, revision, kind: input.kind, fileName: input.fileName, fileBase64: toBase64(input.bytes), schema: input.schema,
    setup: input.setup,
  }, { scope: 'personal' });
}

/** The forms in the library that are not deleted, in no particular order. */
export function listTemplates(db: MasterpieceDB): Promise<FormTemplate[]> {
  return db.formTemplates.filter((t) => !t.deleted).toArray();
}

/**
 * The ship's live drafts of `template`. A draft belongs to the template by its `templateId`. A draft handed over from a
 * device with its own copy of the form names a template that is not here; it then belongs to the template here with the
 * same code (as the Forms screen lists it). A form without a code is never matched by code: an empty code says nothing.
 */
async function liveDraftsOf(db: MasterpieceDB, shipId: string, template: FormTemplate): Promise<FormDraft[]> {
  const drafts = await db.formDrafts.where('shipId').equals(shipId).filter((d) => !d.deleted).toArray();
  const byCode = template.code === '' ? [] : drafts.filter((d) => d.templateId !== template.id && d.code === template.code);
  const known = new Set((await db.formTemplates.bulkGet(byCode.map((d) => d.templateId))).flatMap((t) => (t && !t.deleted ? [t.id] : [])));
  return drafts.filter((d) => d.templateId === template.id || (byCode.includes(d) && !known.has(d.templateId)));
}

/**
 * The ship's draft of `template`: the live one there is (the newest, if a merge of two devices left two), or a new, empty
 * one for `period`. There is one live draft per template and ship; looking and creating are one transaction, so two
 * calls at once still make only one.
 */
export function openDraft(db: MasterpieceDB, shipId: string, template: FormTemplate, period: string): Promise<FormDraft> {
  return guardWrite(() =>
    // `settings` is in the scope because `createRecord` reads the device id from it.
    db.transaction('rw', [db.formDrafts, db.formTemplates, db.settings], async () => {
      const found = newest(await liveDraftsOf(db, shipId, template));
      if (found) return found;
      return createRecord<FormDraft>(db, 'formDrafts', {
        shipId, templateId: template.id, code: template.code, period, values: EMPTY_VALUES, photoIds: [],
      });
    }),
  );
}

/** Saves the values of a live draft, stamped as changed now. A closed or discarded draft is refused. */
export async function saveDraftValues(db: MasterpieceDB, draftId: string, values: DraftValues): Promise<FormDraft> {
  return updateRecord<FormDraft>(db, 'formDrafts', draftId, { values });
}

/** The draft, which must exist, be live and be the ship's when `shipId` is given. Throws otherwise. */
async function liveDraft(db: MasterpieceDB, draftId: string, shipId?: string): Promise<FormDraft> {
  const draft = await db.formDrafts.get(draftId);
  if (!draft) throw new Error(`There is no form draft with id ${draftId}.`);
  if (draft.deleted) throw new Error(`The form draft is closed: ${draftId}`);
  if (shipId !== undefined && draft.shipId !== shipId) throw new Error(`The form draft ${draftId} is not the ship's.`);
  return draft;
}

/**
 * Stores a photo (JPEG, already downsized) for a live draft of the ship and adds it to the draft's `photoIds`, in one
 * transaction. A draft that is closed, missing or another ship's is refused, and nothing is written.
 */
export function addPhoto(
  db: MasterpieceDB, shipId: string, draftId: string, jpeg: Uint8Array, width: number, height: number,
): Promise<FormPhoto> {
  const jpegBase64 = toBase64(jpeg);
  return guardWrite(() =>
    db.transaction('rw', [db.formDrafts, db.formPhotos, db.settings], async () => {
      const draft = await liveDraft(db, draftId, shipId);
      const photo = await createRecord<FormPhoto>(db, 'formPhotos', { shipId, draftId, jpegBase64, width, height });
      await db.formDrafts.put({ ...draft, photoIds: [...draft.photoIds, photo.id], ...(await stampNow(db)) });
      return photo;
    }),
  );
}

/** The draft's live photos, by id, as JPEG bytes. */
export async function photosFor(db: MasterpieceDB, draftId: string): Promise<Record<string, Uint8Array>> {
  const photos = await db.formPhotos.where('draftId').equals(draftId).filter((p) => !p.deleted).toArray();
  return Object.fromEntries(photos.map((p) => [p.id, fromBase64(p.jpegBase64)]));
}

/**
 * What a form's last values are kept under (`FormLastValues.code`): the form's code, so that they still match on a device
 * with its own copy of the form, or `template:<templateId>` for a form without a code, so that two such forms never mix.
 */
export function lastValuesKey(code: string, templateId: string): string {
  return code === '' ? `template:${templateId}` : code;
}

/** The ship's live last-values records kept under `key` (see `lastValuesKey`). */
function liveLastValues(db: MasterpieceDB, shipId: string, key: string): Promise<FormLastValues[]> {
  return db.formLastValues.where('shipId').equals(shipId).filter((r) => !r.deleted && r.code === key).toArray();
}

/**
 * The values of the last file made from `template` on the ship: the newest live record under its key (see
 * `lastValuesKey`; a merge of two devices can leave two), or undefined.
 */
export async function lastValuesFor(
  db: MasterpieceDB, shipId: string, template: Pick<FormTemplate, 'id' | 'code'>,
): Promise<FormLastValues | undefined> {
  return newest(await liveLastValues(db, shipId, lastValuesKey(template.code, template.id)));
}

/** Tombstones the draft (unless it already is one) and its live photos, whose image is not kept. Inside a transaction. */
async function deleteDraftAndPhotos(db: MasterpieceDB, draft: FormDraft, stamp: Pick<BaseRecord, 'updatedAt' | 'updatedBy'>): Promise<void> {
  if (!draft.deleted) await db.formDrafts.put(tombstoneOf('formDrafts', draft, stamp));
  const photos = await db.formPhotos.where('draftId').equals(draft.id).filter((p) => !p.deleted).toArray();
  await db.formPhotos.bulkPut(photos.map((p) => tombstoneOf('formPhotos', p, stamp)));
}

/**
 * Closes a draft once its file is made, in one transaction: if any write fails, nothing is written.
 * - The ship's last values of the form, under its `lastValuesKey`, become `values`. The newest live record is updated
 *   (and one a merge left beside it is deleted), else one is created.
 * - The draft is soft-deleted, and so are its photos, whose tombstones keep no image.
 * - With `rollover`, the next draft of the same form and ship is started, for `rollover.period` with `rollover.values`
 *   (the jobs that are not finished, say), and no photos.
 * A draft that is closed already, or missing, is refused.
 */
export async function closeDraft(
  db: MasterpieceDB, draftId: string, values: DraftValues, rollover?: { period: string; values: DraftValues },
): Promise<void> {
  await guardWrite(() =>
    db.transaction('rw', [db.formDrafts, db.formPhotos, db.formLastValues, db.settings], async () => {
      const draft = await liveDraft(db, draftId);
      const stamp = await stampNow(db);
      const key = lastValuesKey(draft.code, draft.templateId);
      const [current, ...others] = (await liveLastValues(db, draft.shipId, key)).sort(newestFirst);
      if (current) await db.formLastValues.put({ ...current, values, ...stamp });
      else await createRecord<FormLastValues>(db, 'formLastValues', { shipId: draft.shipId, code: key, values });
      await db.formLastValues.bulkPut(others.map((r) => tombstoneOf('formLastValues', r, stamp)));
      await deleteDraftAndPhotos(db, draft, stamp);
      if (rollover) {
        await createRecord<FormDraft>(db, 'formDrafts', {
          shipId: draft.shipId, templateId: draft.templateId, code: draft.code, period: rollover.period, values: rollover.values,
          photoIds: [],
        });
      }
    }),
  );
}

/**
 * Throws a draft away: the draft and its photos are soft-deleted, in one transaction, and no last values are kept. A
 * draft discarded already keeps its deletion time. A missing draft is refused.
 */
export async function discardDraft(db: MasterpieceDB, draftId: string): Promise<void> {
  await guardWrite(() =>
    db.transaction('rw', [db.formDrafts, db.formPhotos, db.settings], async () => {
      const draft = await db.formDrafts.get(draftId);
      if (!draft) throw new Error(`There is no form draft with id ${draftId}.`);
      await deleteDraftAndPhotos(db, draft, await stampNow(db));
    }),
  );
}

/** What `replaceTemplate` did. */
export interface RevisionResult {
  /** The template as it is now: the same id, with the new revision's file, identity, schema and the carried-over setup. */
  template: FormTemplate;
  /** The new fields nothing was linked to, by label, for the setup screen's `New fields to check: <labels>`. */
  unmatched: string[];
  /** The old fields nothing was linked to, by label: what the form no longer asks for. */
  removed: string[];
  /** How many values in the open drafts (every ship's) could not be carried over. */
  droppedFromDrafts: number;
  /** How many of the last values (every ship's) could not be carried over. */
  droppedFromLastValues: number;
}

/** Whether two records hold the same data (the same JSON). */
function sameData(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Replaces a form in the library by its new revision (spec §4 step 5), keeping its id: the file, its name and kind, the
 * code, title and revision, and the schema become the new file's. The old fields are linked to the new ones
 * (`mapRevision`), and through that link, in one transaction (all or nothing):
 * - the setup is carried over (`migrateSetup`);
 * - every live draft of the template, of every ship, moves to the new ids (`migrateValues`), and takes the new code;
 * - so do the last values kept under the form's key (`lastValuesKey`), of every ship, under the new key if it changed.
 * What cannot be carried over is counted. A picture field that is gone loses its value (the photo's id), but the photo
 * stays with its draft until the draft is closed, as every photo does. A draft or last-values record that nothing
 * changed is not written.
 *
 * `oldId` names the template to replace: after a handover two live templates can share a code, and the caller chooses.
 * Templates are never merged here. Refused, with nothing written: a missing or deleted template; a new file whose code
 * is not the old one's (a form without a code can take one); a `kind` that is not the schema's.
 */
export async function replaceTemplate(db: MasterpieceDB, oldId: string, input: Omit<TemplateInput, 'setup'>): Promise<RevisionResult> {
  // The forms engine is loaded on demand, outside the main bundle; and a transaction must not wait for anything but the
  // database. So the module is loaded, and the file encoded, before the transaction starts.
  const { mapRevision, migrateSetup, migrateValues } = await import('../forms/revision');
  const fileBase64 = toBase64(input.bytes);
  const { code, title, revision } = input.schema.identity;
  return guardWrite(() =>
    db.transaction('rw', [db.formTemplates, db.formDrafts, db.formLastValues, db.settings], async () => {
      const old = await db.formTemplates.get(oldId);
      if (!old) throw new Error(`There is no form template with id ${oldId}.`);
      if (old.deleted) throw new Error(`The form template is deleted: ${oldId}`);
      // A new revision is the same form: the caller found it by its code. A different code is another form.
      if (input.kind !== input.schema.kind) throw new Error(`The file is a ${input.kind}, but its schema says ${input.schema.kind}.`);
      if (old.code !== '' && code !== old.code) throw new Error(`Form ${code || '(no code)'} is not a revision of form ${old.code}.`);
      const { map, unmatched, removed } = mapRevision(old.schema, input.schema);
      const schemas = { from: old.schema, to: input.schema };
      const stamp = await stampNow(db);

      let droppedFromDrafts = 0;
      const drafts = await db.formDrafts.where('templateId').equals(oldId).filter((d) => !d.deleted).toArray();
      const movedDrafts = drafts.flatMap((draft) => {
        const { values, dropped } = migrateValues(draft.values, map, schemas);
        droppedFromDrafts += dropped.length;
        return sameData([draft.values, draft.code], [values, code]) ? [] : [{ ...draft, code, values, ...stamp }];
      });
      await db.formDrafts.bulkPut(movedDrafts);

      let droppedFromLastValues = 0;
      const key = lastValuesKey(code, oldId);
      const lasts = await db.formLastValues.where('code').equals(lastValuesKey(old.code, oldId)).filter((r) => !r.deleted).toArray();
      const movedLasts = lasts.flatMap((last) => {
        const { values, dropped } = migrateValues(last.values, map, schemas);
        droppedFromLastValues += dropped.length;
        return sameData([last.values, last.code], [values, key]) ? [] : [{ ...last, code: key, values, ...stamp }];
      });
      await db.formLastValues.bulkPut(movedLasts);

      const template: FormTemplate = {
        ...old, code, title, revision, kind: input.kind, fileName: input.fileName, fileBase64, schema: input.schema,
        setup: migrateSetup(old.setup, map, input.schema), ...stamp,
      };
      await db.formTemplates.put(template);
      return { template, unmatched, removed, droppedFromDrafts, droppedFromLastValues };
    }),
  );
}
