import Dexie from 'dexie';
import type { Table } from 'dexie';
import { TABLE_NAMES } from '../domain/types';
import type {
  Certificate, ClockChange, CrewMember, Settings, ShipProfile, Snapshot, SyncRecord, TableName, Voyage,
} from '../domain/types';

const APP_DB_NAME = 'masterpiece';

/**
 * The app's database. Every schema version is declared in the constructor, oldest first; a later change adds a
 * `version(n + 1)` below the last one.
 *
 * Write transaction callbacks as `async () => …`, even when they only return a promise: Dexie keeps a transaction
 * open across native `await`s only when it can see that the callback is an async function.
 */
export class MasterpieceDB extends Dexie {
  // `declare` keeps the class from emitting fields that would shadow the tables Dexie installs.
  declare ships: Table<ShipProfile, string>;
  declare crew: Table<CrewMember, string>;
  declare voyages: Table<Voyage, string>;
  declare certificates: Table<Certificate, string>;
  declare clockChanges: Table<ClockChange, string>;
  declare settings: Table<Settings, 'device'>;
  declare snapshots: Table<Snapshot, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      ships: 'id',
      crew: 'id, shipId',
      voyages: 'id, shipId',
      certificates: 'id, shipId',
      clockChanges: 'id, shipId',
      settings: 'key',
      snapshots: 'id, createdAt',
    });
  }
}

/** A database handle. It opens itself on first use. Tests pass a unique name for a fresh, empty database. */
export function openDb(name: string = APP_DB_NAME): MasterpieceDB {
  return new MasterpieceDB(name);
}

let appDb: MasterpieceDB | undefined;

/** The app's one database, created on first call. */
export function getDb(): MasterpieceDB {
  return (appDb ??= openDb());
}

/**
 * The Dexie table behind a syncable table name. It reads the `db.<name>` property on purpose: `db.table(name)` hands
 * back a different object, so a spy on `db.crew.put` would never see a write made through it.
 */
export function syncTable(db: MasterpieceDB, name: TableName): Table<SyncRecord, string> {
  return db[name] as Table<SyncRecord, string>;
}

/** Every syncable table, in `TABLE_NAMES` order. */
export function syncTables(db: MasterpieceDB): Table<SyncRecord, string>[] {
  return TABLE_NAMES.map((name) => syncTable(db, name));
}
