'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Ias20261TransferWriter, buildTransferSerial } = require('../src/ias20261-transfer-writer');

const config = {
  schema: 'IAS20261', branchYear: 2026, oracleUserId: 1,
  oracle: {
    user: 'ALBINAA20261WRITER', password: 'secret', connectString: 'db/orcl', clientLibDir: 'C:/oracle',
    poolMin: 1, poolMax: 2, poolIncrement: 1, queueTimeout: 5000, callTimeout: 15000,
  },
};

function grants() {
  return [
    ['IAS_OUT_REQUEST_MST', 'SELECT'], ['IAS_OUT_REQUEST_MST', 'INSERT'],
    ['IAS_OUT_REQUEST_DTL', 'SELECT'], ['IAS_OUT_REQUEST_DTL', 'INSERT'],
    ['S_APPRVD_MOV', 'INSERT'], ['IAS_DOC_SEQ_OTHR', 'SELECT'],
    ['WAREHOUSE_DETAILS', 'SELECT'], ['ITEM_DETAILS', 'SELECT'],
    ['IAS_V_ITM_AVLQTY', 'SELECT'],
  ].map(([TABLE_NAME, PRIVILEGE]) => ({ TABLE_NAME, PRIVILEGE }));
}

test('builds the IAS20261 outgoing-request serial format', () => {
  assert.equal(buildTransferSerial(2026, 1, 31), '202600000131');
});

test('starts only when the dedicated writer has the exact transfer privileges', async () => {
  const connection = {
    execute: async (sql) => sql.includes('SESSION_USER')
      ? { rows: [{ SESSION_USER: 'ALBINAA20261WRITER' }] }
      : { rows: grants() },
    rollback: async () => {}, close: async () => {},
  };
  const driver = {
    OUT_FORMAT_OBJECT: 1, initOracleClient() {},
    createPool: async () => ({ getConnection: async () => connection, close: async () => {} }),
  };
  const writer = new Ias20261TransferWriter(driver, config);
  await writer.start();
  await writer.close();
});

test('dry-run reads stock and rolls back without locks, sequences, inserts, or commits', async () => {
  const calls = [];
  const connection = {
    execute: async (sql) => {
      calls.push(sql);
      if (sql.includes('WAREHOUSE_DETAILS')) return { rows: [{ W_CODE: 102 }, { W_CODE: 101 }] };
      if (sql.includes('ITEM_DETAILS')) return { rows: [{ P_SIZE: 1 }] };
      if (sql.includes('IAS_V_ITM_AVLQTY')) return { rows: [{ SOURCE_QTY: 2208, DESTINATION_QTY: 15 }] };
      return { rows: [] };
    },
    rollbackCount: 0, async rollback() { this.rollbackCount += 1; }, async close() {},
  };
  const writer = new Ias20261TransferWriter({}, config);
  writer.pool = { getConnection: async () => connection };
  const result = await writer.dryRun({
    externalReference: 'inventory-transfer:test-1', sourceWarehouseCode: 102, destinationWarehouseCode: 101,
    requestSide: 'منصة البناء الراقي', notes: 'اختبار',
    lines: [{ itemCode: '111100202001', unitCode: 'حبة', quantity: 1 }],
  });
  assert.equal(result.valid, true);
  assert.equal(result.oracleWrite, 'NONE');
  assert.equal(result.lines[0].sourceAvailable, 2208);
  assert.equal(calls.some((sql) => /LOCK TABLE|NEXTVAL|INSERT|UPDATE|DELETE/i.test(sql)), false);
  assert.ok(connection.rollbackCount >= 1);
});

test('creates only master, detail, and pending DOC_TYP 31 approval', async () => {
  const calls = [];
  const connection = {
    execute: async (sql, binds = {}) => {
      calls.push({ sql, binds });
      if (sql.includes('DOC_SER_EXTRNL')) return { rows: [] };
      if (sql.includes('WAREHOUSE_DETAILS')) return { rows: [{ W_CODE: 102 }, { W_CODE: 101 }] };
      if (sql.includes('ITEM_DETAILS')) return { rows: [{ P_SIZE: 1 }] };
      if (sql.includes('IAS_V_ITM_AVLQTY')) return { rows: [{ SOURCE_QTY: 2208, DESTINATION_QTY: 15 }] };
      if (sql.includes('MAX(OUT_REQ_NO)')) return { rows: [{ NEXT_REQUEST_NO: 31 }] };
      if (sql.includes('IAS_DOC_SEQ_OTHR.NEXTVAL')) return { rows: [{ DOC_SEQUENCE: 9001 }] };
      return { rows: [] };
    },
    commitCount: 0, rollbackCount: 0,
    async commit() { this.commitCount += 1; }, async rollback() { this.rollbackCount += 1; }, async close() {},
  };
  const writer = new Ias20261TransferWriter({}, config);
  writer.pool = { getConnection: async () => connection };
  const result = await writer.createDraft({
    externalReference: 'inventory-transfer:test-1', sourceWarehouseCode: 102, destinationWarehouseCode: 101,
    requestSide: 'منصة البناء الراقي', notes: 'اختبار تحويل',
    lines: [{ itemCode: '111100202001', unitCode: 'حبة', quantity: 1 }],
  });
  assert.equal(result.created, true);
  assert.equal(result.requestNo, '31');
  assert.equal(result.requestSerial, '202600000131');
  assert.equal(connection.commitCount, 1);
  assert.ok(calls.some((call) => /INSERT INTO IAS20261\.IAS_OUT_REQUEST_MST \(/.test(call.sql)));
  assert.ok(calls.some((call) => /INSERT INTO IAS20261\.IAS_OUT_REQUEST_DTL \(/.test(call.sql)));
  const masterInsert = calls.find((call) => /INSERT INTO IAS20261\.IAS_OUT_REQUEST_MST \(/.test(call.sql));
  const detailInsert = calls.find((call) => /INSERT INTO IAS20261\.IAS_OUT_REQUEST_DTL \(/.test(call.sql));
  assert.equal(masterInsert.binds.requestWarehouse, 101);
  assert.equal(masterInsert.binds.fromWarehouse, 102);
  assert.equal(detailInsert.binds.requestWarehouse, 101);
  assert.equal(detailInsert.binds.fromWarehouse, 102);
  assert.equal(detailInsert.binds.destinationAvailable, 15);
  assert.equal(detailInsert.binds.sourceAvailable, 2208);
  assert.ok(calls.some((call) => /INSERT INTO IAS20261\.S_APPRVD_MOV \(/.test(call.sql)
    && call.binds.documentType === 31));
  assert.equal(calls.some((call) => /\b(UPDATE|DELETE|MERGE)\b/i.test(call.sql)), false);
});
