import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('albinaa.db');
    await initSchema();
  }
  return db;
}

async function initSchema() {
  await db.execAsync(`
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
      lastError TEXT
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
  `);
}

export async function upsert(table: string, record: Record<string, any>) {
  const db2 = await getDb();
  const columns = Object.keys(record).join(', ');
  const placeholders = Object.keys(record).map(() => '?').join(', ');
  const values = Object.values(record);
  const update = Object.keys(record).map((k) => `${k} = excluded.${k}`).join(', ');
  await db2.runAsync(
    `INSERT INTO ${table} (${columns}) VALUES (${placeholders})
     ON CONFLICT(id) DO UPDATE SET ${update}, updatedAt = datetime('now')`,
    ...values,
  );
}

export async function getAll(table: string): Promise<any[]> {
  const db2 = await getDb();
  return await db2.getAllAsync(`SELECT * FROM ${table} ORDER BY updatedAt DESC`);
}

export async function getById(table: string, id: string): Promise<any> {
  const db2 = await getDb();
  return await db2.getFirstAsync(`SELECT * FROM ${table} WHERE id = ?`, id);
}

export async function setMeta(key: string, value: string) {
  const db2 = await getDb();
  await db2.runAsync(
    `INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)`,
    key, value,
  );
}

export async function getMeta(key: string): Promise<string | null> {
  const db2 = await getDb();
  const row = await db2.getFirstAsync<{ value: string }>(
    'SELECT value FROM sync_metadata WHERE key = ?', key,
  );
  return row?.value ?? null;
}

export async function enqueueMutation(operationId: string, type: string, endpoint: string, payload: any) {
  const db2 = await getDb();
  await db2.runAsync(
    `INSERT OR IGNORE INTO mutation_queue (operationId, type, endpoint, payload) VALUES (?, ?, ?, ?)`,
    operationId, type, endpoint, JSON.stringify(payload),
  );
}

export async function getPendingMutations(): Promise<any[]> {
  const db2 = await getDb();
  return await db2.getAllAsync(
    'SELECT * FROM mutation_queue ORDER BY id ASC',
  );
}

export async function removeMutation(id: number) {
  const db2 = await getDb();
  await db2.runAsync('DELETE FROM mutation_queue WHERE id = ?', id);
}

export async function incrementRetry(id: number, error: string) {
  const db2 = await getDb();
  await db2.runAsync(
    'UPDATE mutation_queue SET retryCount = retryCount + 1, lastError = ? WHERE id = ?',
    error, id,
  );
}

export async function getUnsyncedGps(): Promise<any[]> {
  const db2 = await getDb();
  return await db2.getAllAsync('SELECT * FROM gps_queue WHERE synced = 0 ORDER BY id ASC');
}

export async function markGpsSynced(ids: number[]) {
  if (ids.length === 0) return;
  const db2 = await getDb();
  const placeholders = ids.map(() => '?').join(', ');
  await db2.runAsync(
    `UPDATE gps_queue SET synced = 1 WHERE id IN (${placeholders})`, ...ids,
  );
}

export async function saveGpsPoint(point: { latitude: number; longitude: number; accuracy?: number; entityTable?: string; entityId?: string }) {
  const db2 = await getDb();
  await db2.runAsync(
    `INSERT INTO gps_queue (latitude, longitude, accuracy, entityTable, entityId, recordedAt)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    point.latitude, point.longitude, point.accuracy ?? null,
    point.entityTable ?? null, point.entityId ?? null,
  );
}
