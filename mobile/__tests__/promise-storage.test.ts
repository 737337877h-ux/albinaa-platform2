import { afterEach, expect, jest, test } from '@jest/globals';
const { DatabaseSync } = require('node:sqlite');
let mockSql: any;
const mockAdapter: any = {
  execAsync: async (sql: string) => mockSql.exec(sql),
  getFirstAsync: async (sql: string, ...args: any[]) => mockSql.prepare(sql).get(...args) ?? null,
  getAllAsync: async (sql: string, ...args: any[]) => mockSql.prepare(sql).all(...args),
  runAsync: async (sql: string, ...args: any[]) => mockSql.prepare(sql).run(...args),
  withExclusiveTransactionAsync: async (work: (tx: any) => Promise<void>) => {
    mockSql.exec('BEGIN');
    try { await work(mockAdapter); mockSql.exec('COMMIT'); }
    catch (error) { mockSql.exec('ROLLBACK'); throw error; }
  },
};
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => mockAdapter }));
afterEach(() => mockSql?.close());

test('upgrade preserves existing promises and pending work, and a sync keeps late-settlement evidence offline', async () => {
  jest.resetModules();
  mockSql = new DatabaseSync(':memory:');
  mockSql.exec(`
    PRAGMA user_version = 18;
    CREATE TABLE customers(id TEXT PRIMARY KEY);
    CREATE TABLE collections(id TEXT PRIMARY KEY);
    CREATE TABLE promises(id TEXT PRIMARY KEY, customerId TEXT, customerName TEXT, expectedAmount REAL,
      currencyCode TEXT, dueDate TEXT, status TEXT, notes TEXT, updatedAt TEXT DEFAULT (datetime('now')));
    INSERT INTO promises(id, customerName, status) VALUES('saved-promise', 'Saved customer', 'unfulfilled');
    CREATE TABLE sync_metadata(key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO sync_metadata VALUES('dataOwner', 'org:user');
    CREATE TABLE mutation_queue(id INTEGER PRIMARY KEY, operationId TEXT, endpoint TEXT, payload TEXT, status TEXT);
    INSERT INTO mutation_queue VALUES(1, 'saved-operation', '/mobile/gps', '{}', 'pending');
  `);
  const database = require('../src/db/database');
  await database.getDb();
  expect(mockSql.prepare('SELECT id,status,settledLate FROM promises').get()).toMatchObject({ id: 'saved-promise', status: 'unfulfilled', settledLate: 0 });

  await database.applySyncSnapshot({ promises: [
    { id: 'saved-promise', customerName: 'Saved customer', status: 'unfulfilled', expectedAmount:20000, fulfilledAmount:10000 },
    { id: 'late-promise', customerName: 'Late customer', status: 'fulfilled', dueDate: '2026-10-08',
      settlementDate: '2026-10-11', settledLate: true, missedDueDate: '2026-10-08' },
    { id: 'on-time-promise', status: 'fulfilled', dueDate: '2026-10-08', settlementDate: '2026-10-08', settledLate: false, missedDueDate: null },
  ] }, 'new-sync-token');
  expect(mockSql.prepare("SELECT status,settlementDate,settledLate,missedDueDate FROM promises WHERE id='late-promise'").get()).toMatchObject({
    status: 'fulfilled', settlementDate: '2026-10-11', settledLate: 1, missedDueDate: '2026-10-08',
  });
  expect(mockSql.prepare("SELECT settledLate FROM promises WHERE id='on-time-promise'").get().settledLate).toBe(0);
  expect(mockSql.prepare("SELECT fulfilledAmount FROM promises WHERE id='saved-promise'").get().fulfilledAmount).toBe(10000);
  expect(mockSql.prepare("SELECT status FROM mutation_queue WHERE operationId='saved-operation'").get().status).toBe('pending');
  expect(mockSql.prepare("SELECT value FROM sync_metadata WHERE key='dataOwner'").get().value).toBe('org:user');
  expect(mockSql.prepare("SELECT value FROM sync_metadata WHERE key='syncToken'").get().value).toBe('new-sync-token');
});
