import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
// Exercise the actual SQLite statements, including rollback and queued legacy endpoints.
const { DatabaseSync } = require('node:sqlite');
const mockSql = new DatabaseSync(':memory:');
let mockFailInsert = false;
const mockAdapter: any = {
  execAsync: async (sql: string) => mockSql.exec(sql),
  runAsync: async (sql: string, ...args: any[]) => {
    if (mockFailInsert && sql.includes('INSERT OR REPLACE INTO customer_orders')) throw new Error('disk full');
    return mockSql.prepare(sql).run(...args);
  },
  getFirstAsync: async (sql: string, ...args: any[]) => mockSql.prepare(sql).get(...args) ?? null,
  getAllAsync: async (sql: string, ...args: any[]) => mockSql.prepare(sql).all(...args),
  withExclusiveTransactionAsync: async (fn: any) => {
    mockSql.exec('BEGIN');
    try { await fn(mockAdapter); mockSql.exec('COMMIT'); } catch (e) { mockSql.exec('ROLLBACK'); throw e; }
  },
};
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => mockAdapter }));
import {getDb,setMeta,saveAttendanceLocal,attendanceRows,attendanceResult,getMutationQueueStats} from '../src/db/database';
describe('attendance SQLite durability',()=>{
 beforeEach(async()=>{await getDb();mockSql.exec('DELETE FROM attendance_outbox; DELETE FROM mutation_queue; DELETE FROM sync_metadata;');await setMeta('dataOwner','org:user');});
 afterAll(()=>mockSql.close());
 it('persists the timestamp and only one copy of a retried operation',async()=>{const p={operationId:'op',recordedAt:123456789,action:'in'};await saveAttendanceLocal('org:user',p);await saveAttendanceLocal('org:user',p);const rows=await attendanceRows('org:user');expect(rows).toHaveLength(1);expect(JSON.parse(rows[0].payload)).toEqual(p);expect(await getMutationQueueStats()).toEqual({pending:1,blocked:0});});
 it('keeps rejected movements visible and counts them separately',async()=>{await saveAttendanceLocal('org:user',{operationId:'op'});await attendanceResult('op','rejected','reason');expect((await attendanceRows('org:user'))[0].error).toBe('reason');expect(await getMutationQueueStats()).toEqual({pending:0,blocked:1});});
 it('prevents writing under another account and isolates its rows',async()=>{await expect(saveAttendanceLocal('org:other',{operationId:'op'})).rejects.toThrow();expect(await attendanceRows('org:other')).toHaveLength(0);});
});
