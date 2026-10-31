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

test('catalog replacement and revision commit atomically, retaining pending operations on failure', async () => {
  jest.resetModules(); mockSql = new DatabaseSync(':memory:');
  const database = require('../src/db/database');
  await database.getDb();
  await database.enqueueMutation('pending-operation', 'POST', '/mobile/gps', { latitude: 1, longitude: 2 });
  const batch = (name: string, version: string) => ({ inventoryCatalogVersion: version, references: { oracleItems: [{ externalItemCode: 'item-1', nameAr: name, units: [{ barcode: '12345' }] }] } });
  await database.applySyncSnapshot(batch('Old name', 'revision-a'), 'sync-a');
  expect(await database.getMeta('inventoryCatalogVersion')).toBe('revision-a');
  mockSql.exec("CREATE TRIGGER fail_catalog BEFORE INSERT ON inventory_items WHEN NEW.name='New name' BEGIN SELECT RAISE(ABORT, 'interrupted catalog'); END");
  await expect(database.applySyncSnapshot(batch('New name', 'revision-b'), 'sync-b')).rejects.toThrow('interrupted catalog');
  expect((await database.getInventoryItemOffline('item-1')).nameAr).toBe('Old name');
  expect(await database.getMeta('inventoryCatalogVersion')).toBe('revision-a');
  expect(await database.getMeta('syncToken')).toBe('sync-a');
  expect(mockSql.prepare('SELECT operationId FROM mutation_queue').get().operationId).toBe('pending-operation');
  mockSql.exec('DROP TRIGGER fail_catalog');
  await database.applySyncSnapshot(batch('New name', 'revision-b'), 'sync-b');
  expect((await database.getInventoryItemOffline('12345')).nameAr).toBe('New name');
  expect(await database.getMeta('inventoryCatalogVersion')).toBe('revision-b');
  await database.applySyncSnapshot({ references: {}, inventoryCatalogVersion: 'uncommitted-revision' }, 'sync-c');
  expect(await database.getMeta('inventoryCatalogVersion')).toBe('revision-b');
});
