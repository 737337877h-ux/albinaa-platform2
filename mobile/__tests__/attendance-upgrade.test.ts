import {afterEach, expect, jest, test} from '@jest/globals';
const {DatabaseSync}=require('node:sqlite');
let mockSql:any;
const mockAdapter:any={
 execAsync:async(sql:string)=>mockSql.exec(sql),
 getFirstAsync:async(sql:string,...args:any[])=>mockSql.prepare(sql).get(...args)??null,
 getAllAsync:async(sql:string,...args:any[])=>mockSql.prepare(sql).all(...args),
 runAsync:async(sql:string,...args:any[])=>mockSql.prepare(sql).run(...args),
};
jest.mock('expo-sqlite',()=>({openDatabaseAsync:async()=>mockAdapter}));
afterEach(()=>mockSql.close());
test.each([false,true])('upgrade v16 repairs missing attendance table and preserves existing records (table exists=%s)',async(exists)=>{
 jest.resetModules();mockSql=new DatabaseSync(':memory:');
 mockSql.exec("PRAGMA user_version=16; CREATE TABLE customers(id TEXT PRIMARY KEY); INSERT INTO customers VALUES('saved'); CREATE TABLE promises(id TEXT PRIMARY KEY); INSERT INTO promises VALUES('saved-promise'); CREATE TABLE collections(id TEXT PRIMARY KEY); CREATE TABLE sync_metadata(key TEXT PRIMARY KEY,value TEXT); INSERT INTO sync_metadata VALUES('dataOwner','org:user'); CREATE TABLE mutation_queue(id INTEGER PRIMARY KEY,status TEXT); INSERT INTO mutation_queue VALUES(1,'pending');");
 if(exists)mockSql.exec("CREATE TABLE attendance_outbox(id INTEGER PRIMARY KEY AUTOINCREMENT,operationId TEXT NOT NULL UNIQUE,scope TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',error TEXT); INSERT INTO attendance_outbox(operationId,scope,payload) VALUES('existing','org:user','{}');");
 const database=require('../src/db/database');await database.getDb();
 expect(mockSql.prepare('PRAGMA user_version').get().user_version).toBeGreaterThanOrEqual(19);
 expect(await database.getMutationQueueStats()).toEqual({pending:exists?2:1,blocked:0});
 expect(mockSql.prepare('SELECT COUNT(*) AS n FROM attendance_outbox').get().n).toBe(exists?1:0);
 expect(mockSql.prepare('SELECT value FROM sync_metadata').get().value).toBe('org:user');
 expect(mockSql.prepare('SELECT id,hasRecordedFollowup FROM customers').get()).toMatchObject({id:'saved',hasRecordedFollowup:null});
});
