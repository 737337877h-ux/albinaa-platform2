import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase;

const SCHEMA_VERSION = 2;

const MIGRATIONS: Record<number, (db: SQLite.SQLiteDatabase) => Promise<void>> = {
  2: async (d) => {
    await d.execAsync(`
      ALTER TABLE mutation_queue ADD COLUMN nextRetryAt TEXT;
      PRAGMA user_version = 2;
    `);
  },
};

async function ensureSchemaVersion(d: SQLite.SQLiteDatabase): Promise<void> {
  const row = await d.getFirstAsync<{ version: number }>('PRAGMA user_version');
  const currentVersion = row?.version ?? 0;

  if (currentVersion === 0) {
    // Fresh install — create full schema at latest version
    await d.execAsync(`
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        fullName TEXT NOT NULL,
        phonePrimary TEXT,
        address TEXT,
        balances TEXT,
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        customerId TEXT,
        customerName TEXT,
        title TEXT,
        dueDate TEXT,
        priority TEXT,
        status TEXT DEFAULT 'pending',
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS followups (
        id TEXT PRIMARY KEY,
        customerId TEXT,
        customerName TEXT,
        typeName TEXT,
        resultName TEXT,
        notes TEXT,
        followupAt TEXT,
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS promises (
        id TEXT PRIMARY KEY,
        customerId TEXT,
        customerName TEXT,
        expectedAmount REAL,
        currencyCode TEXT,
        dueDate TEXT,
        status TEXT,
        notes TEXT,
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        customerId TEXT,
        customerName TEXT,
        amount REAL,
        currencyCode TEXT,
        methodName TEXT,
        notes TEXT,
        collectedAt TEXT,
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS sync_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mutation_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operationId TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        payload TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        retryCount INTEGER DEFAULT 0,
        lastError TEXT,
        nextRetryAt TEXT
      );
      CREATE TABLE IF NOT EXISTS gps_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy REAL,
        entityTable TEXT,
        entityId TEXT,
        recordedAt TEXT NOT NULL,
        synced INTEGER DEFAULT 0
      );
      PRAGMA user_version = ${SCHEMA_VERSION};
    `);
    return;
  }

  // Run pending migrations sequentially
  for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
    const fn = MIGRATIONS[v];
    if (fn) await fn(d);
  }
}

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('albinaa.db');
    await ensureSchemaVersion(db);
  }
  return db;
}

export async function upsert(table: string, record: Record<string, any>) {
  const d = await getDb();
  const columns = Object.keys(record).join(', ');
  const placeholders = Object.keys(record).map(() => '?').join(', ');
  const values = Object.values(record);
  const update = Object.keys(record).map((k) => `${k} = excluded.${k}`).join(', ');
  await d.runAsync(
    `INSERT INTO ${table} (${columns}) VALUES (${placeholders})
     ON CONFLICT(id) DO UPDATE SET ${update}, updatedAt = datetime('now')`,
    ...values,
  );
}

export async function getAll(table: string): Promise<any[]> {
  const d = await getDb();
  return await d.getAllAsync(`SELECT * FROM ${table} ORDER BY updatedAt DESC`);
}

export async function dedupeTable(table: string): Promise<number> {
  const d = await getDb();
  // Keep the most recent record (by updatedAt) per id, delete older duplicates
  const result = await d.runAsync(
    `DELETE FROM ${table} WHERE id IN (
      SELECT id FROM ${table} WHERE rowid NOT IN (
        SELECT MAX(rowid) FROM ${table} GROUP BY id
      )
    )`,
  );
  return (result as any)?.changes ?? 0;
}

export async function getById(table: string, id: string): Promise<any> {
  const d = await getDb();
  return await d.getFirstAsync(`SELECT * FROM ${table} WHERE id = ?`, id);
}

export async function setMeta(key: string, value: string) {
  const d = await getDb();
  await d.runAsync(
    `INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)`,
    key, value,
  );
}

export async function getMeta(key: string): Promise<string | null> {
  const d = await getDb();
  const row = await d.getFirstAsync<{ value: string }>(
    'SELECT value FROM sync_metadata WHERE key = ?', key,
  );
  return row?.value ?? null;
}

export async function enqueueMutation(
  operationId: string, type: string, endpoint: string, payload: any,
) {
  const d = await getDb();
  await d.runAsync(
    `INSERT OR IGNORE INTO mutation_queue (operationId, type, endpoint, payload) VALUES (?, ?, ?, ?)`,
    operationId, type, endpoint, JSON.stringify(payload),
  );
}

export async function getPendingMutations(): Promise<any[]> {
  const d = await getDb();
  return await d.getAllAsync(
    `SELECT * FROM mutation_queue
     WHERE nextRetryAt IS NULL OR datetime(nextRetryAt) <= datetime('now')
     ORDER BY id ASC`,
  );
}

export async function removeMutation(id: number) {
  const d = await getDb();
  await d.runAsync('DELETE FROM mutation_queue WHERE id = ?', id);
}

function calculateBackoff(retryCount: number): number {
  const baseMs = 2000;
  const maxMs = 120_000;
  const delay = Math.min(baseMs * Math.pow(2, retryCount), maxMs);
  const jitter = Math.random() * 0.3 * delay;
  return Math.floor(delay + jitter);
}

export async function incrementRetry(id: number, error: string) {
  const d = await getDb();
  const row = await d.getFirstAsync<{ retryCount: number }>(
    'SELECT retryCount FROM mutation_queue WHERE id = ?', id,
  );
  const retryCount = (row?.retryCount ?? 0) + 1;
  const nextRetryAt = new Date(Date.now() + calculateBackoff(retryCount)).toISOString();
  await d.runAsync(
    `UPDATE mutation_queue SET retryCount = ?, lastError = ?, nextRetryAt = ? WHERE id = ?`,
    retryCount, error, nextRetryAt, id,
  );
}

export async function getUnsyncedGps(): Promise<any[]> {
  const d = await getDb();
  return await d.getAllAsync('SELECT * FROM gps_queue WHERE synced = 0 ORDER BY id ASC');
}

export async function markGpsSynced(ids: number[]) {
  if (ids.length === 0) return;
  const d = await getDb();
  const placeholders = ids.map(() => '?').join(', ');
  await d.runAsync(
    `UPDATE gps_queue SET synced = 1 WHERE id IN (${placeholders})`, ...ids,
  );
}

export async function saveGpsPoint(point: {
  latitude: number; longitude: number; accuracy?: number;
  entityTable?: string; entityId?: string;
}) {
  const d = await getDb();
  await d.runAsync(
    `INSERT INTO gps_queue (latitude, longitude, accuracy, entityTable, entityId, recordedAt)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    point.latitude, point.longitude, point.accuracy ?? null,
    point.entityTable ?? null, point.entityId ?? null,
  );
}
