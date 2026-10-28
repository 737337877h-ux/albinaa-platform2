'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Ias20261ReceiptWriter, buildReceiptSerial } = require('../src/ias20261-receipt-writer');

const config = {
  schema: 'IAS20261', branchYear: 2026, oracleUserId: 1,
  oracle: {
    user: 'ALBINAA20261WRITER', password: 'secret', connectString: 'db/orcl', clientLibDir: 'C:/oracle',
    poolMin: 1, poolMax: 2, poolIncrement: 1, queueTimeout: 5000, callTimeout: 15000,
  },
};

function grants() {
  return [
    ['IAS_RQ_VCHR_MST', 'SELECT'], ['IAS_RQ_VCHR_MST', 'INSERT'],
    ['IAS_RQ_VCHR_DTL', 'SELECT'], ['IAS_RQ_VCHR_DTL', 'INSERT'],
    ['S_APPRVD_MOV', 'INSERT'], ['IAS_DOC_SEQ_OTHR', 'SELECT'],
    ['EX_RATE', 'SELECT'], ['IAS_PERIOD_EX_RATE_DAY', 'SELECT'],
    ['PRIV_CASH', 'SELECT'], ['CASH_IN_HAND', 'SELECT'], ['CASH_AT_BANK', 'SELECT'],
    ['ACCOUNT_CURR', 'SELECT'], ['CUSTOMER_CURR', 'SELECT'], ['GLS_ACCNT_DTL', 'SELECT'],
    ['COLLERCTOR', 'SELECT'],
  ].map(([TABLE_NAME, PRIVILEGE]) => ({ TABLE_NAME, PRIVILEGE }));
}

function input() {
  return {
    kind: 'receipt', paymentMethod: 'cash', externalReference: 'receipt:test-1',
    currencyCode: 'SR', amount: 1, cashOrBankNo: 101,
    description: 'اختبار سند قبض', referenceNo: 'TEST-1', noticeNo: null,
    collectorNo: 1, commissionPercent: 0, recipientName: 'عميل تجريبي',
    lines: [{
      accountCode: '112101001', analyticalAccountCode: '10001', analyticalType: 3,
      currencyCode: 'YR', amount: 140, description: 'تحصيل تجريبي',
    }],
  };
}

function executeResult(sql) {
  if (sql.includes('FROM IAS20261.IAS_RQ_VCHR_MST') && sql.includes('FIELD10')) return { rows: [] };
  if (sql.includes('FROM IAS20261.IAS_RQ_VCHR_MST') && sql.includes('REF_NO')) return { rows: [] };
  if (sql.includes('FROM IAS20261.IAS_RQ_VCHR_DTL') && sql.includes('NOTE_NO')) return { rows: [] };
  if (sql.includes('FROM IAS20261.PRIV_CASH')) return { rows: [{ ACCOUNT_CODE: '111101002' }] };
  if (sql.includes('FROM IAS20261.ACCOUNT_CURR')) return { rows: [{ ALLOWED: 1 }] };
  if (sql.includes('FROM IAS20261.CUSTOMER_CURR')) return { rows: [{ ALLOWED: 1 }] };
  if (sql.includes('FROM IAS20261.GLS_ACCNT_DTL')) return { rows: [{ VALID_ACCOUNT: 1 }] };
  if (sql.includes('FROM IAS20261.COLLERCTOR')) return { rows: [{ ALLOWED: 1 }] };
  if (sql.includes('FROM IAS20261.EX_RATE')) {
    return sql.includes("CUR_CODE=:currencyCode")
      ? { rows: [{ CUR_CODE: sql, CUR_NAME: 'عملة', CUR_RATE: 1, L_F: 1, CUR_FRC_NO: 2 }] }
      : { rows: [] };
  }
  if (sql.includes('IAS_PERIOD_EX_RATE_DAY')) return { rows: [] };
  if (sql.includes('MAX(VOUCHER_NO)')) return { rows: [{ NEXT_REQUEST_NO: 6 }] };
  if (sql.includes('IAS_DOC_SEQ_OTHR.NEXTVAL')) return { rows: [{ DOC_SEQUENCE: 9001 }] };
  return { rows: [] };
}

test('builds the IAS20261 GLST018 receipt request serial', () => {
  assert.equal(buildReceiptSerial(2026, 1, 6), '202600000100092100000000061');
  assert.equal(buildReceiptSerial(2026, 2, 6), '202600000100092200000000061');
});

test('starts only with the dedicated least-privilege receipt grants', async () => {
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
  const writer = new Ias20261ReceiptWriter(driver, config);
  await writer.start();
  await writer.close();
});

test('dry-run performs only SELECT validation and rolls back', async () => {
  const calls = [];
  const connection = {
    execute: async (sql, binds = {}) => {
      calls.push({ sql, binds });
      if (sql.includes('FROM IAS20261.EX_RATE')) {
        const local = binds.currencyCode === 'SR';
        return { rows: [{
          CUR_CODE: binds.currencyCode, CUR_NAME: local ? 'ريال سعودي' : 'ريال يمني',
          CUR_RATE: local ? 1 : 1 / 140, L_F: local ? 1 : 0, CUR_FRC_NO: 2,
        }] };
      }
      return executeResult(sql);
    },
    rollbackCount: 0, async rollback() { this.rollbackCount += 1; }, async close() {},
  };
  const writer = new Ias20261ReceiptWriter({}, config);
  writer.pool = { getConnection: async () => connection };
  const result = await writer.dryRun(input());
  assert.equal(result.valid, true);
  assert.equal(result.oracleWrite, 'NONE');
  assert.equal(result.localAmount, 1);
  assert.equal(result.counterpartyLocalAmount, 1);
  assert.equal(result.localBalance, 0);
  assert.equal(calls.some((call) => call.sql.includes('FROM IAS20261.GLS_ACCNT_DTL')), false);
  assert.ok(calls.some((call) => call.sql.includes('FROM IAS20261.CUSTOMER_CURR')));
  assert.equal(calls.some((call) => /LOCK TABLE|NEXTVAL|INSERT|UPDATE|DELETE/i.test(call.sql)), false);
  assert.ok(connection.rollbackCount >= 1);
});

test('creates only receipt master, detail, and pending DOC_TYP 92 approval', async () => {
  const calls = [];
  let sequence = 9000;
  const connection = {
    execute: async (sql, binds = {}) => {
      calls.push({ sql, binds });
      if (sql.includes('FROM IAS20261.EX_RATE')) {
        const local = binds.currencyCode === 'SR';
        return { rows: [{
          CUR_CODE: binds.currencyCode, CUR_NAME: local ? 'ريال سعودي' : 'ريال يمني',
          CUR_RATE: local ? 1 : 1 / 140, L_F: local ? 1 : 0, CUR_FRC_NO: 2,
        }] };
      }
      if (sql.includes('IAS_DOC_SEQ_OTHR.NEXTVAL')) return { rows: [{ DOC_SEQUENCE: ++sequence }] };
      return executeResult(sql);
    },
    commitCount: 0, rollbackCount: 0,
    async commit() { this.commitCount += 1; }, async rollback() { this.rollbackCount += 1; }, async close() {},
  };
  const writer = new Ias20261ReceiptWriter({}, config);
  writer.pool = { getConnection: async () => connection };
  const result = await writer.createDraft(input());
  assert.equal(result.created, true);
  assert.equal(result.requestNo, '6');
  assert.equal(result.requestSerial, '202600000100092100000000061');
  assert.equal(result.schema, 'IAS20261');
  assert.equal(connection.commitCount, 1);
  assert.ok(calls.some((call) => /INSERT INTO IAS20261\.IAS_RQ_VCHR_MST \(/.test(call.sql)));
  assert.ok(calls.some((call) => /INSERT INTO IAS20261\.IAS_RQ_VCHR_DTL \(/.test(call.sql)));
  const masterInsert = calls.find((call) => /INSERT INTO IAS20261\.IAS_RQ_VCHR_MST \(/.test(call.sql));
  assert.equal(masterInsert.binds.recipientName, 'عميل تجريبي');
  const detailInsert = calls.find((call) => /INSERT INTO IAS20261\.IAS_RQ_VCHR_DTL \(/.test(call.sql));
  assert.equal(detailInsert.binds.referenceNo, 'TEST-1');
  assert.match(detailInsert.sql, /:noticeNo,:referenceNo,:lineNo/);
  assert.ok(calls.some((call) => /INSERT INTO IAS20261\.S_APPRVD_MOV \(/.test(call.sql)
    && call.binds.documentType === 92));
  assert.equal(calls.some((call) => /\b(UPDATE|DELETE|MERGE)\b/i.test(call.sql)), false);
});
