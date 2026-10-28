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
import { bindCustomerOrderServerId, getDb, getMeta, removeMutation, updateCustomerOrderOffline } from '../src/db/database';

const localId = 'local:customer_order:test';
const order = { id: '12345678-1234-1234-1234-123456789012', sourceOrderSerial: 'MOB-test', sourceOrderNo: 'DRAFT-test',
  orderKind: 'cash', sourceCustomerName: 'TEST', sourceOrderDate: '2026-09-04', status: 'draft_review', sourceAmount: 300 };

describe('atomic customer-order binding in SQLite', () => {
  beforeEach(async () => {
    await getDb();
    mockFailInsert = false;
    mockSql.exec('DELETE FROM customer_orders; DELETE FROM sync_metadata; DELETE FROM mutation_queue;');
    mockSql.prepare('INSERT INTO customer_orders(id, sourceOrderSerial, orderKind, searchText, payload) VALUES (?,?,?,?,?)')
      .run(localId, localId, 'cash', 'TEST', JSON.stringify({ ...order, id: localId }));
  });
  afterAll(() => mockSql.close());

  it('replaces only the local row and stores a durable mapping', async () => {
    await bindCustomerOrderServerId(localId, order);
    expect(await getMeta(`customer-order-server:${localId}`)).toBe(order.id);
    expect(mockSql.prepare('SELECT id FROM customer_orders').all()).toEqual([{ id: order.id }]);
    await updateCustomerOrderOffline(localId, { proposedCustomerName: 'EDIT' });
    expect(JSON.parse(mockSql.prepare('SELECT payload FROM customer_orders WHERE id=?').get(order.id).payload).proposedCustomerName).toBe('EDIT');
  });

  it('rolls back mapping and retains the local order on storage failure', async () => {
    mockFailInsert = true;
    await expect(bindCustomerOrderServerId(localId, order)).rejects.toThrow('disk full');
    expect(await getMeta(`customer-order-server:${localId}`)).toBeNull();
    expect(mockSql.prepare('SELECT id FROM customer_orders').all()).toEqual([{ id: localId }]);
  });

  it('is repeatable after a crash without duplicate rows', async () => {
    await bindCustomerOrderServerId(localId, order);
    await bindCustomerOrderServerId(localId, order);
    expect(mockSql.prepare('SELECT count(*) AS n FROM customer_orders').get().n).toBe(1);
  });

  it('retains the dependent blocked operation and mapping after acknowledging creation', async () => {
    const insert = mockSql.prepare('INSERT INTO mutation_queue(operationId,type,endpoint,payload,status) VALUES (?,?,?,?,?)');
    const parent = insert.run('customer_order:test', 'POST', '/sales-order-drafts', '{}', 'pending');
    const endpoint = `/sales-order-drafts/${localId}/process`;
    insert.run('process:test', 'POST', endpoint, '{"status":"ready_for_approval"}', 'blocked');
    await bindCustomerOrderServerId(localId, order);
    await removeMutation(Number(parent.lastInsertRowid));
    expect(await getMeta(`customer-order-server:${localId}`)).toBe(order.id);
    expect(mockSql.prepare('SELECT id FROM customer_orders').all()).toEqual([{ id: order.id }]);
    expect(mockSql.prepare('SELECT endpoint,status FROM mutation_queue').all()).toEqual([{ endpoint, status: 'blocked' }]);
  });
});
