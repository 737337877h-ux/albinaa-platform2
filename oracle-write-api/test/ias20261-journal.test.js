'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { loadIas20261JournalConfig } = require('../src/ias20261-journal-config');
const { createHandler, validateJournalPayload } = require('../src/ias20261-journal-server');
const { Ias20261JournalWriter, buildJournalSerial } = require('../src/ias20261-journal-writer');

const PRIVILEGES = [
  ['IAS_RQ_JRNL_MST', 'SELECT'], ['IAS_RQ_JRNL_MST', 'INSERT'],
  ['IAS_RQ_JRNL_DTL', 'SELECT'], ['IAS_RQ_JRNL_DTL', 'INSERT'],
  ['S_APPRVD_MOV', 'INSERT'], ['IAS_DOC_SEQ_OTHR', 'SELECT'],
  ['EX_RATE', 'SELECT'], ['IAS_PERIOD_EX_RATE_DAY', 'SELECT'],
  ['ACCOUNT_CURR', 'SELECT'], ['CUSTOMER_CURR', 'SELECT'], ['GLS_ACCNT_DTL', 'SELECT'],
  ['CASH_AT_BANK', 'SELECT'],
].map(([TABLE_NAME, PRIVILEGE]) => ({ TABLE_NAME, PRIVILEGE }));

function config() {
  return {
    host: '127.0.0.1', port: 13216, apiKey: 'test-key', schema: 'IAS20261',
    branchYear: 2026, oracleUserId: 1,
    oracle: {
      user: 'ALBINAA20261JRNWRITER', password: 'secret', connectString: 'db', clientLibDir: 'client',
      poolMin: 1, poolMax: 1, poolIncrement: 1, queueTimeout: 1000, callTimeout: 5000,
    },
  };
}

function payload() {
  return {
    externalReference: 'journal:test-1', description: 'اختبار قيد يومي', referenceNo: 'JRN-1',
    lines: [
      {
        direction: 'debit', currencyCode: 'YR', amount: 140,
        accountCode: '112101001', analyticalAccountCode: '10001', analyticalType: 3,
        description: 'مدين العميل',
      },
      {
        direction: 'credit', currencyCode: 'SR', amount: 1,
        accountCode: '111202007', analyticalAccountCode: '207', analyticalType: 2,
        description: 'دائن البنك',
      },
    ],
  };
}

function validationResult(sql, binds = {}) {
  if (/FIELD10/.test(sql)) return { rows: [] };
  if (/FROM IAS20261\.(CUSTOMER_CURR|ACCOUNT_CURR|GLS_ACCNT_DTL|CASH_AT_BANK)/.test(sql)) return { rows: [{ ALLOWED: 1 }] };
  if (/FROM IAS20261\.EX_RATE WHERE CUR_CODE/.test(sql)) {
    const local = binds.currencyCode === 'SR';
    return { rows: [{
      CUR_CODE: binds.currencyCode, CUR_NAME: local ? 'ريال سعودي' : 'ريال يمني',
      CUR_RATE: local ? 1 : 1 / 140, L_F: local ? 1 : 0, CUR_FRC_NO: 2,
    }] };
  }
  if (/FROM IAS20261\.EX_RATE WHERE L_F=1/.test(sql)) {
    return { rows: [{ CUR_CODE: 'SR', CUR_NAME: 'ريال سعودي', CUR_RATE: 1 }] };
  }
  if (/IAS_PERIOD_EX_RATE_DAY/.test(sql)) return { rows: [] };
  if (/MAX\(J_DOC_NO\)/.test(sql)) return { rows: [{ NEXT_REQUEST_NO: 8 }] };
  return { rows: [] };
}

test('pins the journal gateway to the dedicated IAS20261 account and port', () => {
  const value = loadIas20261JournalConfig({
    ORACLE_USER: 'albinaa20261jrnwriter', ORACLE_SCHEMA: 'ias20261', ORACLE_PASSWORD: 'secret',
    ORACLE_CONNECT_STRING: 'db', ORACLE_CLIENT_LIB_DIR: 'client', ORACLE_WRITE_API_KEY: 'key',
  });
  assert.equal(value.port, 13216);
  assert.equal(value.schema, 'IAS20261');
  assert.throws(() => loadIas20261JournalConfig({
    ORACLE_USER: 'ALBINAA20261PAYWRITER', ORACLE_SCHEMA: 'IAS20261', ORACLE_PASSWORD: 'secret',
    ORACLE_CONNECT_STRING: 'db', ORACLE_CLIENT_LIB_DIR: 'client', ORACLE_WRITE_API_KEY: 'key',
  }), /ALBINAA20261JRNWRITER/);
});

test('validates a journal with debit and credit lines', () => {
  const value = validateJournalPayload(payload());
  assert.equal(value.lines.length, 2);
  assert.throws(() => validateJournalPayload({ ...payload(), lines: [payload().lines[0]] }), /Invalid lines/);
  assert.throws(() => validateJournalPayload({
    ...payload(), lines: payload().lines.map((line) => ({ ...line, direction: 'debit' })),
  }), /debit and credit/);
});

test('accepts the verified non-analytical discount account without fabricated details', () => {
  const value = validateJournalPayload({
    ...payload(),
    lines: [
      {
        direction: 'debit', currencyCode: 'SR', amount: 1,
        accountCode: '312401001', analyticalAccountCode: '', analyticalType: 0,
      },
      payload().lines[1],
    ],
  });
  assert.equal(value.lines[0].analyticalAccountCode, null);
  assert.equal(value.lines[0].analyticalType, 0);
});

test('starts only with the dedicated journal INSERT-only grants', async () => {
  const connection = {
    async execute(sql) {
      if (/SESSION_USER/.test(sql)) return { rows: [{ SESSION_USER: 'ALBINAA20261JRNWRITER' }] };
      if (/USER_TAB_PRIVS/.test(sql)) return { rows: PRIVILEGES };
      return { rows: [] };
    },
    async rollback() {}, async close() {},
  };
  const driver = {
    OUT_FORMAT_OBJECT: 1, initOracleClient() {},
    async createPool() { return { async getConnection() { return connection; }, async close() {} }; },
  };
  const writer = new Ias20261JournalWriter(driver, config());
  await writer.start();
  await writer.close();
});

test('Dry Runs a balanced mixed-currency IAS20261 journal without writes', async () => {
  const calls = [];
  const connection = {
    async execute(sql, binds = {}) { calls.push(sql); return validationResult(sql, binds); },
    async rollback() {}, async close() {},
  };
  const writer = new Ias20261JournalWriter({}, config());
  writer.pool = { async getConnection() { return connection; } };
  const result = await writer.dryRun(payload());
  assert.equal(result.valid, true);
  assert.equal(result.saveAllowed, true);
  assert.equal(result.localBalance, 0);
  assert.equal(result.localCurrency, 'SR');
  assert.equal(calls.some((sql) => /\b(INSERT|UPDATE|DELETE|MERGE|NEXTVAL)\b/i.test(sql)), false);
});

test('Dry Runs the verified non-analytical discount account through ACCOUNT_CURR only', async () => {
  const calls = [];
  const connection = {
    async execute(sql, binds = {}) { calls.push({ sql, binds }); return validationResult(sql, binds); },
    async rollback() {}, async close() {},
  };
  const writer = new Ias20261JournalWriter({}, config());
  writer.pool = { async getConnection() { return connection; } };
  const input = {
    ...payload(),
    lines: [
      { direction: 'debit', currencyCode: 'SR', amount: 1, accountCode: '312401001', analyticalAccountCode: null, analyticalType: 0 },
      { direction: 'credit', currencyCode: 'SR', amount: 1, accountCode: '112101001', analyticalAccountCode: '10001', analyticalType: 3 },
    ],
  };
  const result = await writer.dryRun(input);
  assert.equal(result.valid, true);
  assert.equal(calls.some((call) => /GLS_ACCNT_DTL/.test(call.sql) && call.binds.accountCode === '312401001'), false);
  assert.equal(calls.some((call) => /ACCOUNT_CURR/.test(call.sql) && call.binds.accountCode === '312401001'), true);
});

test('creates only journal master, details, and pending DOC_TYP 85 approval', async () => {
  const calls = [];
  let sequence = 8000;
  const connection = {
    async execute(sql, binds = {}) {
      calls.push({ sql, binds });
      if (/IAS_DOC_SEQ_OTHR\.NEXTVAL/.test(sql)) return { rows: [{ DOC_SEQUENCE: ++sequence }] };
      return validationResult(sql, binds);
    },
    commitCount: 0,
    async commit() { this.commitCount += 1; }, async rollback() {}, async close() {},
  };
  const writer = new Ias20261JournalWriter({}, config());
  writer.pool = { async getConnection() { return connection; } };
  const result = await writer.createDraft(payload());
  assert.equal(result.created, true);
  assert.equal(result.requestNo, '8');
  assert.equal(result.requestSerial, buildJournalSerial(2026, 8));
  assert.equal(result.oracleWrite, 'INSERT_ONLY');
  assert.equal(connection.commitCount, 1);
  assert.equal(calls.filter((call) => /INSERT INTO IAS20261\.IAS_RQ_JRNL_DTL/.test(call.sql)).length, 2);
  assert.equal(calls.find((call) => /INSERT INTO IAS20261\.S_APPRVD_MOV/.test(call.sql)).binds.documentType, 85);
  assert.equal(calls.some((call) => /\b(UPDATE|DELETE|MERGE)\b/i.test(call.sql)), false);
});

test('exposes only journal Dry Run and draft creation routes', async () => {
  const calls = [];
  const writer = {
    dryRun: async (value) => { calls.push(['dry-run', value]); return { valid: true, oracleWrite: 'NONE' }; },
    createDraft: async (value) => {
      calls.push(['create', value]);
      return { created: true, requestNo: '8', requestSerial: buildJournalSerial(2026, 8), oracleWrite: 'INSERT_ONLY' };
    },
  };
  const server = http.createServer(createHandler(config(), writer));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    assert.deepEqual(await (await fetch(`${baseUrl}/health`)).json(), {
      status: 'ok', mode: 'IAS20261_JOURNAL_DRAFT_INSERT_ONLY', schema: 'IAS20261',
    });
    const dryRun = await fetch(`${baseUrl}/accounting/journals/dry-run`, {
      method: 'POST', headers: { authorization: 'Bearer test-key' }, body: JSON.stringify(payload()),
    });
    assert.equal(dryRun.status, 200);
    const create = await fetch(`${baseUrl}/accounting/journals`, {
      method: 'POST', headers: { authorization: 'Bearer test-key' }, body: JSON.stringify(payload()),
    });
    assert.equal(create.status, 201);
    assert.equal(calls.length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
