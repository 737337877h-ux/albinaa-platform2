import * as SQLite from 'expo-sqlite';
import { inventoryCostAccess } from '../utils/inventory-cost-access';

export async function purgeInventoryCosts(permissions:readonly string[]) {
 if(permissions.includes('mobile.inventory.cost.view'))return;
 const d=await getDb();
 await d.withExclusiveTransactionAsync(async tx=>{
  for(const table of ['inventory_items','inventory_summary'] as const){
   const rows=await tx.getAllAsync<{rowid:number;payload:string}>(`SELECT rowid,payload FROM ${table}`);
   for(const row of rows){const clean=JSON.stringify(inventoryCostAccess(JSON.parse(row.payload),permissions));if(clean!==row.payload)await tx.runAsync(`UPDATE ${table} SET payload=? WHERE rowid=?`,clean,row.rowid);}
  }
  const rows=await tx.getAllAsync<{rowid:number;payload:string}>("SELECT rowid,payload FROM reference_options WHERE kind IN ('oracleItems','oracleInventorySummary')");
  for(const row of rows){const clean=JSON.stringify(inventoryCostAccess(JSON.parse(row.payload),permissions));if(clean!==row.payload)await tx.runAsync('UPDATE reference_options SET payload=? WHERE rowid=?',clean,row.rowid);}
 });
}
import { normalizeSmartSearch, smartSearchTerms } from '../utils/search';

let db: SQLite.SQLiteDatabase;
let dbOpening: Promise<SQLite.SQLiteDatabase> | null = null;
let ownerTransition: Promise<void> | null = null;

const SCHEMA_VERSION = 21;

const BUSINESS_TABLES = ['customers', 'tasks', 'followups', 'promises', 'collections', 'reservations'] as const;
type BusinessTable = typeof BUSINESS_TABLES[number];

async function hasColumn(
  d: SQLite.SQLiteDatabase,
  table: string,
  column: string,
): Promise<boolean> {
  const columns = await d.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return columns.some((item) => item.name === column);
}

async function addColumnIfMissing(
  d: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  if (!(await hasColumn(d, table, column))) {
    await d.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

const TABLE_COLUMNS: Record<BusinessTable, string[]> = {
  customers: ['id', 'fullName', 'accountNumber', 'externalCustomerCode', 'customerType',
    'phonePrimary', 'phoneSecondary', 'whatsapp', 'address', 'geoLat', 'geoLng',
    'assignedCollectorName', 'balances', 'balanceHidden', 'accountGroupRole', 'groupBalances', 'childBalances',
    'hasRecordedEngagement', 'lastEngagementAt', 'hasRecordedFollowup'],
  tasks: ['id', 'customerId', 'customerName', 'title', 'dueDate', 'priority', 'status'],
  followups: ['id', 'customerId', 'customerName', 'typeName', 'resultName', 'notes', 'followupAt'],
  promises: ['id', 'customerId', 'customerName', 'expectedAmount', 'fulfilledAmount', 'currencyCode', 'dueDate', 'status', 'notes', 'settlementDate', 'settledLate', 'missedDueDate'],
  collections: ['id', 'customerId', 'customerName', 'amount', 'currencyCode', 'methodName', 'notes', 'collectedAt', 'receiptAttachment', 'location', 'status', 'source', 'statusVerified'],
  reservations: ['id', 'customerId', 'customerName', 'itemName', 'quantity', 'remainingQty', 'unitName', 'totalAmount', 'currencyCode', 'totalTons', 'averageTonPrice', 'reservedAt', 'expiresAt', 'status'],
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
  6: async (d) => {
    await d.execAsync(`
      ALTER TABLE customers ADD COLUMN accountNumber TEXT;
      ALTER TABLE customers ADD COLUMN externalCustomerCode TEXT;
      ALTER TABLE customers ADD COLUMN customerType TEXT;
      ALTER TABLE customers ADD COLUMN phoneSecondary TEXT;
      ALTER TABLE customers ADD COLUMN whatsapp TEXT;
      ALTER TABLE customers ADD COLUMN geoLat REAL;
      ALTER TABLE customers ADD COLUMN geoLng REAL;
      CREATE INDEX IF NOT EXISTS idx_customers_type_name ON customers(customerType, fullName);
      CREATE INDEX IF NOT EXISTS idx_customers_account ON customers(accountNumber);
      PRAGMA user_version = 6;
    `);
  },
  7: async (d) => {
    await d.execAsync(`
      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY,
        customerId TEXT,
        customerName TEXT,
        itemName TEXT,
        quantity REAL,
        remainingQty REAL,
        unitName TEXT,
        totalAmount REAL,
        currencyCode TEXT,
        totalTons REAL,
        averageTonPrice REAL,
        reservedAt TEXT,
        expiresAt TEXT,
        status TEXT,
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_reservations_customer_status ON reservations(customerId, status);
      PRAGMA user_version = 7;
    `);
  },
  8: async (d) => {
    await addColumnIfMissing(d, 'customers', 'assignedCollectorName', 'TEXT');
    await d.execAsync(`
      UPDATE mutation_queue
      SET endpoint = REPLACE(endpoint, '/customers/', '/mobile/customers/') || '/field-update',
          status = 'pending', retryCount = 0, lastError = NULL,
          blockedAt = NULL, nextRetryAt = NULL
      WHERE type = 'PATCH' AND endpoint LIKE '/customers/%';
      PRAGMA user_version = 8;
    `);
  },
  9: async (d) => {
    // Self-heal databases that were marked as v8 by an older PRAGMA reader
    // although CREATE TABLE IF NOT EXISTS could not add the new column.
    await addColumnIfMissing(d, 'customers', 'assignedCollectorName', 'TEXT');
    await d.execAsync(`
      UPDATE mutation_queue
      SET endpoint = REPLACE(endpoint, '/customers/', '/mobile/customers/') || '/field-update',
          status = 'pending', retryCount = 0, lastError = NULL,
          blockedAt = NULL, nextRetryAt = NULL
      WHERE type = 'PATCH' AND endpoint LIKE '/customers/%';
      PRAGMA user_version = 9;
    `);
  },
  10: async (d) => {
    await addColumnIfMissing(d, 'collections', 'receiptAttachment', 'TEXT');
    await addColumnIfMissing(d, 'collections', 'location', 'TEXT');
    await d.execAsync('PRAGMA user_version = 10;');
  },
  11: async (d) => {
    await addColumnIfMissing(d, 'customers', 'balanceHidden', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnIfMissing(d, 'customers', 'accountGroupRole', 'TEXT');
    await addColumnIfMissing(d, 'customers', 'groupBalances', 'TEXT');
    await addColumnIfMissing(d, 'customers', 'childBalances', 'TEXT');
    await d.execAsync('PRAGMA user_version = 11;');
  },
  12: async (d) => {
    await d.execAsync(`
      CREATE TABLE IF NOT EXISTS offline_requests (
        operationId TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        lastError TEXT,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        syncedAt TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_offline_requests_status_created
        ON offline_requests(status, createdAt DESC);
      PRAGMA user_version = 12;
    `);
  },
  13: async (d) => {
    await d.execAsync(`
      CREATE TABLE IF NOT EXISTS inventory_items (
        itemCode TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        groupName TEXT,
        searchText TEXT NOT NULL,
        payload TEXT NOT NULL,
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_inventory_items_name ON inventory_items(name);
      CREATE TABLE IF NOT EXISTS inventory_barcodes (
        barcode TEXT PRIMARY KEY,
        itemCode TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_inventory_barcodes_item ON inventory_barcodes(itemCode);
      CREATE TABLE IF NOT EXISTS inventory_summary (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );
      PRAGMA user_version = 13;
    `);
  },
  14: async (d) => {
    await d.execAsync(`
      CREATE TABLE IF NOT EXISTS customer_orders (
        id TEXT PRIMARY KEY,
        sourceOrderSerial TEXT NOT NULL,
        sourceOrderNo TEXT,
        orderKind TEXT NOT NULL,
        customerCode TEXT,
        customerName TEXT,
        orderDate TEXT,
        status TEXT,
        searchText TEXT NOT NULL,
        payload TEXT NOT NULL,
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_customer_orders_kind_date
        ON customer_orders(orderKind, orderDate DESC);
      CREATE INDEX IF NOT EXISTS idx_customer_orders_customer
        ON customer_orders(customerCode, customerName);
      PRAGMA user_version = 14;
    `);
  },
  15: async (d) => {
    await addColumnIfMissing(d, 'offline_requests', 'payload', "TEXT NOT NULL DEFAULT '{}'");
    await addColumnIfMissing(d, 'offline_requests', 'updatedAt', 'TEXT');
    await d.execAsync(`
      UPDATE offline_requests SET updatedAt = COALESCE(updatedAt, createdAt);
      CREATE INDEX IF NOT EXISTS idx_offline_requests_kind_status
        ON offline_requests(kind, status, updatedAt DESC);
      PRAGMA user_version = 15;
    `);
  },
  16: async (d) => {
    await addColumnIfMissing(d, 'customers', 'hasRecordedEngagement', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnIfMissing(d, 'customers', 'lastEngagementAt', 'TEXT');
    await d.execAsync('PRAGMA user_version = 16;');
  },
  17: async (d) => {
    // Older installations already at v16 never ran the fresh-install table DDL.
    await d.execAsync(`
      CREATE TABLE IF NOT EXISTS attendance_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operationId TEXT NOT NULL UNIQUE,
        scope TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT
      );
      PRAGMA user_version = 17;
    `);
  },
};

// Nullable until the first full server snapshot: no history is not the same as unknown history.
MIGRATIONS[18] = async (d) => {
  await addColumnIfMissing(d, 'customers', 'hasRecordedFollowup', 'INTEGER');
  await d.execAsync('PRAGMA user_version = 18;');
};

MIGRATIONS[19] = async (d) => {
  await addColumnIfMissing(d, 'promises', 'settlementDate', 'TEXT');
  await addColumnIfMissing(d, 'promises', 'settledLate', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing(d, 'promises', 'missedDueDate', 'TEXT');
  await d.execAsync('PRAGMA user_version = 19;');
};

MIGRATIONS[20] = async (d) => {
  await addColumnIfMissing(d, 'collections', 'status', "TEXT NOT NULL DEFAULT 'unknown'");
  await addColumnIfMissing(d, 'collections', 'source', 'TEXT');
  await addColumnIfMissing(d, 'collections', 'statusVerified', 'INTEGER NOT NULL DEFAULT 0');
  await d.execAsync('PRAGMA user_version = 20;');
};

MIGRATIONS[21] = async (d) => {
  await addColumnIfMissing(d, 'promises', 'fulfilledAmount', 'REAL');
  await d.execAsync('PRAGMA user_version = 21;');
};

async function ensureSchemaVersion(d: SQLite.SQLiteDatabase): Promise<void> {
  const row = await d.getFirstAsync<{ user_version?: number; version?: number }>('PRAGMA user_version');
  const currentVersion = row?.user_version ?? row?.version ?? 0;

  if (currentVersion === 0) {
    // Fresh install — create full schema at latest version
    await d.execAsync(`
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        fullName TEXT NOT NULL,
        accountNumber TEXT,
        externalCustomerCode TEXT,
        customerType TEXT,
        phonePrimary TEXT,
        phoneSecondary TEXT,
        whatsapp TEXT,
        address TEXT,
        geoLat REAL,
        geoLng REAL,
        assignedCollectorName TEXT,
        balances TEXT,
        balanceHidden INTEGER NOT NULL DEFAULT 0,
        accountGroupRole TEXT,
        groupBalances TEXT,
        childBalances TEXT,
        hasRecordedEngagement INTEGER NOT NULL DEFAULT 0,
        hasRecordedFollowup INTEGER,
        lastEngagementAt TEXT,
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
        fulfilledAmount REAL,
        currencyCode TEXT,
        dueDate TEXT,
        status TEXT,
        notes TEXT,
        settlementDate TEXT,
        settledLate INTEGER NOT NULL DEFAULT 0,
        missedDueDate TEXT,
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
        receiptAttachment TEXT,
        location TEXT,
        status TEXT NOT NULL DEFAULT 'unknown',
        source TEXT,
        statusVerified INTEGER NOT NULL DEFAULT 0,
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS sync_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attendance_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operationId TEXT NOT NULL UNIQUE,
        scope TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT
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
      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY,
        customerId TEXT,
        customerName TEXT,
        itemName TEXT,
        quantity REAL,
        remainingQty REAL,
        unitName TEXT,
        totalAmount REAL,
        currencyCode TEXT,
        totalTons REAL,
        averageTonPrice REAL,
        reservedAt TEXT,
        expiresAt TEXT,
        status TEXT,
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_reservations_customer_status ON reservations(customerId, status);
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
      CREATE TABLE IF NOT EXISTS offline_requests (
        operationId TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        lastError TEXT,
        payload TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
        syncedAt TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_offline_requests_status_created
        ON offline_requests(status, createdAt DESC);
      CREATE TABLE IF NOT EXISTS inventory_items (
        itemCode TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        groupName TEXT,
        searchText TEXT NOT NULL,
        payload TEXT NOT NULL,
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_inventory_items_name ON inventory_items(name);
      CREATE TABLE IF NOT EXISTS inventory_barcodes (
        barcode TEXT PRIMARY KEY,
        itemCode TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_inventory_barcodes_item ON inventory_barcodes(itemCode);
      CREATE TABLE IF NOT EXISTS inventory_summary (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS customer_orders (
        id TEXT PRIMARY KEY,
        sourceOrderSerial TEXT NOT NULL,
        sourceOrderNo TEXT,
        orderKind TEXT NOT NULL,
        customerCode TEXT,
        customerName TEXT,
        orderDate TEXT,
        status TEXT,
        searchText TEXT NOT NULL,
        payload TEXT NOT NULL,
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_customer_orders_kind_date
        ON customer_orders(orderKind, orderDate DESC);
      CREATE INDEX IF NOT EXISTS idx_customer_orders_customer
        ON customer_orders(customerCode, customerName);
      CREATE INDEX IF NOT EXISTS idx_customers_type_name ON customers(customerType, fullName);
      CREATE INDEX IF NOT EXISTS idx_customers_account ON customers(accountNumber);
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

async function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  if (!dbOpening) {
    dbOpening = (async () => {
      const opened = await SQLite.openDatabaseAsync('albinaa.db');
      await opened.execAsync('PRAGMA journal_mode = WAL;');
      await ensureSchemaVersion(opened);
      db = opened;
      return opened;
    })().finally(() => { dbOpening = null; });
  }
  return dbOpening;
}

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  // Account ownership changes clear and re-scope cached business data. New
  // reads wait for that short transaction instead of preparing statements
  // against SQLite while its exclusive transaction is being replaced.
  if (ownerTransition) await ownerTransition;
  return openDb();
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

async function upsertRecordsBatched(
  d: SQLite.SQLiteDatabase,
  table: BusinessTable,
  records: Record<string, any>[],
): Promise<void> {
  const groups = new Map<string, { columns: string[]; records: Record<string, any>[] }>();
  for (const record of records) {
    const columns = Object.keys(record);
    if (!columns.includes('id')) continue;
    const key = columns.join('|');
    const group = groups.get(key) ?? { columns, records: [] };
    group.records.push(record);
    groups.set(key, group);
  }
  for (const { columns, records: matching } of groups.values()) {
    const update = columns.map((column) => `${column} = excluded.${column}`).join(', ');
    const chunkSize = Math.max(1, Math.min(50, Math.floor(800 / columns.length)));
    for (let start = 0; start < matching.length; start += chunkSize) {
      const chunk = matching.slice(start, start + chunkSize);
      await d.runAsync(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES
         ${chunk.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ')}
         ON CONFLICT(id) DO UPDATE SET ${update}, updatedAt = datetime('now')`,
        ...chunk.flatMap((record) => columns.map((column) => record[column])),
      );
    }
  }
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
  if (['/collections', '/followups', '/payment-promises'].includes(endpoint) && payload.customerId) {
    await d.runAsync(
      `UPDATE tasks SET status = 'done', updatedAt = datetime('now')
       WHERE customerId = ? AND status IN ('open', 'pending')
         AND (dueDate IS NULL OR date(dueDate) <= date('now'))`,
      payload.customerId,
    );
  }
  if (endpoint === '/collections') {
    const existing = await d.getFirstAsync<{ id: string }>('SELECT id FROM collections WHERE id = ?', id);
    await upsertWithDatabase(d, 'collections', {
      id, customerId: payload.customerId, customerName,
      amount: payload.amount, currencyCode: payload.currencyCode,
      methodName: 'بانتظار المزامنة', notes: payload.notes,
      collectedAt: payload.collectedAt || new Date().toISOString(),
      status: 'pending_sync', source: 'platform_collection', statusVerified: 0,
    });
    if (!existing) {
      await applyLocalCollectionBalance(d, payload.customerId, payload.currencyCode, Number(payload.amount || 0));
    }
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
  } else if (endpoint === '/reservations') {
    const unit = await d.getFirstAsync<{ name: string }>(
      'SELECT name FROM reference_options WHERE kind = ? AND id = ?',
      'reservationUnits', payload.unitId,
    );
    const quantity = Number(payload.totalTons || payload.quantity || 0);
    const unitPrice = Number(payload.unitPrice || 0);
    await upsertWithDatabase(d, 'reservations', {
      id, customerId: payload.customerId, customerName,
      itemName: payload.itemName || 'حجز إجمالي بالطن', quantity, remainingQty: quantity,
      unitName: unit?.name || 'طن', totalTons: quantity, averageTonPrice: unitPrice,
      totalAmount: quantity * unitPrice, currencyCode: payload.currencyCode,
      reservedAt: new Date().toISOString(), expiresAt: payload.expiresAt,
      status: 'open',
    });
  } else if (endpoint === '/sales-order-drafts') {
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    const sourceAmount = lines.reduce(
      (sum: number, line: any) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0,
    );
    const sourceOrderSerial = `local:${operationId}`;
    const sourceOrderNo = `محلي-${String(operationId).split(':').slice(-2, -1)[0] || Date.now()}`;
    const item = {
      id, sourceSchema: 'PLATFORM', sourceOrderSerial, sourceOrderNo,
      sourceOrderDate: payload.orderDate, orderKind: payload.orderKind,
      sourceCustomerCode: payload.customerCode || null, sourceCustomerName: payload.customerName,
      proposedCustomerCode: payload.customerCode || null, proposedCustomerName: payload.customerName,
      currencyCode: payload.currencyCode, sourceAmount, status: 'pending_sync',
      validationStatus: 'local_pending', customerBindingStatus: payload.orderKind === 'cash' ? 'cash_name_only' : 'linked_by_code',
      oracleWriteEnabled: false, notes: payload.notes || null,
      lines: lines.map((line: any, index: number) => ({
        id: `${id}:line:${index + 1}`, lineNo: index + 1, itemCode: line.itemCode,
        itemName: line.itemName, unitCode: line.unitCode, quantity: line.quantity,
        sourcePrice: line.unitPrice, sourceWarehouseCode: line.warehouseCode,
        proposedWarehouseCode: line.warehouseCode, validationStatus: 'local_pending',
      })),
    };
    const searchText = [sourceOrderNo, payload.customerCode, payload.customerName]
      .filter(Boolean).join(' ').toLocaleLowerCase('ar');
    await d.runAsync(
      `INSERT OR REPLACE INTO customer_orders
       (id, sourceOrderSerial, sourceOrderNo, orderKind, customerCode, customerName, orderDate, status, searchText, payload, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      id, sourceOrderSerial, sourceOrderNo, payload.orderKind, payload.customerCode || null,
      payload.customerName, payload.orderDate, 'pending_sync', searchText, JSON.stringify(item),
    );
  }
}

export async function getAll(table: string): Promise<any[]> {
  const d = await getDb();
  if (!BUSINESS_TABLES.includes(table as BusinessTable)) throw new Error(`Unsupported table: ${table}`);
  return await d.getAllAsync(`SELECT * FROM ${table} ORDER BY updatedAt DESC`);
}

export async function getCustomerOptionsOffline(): Promise<any[]> {
  const d = await getDb();
  return d.getAllAsync(
    `SELECT id, fullName, accountNumber, externalCustomerCode,
            phonePrimary, phoneSecondary, whatsapp
     FROM customers ORDER BY fullName COLLATE NOCASE ASC`,
  );
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

export async function updateCustomerPhoneOffline(id: string, phonePrimary: string): Promise<void> {
  return updateCustomerContactOffline(id, { phonePrimary });
}

export async function updateCustomerContactOffline(
  id: string,
  fields: { phonePrimary?: string; phoneSecondary?: string; whatsapp?: string },
): Promise<void> {
  const d = await getDb();
  const entries = Object.entries(fields).filter(([key]) => ['phonePrimary', 'phoneSecondary', 'whatsapp'].includes(key));
  if (entries.length === 0) return;
  const setClause = entries.map(([key]) => `${key} = ?`).join(', ');
  await d.runAsync(
    `UPDATE customers SET ${setClause}, updatedAt = datetime('now') WHERE id = ?`,
    ...entries.map(([, value]) => value ?? ''), id,
  );
}

async function applyLocalCollectionBalance(
  d: SQLite.SQLiteDatabase,
  customerId: string,
  currencyCode: string,
  amount: number,
): Promise<void> {
  if (!customerId || !currencyCode || !Number.isFinite(amount) || amount <= 0) return;
  const customer = await d.getFirstAsync<{ balances: string | null }>(
    'SELECT balances FROM customers WHERE id = ?', customerId,
  );
  if (!customer) return;
  let balances: any[];
  try { balances = JSON.parse(customer.balances || '[]'); } catch { balances = []; }
  let found = false;
  balances = balances.map((item) => {
    const currency = item?.currency || item?.currencyCode;
    if (currency !== currencyCode) return item;
    found = true;
    const current = Number(item?.operationalBalance ?? item?.balance ?? item?.accountingBalance ?? 0);
    return { ...item, operationalBalance: current - amount };
  });
  if (!found) balances.push({ currency: currencyCode, balance: 0, operationalBalance: -amount });
  await d.runAsync(
    "UPDATE customers SET balances = ?, updatedAt = datetime('now') WHERE id = ?",
    JSON.stringify(balances), customerId,
  );
}

export async function recordCollectionOffline(input: {
  id: string;
  customerId: string;
  customerName?: string;
  amount: number;
  currencyCode: string;
  methodName?: string;
  notes?: string;
  collectedAt?: string;
}): Promise<void> {
  const d = await getDb();
  const existing = await d.getFirstAsync<{ id: string }>('SELECT id FROM collections WHERE id = ?', input.id);
  await upsertWithDatabase(d, 'collections', {
    id: input.id,
    customerId: input.customerId,
    customerName: input.customerName || 'عميل',
    amount: input.amount,
    currencyCode: input.currencyCode,
    methodName: input.methodName || 'تحصيل مسجل',
    notes: input.notes,
    collectedAt: input.collectedAt || new Date().toISOString(),
  });
  await d.runAsync(
    `UPDATE tasks SET status = 'done', updatedAt = datetime('now')
     WHERE customerId = ? AND status IN ('open', 'pending')
       AND (dueDate IS NULL OR date(dueDate) <= date('now'))`,
    input.customerId,
  );
  if (!existing) {
    await applyLocalCollectionBalance(d, input.customerId, input.currencyCode, input.amount);
  }
}

export async function updateCustomerLocationOffline(id: string, geoLat: number, geoLng: number): Promise<void> {
  const d = await getDb();
  await d.runAsync(
    "UPDATE customers SET geoLat = ?, geoLng = ?, updatedAt = datetime('now') WHERE id = ?",
    geoLat, geoLng, id,
  );
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
  if (table === 'customers') {
    for (const column of ['balances', 'groupBalances', 'childBalances']) {
      if (normalized[column] !== undefined && typeof normalized[column] !== 'string') {
        normalized[column] = JSON.stringify(normalized[column] || []);
      }
    }
    if (normalized.balanceHidden !== undefined) normalized.balanceHidden = normalized.balanceHidden ? 1 : 0;
    if (normalized.hasRecordedEngagement !== undefined) {
      normalized.hasRecordedEngagement = normalized.hasRecordedEngagement ? 1 : 0;
    }
    if (normalized.hasRecordedFollowup != null) normalized.hasRecordedFollowup = normalized.hasRecordedFollowup ? 1 : 0;
  }
  if (table === 'collections') {
    for (const column of ['receiptAttachment', 'location']) {
      if (normalized[column] !== undefined && normalized[column] !== null && typeof normalized[column] !== 'string') {
        normalized[column] = JSON.stringify(normalized[column]);
      }
    }
    if (normalized.statusVerified !== undefined) {
      normalized.statusVerified = [true, 1, 'true', '1'].includes(normalized.statusVerified) ? 1 : 0;
    }
  }
  if (table === 'promises' && normalized.settledLate !== undefined) {
    normalized.settledLate = [true, 1, 'true', '1'].includes(normalized.settledLate) ? 1 : 0;
  }
  return normalized;
}

export interface MobileSyncBatch {
  inventoryCatalogVersion?: string;
  customers?: Record<string, any>[];
  tasks?: Record<string, any>[];
  followups?: Record<string, any>[];
  promises?: Record<string, any>[];
  collections?: Record<string, any>[];
  reservations?: Record<string, any>[];
  references?: Record<string, Record<string, any>[]>;
  newDebt?: Record<string, any> | null;
  customerAlerts?: { unassigned: number; newCustomers: number; since: string } | null;
}

function referenceIdentity(option: Record<string, any>) {
  const id = String(option?.id ?? option?.key ?? option?.code ?? option?.externalItemCode
    ?? option?.itemCode ?? option?.externalWarehouseCode ?? option?.warehouseCode ?? '');
  const name = String(option?.name ?? option?.nameAr ?? option?.itemName
    ?? option?.warehouseName ?? option?.label ?? option?.code ?? id);
  const code = option?.code ?? option?.externalItemCode ?? option?.itemCode
    ?? option?.externalWarehouseCode ?? option?.warehouseCode ?? null;
  return { id, name, code: code == null ? null : String(code) };
}

async function insertReferenceOptionsBatched(
  d: SQLite.SQLiteDatabase,
  kind: string,
  options: Record<string, any>[],
): Promise<void> {
  const rows = (options || []).flatMap((option) => {
    const identity = referenceIdentity(option);
    return identity.id ? [{ ...identity, payload: JSON.stringify(option) }] : [];
  });
  for (let start = 0; start < rows.length; start += 50) {
    const chunk = rows.slice(start, start + 50);
    const values = chunk.flatMap((row) => [kind, row.id, row.name, row.code, row.payload]);
    await d.runAsync(
      `INSERT OR REPLACE INTO reference_options (kind, id, name, code, payload, updatedAt)
       VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, datetime('now'))").join(', ')}`,
      ...values,
    );
  }
}

async function replaceInventoryCatalog(
  d: SQLite.SQLiteDatabase,
  items: Record<string, any>[],
  replace = true,
): Promise<void> {
  if (replace) {
    await d.runAsync('DELETE FROM inventory_barcodes');
    await d.runAsync('DELETE FROM inventory_items');
  }
  const normalized = (items || []).flatMap((item) => {
    const itemCode = String(item.externalItemCode ?? item.itemCode ?? '').trim();
    if (!itemCode) return [];
    const name = String(item.nameAr ?? item.itemName ?? itemCode);
    const groupName = String(item.group?.nameAr ?? item.groupName ?? '');
    const barcodes = ((item.units ?? []) as any[])
      .map((unit) => String(unit?.barcode ?? '').trim())
      .filter(Boolean);
    const searchText = normalizeSmartSearch([itemCode, name, groupName, ...barcodes].join(' '));
    return [{ itemCode, name, groupName, searchText, payload: JSON.stringify(item), barcodes }];
  });
  for (let start = 0; start < normalized.length; start += 50) {
    const chunk = normalized.slice(start, start + 50);
    await d.runAsync(
      `INSERT OR REPLACE INTO inventory_items
       (itemCode, name, groupName, searchText, payload, updatedAt)
       VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, datetime('now'))").join(', ')}`,
      ...chunk.flatMap((row) => [row.itemCode, row.name, row.groupName, row.searchText, row.payload]),
    );
  }
  const barcodeRows = normalized.flatMap((item) => item.barcodes.map((barcode) => ({ barcode, itemCode: item.itemCode })));
  for (let start = 0; start < barcodeRows.length; start += 100) {
    const chunk = barcodeRows.slice(start, start + 100);
    await d.runAsync(
      `INSERT OR REPLACE INTO inventory_barcodes (barcode, itemCode)
       VALUES ${chunk.map(() => '(?, ?)').join(', ')}`,
      ...chunk.flatMap((row) => [row.barcode, row.itemCode]),
    );
  }
}

/**
 * Applies a server snapshot and advances its token atomically. If the app is
 * closed during this operation SQLite rolls everything back, so the same
 * server page is requested again on the next launch.
 */
export async function applySyncSnapshot(batch: MobileSyncBatch, syncToken: string): Promise<void> {
  const previous = ownerTransition;
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  ownerTransition = current;
  if (previous) await previous;
  try {
    const d = await openDb();
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
      const normalizedRecords: Record<string, any>[] = [];
      for (const raw of records) {
        if (!raw?.id || seen.has(raw.id)) continue;
        seen.add(raw.id);
        const record = normalizeRecord(table, raw);
        if (record) normalizedRecords.push(record);
      }
      await upsertRecordsBatched(tx, table, normalizedRecords);
      const seenIds = [...seen];
      for (let start = 0; start < seenIds.length; start += 100) {
        const chunk = seenIds.slice(start, start + 100);
        await tx.runAsync(
          `INSERT OR IGNORE INTO sync_seen_ids (tableName, id)
           VALUES ${chunk.map(() => '(?, ?)').join(', ')}`,
          ...chunk.flatMap((id) => [table, String(id)]),
        );
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
      for (const [kind, options] of Object.entries(batch.references)) {
        await tx.runAsync('DELETE FROM reference_options WHERE kind = ?', kind);
        await insertReferenceOptionsBatched(tx, kind, options || []);
        if (kind === 'oracleItems') {
          await replaceInventoryCatalog(tx, options || []);
          // Commit the revision in the same transaction as every item/barcode.
          // A failed import must leave the previous catalog and revision intact.
          if (batch.inventoryCatalogVersion) {
            await tx.runAsync('INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)',
              'inventoryCatalogVersion', batch.inventoryCatalogVersion);
          } else {
            await tx.runAsync('DELETE FROM sync_metadata WHERE key = ?', 'inventoryCatalogVersion');
          }
          await tx.runAsync(
            'INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)',
            'inventoryCatalogComplete', new Date().toISOString(),
          );
        } else if (kind === 'oracleInventorySummary' && options?.[0]) {
          await tx.runAsync(
            `INSERT OR REPLACE INTO inventory_summary (id, payload, updatedAt)
             VALUES ('current', ?, datetime('now'))`,
            JSON.stringify(options[0]),
          );
        }
      }
    }
    if (batch.newDebt !== undefined) {
      await tx.runAsync(
        'INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)',
        'newDebt', JSON.stringify(batch.newDebt),
      );
    }
    if (batch.customerAlerts !== undefined) {
      await tx.runAsync(
        'INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)',
        'customerAlerts', JSON.stringify(batch.customerAlerts),
      );
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
  } finally {
    release();
    if (ownerTransition === current) ownerTransition = null;
  }
}

/**
 * Ensures cached business data can only be read by the account that created
 * it. Existing unscoped data is treated as unsafe and removed once.
 */
export async function ensureDataOwner(ownerId: string): Promise<boolean> {
  const normalizedOwner = String(ownerId || '').trim();
  if (!normalizedOwner) throw new Error('Missing local data owner');

  const previous = ownerTransition;
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  ownerTransition = current;
  if (previous) await previous;

  try {
    const d = await openDb();
    const row = await d.getFirstAsync<{ value: string }>(
      "SELECT value FROM sync_metadata WHERE key = 'dataOwner'",
    );
    if (row?.value === normalizedOwner) return false;

    await d.withExclusiveTransactionAsync(async (tx) => {
      for (const table of BUSINESS_TABLES) await tx.runAsync(`DELETE FROM ${table}`);
      await tx.runAsync('DELETE FROM mutation_queue');
      await tx.runAsync('DELETE FROM gps_queue');
      await tx.runAsync('DELETE FROM reference_options');
      await tx.runAsync('DELETE FROM inventory_barcodes');
      await tx.runAsync('DELETE FROM inventory_items');
      await tx.runAsync('DELETE FROM inventory_summary');
      await tx.runAsync('DELETE FROM customer_orders');
      await tx.runAsync('DELETE FROM offline_requests');
      await tx.runAsync('DELETE FROM sync_metadata');
      await tx.runAsync(
        'INSERT INTO sync_metadata (key, value) VALUES (?, ?)',
        'dataOwner', normalizedOwner,
      );
    });
    return true;
  } finally {
    release();
    if (ownerTransition === current) ownerTransition = null;
  }
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

export async function getInventorySummaryOffline(): Promise<any | null> {
  const d = await getDb();
  const row = await d.getFirstAsync<{ payload: string; updatedAt: string }>(
    "SELECT payload, updatedAt FROM inventory_summary WHERE id = 'current'",
  );
  if (!row) return null;
  try { return { ...JSON.parse(row.payload), cachedAt: row.updatedAt }; } catch { return null; }
}

export async function searchInventoryItemsOffline(search = '', limit = 40, offset = 0): Promise<any[]> {
  const d = await getDb();
  const needle = normalizeSmartSearch(search);
  if (needle) {
    const barcode = await d.getFirstAsync<{ payload: string }>(
      `SELECT i.payload FROM inventory_barcodes b
       JOIN inventory_items i ON i.itemCode = b.itemCode
       WHERE b.barcode = ? LIMIT 1`,
      search.trim(),
    );
    if (barcode) {
      try { return [JSON.parse(barcode.payload)]; } catch { /* fall through */ }
    }
  }
  const terms = smartSearchTerms(needle);
  const rows = terms.length
    ? await d.getAllAsync<{ payload: string }>(
        `SELECT payload FROM inventory_items
         WHERE ${terms.map(() => 'searchText LIKE ?').join(' AND ')}
         ORDER BY name COLLATE NOCASE ASC LIMIT ? OFFSET ?`,
        ...terms.map((term) => `%${term}%`), limit, offset,
      )
    : await d.getAllAsync<{ payload: string }>(
        'SELECT payload FROM inventory_items ORDER BY name COLLATE NOCASE ASC LIMIT ? OFFSET ?',
        limit, offset,
      );
  return rows.flatMap((row) => {
    try { return [JSON.parse(row.payload)]; } catch { return []; }
  });
}

export async function getInventoryItemOffline(codeOrBarcode: string): Promise<any | null> {
  const d = await getDb();
  const key = codeOrBarcode.trim();
  const row = await d.getFirstAsync<{ payload: string }>(
    `SELECT payload FROM inventory_items WHERE itemCode = ?
     UNION ALL
     SELECT i.payload FROM inventory_barcodes b
     JOIN inventory_items i ON i.itemCode = b.itemCode
     WHERE b.barcode = ? LIMIT 1`,
    key, key,
  );
  if (!row) return null;
  try { return JSON.parse(row.payload); } catch { return null; }
}

export async function hasInventoryCatalogOffline(): Promise<boolean> {
  const d = await getDb();
  const [row, marker] = await Promise.all([
    d.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM inventory_items'),
    d.getFirstAsync<{ value: string }>("SELECT value FROM sync_metadata WHERE key = 'inventoryCatalogComplete'"),
  ]);
  return Number(row?.total ?? 0) > 0 && Boolean(marker?.value);
}

export async function replaceCustomerOrdersSnapshot(items: Record<string, any>[]): Promise<void> {
  const d = await getDb();
  await d.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync("DELETE FROM customer_orders WHERE sourceOrderSerial NOT LIKE 'local:%'");
    const rows = (items || []).flatMap((item) => {
      const id = String(item.id || '').trim();
      const sourceOrderSerial = String(item.sourceOrderSerial || '').trim();
      if (!id || !sourceOrderSerial) return [];
      const customerCode = item.proposedCustomerCode ?? item.sourceCustomerCode ?? null;
      const customerName = item.proposedCustomerName ?? item.sourceCustomerName ?? null;
      const searchText = [sourceOrderSerial, item.sourceOrderNo, customerCode, customerName]
        .filter(Boolean).join(' ').toLocaleLowerCase('ar');
      return [{
        id, sourceOrderSerial, sourceOrderNo: item.sourceOrderNo ?? null,
        orderKind: item.orderKind || 'other', customerCode, customerName,
        orderDate: item.sourceOrderDate ?? null, status: item.status ?? 'draft_review',
        searchText, payload: JSON.stringify(item),
      }];
    });
    for (let start = 0; start < rows.length; start += 50) {
      const chunk = rows.slice(start, start + 50);
      await tx.runAsync(
        `INSERT INTO customer_orders
         (id, sourceOrderSerial, sourceOrderNo, orderKind, customerCode, customerName, orderDate, status, searchText, payload)
         VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        ...chunk.flatMap((row) => [row.id, row.sourceOrderSerial, row.sourceOrderNo, row.orderKind,
          row.customerCode, row.customerName, row.orderDate, row.status, row.searchText, row.payload]),
      );
    }
  });
}

export async function listCustomerOrdersOffline(input: {
  kind?: 'all' | 'cash' | 'credit' | 'other'; search?: string; limit?: number; offset?: number;
} = {}): Promise<any[]> {
  const d = await getDb();
  const clauses: string[] = [];
  const args: any[] = [];
  if (input.kind && input.kind !== 'all') { clauses.push('orderKind = ?'); args.push(input.kind); }
  const search = String(input.search || '').trim().toLocaleLowerCase('ar');
  if (search) { clauses.push('searchText LIKE ?'); args.push(`%${search}%`); }
  const limit = Math.max(1, Math.min(500, Number(input.limit || 100)));
  const offset = Math.max(0, Number(input.offset || 0));
  const rows = await d.getAllAsync<any>(
    `SELECT payload FROM customer_orders ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY orderDate DESC, sourceOrderSerial DESC LIMIT ? OFFSET ?`, ...args, limit, offset,
  );
  return rows.flatMap((row) => { try { return [JSON.parse(row.payload)]; } catch { return []; } });
}

export async function countCustomerOrdersOffline(input: {
  kind?: 'all' | 'cash' | 'credit' | 'other'; search?: string;
} = {}): Promise<number> {
  const d = await getDb();
  const clauses: string[] = [];
  const args: any[] = [];
  if (input.kind && input.kind !== 'all') { clauses.push('orderKind = ?'); args.push(input.kind); }
  const search = String(input.search || '').trim().toLocaleLowerCase('ar');
  if (search) { clauses.push('searchText LIKE ?'); args.push(`%${search}%`); }
  const row = await d.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM customer_orders ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}`,
    ...args,
  );
  return Number(row?.count || 0);
}

/** Persist the server identity before acknowledging/removing the creation mutation. */
export async function bindCustomerOrderServerId(localId: string, order: Record<string, any>): Promise<void> {
  if (!localId.startsWith('local:') || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(order.id || ''))) {
    throw new Error('رقم طلب المنصة غير صالح');
  }
  const d = await getDb();
  await d.withExclusiveTransactionAsync(async (tx) => {
    const customerCode = order.proposedCustomerCode ?? order.sourceCustomerCode ?? null;
    const customerName = order.proposedCustomerName ?? order.sourceCustomerName ?? null;
    const searchText = [order.sourceOrderSerial, order.sourceOrderNo, customerCode, customerName]
      .filter(Boolean).join(' ').toLocaleLowerCase('ar');
    await tx.runAsync('INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)',
      `customer-order-server:${localId}`, order.id);
    await tx.runAsync(
      `INSERT OR REPLACE INTO customer_orders
       (id, sourceOrderSerial, sourceOrderNo, orderKind, customerCode, customerName, orderDate, status, searchText, payload, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      order.id, order.sourceOrderSerial ?? order.id, order.sourceOrderNo ?? null, order.orderKind,
      customerCode, customerName, order.sourceOrderDate ?? null, order.status ?? 'draft_review', searchText, JSON.stringify(order),
    );
    await tx.runAsync('DELETE FROM customer_orders WHERE id = ?', localId);
  });
}

export async function updateCustomerOrderOffline(id: string, patch: Record<string, any>): Promise<void> {
  const d = await getDb();
  if (id.startsWith('local:')) id = await getMeta(`customer-order-server:${id}`) || id;
  const row = await d.getFirstAsync<any>('SELECT payload FROM customer_orders WHERE id = ?', id);
  if (!row) throw new Error('طلب العميل غير موجود في قاعدة الهاتف');
  const item = { ...JSON.parse(row.payload), ...patch };
  const customerCode = item.proposedCustomerCode ?? item.sourceCustomerCode ?? null;
  const customerName = item.proposedCustomerName ?? item.sourceCustomerName ?? null;
  const searchText = [item.sourceOrderSerial, item.sourceOrderNo, customerCode, customerName]
    .filter(Boolean).join(' ').toLocaleLowerCase('ar');
  await d.runAsync(
    `UPDATE customer_orders SET customerCode = ?, customerName = ?, status = ?, searchText = ?, payload = ?, updatedAt = datetime('now')
     WHERE id = ?`, customerCode, customerName, item.status ?? 'draft_review', searchText, JSON.stringify(item), id,
  );
}

export async function hasCustomerOrdersOffline(): Promise<boolean> {
  const d = await getDb();
  const row = await d.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM customer_orders');
  return Number(row?.count || 0) > 0;
}

export async function replaceReferenceOptions(kind: string, options: any[]): Promise<void> {
  const d = await getDb();
  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM reference_options WHERE kind = ?', kind);
    await insertReferenceOptionsBatched(d, kind, options || []);
    if (kind === 'oracleItems') await replaceInventoryCatalog(d, options || []);
    if (kind === 'oracleInventorySummary' && options?.[0]) {
      await d.runAsync(
        `INSERT OR REPLACE INTO inventory_summary (id, payload, updatedAt)
         VALUES ('current', ?, datetime('now'))`,
        JSON.stringify(options[0]),
      );
    }
  });
}

export async function mergeReferenceOptions(kind: string, options: any[]): Promise<void> {
  const d = await getDb();
  await insertReferenceOptionsBatched(d, kind, options || []);
  if (kind === 'oracleItems') await replaceInventoryCatalog(d, options || [], false);
}

export async function recordOfflineRequest(
  operationId: string,
  kind: string,
  title: string,
  endpoint: string,
  payload: unknown = {},
  status: 'draft' | 'pending' = 'draft',
): Promise<void> {
  const d = await getDb();
  await d.runAsync(
    `INSERT OR REPLACE INTO offline_requests
      (operationId, kind, title, endpoint, status, lastError, payload, createdAt, updatedAt, syncedAt)
     VALUES (?, ?, ?, ?, ?, NULL, ?,
       COALESCE((SELECT createdAt FROM offline_requests WHERE operationId = ?), datetime('now')),
       datetime('now'), NULL)`,
    operationId, kind, title, endpoint, status, JSON.stringify(payload), operationId,
  );
}

export async function markOfflineRequestResult(
  operationId: string,
  status: 'synced' | 'blocked' | 'pending',
  lastError?: string,
): Promise<void> {
  const d = await getDb();
  await d.runAsync(
    `UPDATE offline_requests
     SET status = ?, lastError = ?, syncedAt = CASE WHEN ? = 'synced' THEN datetime('now') ELSE syncedAt END
     WHERE operationId = ?`,
    status, lastError ?? null, status, operationId,
  );
}

export async function getOfflineRequests(): Promise<any[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<any>('SELECT * FROM offline_requests ORDER BY COALESCE(updatedAt, createdAt) DESC');
  return rows.map((row) => {
    try { return { ...row, payload: JSON.parse(row.payload || '{}') }; }
    catch { return { ...row, payload: {} }; }
  });
}

export async function getOfflineRequest(operationId: string): Promise<any | null> {
  const d = await getDb();
  const row = await d.getFirstAsync<any>('SELECT * FROM offline_requests WHERE operationId = ?', operationId);
  if (!row) return null;
  try { return { ...row, payload: JSON.parse(row.payload || '{}') }; }
  catch { return { ...row, payload: {} }; }
}

export async function deleteOfflineRequest(operationId: string): Promise<void> {
  const d = await getDb();
  await d.withTransactionAsync(async () => {
    await d.runAsync("DELETE FROM mutation_queue WHERE operationId = ? AND status = 'pending'", operationId);
    await d.runAsync('DELETE FROM offline_requests WHERE operationId = ?', operationId);
  });
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

export async function cancelContactAttemptLocal(operationId:string) {
 const d=await getDb();
 await d.runAsync("DELETE FROM mutation_queue WHERE operationId=? AND endpoint='/followups/contact-attempts' AND status='pending'",operationId);
}

export async function resubmitMutation(
  operationId: string, type: string, endpoint: string, payload: any,
) {
  const d = await getDb();
  const serialized = JSON.stringify(payload);
  await d.withTransactionAsync(async () => {
    const updated = await d.runAsync(
      `UPDATE mutation_queue
       SET type = ?, endpoint = ?, payload = ?, status = 'pending',
           retryCount = 0, lastError = NULL, blockedAt = NULL, nextRetryAt = NULL
       WHERE operationId = ?`,
      type, endpoint, serialized, operationId,
    );
    if (updated.changes === 0) {
      await d.runAsync(
        `INSERT INTO mutation_queue (operationId, type, endpoint, payload, status)
         VALUES (?, ?, ?, ?, 'pending')`,
        operationId, type, endpoint, serialized,
      );
    }
    await materializeQueuedMutation(d, operationId, endpoint, payload);
  });
}

export async function getPendingMutations(): Promise<any[]> {
  const d = await getDb();
  return await d.getAllAsync(
    `SELECT * FROM mutation_queue
     WHERE COALESCE(status, 'pending') = 'pending'
       AND (nextRetryAt IS NULL OR datetime(nextRetryAt) <= datetime('now'))
     ORDER BY id ASC`,
  );
}

export async function getMutationQueueStats(): Promise<{ pending: number; blocked: number }> {
  const d = await getDb();
  const rows = await d.getAllAsync<{ status: string; count: number }>(
    `SELECT status, COUNT(*) AS count FROM mutation_queue GROUP BY status
     UNION ALL SELECT CASE WHEN status='rejected' THEN 'blocked' ELSE status END, COUNT(*)
     FROM attendance_outbox WHERE status!='synced' AND scope=(SELECT value FROM sync_metadata WHERE key='dataOwner') GROUP BY status`,
  );
  return rows.reduce((acc, row) => {
    if (row.status === 'blocked') acc.blocked += row.count;
    else acc.pending += row.count;
    return acc;
  }, { pending: 0, blocked: 0 });
}

export type BlockedMutationDiagnostic = {
  id: number;
  operationId: string;
  type: string;
  endpoint: string;
  lastError: string | null;
  blockedAt: string | null;
  payloadSummary: string;
};

export async function getBlockedMutationDiagnostics(): Promise<BlockedMutationDiagnostic[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<{
    id: number;
    operationId: string;
    type: string;
    endpoint: string;
    payload: string;
    lastError: string | null;
    blockedAt: string | null;
  }>(
    `SELECT id, operationId, type, endpoint, payload, lastError, blockedAt
     FROM mutation_queue
     WHERE status = 'blocked'
     ORDER BY id ASC`,
  );

  return rows.map(({ payload, ...row }) => {
    let payloadSummary = 'بيانات غير قابلة للقراءة';
    try {
      const parsed = JSON.parse(payload);
      const safeEntries = Object.entries(parsed ?? {})
        .filter(([key]) => !['receiptAttachment', 'password', 'token'].includes(key))
        .slice(0, 8);
      payloadSummary = safeEntries
        .map(([key, value]) => `${key}=${typeof value === 'object' ? '[بيانات]' : String(value)}`)
        .join('، ') || 'لا توجد حقول';
    } catch { /* keep the safe fallback */ }
    return { ...row, payloadSummary };
  });
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
    await d.runAsync('DELETE FROM customer_orders WHERE id = ?', localId);
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

export async function retryPendingMutationsNow() {
  const d = await getDb();
  await d.runAsync(
    `UPDATE mutation_queue
     SET status = 'pending', nextRetryAt = NULL
     WHERE status IS NULL OR status <> 'blocked'`,
  );
}

export async function discardBlockedMutations(): Promise<number> {
  const d = await getDb();
  const result = await d.runAsync("DELETE FROM mutation_queue WHERE status = 'blocked'");
  return result.changes;
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

export async function attendanceRows(scope:string):Promise<any[]> {
 const d=await getDb();return d.getAllAsync('SELECT * FROM attendance_outbox WHERE scope=? ORDER BY id',scope);
}
export async function saveAttendanceLocal(scope:string,payload:any){
 const d=await getDb();await d.withExclusiveTransactionAsync(async tx=>{
  const owner=await tx.getFirstAsync<{value:string}>("SELECT value FROM sync_metadata WHERE key='dataOwner'");
  if(owner?.value!==scope)throw Error('تغير حساب الدخول؛ افتح الشاشة مجددًا');
  await tx.runAsync('INSERT OR IGNORE INTO attendance_outbox(operationId,scope,payload) VALUES(?,?,?)',payload.operationId,scope,JSON.stringify(payload));
 });
}
export async function attendanceResult(operationId:string,status:string,error:string|null=null){
 const d=await getDb();await d.runAsync('UPDATE attendance_outbox SET status=?,error=? WHERE operationId=?',status,error,operationId);
}
