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

test('upgrade marks legacy states unknown and sync replaces the request with its confirmed receipt', async () => {
  jest.resetModules();
  mockSql = new DatabaseSync(':memory:');
  mockSql.exec(`
    PRAGMA user_version = 19;
    CREATE TABLE promises(id TEXT PRIMARY KEY);
    CREATE TABLE collections(id TEXT PRIMARY KEY, customerId TEXT, customerName TEXT, amount REAL,
      currencyCode TEXT, methodName TEXT, notes TEXT, collectedAt TEXT, receiptAttachment TEXT, location TEXT,
      updatedAt TEXT DEFAULT (datetime('now')));
    INSERT INTO collections(id,amount,currencyCode) VALUES('legacy',7000,'YER');
    CREATE TABLE sync_metadata(key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO sync_metadata VALUES('dataOwner','org:user');
    CREATE TABLE mutation_queue(id INTEGER PRIMARY KEY,operationId TEXT,endpoint TEXT,payload TEXT,status TEXT);
    INSERT INTO mutation_queue VALUES(1,'saved-operation','/mobile/gps','{}','pending');
  `);
  const database = require('../src/db/database');
  await database.getDb();
  expect(mockSql.prepare('SELECT status,statusVerified FROM collections').get()).toMatchObject({ status: 'unknown', statusVerified: 0 });
  await database.applySyncSnapshot({ collections: [
    { id: 'oracle-receipt:request', amount: 100000, currencyCode: 'YER', status: 'pending_approval', source: 'oracle_receipt_request', statusVerified: true },
  ] }, 'request-snapshot');
  expect(mockSql.prepare('SELECT status,source,statusVerified FROM collections').get()).toMatchObject({ status: 'pending_approval', source: 'oracle_receipt_request', statusVerified: 1 });
  await database.applySyncSnapshot({ collections: [
    { id: 'oracle-direct:receipt', amount: 100000, currencyCode: 'YER', status: 'recorded', source: 'oracle_direct_receipt', statusVerified: true },
  ] }, 'posted-snapshot');
  expect(mockSql.prepare('SELECT id,amount,status,source,statusVerified FROM collections').all()).toEqual([
    expect.objectContaining({ id: 'oracle-direct:receipt', amount: 100000, status: 'recorded', source: 'oracle_direct_receipt', statusVerified: 1 }),
  ]);
  expect(mockSql.prepare("SELECT status FROM mutation_queue WHERE operationId='saved-operation'").get().status).toBe('pending');
  expect(mockSql.prepare("SELECT value FROM sync_metadata WHERE key='dataOwner'").get().value).toBe('org:user');
});
