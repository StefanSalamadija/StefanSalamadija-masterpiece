import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftValues, FormSchema, FormSetup } from '../forms/types';
import type { FormDraft, FormLastValues, FormPhoto, FormTemplate } from '../domain/types';
import {
  addPhoto, closeDraft, discardDraft, lastValuesFor, listTemplates, openDraft, photosFor, saveDraftValues, saveTemplate,
} from './forms';
import { allTables, createRecord, softDelete } from './records';
import { openDb } from './schema';
import type { MasterpieceDB } from './schema';
import { getSettings } from './settings';
import { StorageFullError } from './storage';

// Invented forms only: no company form, code or wording is used in tests.
const schema = (code: string, title = 'Toolbox Talk', revision = '00 / 01.01.2026'): FormSchema => ({
  kind: 'docx',
  identity: { code, title, revision },
  fields: [{ id: 'f1', kind: 'text', label: 'Vessel', section: '', loc: 'word/document.xml#0/1', confidence: 'high' }],
  rowGroups: [],
  unsupported: [],
});

const setup: FormSetup = {
  links: { f1: { source: 'vessel.name' } },
  leftEmpty: [],
  helpers: { pickCrew: [], allOk: [], todayRow: [], startFromLast: [], jobLog: [], thresholds: [], now: [] },
  okWord: 'Satisfactory',
  notFinished: 'Pending',
};

/** Every byte value, and more than one chunk of the base64 encoder, so that nothing is lost on the way in or out. */
function sampleBytes(length = 70_000): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (i * 31 + 7) % 256;
  return bytes;
}

const values = (vessel: string): DraftValues => ({ fields: { f1: vessel }, rows: {} });

function freshDb(): MasterpieceDB {
  return openDb('t-' + crypto.randomUUID());
}

/** Moves the clock, so that "the newest" never depends on how fast a test runs. */
function at(iso: string): void {
  vi.setSystemTime(new Date(iso));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); // fake-indexeddb needs the real timers
  at('2026-10-28T08:00:00.000Z');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function withTemplate(code = 'TST-01') {
  const db = freshDb();
  const template = await saveTemplate(db, { fileName: 'toolbox.docx', bytes: sampleBytes(), kind: 'docx', schema: schema(code), setup });
  return { db, template };
}

describe('createRecord', () => {
  it('writes on the ship side unless told otherwise, and on the personal side when asked', async () => {
    const db = freshDb();
    const draft = await createRecord<FormLastValues>(db, 'formLastValues', { shipId: 's1', code: 'TST-01', values: values('A') });
    expect(draft.scope).toBe('ship');
    const mine = await createRecord<FormLastValues>(db, 'formLastValues', { shipId: 's1', code: 'TST-01', values: values('A') }, { scope: 'personal' });
    expect(mine.scope).toBe('personal');
    expect((await db.formLastValues.get(mine.id))?.scope).toBe('personal');
  });
});

describe('softDelete of a photo', () => {
  it('leaves a tombstone without the image', async () => {
    const db = freshDb();
    const photo = await createRecord<FormPhoto>(db, 'formPhotos', { shipId: 's1', draftId: 'd1', jpegBase64: 'AAEC', width: 2, height: 1 });
    await softDelete(db, 'formPhotos', photo.id);
    expect(await db.formPhotos.get(photo.id)).toMatchObject({ deleted: true, jpegBase64: '', width: 2, height: 1, draftId: 'd1' });
  });
});

describe('saveTemplate and listTemplates', () => {
  it('stores the file as base64 on the personal side, named by the form, with no ship', async () => {
    const { db, template } = await withTemplate();
    const { deviceId } = await getSettings(db);
    expect(template).toMatchObject({
      scope: 'personal', deleted: false, updatedBy: deviceId, createdAt: '2026-10-28T08:00:00.000Z',
      code: 'TST-01', title: 'Toolbox Talk', revision: '00 / 01.01.2026', kind: 'docx', fileName: 'toolbox.docx',
      schema: schema('TST-01'), setup,
    });
    expect(template).not.toHaveProperty('shipId');
    expect(typeof template.fileBase64).toBe('string');
    expect(await db.formTemplates.get(template.id)).toEqual(template);
  });

  it('keeps every byte of the file', async () => {
    const { db, template } = await withTemplate();
    const stored = (await db.formTemplates.get(template.id)) as FormTemplate;
    const decoded = Uint8Array.from(atob(stored.fileBase64), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(sampleBytes());
  });

  it('lists the live templates only', async () => {
    const { db, template } = await withTemplate();
    const other = await saveTemplate(db, { fileName: 'b.xlsx', bytes: sampleBytes(10), kind: 'xlsx', schema: schema('TST-02', 'Inventory'), setup });
    await softDelete(db, 'formTemplates', other.id);
    expect((await listTemplates(db)).map((t) => t.id)).toEqual([template.id]);
  });

  it('reports a full disk as such', async () => {
    const db = freshDb();
    await getSettings(db);
    vi.spyOn(db.formTemplates, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    await expect(saveTemplate(db, { fileName: 'a.docx', bytes: sampleBytes(10), kind: 'docx', schema: schema('X'), setup }))
      .rejects.toBeInstanceOf(StorageFullError);
    expect(await db.formTemplates.count()).toBe(0);
  });
});

describe('openDraft', () => {
  it('creates an empty draft for the ship and the period the first time', async () => {
    const { db, template } = await withTemplate();
    const draft = await openDraft(db, 'ship-1', template, '2026-10-28');
    expect(draft).toMatchObject({
      scope: 'ship', deleted: false, shipId: 'ship-1', templateId: template.id, code: 'TST-01', period: '2026-10-28',
      values: { fields: {}, rows: {} }, photoIds: [],
    });
    expect(await db.formDrafts.get(draft.id)).toEqual(draft);
  });

  it('keeps one live draft per template and ship: opening again gives the same draft, whatever the period', async () => {
    const { db, template } = await withTemplate();
    const first = await openDraft(db, 'ship-1', template, '2026-10-28');
    const again = await openDraft(db, 'ship-1', template, '2026-10-29');
    expect(again).toEqual(first);
    expect(await db.formDrafts.count()).toBe(1);
  });

  it('gives each ship its own draft, and each template its own', async () => {
    const { db, template } = await withTemplate();
    const other = await saveTemplate(db, { fileName: 'b.docx', bytes: sampleBytes(10), kind: 'docx', schema: schema('TST-02'), setup });
    const mine = await openDraft(db, 'ship-1', template, '2026-10-28');
    const theirs = await openDraft(db, 'ship-2', template, '2026-10-28');
    const otherForm = await openDraft(db, 'ship-1', other, '2026-10-28');
    expect(new Set([mine.id, theirs.id, otherForm.id]).size).toBe(3);
    expect(theirs.shipId).toBe('ship-2');
    expect(otherForm.templateId).toBe(other.id);
  });

  it('opens two drafts at once as one: both calls get the same draft', async () => {
    const { db, template } = await withTemplate();
    const [a, b] = await Promise.all([openDraft(db, 'ship-1', template, '2026-10-28'), openDraft(db, 'ship-1', template, '2026-10-28')]);
    expect(a.id).toBe(b.id);
    expect(await db.formDrafts.count()).toBe(1);
  });

  it('starts a new draft once the last one is closed or discarded', async () => {
    const { db, template } = await withTemplate();
    const first = await openDraft(db, 'ship-1', template, '2026-10-28');
    await discardDraft(db, first.id);
    const second = await openDraft(db, 'ship-1', template, '2026-10-29');
    expect(second.id).not.toBe(first.id);
    expect(second.period).toBe('2026-10-29');
  });

  it('gives the newest when a merge left two live drafts', async () => {
    const { db, template } = await withTemplate();
    const older = await createRecord<FormDraft>(db, 'formDrafts', {
      shipId: 'ship-1', templateId: template.id, code: 'TST-01', period: '2026-10-27', values: values('Older'), photoIds: [],
    });
    at('2026-10-28T09:00:00.000Z');
    const newer = await createRecord<FormDraft>(db, 'formDrafts', {
      shipId: 'ship-1', templateId: template.id, code: 'TST-01', period: '2026-10-28', values: values('Newer'), photoIds: [],
    });
    at('2026-10-28T10:00:00.000Z');
    expect((await openDraft(db, 'ship-1', template, '2026-10-28')).id).toBe(newer.id);
    // The one worked on last is the newest, whenever it was made.
    await saveDraftValues(db, older.id, values('Edited'));
    expect((await openDraft(db, 'ship-1', template, '2026-10-28')).id).toBe(older.id);
    expect(await db.formDrafts.count()).toBe(2);
  });

  it("continues a draft handed over from a copy of the same form that is not here, found by the form's code", async () => {
    const { db, template } = await withTemplate();
    const handedOver = await createRecord<FormDraft>(db, 'formDrafts', {
      shipId: 'ship-1', templateId: 'their-copy', code: 'TST-01', period: '2026-10-27', values: values('Handed over'), photoIds: [],
    });
    expect((await openDraft(db, 'ship-1', template, '2026-10-28')).id).toBe(handedOver.id);
  });

  it('does not take the draft of another form here that has the same code, nor match forms that have no code', async () => {
    const { db, template } = await withTemplate();
    const twin = await saveTemplate(db, { fileName: 'twin.docx', bytes: sampleBytes(10), kind: 'docx', schema: schema('TST-01', 'Twin'), setup });
    const twinDraft = await openDraft(db, 'ship-1', twin, '2026-10-28');
    expect((await openDraft(db, 'ship-1', template, '2026-10-28')).id).not.toBe(twinDraft.id);

    const noCode = await saveTemplate(db, { fileName: 'n.docx', bytes: sampleBytes(10), kind: 'docx', schema: schema(''), setup });
    await createRecord<FormDraft>(db, 'formDrafts', {
      shipId: 'ship-1', templateId: 'elsewhere', code: '', period: '2026-10-27', values: values('?'), photoIds: [],
    });
    const fresh = await openDraft(db, 'ship-1', noCode, '2026-10-28');
    expect(fresh.templateId).toBe(noCode.id);
  });
});

describe('saveDraftValues', () => {
  it('stores the values, stamped as changed now', async () => {
    const { db, template } = await withTemplate();
    const draft = await openDraft(db, 'ship-1', template, '2026-10-28');
    at('2026-10-28T09:30:00.000Z');
    const next: DraftValues = { fields: { f1: 'MV OCEAN STAR', f2: true, f3: null }, rows: { g1: [{ 'g1.c1': 'Ivan Petrović' }] } };
    await saveDraftValues(db, draft.id, next);
    expect(await db.formDrafts.get(draft.id)).toMatchObject({ values: next, updatedAt: '2026-10-28T09:30:00.000Z', period: '2026-10-28' });
  });

  it('refuses a draft that is closed', async () => {
    const { db, template } = await withTemplate();
    const draft = await openDraft(db, 'ship-1', template, '2026-10-28');
    await discardDraft(db, draft.id);
    await expect(saveDraftValues(db, draft.id, values('late'))).rejects.toThrow(/deleted/);
  });
});

describe('addPhoto and photosFor', () => {
  it('stores the photo with the draft, lists it on the draft, and gives it back byte for byte', async () => {
    const { db, template } = await withTemplate();
    const draft = await openDraft(db, 'ship-1', template, '2026-10-28');
    const jpeg = sampleBytes(40_000);
    const photo = await addPhoto(db, 'ship-1', draft.id, jpeg, 1600, 1200);
    expect(photo).toMatchObject({ scope: 'ship', shipId: 'ship-1', draftId: draft.id, width: 1600, height: 1200, deleted: false });
    expect((await db.formDrafts.get(draft.id))?.photoIds).toEqual([photo.id]);
    const photos = await photosFor(db, draft.id);
    expect(Object.keys(photos)).toEqual([photo.id]);
    expect(photos[photo.id]).toEqual(jpeg);
  });

  it("gives only the draft's live photos", async () => {
    const { db, template } = await withTemplate();
    const draft = await openDraft(db, 'ship-1', template, '2026-10-28');
    const other = await openDraft(db, 'ship-2', template, '2026-10-28');
    const kept = await addPhoto(db, 'ship-1', draft.id, sampleBytes(10), 10, 10);
    const removed = await addPhoto(db, 'ship-1', draft.id, sampleBytes(20), 10, 10);
    await addPhoto(db, 'ship-2', other.id, sampleBytes(30), 10, 10);
    await softDelete(db, 'formPhotos', removed.id);
    expect(Object.keys(await photosFor(db, draft.id))).toEqual([kept.id]);
    expect(await photosFor(db, 'no-such-draft')).toEqual({});
  });

  it('refuses a photo for a draft that is not open, or that belongs to another ship, and writes nothing', async () => {
    const { db, template } = await withTemplate();
    const draft = await openDraft(db, 'ship-1', template, '2026-10-28');
    await expect(addPhoto(db, 'ship-2', draft.id, sampleBytes(10), 1, 1)).rejects.toThrow();
    await expect(addPhoto(db, 'ship-1', 'missing', sampleBytes(10), 1, 1)).rejects.toThrow();
    await discardDraft(db, draft.id);
    await expect(addPhoto(db, 'ship-1', draft.id, sampleBytes(10), 1, 1)).rejects.toThrow();
    expect(await db.formPhotos.count()).toBe(0);
  });

  it('writes neither the photo nor the list on the draft when the draft cannot be written', async () => {
    const { db, template } = await withTemplate();
    const draft = await openDraft(db, 'ship-1', template, '2026-10-28');
    vi.spyOn(db.formDrafts, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    await expect(addPhoto(db, 'ship-1', draft.id, sampleBytes(10), 1, 1)).rejects.toBeInstanceOf(StorageFullError);
    expect(await db.formPhotos.count()).toBe(0);
    expect((await db.formDrafts.get(draft.id))?.photoIds).toEqual([]);
  });
});

describe('lastValuesFor', () => {
  it("gives the newest live values of the ship's form, and nothing for another ship or code", async () => {
    const db = freshDb();
    await createRecord<FormLastValues>(db, 'formLastValues', { shipId: 'ship-1', code: 'TST-01', values: values('Old') });
    at('2026-10-28T09:00:00.000Z');
    const newest = await createRecord<FormLastValues>(db, 'formLastValues', { shipId: 'ship-1', code: 'TST-01', values: values('New') });
    at('2026-10-28T10:00:00.000Z');
    const gone = await createRecord<FormLastValues>(db, 'formLastValues', { shipId: 'ship-1', code: 'TST-01', values: values('Gone') });
    await softDelete(db, 'formLastValues', gone.id);
    expect((await lastValuesFor(db, 'ship-1', 'TST-01'))?.id).toBe(newest.id);
    expect(await lastValuesFor(db, 'ship-2', 'TST-01')).toBeUndefined();
    expect(await lastValuesFor(db, 'ship-1', 'TST-02')).toBeUndefined();
  });
});

/** A draft with two photos (one of them already deleted) on ship 1, and a photo of another draft. */
async function draftWithPhotos() {
  const { db, template } = await withTemplate();
  const draft = await openDraft(db, 'ship-1', template, '2026-10-28');
  const photo = await addPhoto(db, 'ship-1', draft.id, sampleBytes(100), 10, 10);
  const second = await addPhoto(db, 'ship-1', draft.id, sampleBytes(200), 20, 20);
  const other = await openDraft(db, 'ship-2', template, '2026-10-28');
  const otherPhoto = await addPhoto(db, 'ship-2', other.id, sampleBytes(300), 30, 30);
  return { db, template, draft, photo, second, other, otherPhoto };
}

describe('closeDraft', () => {
  it('writes the last values, tombstones the draft and empties its photos', async () => {
    const { db, draft, photo, second, otherPhoto } = await draftWithPhotos();
    const { deviceId } = await getSettings(db);
    at('2026-10-28T12:00:00.000Z');
    await closeDraft(db, draft.id, values('MV OCEAN STAR'));
    const stamp = { deleted: true, updatedAt: '2026-10-28T12:00:00.000Z', updatedBy: deviceId };
    expect(await lastValuesFor(db, 'ship-1', 'TST-01')).toMatchObject({
      scope: 'ship', shipId: 'ship-1', code: 'TST-01', values: values('MV OCEAN STAR'), updatedAt: '2026-10-28T12:00:00.000Z',
    });
    expect(await db.formDrafts.get(draft.id)).toMatchObject(stamp);
    for (const id of [photo.id, second.id]) expect(await db.formPhotos.get(id), id).toMatchObject({ ...stamp, jpegBase64: '' });
    expect(await photosFor(db, draft.id)).toEqual({});
    // Another draft's photo is not touched.
    expect(await db.formPhotos.get(otherPhoto.id)).toEqual(otherPhoto);
  });

  it('starts the rollover draft when one is given, with its period and values and no photos', async () => {
    const { db, template, draft } = await draftWithPhotos();
    const carried: DraftValues = { fields: {}, rows: { g1: [{ 'g1.c1': 'Paint the hatch', 'g1.c2': 'Pending' }] } };
    await closeDraft(db, draft.id, values('Done'), { period: '2026-W45', values: carried });
    const next = await openDraft(db, 'ship-1', template, 'not used');
    expect(next.id).not.toBe(draft.id);
    expect(next).toMatchObject({ shipId: 'ship-1', templateId: template.id, code: 'TST-01', period: '2026-W45', values: carried, photoIds: [], deleted: false });
    expect((await db.formDrafts.where('shipId').equals('ship-1').filter((d) => !d.deleted).toArray()).map((d) => d.id)).toEqual([next.id]);
  });

  it('keeps one record of last values per ship and form: a second close updates it', async () => {
    const { db, template, draft } = await draftWithPhotos();
    await closeDraft(db, draft.id, values('First'));
    const first = await lastValuesFor(db, 'ship-1', 'TST-01');
    at('2026-10-29T08:00:00.000Z');
    const next = await openDraft(db, 'ship-1', template, '2026-10-29');
    await closeDraft(db, next.id, values('Second'));
    const second = await lastValuesFor(db, 'ship-1', 'TST-01');
    expect(second).toMatchObject({ id: first?.id, createdAt: first?.createdAt, values: values('Second'), updatedAt: '2026-10-29T08:00:00.000Z' });
    expect(await db.formLastValues.count()).toBe(1);
  });

  it('updates the newest of two records a merge left, and tombstones the other', async () => {
    const { db, draft } = await draftWithPhotos();
    const older = await createRecord<FormLastValues>(db, 'formLastValues', { shipId: 'ship-1', code: 'TST-01', values: values('A') });
    at('2026-10-28T09:00:00.000Z');
    const newer = await createRecord<FormLastValues>(db, 'formLastValues', { shipId: 'ship-1', code: 'TST-01', values: values('B') });
    at('2026-10-28T10:00:00.000Z');
    await closeDraft(db, draft.id, values('C'));
    expect(await db.formLastValues.get(newer.id)).toMatchObject({ deleted: false, values: values('C') });
    expect(await db.formLastValues.get(older.id)).toMatchObject({ deleted: true, updatedAt: '2026-10-28T10:00:00.000Z' });
  });

  it('keeps no last values for a form that has no code, which would mix up forms', async () => {
    const { db } = await withTemplate('');
    const template = (await listTemplates(db))[0];
    const draft = await openDraft(db, 'ship-1', template, '2026-10-28');
    await closeDraft(db, draft.id, values('X'));
    expect(await db.formLastValues.count()).toBe(0);
    expect(await lastValuesFor(db, 'ship-1', '')).toBeUndefined();
    expect((await db.formDrafts.get(draft.id))?.deleted).toBe(true);
  });

  it('writes nothing when a write inside fails: last values, draft and photos stay as they were', async () => {
    const { db, draft } = await draftWithPhotos();
    const before = await allTables(db);
    const real = db.formDrafts.put.bind(db.formDrafts);
    // The draft's tombstone is written; the rollover draft after it fails.
    vi.spyOn(db.formDrafts, 'put').mockImplementationOnce(real).mockRejectedValueOnce(new Error('boom'));
    await expect(closeDraft(db, draft.id, values('X'), { period: '2026-10-29', values: values('') })).rejects.toThrow('boom');
    expect(await allTables(db)).toEqual(before);
  });

  it('reports a full disk as such, and writes nothing', async () => {
    const { db, draft } = await draftWithPhotos();
    const before = await allTables(db);
    vi.spyOn(db.formPhotos, 'bulkPut').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    await expect(closeDraft(db, draft.id, values('X'))).rejects.toBeInstanceOf(StorageFullError);
    expect(await allTables(db)).toEqual(before);
  });

  it('refuses a draft that is already closed or does not exist, and writes nothing', async () => {
    const { db, draft } = await draftWithPhotos();
    await closeDraft(db, draft.id, values('X'));
    const before = await allTables(db);
    await expect(closeDraft(db, draft.id, values('Y'))).rejects.toThrow();
    await expect(closeDraft(db, 'missing', values('Y'))).rejects.toThrow(/missing/);
    expect(await allTables(db)).toEqual(before);
  });
});

describe('discardDraft', () => {
  it('tombstones the draft and empties its photos, and keeps no last values', async () => {
    const { db, draft, photo, second, otherPhoto } = await draftWithPhotos();
    await discardDraft(db, draft.id);
    expect((await db.formDrafts.get(draft.id))?.deleted).toBe(true);
    for (const id of [photo.id, second.id]) expect(await db.formPhotos.get(id), id).toMatchObject({ deleted: true, jpegBase64: '' });
    expect(await db.formPhotos.get(otherPhoto.id)).toEqual(otherPhoto);
    expect(await db.formLastValues.count()).toBe(0);
  });

  it('keeps the deletion time of a draft discarded twice', async () => {
    const { db, draft } = await draftWithPhotos();
    await discardDraft(db, draft.id);
    const tombstone = await db.formDrafts.get(draft.id);
    at('2026-10-30T00:00:00.000Z');
    await discardDraft(db, draft.id);
    expect(await db.formDrafts.get(draft.id)).toEqual(tombstone);
  });

  it('writes nothing when the photos cannot be deleted', async () => {
    const { db, draft } = await draftWithPhotos();
    const before = await allTables(db);
    vi.spyOn(db.formPhotos, 'bulkPut').mockRejectedValueOnce(new Error('boom'));
    await expect(discardDraft(db, draft.id)).rejects.toThrow('boom');
    expect(await allTables(db)).toEqual(before);
  });
});
