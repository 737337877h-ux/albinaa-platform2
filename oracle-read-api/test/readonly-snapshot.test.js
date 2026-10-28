'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ReadonlySnapshot } = require('../scripts/readonly-snapshot');

function fixture(user = 'ALBINAA_RO') {
  const calls = [];
  const connection = {
    execute: async (sql) => { calls.push(sql); return { rows: [{ SESSION_USER: user }] }; },
    rollback: async () => calls.push('rollback'), close: async () => calls.push('close'),
  };
  const driver = { NUMBER: 2010, OUT_FORMAT_OBJECT: 4002, initOracleClient() {},
    getConnection: async (options) => { calls.push(options); return connection; } };
  const db = new ReadonlySnapshot(driver, { user: 'ALBINAA_RO', password: 'test', clientLibDir: 'test', connectString: '(DESCRIPTION=(ADDRESS=(HOST=test)))' });
  return { calls, connection, driver, db };
}
test('keeps every query on one read-only transaction with bounded connect/query times', async () => {
  const { db, calls, connection, driver } = fixture();
  await db.start();
  assert.match(calls[0].connectString, /CONNECT_TIMEOUT=15/);
  assert.equal(calls[1], 'SET TRANSACTION READ ONLY');
  assert.equal(connection.callTimeout, 120000);
  assert.deepEqual(driver.fetchAsString, [driver.NUMBER]);
  await db.select('SELECT C_CODE FROM IAS20261.CUSTOMER');
  await db.close();
  assert.deepEqual(calls.slice(-2), ['rollback', 'close']);
});
test('rejects YS before connecting', async () => {
  const { db, calls } = fixture(); db.config.user = 'YS';
  await assert.rejects(db.start(), /ALBINAA_RO/);
  assert.equal(calls.length, 0);
});
test('rejects an unexpected session identity and closes it', async () => {
  const { db, calls } = fixture('WRITER');
  await assert.rejects(db.start(), /Unexpected/);
  assert.deepEqual(calls.slice(-2), ['rollback', 'close']);
});
test('rejects writes and sequences', async () => {
  const { db } = fixture(); await db.start();
  for (const sql of ['DELETE FROM CUSTOMER', 'SELECT S.NEXTVAL FROM DUAL', 'SELECT 1 FROM DUAL;']) {
    assert.throws(() => db.select(sql), /SELECT only/);
  }
  await db.close();
});
