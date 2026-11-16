import { toBase64 } from '../backup/crypto';
import { hydroRowsOk } from '../domain/survey';
import type {
  BaseRecord, DraftSurvey, DraftSurveyShip, HydroRow, HydroTable, SurveyTableName, SurveyTemplate,
} from '../domain/types';
import type { CellMap } from '../survey/workbook/types';
import { listForShip, softDelete } from './records';
import type { MasterpieceDB } from './schema';
import { syncTable } from './schema';
import { getSettings } from './settings';
import { guardWrite } from './storage';

/** A ship's survey data as the ship data screen and the workbook import give it. */
export type SurveyShipFields = Omit<DraftSurveyShip, keyof BaseRecord | 'shipId'>;
/** A survey as the survey screen gives it: the whole survey, every input of it. */
export type SurveyFields = Omit<DraftSurvey, keyof BaseRecord | 'shipId'>;
/** The company workbook as imported: its name, its bytes and the input cells found in it. */
export interface SurveyTemplateInput { fileName: string; bytes: Uint8Array; cellMap: CellMap }

/**
 * The ids of the records a ship has one of. They are made from the ship's id, so that two devices that each import the
 * ship's workbook write the same record, and the merge matches them by id instead of keeping two.
 */
export const surveyShipId = (shipId: string): string => `survey-ship:${shipId}`;
export const hydroTableId = (shipId: string): string => `hydro:${shipId}`;
export const surveyTemplateId = (shipId: string): string => `survey-template:${shipId}`;

/** Said when a hydrostatic table is not one the look-ups can use. */
export const HYDRO_ROWS_INVALID = 'The hydrostatic table must have numbers only, with the drafts in increasing order.';

/** `fields` without the keys whose value is `undefined`, also inside the drafts and the deductibles: an empty input is not stored. */
function withoutUndefined<T extends object>(fields: T): T {
  const strip = (o: object) => Object.fromEntries(Object.entries(o).filter(([, value]) => value !== undefined));
  const out = strip(fields) as Record<string, unknown>;
  for (const key of ['drafts', 'deductibles']) {
    const nested = out[key];
    if (typeof nested === 'object' && nested !== null && !Array.isArray(nested)) out[key] = strip(nested);
  }
  return out as T;
}

/**
 * Writes the whole record `id` of the ship from `fields`, stamped as changed now by this device, in one transaction: a
 * field `fields` leaves out is removed. A live record keeps its creation time. With `mustBeLive` (an edit of a survey)
 * the record must be there, live and the ship's; otherwise a missing or deleted record is made anew.
 */
function writeWhole<T extends DraftSurveyShip | HydroTable | DraftSurvey | SurveyTemplate>(
  db: MasterpieceDB, table: SurveyTableName, id: string, shipId: string, fields: object, mustBeLive = false,
): Promise<T> {
  const t = syncTable(db, table);
  return guardWrite(() =>
    // `settings` is in the scope because the stamp reads the device id from it.
    db.transaction('rw', [t, db.settings], async () => {
      const { deviceId } = await getSettings(db);
      const current = (await t.get(id)) as T | undefined;
      const live = current !== undefined && !current.deleted;
      if (mustBeLive && !live) throw new Error(`There is no ${table} record with id ${id}.`);
      if (live && current.shipId !== shipId) throw new Error(`Record ${table}:${id} belongs to another ship.`);
      const now = new Date().toISOString();
      const record = withoutUndefined({
        ...fields, id, shipId, scope: 'ship', createdAt: live ? current.createdAt : now, updatedAt: now, updatedBy: deviceId, deleted: false,
      }) as unknown as T;
      await t.put(record);
      return record;
    }),
  );
}

async function liveById<T extends BaseRecord>(db: MasterpieceDB, table: SurveyTableName, id: string): Promise<T | undefined> {
  const record = (await syncTable(db, table).get(id)) as T | undefined;
  return record && !record.deleted ? record : undefined;
}

/** The ship's survey data, if it has been imported or entered. */
export function getSurveyShip(db: MasterpieceDB, shipId: string): Promise<DraftSurveyShip | undefined> {
  return liveById<DraftSurveyShip>(db, 'draftSurveyShips', surveyShipId(shipId));
}

/** Saves the ship's survey data as a whole (an optional field left out is removed). */
export function saveSurveyShip(db: MasterpieceDB, shipId: string, fields: SurveyShipFields): Promise<DraftSurveyShip> {
  return writeWhole<DraftSurveyShip>(db, 'draftSurveyShips', surveyShipId(shipId), shipId, fields);
}

/** The ship's hydrostatic table, if it has one. */
export function getHydro(db: MasterpieceDB, shipId: string): Promise<HydroTable | undefined> {
  return liveById<HydroTable>(db, 'hydroTables', hydroTableId(shipId));
}

/** Replaces the ship's hydrostatic table with `rows`. Rows that are not numbers, or not in strictly increasing draft order, are refused. */
export function saveHydro(db: MasterpieceDB, shipId: string, rows: HydroRow[]): Promise<HydroTable> {
  if (!hydroRowsOk(rows)) return Promise.reject(new Error(HYDRO_ROWS_INVALID));
  return writeWhole<HydroTable>(db, 'hydroTables', hydroTableId(shipId), shipId, { rows });
}

/** The ship's live surveys, the newest first (by when each was started). */
export async function listSurveys(db: MasterpieceDB, shipId: string): Promise<DraftSurvey[]> {
  const surveys = await listForShip<DraftSurvey>(db, 'draftSurveys', shipId);
  return surveys.sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Saves a survey as a whole: a new one without `id`, else the live survey `id` of the same ship (an input left out is
 * removed). A survey that is deleted, missing or another ship's is refused.
 */
export function saveSurvey(db: MasterpieceDB, shipId: string, fields: SurveyFields, id?: string): Promise<DraftSurvey> {
  return writeWhole<DraftSurvey>(db, 'draftSurveys', id ?? crypto.randomUUID(), shipId, fields, id !== undefined);
}

/** Deletes a survey: it stays as a tombstone, so that the deletion reaches other devices. */
export function deleteSurvey(db: MasterpieceDB, id: string): Promise<void> {
  return softDelete(db, 'draftSurveys', id);
}

/** The ship's company workbook, if one was imported. */
export function getTemplate(db: MasterpieceDB, shipId: string): Promise<SurveyTemplate | undefined> {
  return liveById<SurveyTemplate>(db, 'surveyTemplates', surveyTemplateId(shipId));
}

/** Keeps the ship's company workbook, replacing the one it had. The file is kept as base64, as the forms library keeps its files. */
export function saveTemplate(db: MasterpieceDB, shipId: string, input: SurveyTemplateInput): Promise<SurveyTemplate> {
  return writeWhole<SurveyTemplate>(db, 'surveyTemplates', surveyTemplateId(shipId), shipId, {
    fileName: input.fileName, fileBase64: toBase64(input.bytes), cellMap: input.cellMap,
  });
}
