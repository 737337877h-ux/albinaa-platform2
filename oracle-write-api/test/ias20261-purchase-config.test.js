'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadIas20261PurchaseConfig } = require('../src/ias20261-purchase-config');

const base = {
  ORACLE_USER: 'ALBINAA20261WRITER', ORACLE_PASSWORD: 'test-only', ORACLE_SCHEMA: 'IAS20261',
  ORACLE_CONNECT_STRING: 'db/orcl', ORACLE_CLIENT_LIB_DIR: 'C:/oracle', ORACLE_WRITE_API_KEY: 'key',
  ORACLE_REQUEST_BRANCH_YEAR: '2026',
};

test('pins the operational purchase writer to its dedicated user and IAS20261', () => {
  const config = loadIas20261PurchaseConfig(base);
  assert.equal(config.schema, 'IAS20261');
  assert.equal(config.branchYear, 2026);
  assert.equal(config.port, 13014);
  assert.throws(() => loadIas20261PurchaseConfig({ ...base, ORACLE_USER: 'ALBINAAWRITER' }), /ALBINAA20261WRITER/);
  assert.throws(() => loadIas20261PurchaseConfig({ ...base, ORACLE_SCHEMA: 'IAS20191' }), /IAS20261/);
  assert.throws(() => loadIas20261PurchaseConfig({ ...base, ORACLE_REQUEST_BRANCH_YEAR: '2019' }), /2026/);
});
