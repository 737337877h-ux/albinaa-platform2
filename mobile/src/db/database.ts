import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase;

const SCHEMA_VERSION = 5;

const BUSINESS_TABLES = ['customers', 'tasks', 'followups', 'promises', 'collections'] as const;
type BusinessTable = typeof BUSINESS_TABLES[number];

const TABLE_COLUMNS: Record<BusinessTable, string[]> = {
  customers: ['id', 'fullName', 'phonePrimary', 'address', 'balances'],
  tasks: ['id', 'customerId', 'customerName', 'title', 'dueDate', 'priority', 'status'],
  followups: ['id', 'customerId', 'customerName', 'typeName', 'resultName', 'notes', 'followupAt'],
  promises: ['id', 'customerId', 'customerName', 'expectedAmount', 'currencyCode', 'dueDate', 'status', 'notes'],
  collections: ['id', 'customerId', 'customerName', 'amount', 'currencyCode', 'methodName', 'notes', 'collectedAt'],
};

const MIGRATIONS: Record<number, (db: SQLite.SQLiteDatabase) => Promise<void>> = {
  2: async (d) => {
    await d.execAsync(`
      ALTER TABLE mutation_queue ADD COLUMN nextRetryAt TEXT;
      PRAGMA user_version = 2;
    `);
  },
  3: async (d) => {
    // Ensure UNIQUE indexes on every table that uses id as the conflict key.
    // PRIMARY KEY already enforces uniqueness, but explicit UNIQUE indexes
    // make the intent clear and protect against schema drift.
    await d.execAsync(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_id ON customers(id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_id ON tasks(id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_followups_id ON followups(id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_promises_id ON promises(id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_collections_id ON collections(id);
      PRAGMA user_version = 3;
    `);
  },
  4: async (d) => {
    await d.execAsync(`
      ALTER TABLE mutation_queue ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
      ALTER TABLE mutation_queue ADD COLUMN blockedAt TEXT;
      CREATE INDEX IF NOT EXISTS idx_mutation_queue_status_retry
        ON mutation_queue(status, nextRetryAt, id);
      PRAGMA user_version = 4;
    `);
  },
  5: async (d) => {
    await d.execAsync(`
      CREATE TABLE IF NOT EXISTS reference_options (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        code TEXT,
        payload TEXT,
        updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (kind, id)
      );
      CREATE INDEX IF NOT EXISTS idx_reference_options_kind ON reference_options(kind, name);
      PRAGMA user_version = 5;
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
        nextRetryAt TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        blockedAt TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_mutation_queue_status_retry
        ON mutation_queue(status, nextRetryAt, id);
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
      CREATE TABLE IF NOT EXISTS reference_options (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        code TEXT,
        payload TEXT,
        updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (kind, id)
      );
      CREATE INDEX IF NOT EXISTS idx_reference_options_kind ON reference_options(kind, name);
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
  if (!BUSINESS_TABLES.includes(table as BusinessTable)) throw new Error(`Unsupported table: ${table}`);
  await upsertWithDatabase(d, table as BusinessTable, record);
}

async function upsertWithDatabase(
  d: SQLite.SQLiteDatabase,
  table: BusinessTable,
  record: Record<string, any>,
) {
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

async function materializeQueuedMutation(
  d: SQLite.SQLiteDatabase,
  operationId: string,
  endpoint: string,
  payload: Record<string, any>,
) {
  const id = `local:${operationId}`;
  const customer = payload.customerId
    ? await d.getFirstAsync<{ fullName: string }>('SELECT fullName FROM customers WHERE id = ?', payload.customerId)
    : null;
  const customerName = customer?.fullName ?? 'عميل';
  if (endpoint === '/collections') {
    await upsertWithDatabase(d, 'collections', {
      id, customerId: payload.customerId, customerName,
      amount: payload.amount, currencyCode: payload.currencyCode,
      methodName: 'بانتظار المزامنة', notes: payload.notes,
      collectedAt: payload.collectedAt || new Date().toISOString(),
    });
  } else if (endpoint === '/followups') {
    await upsertWithDatabase(d, 'followups', {
      id, customerId: payload.customerId, customerName,
      typeName: 'بانتظار المزامنة', resultName: '', notes: payload.notes,
      followupAt: payload.followupAt || new Date().toISOString(),
    });
  } else if (endpoint === '/payment-promises') {
    await upsertWithDatabase(d, 'promises', {
      id, customerId: payload.customerId, customerName,
      expectedAmount: payload.expectedAmount, currencyCode: payload.currencyCode,
      dueDate: payload.dueDate, status: 'بانتظار المزامنة', notes: payload.notes,
    });
  } else if (endpoint === '/tasks') {
    await upsertWithDatabase(d, 'tasks', {
      id, customerId: payload.customerId, customerName,
      title: payload.priorityReason || payload.taskType || 'مهمة محلية',
      dueDate: payload.dueDate, priority: payload.taskType, status: 'pending',
    });
  }
}

export async function getAll(table: string): Promise<any[]> {
  const d = await getDb();
  if (!BUSINESS_TABLES.includes(table as BusinessTable)) throw new Error(`Unsupported table: ${table}`);
  return await d.getAllAsync(`SELECT * FROM ${table} ORDER BY updatedAt DESC`);
}

export async function dedupeTable(table: string): Promise<number> {
  const d = await getDb();
  if (!BUSINESS_TABLES.includes(table as BusinessTable)) throw new Error(`Unsupported table: ${table}`);
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
  if (!BUSINESS_TABLES.includes(table as BusinessTable)) throw new Error(`Unsupported table: ${table}`);
  return await d.getFirstAsync(`SELECT * FROM ${table} WHERE id = ?`, id);
}

export async function getCustomerOffline360(id: string): Promise<any | null> {
  const d = await getDb();
  const customer = await d.getFirstAsync<any>('SELECT * FROM customers WHERE id = ?', id);
  if (!customer) return null;
  const [followups, promises, collections] = await Promise.all([
    d.getAllAsync<any>('SELECT * FROM followups WHERE customerId = ? ORDER BY followupAt DESC LIMIT 20', id),
    d.getAllAsync<any>('SELECT * FROM promises WHERE customerId = ? ORDER BY dueDate DESC LIMIT 20', id),
    d.getAllAsync<any>('SELECT * FROM collections WHERE customerId = ? ORDER BY collectedAt DESC LIMIT 20', id),
  ]);
  const timeline = [
    ...followups.map((item) => ({ at: item.followupAt, type: 'followup', title: `متابعة — ${item.resultName || item.typeName || ''}` })),
    ...promises.map((item) => ({ at: item.dueDate, type: 'payment_promise', title: `وعد سداد ${Number(item.expectedAmount || 0).toLocaleString('en-US')} ${item.currencyCode || ''}` })),
    ...collections.map((item) => ({ at: item.collectedAt, type: 'collection', title: `تحصيل ${Number(item.amount || 0).toLocaleString('en-US')} ${item.currencyCode || ''}` })),
  ].sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 20);
  return { ...customer, timeline, recentFollowups: followups, recentPromises: promises, recentCollections: collections };
}

function normalizeRecord(table: BusinessTable, record: Record<string, any>): Record<string, any> | null {
  if (!record?.id) return null;
  const normalized: Record<string, any> = {};
  for (const column of TABLE_COLUMNS[table]) {
    if (record[column] !== undefined) normalized[column] = record[column];
  }
  if (table === 'customers' && normalized.balances !== undefined && typeof normalized.balances !== 'string') {
    normalized.balances = JSON.stringify(normalized.balances || []);
  }
  return normalized;
}

export interface MobileSyncBatch {
  customers?: Record<string, any>[];
  tasks?: Record<string, any>[];
  followups?: Record<string, any>[];
  promises?: Record<string, any>[];
  collections?: Record<string, any>[];
  references?: Record<string, Record<string, any>[]>;
}

/**
 * Applies a server snapshot and advances its token atomically. If the app is
 * closed during this operation SQLite rolls everything back, so the same
 * server page is requested again on the next launch.
 */
export async function applySyncSnapshot(batch: MobileSyncBatch, syncToken: string): Promise<void> {
  const d = await getDb();
  await d.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(`
      CREATE TEMP TABLE IF NOT EXISTS sync_seen_ids (
        tableName TEXT NOT NULL,
        id TEXT NOT NULL,
        PRIMARY KEY (tableName, id)
      )
    `);
    for (const table of BUSINESS_TABLES) {
      const records = batch[table];
      if (!records) continue;
      await tx.runAsync('DELETE FROM sync_seen_ids WHERE tableName = ?', table);
      const seen = new Set<string>();
      for (const raw of records) {
        if (!raw?.id || seen.has(raw.id)) continue;
        seen.add(raw.id);
        const record = normalizeRecord(table, raw);
        if (record) {
          await upsertWithDatabase(tx, table, record);
          await tx.runAsync(
            'INSERT OR IGNORE INTO sync_seen_ids (tableName, id) VALUES (?, ?)',
            table,
            String(raw.id),
          );
        }
      }
      // Keep the previous snapshot readable while the (potentially large)
      // upsert is running. Stale rows are removed only after every incoming
      // row is safely present, avoiding transient "customer not found"
      // screens during background sync.
      await tx.runAsync(
        `DELETE FROM ${table}
         WHERE NOT EXISTS (
           SELECT 1 FROM sync_seen_ids
           WHERE tableName = ? AND sync_seen_ids.id = ${table}.id
         )`,
        table,
      );
    }
    await tx.runAsync('DELETE FROM sync_seen_ids');
    if (batch.references) {
      await tx.runAsync('DELETE FROM reference_options');
      for (const [kind, options] of Object.entries(batch.references)) {
        for (const option of options || []) {
          const id = String(option.id ?? option.code ?? '');
          if (!id) continue;
          const name = String(option.name ?? option.nameAr ?? option.code ?? id);
          await tx.runAsync(
            `INSERT OR REPLACE INTO reference_options (kind, id, name, code, payload, updatedAt)
             VALUES (?, ?, ?, ?, ?, datetime('now'))`,
            kind, id, name, option.code ?? null, JSON.stringify(option),
          );
        }
      }
    }
    const queued = await tx.getAllAsync<{ operationId: string; endpoint: string; payload: string }>(
      "SELECT operationId, endpoint, payload FROM mutation_queue WHERE status IN ('pending', 'blocked') ORDER BY id ASC",
    );
    for (const item of queued) {
      try {
        await materializeQueuedMutation(tx, item.operationId, item.endpoint, JSON.parse(item.payload));
      } catch { /* malformed queued data remains available in queue diagnostics */ }
    }
    await tx.runAsync(
      'INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)',
      'syncToken', syncToken,
    );
    await tx.runAsync(
      'INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)',
      'lastSyncAt', new Date().toISOString(),
    );
  });
}

/**
 * Ensures cached business data can only be read by the account that created
 * it. Existing unscoped data is treated as unsafe and removed once.
 */
export async function ensureDataOwner(ownerId: string): Promise<boolean> {
  const d = await getDb();
  const row = await d.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_metadata WHERE key = 'dataOwner'",
  );
  if (row?.value === ownerId) return false;

  await d.withExclusiveTransactionAsync(async (tx) => {
    for (const table of BUSINESS_TABLES) await tx.runAsync(`DELETE FROM ${table}`);
    await tx.runAsync('DELETE FROM mutation_queue');
    await tx.runAsync('DELETE FROM gps_queue');
    await tx.runAsync('DELETE FROM reference_options');
    await tx.runAsync('DELETE FROM sync_metadata');
    await tx.runAsync(
      'INSERT INTO sync_metadata (key, value) VALUES (?, ?)',
      'dataOwner', ownerId,
    );
  });
  return true;
}

export async function getReferenceOptions(kind: string): Promise<any[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<{ payload: string }>(
    'SELECT payload FROM reference_options WHERE kind = ? ORDER BY name ASC', kind,
  );
  return rows.map((row) => {
    try { return JSON.parse(row.payload); } catch { return null; }
  }).filter(Boolean);
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
  await materializeQueuedMutation(d, operationId, endpoint, payload);
}

export async function getPendingMutations(): Promise<any[]> {
  const d = await getDb();
  return await d.getAllAsync(
    `SELECT * FROM mutation_queue
     WHERE status = 'pending'
       AND (nextRetryAt IS NULL OR datetime(nextRetryAt) <= datetime('now'))
     ORDER BY id ASC`,
  );
}

export async function getMutationQueueStats(): Promise<{ pending: number; blocked: number }> {
  const d = await getDb();
  const rows = await d.getAllAsync<{ status: string; count: number }>(
    'SELECT status, COUNT(*) AS count FROM mutation_queue GROUP BY status',
  );
  return rows.reduce((acc, row) => {
    if (row.status === 'blocked') acc.blocked = row.count;
    else acc.pending += row.count;
    return acc;
  }, { pending: 0, blocked: 0 });
}

export async function removeMutation(id: number) {
  const d = await getDb();
  const row = await d.getFirstAsync<{ operationId: string }>(
    'SELECT operationId FROM mutation_queue WHERE id = ?', id,
  );
  await d.runAsync('DELETE FROM mutation_queue WHERE id = ?', id);
  if (row?.operationId) {
    const localId = `local:${row.operationId}`;
    for (const table of ['tasks', 'followups', 'promises', 'collections'] as BusinessTable[]) {
      await d.runAsync(`DELETE FROM ${table} WHERE id = ?`, localId);
    }
  }
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

export async function blockMutation(id: number, error: string) {
  const d = await getDb();
  await d.runAsync(
    `UPDATE mutation_queue
     SET status = 'blocked', lastError = ?, blockedAt = datetime('now'), nextRetryAt = NULL
     WHERE id = ?`,
    error, id,
  );
}

export async function retryBlockedMutations() {
  const d = await getDb();
  await d.runAsync(
    `UPDATE mutation_queue
     SET status = 'pending', retryCount = 0, lastError = NULL, blockedAt = NULL, nextRetryAt = NULL
     WHERE status = 'blocked'`,
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
