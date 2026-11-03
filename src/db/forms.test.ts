import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSetup } from '../forms/helpers';
import { readPackage } from '../forms/package';
import { toolboxTalkDocx, weeklyJobsDotx } from '../forms/testing/wordFixtures';
import type { DraftValues, FormSchema, FormSetup } from '../forms/types';
import { detectWord } from '../forms/word/detect';
import type { FormDraft, FormLastValues, FormPhoto, FormTemplate } from '../domain/types';
import {
  addPhoto, removePhoto, closeDraft, discardDraft, findDraft, lastValuesFor, lastValuesKey, listTemplates, openDraft, photosFor, replaceTemplate, saveDraftValues,
  saveSetup, saveTemplate, SETUP_GONE, SETUP_STALE,
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

describe('saveSetup', () => {
  const chosen: FormSetup = { ...setup, links: { f1: { source: 'none' } }, leftEmpty: ['f1'], okWord: 'Good' };
  const renamed: FormSchema = { ...schema('TST-01'), fields: [{ ...schema('TST-01').fields[0], label: 'Ship', leftEmpty: true }] };

  it('saves the setup and the schema the review made, stamped as changed now', async () => {
    const { db, template } = await withTemplate();
    at('2026-10-28T09:00:00.000Z');
    const saved = await saveSetup(db, template.id, template.updatedAt, chosen, renamed);
    expect(saved).toEqual({ ...template, setup: chosen, schema: renamed, updatedAt: '2026-10-28T09:00:00.000Z' });
    expect(await db.formTemplates.get(template.id)).toEqual(saved);
  });

  it("aligns the schema's left-empty marks with the setup, and drops helpers on left-empty fields, whatever it is given", async () => {
    const { db, template } = await withTemplate();
    const emptied: FormSetup = { ...setup, leftEmpty: ['f1'], helpers: { ...setup.helpers, now: ['f1'] } };
    const saved = await saveSetup(db, template.id, template.updatedAt, emptied, schema('TST-01'));
    expect(saved.schema.fields[0].leftEmpty).toBe(true);
    expect(saved.setup.helpers.now).toEqual([]);
  });

  it('refuses, and writes nothing, when the form changed since the review was opened (a new revision came in)', async () => {
    const { db, template } = await withTemplate();
    at('2026-10-28T09:00:00.000Z');
    const changed = await saveSetup(db, template.id, template.updatedAt, setup, schema('TST-01'));
    at('2026-10-28T10:00:00.000Z');
    await expect(saveSetup(db, template.id, template.updatedAt, chosen, renamed)).rejects.toThrow(SETUP_STALE);
    expect(await db.formTemplates.get(template.id)).toEqual(changed);
  });

  it('refuses a form that is gone from the library', async () => {
    const { db, template } = await withTemplate();
    await softDelete(db, 'formTemplates', template.id);
    const deleted = await db.formTemplates.get(template.id);
    await expect(saveSetup(db, template.id, deleted!.updatedAt, chosen, renamed)).rejects.toThrow(SETUP_GONE);
    await expect(saveSetup(db, 'missing', template.updatedAt, chosen, renamed)).rejects.toThrow(SETUP_GONE);
    expect(await db.formTemplates.get(template.id)).toEqual(deleted);
  });

  it('reports a full disk as such', async () => {
    const { db, template } = await withTemplate();
    vi.spyOn(db.formTemplates, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    await expect(saveSetup(db, template.id, template.updatedAt, chosen, renamed)).rejects.toBeInstanceOf(StorageFullError);
    expect(await db.formTemplates.get(template.id)).toEqual(template);
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

describe('findDraft and a draft that starts with its auto values (R18)', () => {
  it('finds the live draft as openDraft does, and writes nothing when there is none', async () => {
    const { db, template } = await withTemplate();
    const before = await allTables(db);
    expect(await findDraft(db, 'ship-1', template)).toBeUndefined();
    expect(await allTables(db)).toEqual(before);
    const draft = await openDraft(db, 'ship-1', template, '2026-10-28');
    expect(await findDraft(db, 'ship-1', template)).toEqual(draft);
    expect(await findDraft(db, 'ship-2', template)).toBeUndefined();
  });

  it('creates a draft with the values and auto ids it starts with, and gives back one that is there as it is', async () => {
    const { db, template } = await withTemplate();
    const start = { values: { fields: { f1: 'MV OCEAN STAR', f2: 'Drill' }, rows: {} }, autoIds: ['f1'] };
    const draft = await openDraft(db, 'ship-1', template, '2026-10-28', start);
    expect(draft).toMatchObject({ period: '2026-10-28', values: start.values, autoIds: ['f1'] });
    const again = await openDraft(db, 'ship-1', template, '2026-10-29', { values: values('Other'), autoIds: [] });
    expect(again).toEqual(draft);
    // Without a start, a new draft has no auto values fixed (no `autoIds`).
    expect(await openDraft(db, 'ship-2', template, '2026-10-28')).not.toHaveProperty('autoIds');
  });

  it('saves the auto ids with the values when given, and keeps them when not', async () => {
    const { db, template } = await withTemplate();
    const draft = await openDraft(db, 'ship-1', template, '2026-10-28', { values: values('MV OCEAN STAR'), autoIds: ['f1'] });
    await saveDraftValues(db, draft.id, values('MV OCEAN STAR'));
    expect((await db.formDrafts.get(draft.id))?.autoIds).toEqual(['f1']);
    await saveDraftValues(db, draft.id, values('MV SEA BREEZE'), []);
    expect(await db.formDrafts.get(draft.id)).toMatchObject({ values: values('MV SEA BREEZE'), autoIds: [] });
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

  it('removes a photo: it keeps no image, leaves the draft\'s list, and removing it again changes nothing', async () => {
    const { db, template } = await withTemplate();
    const draft = await openDraft(db, 'ship-1', template, '2026-10-28');
    const keep = await addPhoto(db, 'ship-1', draft.id, sampleBytes(10), 10, 10);
    const drop = await addPhoto(db, 'ship-1', draft.id, sampleBytes(20), 10, 10);
    await removePhoto(db, drop.id);
    expect(await db.formPhotos.get(drop.id)).toMatchObject({ deleted: true, jpegBase64: '' });
    expect((await db.formDrafts.get(draft.id))?.photoIds).toEqual([keep.id]);
    expect(Object.keys(await photosFor(db, draft.id))).toEqual([keep.id]);
    const stamped = (await db.formPhotos.get(drop.id))?.updatedAt;
    await removePhoto(db, drop.id);
    await removePhoto(db, 'missing');
    expect((await db.formPhotos.get(drop.id))?.updatedAt).toBe(stamped);
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
    const form = (code: string) => ({ id: 'tpl-x', code });
    expect((await lastValuesFor(db, 'ship-1', form('TST-01')))?.id).toBe(newest.id);
    expect(await lastValuesFor(db, 'ship-2', form('TST-01'))).toBeUndefined();
    expect(await lastValuesFor(db, 'ship-1', form('TST-02'))).toBeUndefined();
  });
});

describe('lastValuesKey', () => {
  it("is the form's code, or the template when the form has none", () => {
    expect(lastValuesKey('TST-01', 'tpl-1')).toBe('TST-01');
    expect(lastValuesKey('', 'tpl-1')).toBe('template:tpl-1');
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
    const { db, template, draft, photo, second, otherPhoto } = await draftWithPhotos();
    const { deviceId } = await getSettings(db);
    at('2026-10-28T12:00:00.000Z');
    await closeDraft(db, draft.id, values('MV OCEAN STAR'));
    const stamp = { deleted: true, updatedAt: '2026-10-28T12:00:00.000Z', updatedBy: deviceId };
    expect(await lastValuesFor(db, 'ship-1', template)).toMatchObject({
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
    const first = await lastValuesFor(db, 'ship-1', template);
    at('2026-10-29T08:00:00.000Z');
    const next = await openDraft(db, 'ship-1', template, '2026-10-29');
    await closeDraft(db, next.id, values('Second'));
    const second = await lastValuesFor(db, 'ship-1', template);
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

  it('keeps the last values of a form that has no code by its template, so that two such forms never mix', async () => {
    const { db, template: first } = await withTemplate('');
    const second = await saveTemplate(db, { fileName: 'other.docx', bytes: sampleBytes(10), kind: 'docx', schema: schema('', 'Other form'), setup });
    await closeDraft(db, (await openDraft(db, 'ship-1', first, '2026-10-28')).id, values('First form'));
    await closeDraft(db, (await openDraft(db, 'ship-1', second, '2026-10-28')).id, values('Second form'));
    expect(await lastValuesFor(db, 'ship-1', first)).toMatchObject({ code: `template:${first.id}`, values: values('First form') });
    expect(await lastValuesFor(db, 'ship-1', second)).toMatchObject({ code: `template:${second.id}`, values: values('Second form') });
    expect(await db.formLastValues.count()).toBe(2);
    // A second close of the first form updates its own record, and leaves the other form's alone.
    await closeDraft(db, (await openDraft(db, 'ship-1', first, '2026-10-29')).id, values('First again'));
    expect((await lastValuesFor(db, 'ship-1', first))?.values).toEqual(values('First again'));
    expect((await lastValuesFor(db, 'ship-1', second))?.values).toEqual(values('Second form'));
    expect(await db.formLastValues.count()).toBe(2);
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

describe('replaceTemplate', () => {
  const rev00Bytes = toolboxTalkDocx();
  const rev00 = detectWord(readPackage(rev00Bytes), 'docx', 'toolbox.docx');
  // R6: `Subject` becomes `Topic`, and `Location` is added after it.
  const rev01Bytes = toolboxTalkDocx({ revision: '01 / 01.06.2026', renameSubjectTo: 'Topic', extraFieldLabel: 'Location' });
  const rev01 = detectWord(readPackage(rev01Bytes), 'docx', 'toolbox-rev01.docx');
  // A later revision that takes `Location` out again.
  const rev02Bytes = toolboxTalkDocx({ revision: '02 / 01.09.2026', renameSubjectTo: 'Topic' });
  const rev02 = detectWord(readPackage(rev02Bytes), 'docx', 'toolbox-rev02.docx');
  const rev01Input = { fileName: 'toolbox-rev01.docx', bytes: rev01Bytes, kind: 'docx' as const, schema: rev01 };

  const filled = (vessel: string): DraftValues => ({
    fields: { f1: vessel, f2: 'Working aloft', f3: '2026-10-28', f4: '08:30' },
    rows: { g1: [{ 'g1.c1': 'Ana Marin', 'g1.c2': 'Chief Officer' }] },
  });
  const moved = (vessel: string): DraftValues => ({
    fields: { f1: vessel, f2: 'Working aloft', f4: '2026-10-28', f5: '08:30' },
    rows: { g1: [{ 'g1.c1': 'Ana Marin', 'g1.c2': 'Chief Officer' }] },
  });

  async function library() {
    const db = freshDb();
    const template = await saveTemplate(db, { fileName: 'toolbox.docx', bytes: rev00Bytes, kind: 'docx', schema: rev00, setup: defaultSetup(rev00) });
    return { db, template };
  }

  it("stores the new file's schema with the left-empty marks of the carried-over setup, and no helper on a left-empty field", async () => {
    const { db, template } = await library();
    // The person chose to fill the participants' Signature column, and to leave Time (f4) empty, which had the Now helper.
    const chosen = { ...template.setup, leftEmpty: ['f4'], links: { ...template.setup.links, f4: { source: 'none' as const } } };
    const reviewed = await saveSetup(db, template.id, template.updatedAt, chosen, template.schema);
    expect(reviewed.setup.helpers.now).toEqual([]);
    at('2026-10-29T08:00:00.000Z');
    // A new revision replaces it, and its setup is never saved again.
    const { template: replaced } = await replaceTemplate(db, template.id, rev01Input);
    const stored = (await db.formTemplates.get(template.id))!;
    expect(stored).toEqual(replaced);
    const flagged = [...stored.schema.fields, ...stored.schema.rowGroups.flatMap((g) => g.columns)].filter((f) => f.leftEmpty).map((f) => f.id);
    expect(flagged.sort()).toEqual([...stored.setup.leftEmpty].sort());
    expect(stored.setup.leftEmpty).toEqual(['f5']); // Time, which is f5 in the new revision
    expect(stored.schema.rowGroups[0].columns[2].label).toBe('Signature');
    expect(stored.schema.rowGroups[0].columns[2]).not.toHaveProperty('leftEmpty'); // detection's flag gave way to the choice
    for (const ids of Object.values(stored.setup.helpers)) expect(ids).not.toContain('f5');
  });

  it('open_draft_migrates: an open draft keeps its values under the new ids, and a removed field is counted', async () => {
    const { db, template } = await library();
    const draft = await openDraft(db, 'ship-1', template, '2026-10-28');
    await saveDraftValues(db, draft.id, filled('MV OCEAN STAR'));
    at('2026-10-29T08:00:00.000Z');

    const first = await replaceTemplate(db, template.id, rev01Input);
    expect(first.unmatched).toEqual(['Location']);
    expect(first.droppedFromDrafts).toBe(0);
    expect((await db.formDrafts.get(draft.id))?.values).toEqual(moved('MV OCEAN STAR'));
    expect(await db.formDrafts.get(draft.id)).not.toHaveProperty('autoIds'); // none fixed: none made up
    // Opening the form now continues the same draft, under the new revision.
    expect((await openDraft(db, 'ship-1', first.template, '2026-10-29')).id).toBe(draft.id);

    // The person fills the new field; the next revision takes it out again.
    await saveDraftValues(db, draft.id, { ...moved('MV OCEAN STAR'), fields: { ...moved('MV OCEAN STAR').fields, f3: 'Bosun store' } });
    const second = await replaceTemplate(db, template.id, { fileName: 'toolbox-rev02.docx', bytes: rev02Bytes, kind: 'docx', schema: rev02 });
    expect(second.removed).toEqual(['Location']);
    expect(second.droppedFromDrafts).toBe(1);
    expect((await db.formDrafts.get(draft.id))?.values).toEqual({
      fields: { f1: 'MV OCEAN STAR', f2: 'Working aloft', f3: '2026-10-28', f4: '08:30' },
      rows: { g1: [{ 'g1.c1': 'Ana Marin', 'g1.c2': 'Chief Officer' }] },
    });
  });

  it('keeps the template\'s id and replaces its file, name, identity and schema', async () => {
    const { db, template } = await library();
    const { deviceId } = await getSettings(db);
    at('2026-10-29T08:00:00.000Z');
    const { template: replaced } = await replaceTemplate(db, template.id, rev01Input);
    expect(replaced).toMatchObject({
      id: template.id, createdAt: template.createdAt, scope: 'personal', deleted: false, updatedAt: '2026-10-29T08:00:00.000Z', updatedBy: deviceId,
      code: 'TST-01', title: 'Toolbox Talk', revision: '01 / 01.06.2026', kind: 'docx', fileName: 'toolbox-rev01.docx', schema: rev01,
    });
    expect(Uint8Array.from(atob(replaced.fileBase64), (c) => c.charCodeAt(0))).toEqual(rev01Bytes);
    expect(await db.formTemplates.get(template.id)).toEqual(replaced);
    expect(await db.formTemplates.count()).toBe(1);
  });

  it('carries the setup over to the new ids', async () => {
    const { db, template } = await library();
    const setup: FormSetup = {
      links: { f1: { source: 'vessel.name' }, f2: { source: 'none' }, f4: { source: 'time.timeUtc' } },
      leftEmpty: ['g1.c3', 'f3'],
      helpers: { pickCrew: ['g1'], allOk: [], todayRow: [], startFromLast: ['g1'], jobLog: [], thresholds: [], now: ['f4'] },
      okWord: 'Good',
      notFinished: '',
    };
    await db.formTemplates.put({ ...template, setup });
    const { template: replaced } = await replaceTemplate(db, template.id, rev01Input);
    expect(replaced.setup).toEqual({
      links: { f1: { source: 'vessel.name' }, f2: { source: 'none' }, f5: { source: 'time.timeUtc' } },
      leftEmpty: ['g1.c3', 'f4'],
      helpers: { pickCrew: ['g1'], allOk: [], todayRow: [], startFromLast: ['g1'], jobLog: [], thresholds: [], now: ['f5'] },
      okWord: 'Good',
      notFinished: '',
    });
  });

  it('moves the auto marks of a draft to the new ids, and drops the mark of a field that is gone (R18)', async () => {
    const { db, template } = await library();
    const draft = await openDraft(db, 'ship-1', template, '2026-10-28', { values: filled('MV OCEAN STAR'), autoIds: ['f1', 'f3', 'f4'] });
    await replaceTemplate(db, template.id, rev01Input);
    expect((await db.formDrafts.get(draft.id))?.autoIds).toEqual(['f1', 'f4', 'f5']); // Date and Time moved down one
    await saveDraftValues(db, draft.id, (await db.formDrafts.get(draft.id))!.values, ['f1', 'f3']); // f3 is Location now
    await replaceTemplate(db, template.id, { fileName: 'toolbox-rev02.docx', bytes: rev02Bytes, kind: 'docx', schema: rev02 });
    expect((await db.formDrafts.get(draft.id))?.autoIds).toEqual(['f1']);
  });

  it('moves every live draft and the last values of every ship, and nothing else', async () => {
    const { db, template } = await library();
    const other = await saveTemplate(db, { fileName: 'other.docx', bytes: rev00Bytes, kind: 'docx', schema: { ...rev00, identity: { ...rev00.identity, code: 'TST-77' } }, setup: defaultSetup(rev00) });
    // Ship 2 made a file: its last values. Ship 1 and ship 2 then each have a draft open.
    await closeDraft(db, (await openDraft(db, 'ship-2', template, '2026-10-27')).id, filled('MV NORTH WIND'));
    const one = await openDraft(db, 'ship-1', template, '2026-10-28');
    await saveDraftValues(db, one.id, filled('MV OCEAN STAR'));
    const two = await openDraft(db, 'ship-2', template, '2026-10-28');
    await saveDraftValues(db, two.id, filled('MV NORTH WIND'));
    const closed = (await db.formDrafts.where('shipId').equals('ship-2').filter((d) => d.deleted).first())!;
    const otherDraft = await saveDraftValues(db, (await openDraft(db, 'ship-1', other, '2026-10-28')).id, filled('MV OCEAN STAR'));
    await closeDraft(db, (await openDraft(db, 'ship-3', other, '2026-10-01')).id, filled('MV SOUTH SEA'));
    const otherLast = (await lastValuesFor(db, 'ship-3', other))!;
    at('2026-10-29T08:00:00.000Z');

    const result = await replaceTemplate(db, template.id, rev01Input);
    expect(result.droppedFromDrafts).toBe(0);
    expect(result.droppedFromLastValues).toBe(0);
    expect((await db.formDrafts.get(one.id))).toMatchObject({ values: moved('MV OCEAN STAR'), code: 'TST-01', updatedAt: '2026-10-29T08:00:00.000Z' });
    expect((await db.formDrafts.get(two.id))?.values).toEqual(moved('MV NORTH WIND'));
    expect((await lastValuesFor(db, 'ship-2', result.template))?.values).toEqual(moved('MV NORTH WIND'));
    // A closed draft, and another form's draft and last values, are left as they were.
    expect(await db.formDrafts.get(closed.id)).toEqual(closed);
    expect(await db.formDrafts.get(otherDraft.id)).toEqual(otherDraft);
    expect(await db.formLastValues.get(otherLast.id)).toEqual(otherLast);
  });

  it('counts what it drops from the drafts and from the last values', async () => {
    const { db } = await library();
    const template = await replaceTemplate(db, (await listTemplates(db))[0]!.id, rev01Input).then((r) => r.template);
    const withLocation = (vessel: string): DraftValues => ({ ...moved(vessel), fields: { ...moved(vessel).fields, f3: 'Bosun store' } });
    await closeDraft(db, (await openDraft(db, 'ship-1', template, '2026-10-27')).id, withLocation('MV OCEAN STAR'));
    await saveDraftValues(db, (await openDraft(db, 'ship-1', template, '2026-10-28')).id, withLocation('MV OCEAN STAR'));
    await saveDraftValues(db, (await openDraft(db, 'ship-2', template, '2026-10-28')).id, withLocation('MV NORTH WIND'));
    const result = await replaceTemplate(db, template.id, { fileName: 'toolbox-rev02.docx', bytes: rev02Bytes, kind: 'docx', schema: rev02 });
    expect(result).toMatchObject({ unmatched: [], removed: ['Location'], droppedFromDrafts: 2, droppedFromLastValues: 1 });
    expect((await lastValuesFor(db, 'ship-1', result.template))?.values.fields).toEqual({ f1: 'MV OCEAN STAR', f2: 'Working aloft', f3: '2026-10-28', f4: '08:30' });
  });

  it('drops the value of a picture field that is gone, and leaves the photo with its draft', async () => {
    const db = freshDb();
    const weeklyBytes = weeklyJobsDotx();
    const weekly = detectWord(readPackage(weeklyBytes), 'dotx', 'weekly.dotx');
    const template = await saveTemplate(db, { fileName: 'weekly.dotx', bytes: weeklyBytes, kind: 'dotx', schema: weekly, setup: defaultSetup(weekly) });
    const draft = await openDraft(db, 'ship-1', template, '2026-W44');
    const photos = [
      await addPhoto(db, 'ship-1', draft.id, Uint8Array.of(0xff, 0xd8, 1), 1, 1),
      await addPhoto(db, 'ship-1', draft.id, Uint8Array.of(0xff, 0xd8, 2), 1, 1),
      await addPhoto(db, 'ship-1', draft.id, Uint8Array.of(0xff, 0xd8, 3), 1, 1),
    ];
    const row = { 'g2.c1': photos[0]!.id, 'g2.c2': 'Before', 'g2.c3': photos[1]!.id, 'g2.c4': 'After', 'g2.c5': photos[2]!.id, 'g2.c6': 'After' };
    await saveDraftValues(db, draft.id, { fields: {}, rows: { g2: [row] } });
    // The next revision has room for two pictures.
    const next: FormSchema = {
      ...weekly, identity: { ...weekly.identity, revision: '01 / 01.06.2026' },
      rowGroups: weekly.rowGroups.map((g) => (g.id === 'g2' ? { ...g, columns: g.columns.slice(0, 4) } : g)),
    };
    const result = await replaceTemplate(db, template.id, { fileName: 'weekly.dotx', bytes: weeklyBytes, kind: 'dotx', schema: next });
    expect(result.droppedFromDrafts).toBe(2);
    const after = (await db.formDrafts.get(draft.id))!;
    expect(after.values.rows.g2).toEqual([{ 'g2.c1': photos[0]!.id, 'g2.c2': 'Before', 'g2.c3': photos[1]!.id, 'g2.c4': 'After' }]);
    expect(after.photoIds).toEqual(photos.map((p) => p.id));
    expect(Object.keys(await photosFor(db, draft.id)).sort()).toEqual(photos.map((p) => p.id).sort());
  });

  it('does not rewrite a draft or last values that nothing changed (no needless conflicts in a later merge)', async () => {
    const { db, template } = await library();
    await closeDraft(db, (await openDraft(db, 'ship-2', template, '2026-10-27')).id, filled('MV NORTH WIND'));
    const draft = await saveDraftValues(db, (await openDraft(db, 'ship-1', template, '2026-10-28')).id, filled('MV OCEAN STAR'));
    const last = (await lastValuesFor(db, 'ship-2', template))!;
    at('2026-10-29T08:00:00.000Z');
    // The same layout re-issued: only the revision changes.
    const same = { ...rev00, identity: { ...rev00.identity, revision: '01 / 01.06.2026' } };
    const result = await replaceTemplate(db, template.id, { fileName: 'toolbox.docx', bytes: rev00Bytes, kind: 'docx', schema: same });
    expect(result).toMatchObject({ unmatched: [], removed: [], droppedFromDrafts: 0, droppedFromLastValues: 0 });
    expect(result.template.revision).toBe('01 / 01.06.2026');
    expect(await db.formDrafts.get(draft.id)).toEqual(draft);
    expect(await db.formLastValues.get(last.id)).toEqual(last);
  });

  it('moves the last values of a form without a code, kept under its template id', async () => {
    const db = freshDb();
    const noCode = { ...rev00, identity: { ...rev00.identity, code: '' } };
    const template = await saveTemplate(db, { fileName: 'toolbox.docx', bytes: rev00Bytes, kind: 'docx', schema: noCode, setup: defaultSetup(noCode) });
    await closeDraft(db, (await openDraft(db, 'ship-1', template, '2026-10-27')).id, filled('MV OCEAN STAR'));
    const result = await replaceTemplate(db, template.id, { ...rev01Input, schema: { ...rev01, identity: { ...rev01.identity, code: '' } } });
    expect((await lastValuesFor(db, 'ship-1', result.template))?.values).toEqual(moved('MV OCEAN STAR'));
  });

  it('refuses a template that is missing or deleted, and writes nothing', async () => {
    const { db, template } = await library();
    await softDelete(db, 'formTemplates', template.id);
    const before = await allTables(db);
    await expect(replaceTemplate(db, template.id, rev01Input)).rejects.toThrow();
    await expect(replaceTemplate(db, 'missing', rev01Input)).rejects.toThrow(/missing/);
    expect(await allTables(db)).toEqual(before);
  });

  it('refuses a file of another form (another code) or whose kind is not its schema\'s, and writes nothing', async () => {
    const { db, template } = await library();
    const before = await allTables(db);
    const otherCode = { ...rev01, identity: { ...rev01.identity, code: 'TST-02' } };
    await expect(replaceTemplate(db, template.id, { ...rev01Input, schema: otherCode })).rejects.toThrow(/not a revision/);
    await expect(replaceTemplate(db, template.id, { ...rev01Input, kind: 'xlsx' })).rejects.toThrow(/schema says docx/);
    expect(await allTables(db)).toEqual(before);
  });

  it('writes nothing when a write inside fails: template, drafts and last values stay as they were', async () => {
    const { db, template } = await library();
    await closeDraft(db, (await openDraft(db, 'ship-2', template, '2026-10-27')).id, filled('MV NORTH WIND'));
    await saveDraftValues(db, (await openDraft(db, 'ship-1', template, '2026-10-28')).id, filled('MV OCEAN STAR'));
    const before = await allTables(db);
    // The drafts and the last values are written; the template after them fails.
    vi.spyOn(db.formTemplates, 'put').mockRejectedValueOnce(new Error('boom'));
    await expect(replaceTemplate(db, template.id, rev01Input)).rejects.toThrow('boom');
    expect(await allTables(db)).toEqual(before);
  });

  it('reports a full disk as such, and writes nothing', async () => {
    const { db, template } = await library();
    await saveDraftValues(db, (await openDraft(db, 'ship-1', template, '2026-10-28')).id, filled('MV OCEAN STAR'));
    const before = await allTables(db);
    vi.spyOn(db.formTemplates, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    await expect(replaceTemplate(db, template.id, rev01Input)).rejects.toBeInstanceOf(StorageFullError);
    expect(await allTables(db)).toEqual(before);
  });
});
