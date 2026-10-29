'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

const base = {
  ORACLE_USER: 'ALBINAAWRITER', ORACLE_PASSWORD: 'test-only', ORACLE_SCHEMA: 'IAS20191',
  ORACLE_CONNECT_STRING: 'db/orcl', ORACLE_CLIENT_LIB_DIR: 'C:/oracle', ORACLE_WRITE_API_KEY: 'key',
};

test('accepts only the isolated writer and IAS20191', () => {
  assert.equal(loadConfig(base).schema, 'IAS20191');
  assert.throws(() => loadConfig({ ...base, ORACLE_USER: 'YS' }), /ALBINAAWRITER/);
  assert.throws(() => loadConfig({ ...base, ORACLE_USER: 'ALBINAA_RO' }), /ALBINAAWRITER/);
  assert.throws(() => loadConfig({ ...base, ORACLE_SCHEMA: 'IAS20261' }), /IAS20191/);
});

test('pins the frozen company year and request date', () => {
  assert.throws(() => loadConfig({ ...base, ORACLE_REQUEST_BRANCH_YEAR: '2026' }), /2019/);
  assert.throws(() => loadConfig({ ...base, ORACLE_REQUEST_DATE: '2026-08-23' }), /2020-12-31/);
});
