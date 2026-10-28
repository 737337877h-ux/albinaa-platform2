'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Ias20261PurchaseWriter, buildRequestSerial } = require('../src/ias20261-purchase-writer');

const config = {
  schema: 'IAS20261', branchYear: 2026, oracleUserId: 1,
  oracle: {
    user: 'ALBINAA20261WRITER', password: 'secret', connectString: 'db/orcl', clientLibDir: 'C:/oracle',
    poolMin: 1, poolMax: 2, poolIncrement: 1, queueTimeout: 5000, callTimeout: 15000,
  },
};

function grantRows() {
  return [
    ['P_REQUEST', 'SELECT'], ['P_REQUEST', 'INSERT'],
    ['P_REQUEST_DETAIL', 'SELECT'], ['P_REQUEST_DETAIL', 'INSERT'],
    ['S_APPRVD_MOV', 'INSERT'], ['IAS_DOC_SEQ_OTHR', 'SELECT'],
    ['WAREHOUSE_DETAILS', 'SELECT'], ['ITEM_DETAILS', 'SELECT'],
  ].map(([TABLE_NAME, PRIVILEGE]) => ({ TABLE_NAME, PRIVILEGE }));
}

test('builds the serial format observed in IAS20261 APST001.125', () => {
  assert.equal(buildRequestSerial(2026, 1, 3), '20260000013');
});

test('starts only with the dedicated least-privilege IAS20261 account', async () => {
  const connection = {
    execute: async (sql) => sql.includes('SESSION_USER')
      ? { rows: [{ SESSION_USER: 'ALBINAA20261WRITER' }] }
      : { rows: grantRows() },
    rollback: async () => {}, close: async () => {},
  };
  const driver = {
    OUT_FORMAT_OBJECT: 1, initOracleClient() {},
    createPool: async () => ({ getConnection: async () => connection, close: async () => {} }),
  };
  const writer = new Ias20261PurchaseWriter(driver, config);
  await writer.start();
  await writer.close();
});

test('creates only the purchase master, details, and pending approval', async () => {
  const calls = [];
  let sequence = 8000;
  const connection = {
    callTimeout: 0,
    execute: async (sql, binds = {}) => {
      calls.push({ sql, binds });
      if (sql.includes('FROM IAS20261.P_REQUEST') && sql.includes('REF_NO')) return { rows: [] };
      if (sql.includes('FROM IAS20261.P_REQUEST WHERE PR_TYPE')) return { rows: [{ NEXT_REQUEST_NO: 4 }] };
      if (sql.includes('FROM IAS20261.WAREHOUSE_DETAILS')) return { rows: [{ W_CODE: 102 }] };
      if (sql.includes('FROM IAS20261.ITEM_DETAILS')) return { rows: [{ P_SIZE: 5.5 }] };
      if (sql.includes('IAS_DOC_SEQ_OTHR.NEXTVAL')) return { rows: [{ DOC_SEQUENCE: ++sequence }] };
      return { rows: [] };
    },
    commitCount: 0, rollbackCount: 0,
    async commit() { this.commitCount += 1; },
    async rollback() { this.rollbackCount += 1; },
    async close() {},
  };
  const writer = new Ias20261PurchaseWriter({}, config);
  writer.pool = { getConnection: async () => connection };
  const result = await writer.createDraft({
    externalReference: 'platform-purchase:test-1', warehouseCode: 102,
    requiredDate: '2026-08-29', requestSide: 'منصة البناء الراقي', notes: 'طلب شراء',
    lines: [{ itemCode: '971012502005', unitCode: 'ماصورة', quantity: 2 }],
  });
  assert.deepEqual(result, {
    created: true, requestNo: '4', requestSerial: '20260000014', schema: 'IAS20261',
    status: 'pending_approval', oracleWrite: 'INSERT_ONLY',
  });
  assert.equal(connection.commitCount, 1);
  assert.ok(calls.some((call) => /INSERT INTO IAS20261\.P_REQUEST \(/.test(call.sql)));
  assert.ok(calls.some((call) => /INSERT INTO IAS20261\.P_REQUEST_DETAIL \(/.test(call.sql)));
  assert.ok(calls.some((call) => /INSERT INTO IAS20261\.S_APPRVD_MOV \(/.test(call.sql)));
  assert.ok(calls.some((call) => call.binds.documentType === 40 && call.binds.branchYear === 2026));
  assert.equal(calls.some((call) => /\b(UPDATE|DELETE|MERGE)\b/i.test(call.sql)), false);
});
