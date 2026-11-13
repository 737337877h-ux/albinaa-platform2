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

test('delta application preserves omitted tables and commits revision metadata only after all writes succeed',async()=>{
 jest.resetModules();mockSql=new DatabaseSync(':memory:');
 const db=require('../src/db/database'),{syncSnapshotBatch}=require('../src/utils/sync-snapshot');
 await db.ensureDataOwner('org:u');
 const a='a'.repeat(64),b='b'.repeat(64);
 await db.applySyncSnapshot(syncSnapshotBatch({snapshot:'full',schemaVersion:2,syncSectionVersions:{customers:a,collections:a,tasks:a},customers:[{id:'c',fullName:'عميل'}],tasks:[{id:'t',title:'متابعة'}],collections:[{id:'r',customerId:'c',amount:0.0041}],references:{currencies:[{code:'YER',nameAr:'يمني'}]}}),'sync-a','org:u');
 await db.enqueueMutation('preserved-operation','POST','/mobile/gps',{latitude:1,longitude:2});
 const delta={snapshot:'delta',schemaVersion:2,syncSectionVersions:{customers:a,collections:b,tasks:b},tasks:[],collections:[{id:'r',customerId:'c',amount:446105.077}],references:{}};
 mockSql.exec("CREATE TRIGGER interrupt_sync BEFORE INSERT ON collections WHEN NEW.amount>1 BEGIN SELECT RAISE(ABORT,'interrupted sync'); END");
 await expect(db.applySyncSnapshot(syncSnapshotBatch(delta),'sync-b','org:u')).rejects.toThrow('interrupted sync');
 expect(await db.getMeta('syncToken')).toBe('sync-a');expect(JSON.parse(await db.getMeta('syncSectionVersions')).collections).toBe(a);expect(mockSql.prepare('SELECT amount FROM collections').get().amount).toBe(0.0041);
 mockSql.exec('DROP TRIGGER interrupt_sync');
 await db.applySyncSnapshot(syncSnapshotBatch(delta),'sync-b','org:u');
 expect(mockSql.prepare('SELECT fullName FROM customers').get().fullName).toBe('عميل');expect(mockSql.prepare('SELECT COUNT(*) AS n FROM tasks').get().n).toBe(0);expect(mockSql.prepare('SELECT amount FROM collections').get().amount).toBe(446105.077);expect((await db.getReferenceOptions('currencies'))[0].code).toBe('YER');
 expect(JSON.parse(await db.getMeta('syncSectionVersions')).collections).toBe(b);expect(mockSql.prepare('SELECT operationId FROM mutation_queue').get().operationId).toBe('preserved-operation');
 await expect(db.applySyncSnapshot(syncSnapshotBatch({...delta,customers:undefined,syncSectionVersions:{customers:b}}),'out-of-order','org:u')).rejects.toMatchObject({code:'SYNC_BASE_CHANGED'});
 expect(await db.getMeta('syncToken')).toBe('sync-b');expect(JSON.parse(await db.getMeta('syncSectionVersions')).customers).toBe(a);
 expect(()=>syncSnapshotBatch({...delta,syncSectionVersions:undefined})).toThrow('غير مكتملة');
 expect(syncSnapshotBatch({...delta,newDebt:null,customerAlerts:null})).toMatchObject({newDebt:null,customerAlerts:null});
});
