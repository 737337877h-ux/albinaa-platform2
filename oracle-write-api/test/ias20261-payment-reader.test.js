'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  Ias20261PaymentReader, Ias20261PaymentWriter, buildPaymentSerial,
} = require('../src/ias20261-payment-reader');

const SELECT_PRIVILEGES = [
  'IAS_RQ_VCHR_MST','IAS_RQ_VCHR_DTL','EX_RATE','IAS_PERIOD_EX_RATE_DAY',
  'PRIV_CASH','CASH_IN_HAND','CASH_AT_BANK','ACCOUNT_CURR','CUSTOMER_CURR',
  'GLS_ACCNT_DTL','COLLERCTOR',
].map((TABLE_NAME) => ({ TABLE_NAME, PRIVILEGE: 'SELECT' }));

function config() {
  return {
    schema: 'IAS20261', branchYear: 2026, oracleUserId: 1,
    oracle: {
      user: 'ALBINAA20261PAYWRITER', password: 'secret', connectString: 'db', clientLibDir: 'client',
      poolMin: 1, poolMax: 1, poolIncrement: 1, queueTimeout: 1000, callTimeout: 5000,
    },
  };
}

const WRITER_PRIVILEGES = [
  ...SELECT_PRIVILEGES,
  { TABLE_NAME: 'IAS_RQ_VCHR_MST', PRIVILEGE: 'INSERT' },
  { TABLE_NAME: 'IAS_RQ_VCHR_DTL', PRIVILEGE: 'INSERT' },
  { TABLE_NAME: 'S_APPRVD_MOV', PRIVILEGE: 'INSERT' },
  { TABLE_NAME: 'IAS_DOC_SEQ_OTHR', PRIVILEGE: 'SELECT' },
];

function paymentInput() {
  return {
    kind: 'payment', paymentMethod: 'cash', externalReference: 'payment:test-1',
    currencyCode: 'SR', amount: 1, cashOrBankNo: 101,
    description: 'اختبار سند صرف', recipientName: 'مستلم تجريبي', collectorNo: 1,
    commissionPercent: 0, referenceNo: 'PAY-1', noticeNo: null,
    lines: [{
      accountCode: '112101001', analyticalAccountCode: '10001', analyticalType: 3,
      currencyCode: 'YR', amount: 140, description: 'طرف العميل',
    }],
  };
}

function executePaymentValidation(sql, binds = {}) {
  if (/FIELD10/.test(sql)) return { rows: [] };
  if (/TRIM\(REF_NO\)/.test(sql) || /TRIM\(NOTE_NO\)/.test(sql)) return { rows: [] };
  if (/FROM IAS20261\.PRIV_CASH/.test(sql)) return { rows: [{ ACCOUNT_CODE: '111101002' }] };
  if (/FROM IAS20261\.(ACCOUNT_CURR|CUSTOMER_CURR)/.test(sql)) return { rows: [{ ALLOWED: 1 }] };
  if (/FROM IAS20261\.COLLERCTOR/.test(sql)) return { rows: [{ ALLOWED: 1 }] };
  if (/FROM IAS20261\.EX_RATE/.test(sql)) {
    const local = binds.currencyCode === 'SR';
    return { rows: [{
      CUR_CODE: binds.currencyCode, CUR_NAME: local ? 'ريال سعودي' : 'ريال يمني',
      CUR_RATE: local ? 1 : 1 / 140, L_F: local ? 1 : 0, CUR_FRC_NO: 2,
    }] };
  }
  if (/IAS_PERIOD_EX_RATE_DAY/.test(sql)) return { rows: [] };
  if (/MAX\(VOUCHER_NO\)/.test(sql)) return { rows: [{ NEXT_REQUEST_NO: 6 }] };
  return { rows: [] };
}

test('starts only with the dedicated SELECT-only payment Dry Run grants', async () => {
  const connection = {
    async execute(sql) {
      if (/SESSION_USER/.test(sql)) return { rows: [{ SESSION_USER: 'ALBINAA20261PAYWRITER' }] };
      if (/USER_TAB_PRIVS/.test(sql)) return { rows: SELECT_PRIVILEGES };
      return { rows: [] };
    },
    async rollback() {}, async close() {},
  };
  const driver = {
    OUT_FORMAT_OBJECT: 1,
    initOracleClient() {},
    async createPool() { return { async getConnection() { return connection; }, async close() {} }; },
  };
  const reader = new Ias20261PaymentReader(driver, config());
  await reader.start();
  await reader.close();
});

test('rejects any IAS20261 INSERT privilege in the Dry Run account', async () => {
  const connection = {
    async execute(sql) {
      if (/SESSION_USER/.test(sql)) return { rows: [{ SESSION_USER: 'ALBINAA20261PAYWRITER' }] };
      if (/USER_TAB_PRIVS/.test(sql)) return { rows: [...SELECT_PRIVILEGES, { TABLE_NAME: 'IAS_RQ_VCHR_MST', PRIVILEGE: 'INSERT' }] };
      return { rows: [] };
    },
    async rollback() {}, async close() {},
  };
  const driver = {
    OUT_FORMAT_OBJECT: 1,
    initOracleClient() {},
    async createPool() { return { async getConnection() { return connection; } }; },
  };
  const reader = new Ias20261PaymentReader(driver, config());
  await assert.rejects(reader.start(), /forbidden IAS20261 payment Dry Run privileges/);
});

test('Dry Runs a mixed-currency payment with PYMNT permission and positive party amounts', async () => {
  const statements = [];
  const connection = {
    callTimeout: 0,
    async execute(sql, binds) {
      statements.push(sql);
      if (/SET TRANSACTION READ ONLY/.test(sql)) return { rows: [] };
      if (/TRIM\(REF_NO\)/.test(sql) || /TRIM\(NOTE_NO\)/.test(sql)) return { rows: [] };
      if (/FROM IAS20261\.PRIV_CASH/.test(sql)) return { rows: [{ ACCOUNT_CODE: '111101002' }] };
      if (/FROM IAS20261\.ACCOUNT_CURR/.test(sql)) return { rows: [{ ALLOWED: 1 }] };
      if (/FROM IAS20261\.CUSTOMER_CURR/.test(sql)) return { rows: [{ ALLOWED: 1 }] };
      if (/FROM IAS20261\.COLLERCTOR/.test(sql)) return { rows: [{ ALLOWED: 1 }] };
      if (/FROM IAS20261\.EX_RATE/.test(sql)) {
        if (binds.currencyCode === 'YR') return { rows: [{ CUR_CODE: 'YR', CUR_NAME: 'ريال يمني', CUR_RATE: 0.0071428571428571, L_F: 2, CUR_FRC_NO: 2 }] };
        return { rows: [{ CUR_CODE: 'SR', CUR_NAME: 'ريال سعودي', CUR_RATE: 1, L_F: 1, CUR_FRC_NO: 2 }] };
      }
      if (/IAS_PERIOD_EX_RATE_DAY/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
    async rollback() {}, async close() {},
  };
  const reader = new Ias20261PaymentReader({}, config());
  reader.pool = { async getConnection() { return connection; } };
  const result = await reader.dryRun({
    kind: 'payment', paymentMethod: 'cash', externalReference: 'payment:test-1',
    currencyCode: 'SR', amount: 1, cashOrBankNo: 101,
    description: 'اختبار سند صرف', recipientName: 'مستلم تجريبي', collectorNo: 1,
    referenceNo: null, noticeNo: null,
    lines: [{
      accountCode: '112101001', analyticalAccountCode: '10001', analyticalType: 3,
      currencyCode: 'YR', amount: 140, description: 'طرف العميل',
    }],
  });
  assert.equal(result.valid, true);
  assert.equal(result.oracleWrite, 'NONE');
  assert.equal(result.saveAllowed, false);
  assert.equal(result.voucherType, 2);
  assert.equal(result.approvalDocumentType, 93);
  assert.equal(result.lines[0].AC_AMT, 1);
  assert.equal(result.lines[0].AC_AMTF, 140);
  assert.ok(statements.some((sql) => /P\.PYMNT/.test(sql)));
  assert.equal(statements.some((sql) => /\b(INSERT|UPDATE|DELETE|MERGE|NEXTVAL)\b/i.test(sql)), false);
});

test('builds the IAS20261 GLST018 payment request serial', () => {
  assert.equal(buildPaymentSerial(2026, 1, 6), '202600000100093100000000061');
  assert.equal(buildPaymentSerial(2026, 2, 6), '202600000100093200000000061');
});

test('starts the writer only with INSERT-only payment draft grants', async () => {
  const connection = {
    async execute(sql) {
      if (/SESSION_USER/.test(sql)) return { rows: [{ SESSION_USER: 'ALBINAA20261PAYWRITER' }] };
      if (/USER_TAB_PRIVS/.test(sql)) return { rows: WRITER_PRIVILEGES };
      return { rows: [] };
    },
    async rollback() {}, async close() {},
  };
  const driver = {
    OUT_FORMAT_OBJECT: 1, initOracleClient() {},
    async createPool() { return { async getConnection() { return connection; }, async close() {} }; },
  };
  const writer = new Ias20261PaymentWriter(driver, config());
  await writer.start();
  await writer.close();
});

test('creates only payment master, detail, and pending DOC_TYP 93 approval', async () => {
  const calls = [];
  let sequence = 7000;
  const connection = {
    async execute(sql, binds = {}) {
      calls.push({ sql, binds });
      if (/IAS_DOC_SEQ_OTHR\.NEXTVAL/.test(sql)) return { rows: [{ DOC_SEQUENCE: ++sequence }] };
      return executePaymentValidation(sql, binds);
    },
    commitCount: 0, rollbackCount: 0,
    async commit() { this.commitCount += 1; },
    async rollback() { this.rollbackCount += 1; },
    async close() {},
  };
  const writer = new Ias20261PaymentWriter({}, config());
  writer.pool = { async getConnection() { return connection; } };
  const result = await writer.createDraft(paymentInput());
  assert.equal(result.created, true);
  assert.equal(result.requestNo, '6');
  assert.equal(result.requestSerial, '202600000100093100000000061');
  assert.equal(result.schema, 'IAS20261');
  assert.equal(result.oracleWrite, 'INSERT_ONLY');
  assert.equal(connection.commitCount, 1);
  const master = calls.find((call) => /INSERT INTO IAS20261\.IAS_RQ_VCHR_MST/.test(call.sql));
  const detail = calls.find((call) => /INSERT INTO IAS20261\.IAS_RQ_VCHR_DTL/.test(call.sql));
  const approval = calls.find((call) => /INSERT INTO IAS20261\.S_APPRVD_MOV/.test(call.sql));
  assert.equal(master.binds.voucherType, 2);
  assert.equal(master.binds.documentType, 93);
  assert.equal(master.binds.recipientName, 'مستلم تجريبي');
  assert.equal(detail.binds.signedLocal, 1);
  assert.equal(detail.binds.signedForeign, 140);
  assert.equal(detail.binds.referenceNo, 'PAY-1');
  assert.equal(approval.binds.documentType, 93);
  assert.equal(approval.binds.voucherType, 2);
  assert.equal(calls.some((call) => /\b(UPDATE|DELETE|MERGE)\b/i.test(call.sql)), false);
});
