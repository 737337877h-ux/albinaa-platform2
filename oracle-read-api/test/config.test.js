'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, resolveSchema } = require('../src/config');

const base = {
  ORACLE_USER: 'ALBINAA_RO', ORACLE_PASSWORD: 'test-only', ORACLE_CONNECT_STRING: 'db/IAS',
  ORACLE_CLIENT_LIB_DIR: 'C:\\oracle', ORACLE_SCHEMA: 'IAS20261', ORACLE_ALLOWED_SCHEMAS: 'IAS20261,IAS20262',
  ORACLE_READ_API_KEY: 'test-key',
};

test('accepts ALBINAA_RO and an allowlisted configurable schema', () => {
  const config = loadConfig(base);
  assert.equal(resolveSchema(config, 'IAS20262'), 'IAS20262');
});

test('rejects YS and non-allowlisted or injected schemas', () => {
  assert.throws(() => loadConfig({ ...base, ORACLE_USER: 'YS' }), /ALBINAA_RO/);
  const config = loadConfig(base);
  assert.throws(() => resolveSchema(config, 'SYSTEM'), /not allowed/);
  assert.throws(() => resolveSchema(config, 'IAS20261.ITEM_MOVEMENT --'), /Invalid/);
});
