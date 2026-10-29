'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { loadIas20261InventoryConfig } = require('../src/ias20261-inventory-config');
const { createHandler, validateInventoryPayload } = require('../src/ias20261-inventory-server');
const { Ias20261InventoryWriter, buildInventorySerial } = require('../src/ias20261-inventory-writer');

const PRIVILEGES = [
  ['IAS_INV_TYPES', 'SELECT'], ['IAS_PRIV_INV_TYPE', 'SELECT'],
  ['WAREHOUSE_DETAILS', 'SELECT'], ['ITEM_DETAILS', 'SELECT'],
  ['IAS_V_ITM_AVLQTY', 'SELECT'], ['MASTER_INV', 'SELECT'], ['MASTER_INV', 'INSERT'],
  ['DETAIL_INV', 'SELECT'], ['DETAIL_INV', 'INSERT'],
].map(([TABLE_NAME, PRIVILEGE]) => ({ TABLE_NAME, PRIVILEGE }));

function config() {
  return {
    host: '127.0.0.1', port: 13217, apiKey: 'test-key', schema: 'IAS20261',
    branchYear: 2026, oracleUserId: 1,
    oracle: {
      user: 'ALBINAA20261INVWRITER', password: 'secret', connectString: 'db', clientLibDir: 'client',
      poolMin: 1, poolMax: 1, poolIncrement: 1, queueTimeout: 1000, callTimeout: 5000,
    },
  };
}

function payload() {
  return {
    externalReference: 'inventory:test-1', inventoryType: 2, warehouseCode: 101,
    description: 'جرد تجريبي من المنصة',
    lines: [{ itemCode: '230800105001', unitCode: 'طن', countedQuantity: 1 }],
  };
}

function inventoryResult(sql, binds = {}) {
  if (/REF_NO=:referenceNo/.test(sql)) return { rows: [] };
  if (/IAS_INV_TYPES/.test(sql)) return { rows: [{ INV_TYPE: 2, INV_NAME: 'جرد من التطبيق', ADD_ALLOWED: 1 }] };
  if (/WAREHOUSE_DETAILS/.test(sql)) return { rows: [{ W_CODE: binds.warehouseCode }] };
  if (/ITEM_DETAILS/.test(sql)) return { rows: [{ I_NAME: 'حديد تركي 8', I_E_NAME: null, P_SIZE: 1 }] };
  if (/IAS_V_ITM_AVLQTY/.test(sql)) return { rows: [{ AVAILABLE_QUANTITY: 5 }] };
  if (/MAX\(INV_NO\)/.test(sql)) return { rows: [{ NEXT_DOCUMENT_NO: 9 }] };
  return { rows: [] };
}

test('pins the inventory gateway to the dedicated IAS20261 account and port', () => {
  const value = loadIas20261InventoryConfig({
    ORACLE_USER: 'albinaa20261invwriter', ORACLE_SCHEMA: 'ias20261', ORACLE_PASSWORD: 'secret',
    ORACLE_CONNECT_STRING: 'db', ORACLE_CLIENT_LIB_DIR: 'client', ORACLE_WRITE_API_KEY: 'key',
  });
  assert.equal(value.port, 13217);
  assert.equal(value.schema, 'IAS20261');
  assert.throws(() => loadIas20261InventoryConfig({
    ORACLE_USER: 'ALBINAAWRITER', ORACLE_SCHEMA: 'IAS20261', ORACLE_PASSWORD: 'secret',
    ORACLE_CONNECT_STRING: 'db', ORACLE_CLIENT_LIB_DIR: 'client', ORACLE_WRITE_API_KEY: 'key',
  }), /ALBINAA20261INVWRITER/);
});

test('validates a native IAS20261 inventory-count payload', () => {
  const value = validateInventoryPayload(payload());
  assert.equal(value.warehouseCode, 101);
  assert.equal(value.lines[0].itemCode, '230800105001');
  assert.equal(value.lines[0].batchNo, '0');
  assert.equal(value.lines[0].expireDate, '1900-01-01');
});

test('starts only with the dedicated inventory INSERT-only grants', async () => {
  const connection = {
    async execute(sql) {
      if (/SESSION_USER/.test(sql)) return { rows: [{ SESSION_USER: 'ALBINAA20261INVWRITER' }] };
      if (/USER_TAB_PRIVS/.test(sql)) return { rows: PRIVILEGES };
      return { rows: [] };
    },
    async rollback() {}, async close() {},
  };
  const driver = {
    OUT_FORMAT_OBJECT: 1, initOracleClient() {},
    async createPool() { return { async getConnection() { return connection; }, async close() {} }; },
  };
  const writer = new Ias20261InventoryWriter(driver, config());
  await writer.start();
  await writer.close();
});

test('Dry Runs IAS20261 inventory count without locks or writes', async () => {
  const calls = [];
  const connection = {
    async execute(sql, binds = {}) { calls.push(sql); return inventoryResult(sql, binds); },
    async rollback() {}, async close() {},
  };
  const writer = new Ias20261InventoryWriter({}, config());
  writer.pool = { async getConnection() { return connection; } };
  const result = await writer.dryRun(payload());
  assert.equal(result.valid, true);
  assert.equal(result.saveAllowed, true);
  assert.equal(result.schema, 'IAS20261');
  assert.equal(result.lines[0].differenceQuantity, -4);
  assert.equal(calls.some((sql) => /LOCK TABLE|INSERT INTO|UPDATE|DELETE|MERGE|NEXTVAL/i.test(sql)), false);
});

test('creates only unprocessed IAS20261 inventory master and detail rows', async () => {
  const calls = [];
  const connection = {
    async execute(sql, binds = {}) { calls.push({ sql, binds }); return inventoryResult(sql, binds); },
    commits: 0,
    async commit() { this.commits += 1; }, async rollback() {}, async close() {},
  };
  const writer = new Ias20261InventoryWriter({}, config());
  writer.pool = { async getConnection() { return connection; } };
  const result = await writer.createDraft(payload());
  assert.equal(result.created, true);
  assert.equal(result.documentNo, '9');
  assert.equal(result.documentSerial, buildInventorySerial(2026, 2, 9));
  assert.equal(result.processed, false);
  assert.equal(result.externalPost, false);
  assert.equal(connection.commits, 1);
  assert.equal(calls.filter((call) => /INSERT INTO IAS20261\.MASTER_INV/.test(call.sql)).length, 1);
  assert.equal(calls.filter((call) => /INSERT INTO IAS20261\.DETAIL_INV/.test(call.sql)).length, 1);
  assert.equal(calls.some((call) => /INSERT INTO IAS20261\.(?!MASTER_INV|DETAIL_INV)/.test(call.sql)), false);
  assert.equal(calls.some((call) => /\b(UPDATE|DELETE|MERGE)\b/i.test(call.sql)), false);
});

test('exposes only inventory Dry Run and draft creation routes', async () => {
  const calls = [];
  const writer = {
    dryRun: async (value) => { calls.push(['dry-run', value]); return { valid: true, saveAllowed: true }; },
    createDraft: async (value) => {
      calls.push(['create', value]);
      return { created: true, documentNo: '9', documentSerial: buildInventorySerial(2026, 2, 9) };
    },
  };
  const server = http.createServer(createHandler(config(), writer));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    assert.deepEqual(await (await fetch(`${baseUrl}/health`)).json(), {
      status: 'ok', mode: 'IAS20261_INVENTORY_COUNT_DRAFT_INSERT_ONLY', schema: 'IAS20261',
    });
    const dry = await fetch(`${baseUrl}/inventory/counts/dry-run`, {
      method: 'POST', headers: { authorization: 'Bearer test-key' }, body: JSON.stringify(payload()),
    });
    assert.equal(dry.status, 200);
    const create = await fetch(`${baseUrl}/inventory/counts`, {
      method: 'POST', headers: { authorization: 'Bearer test-key' }, body: JSON.stringify(payload()),
    });
    assert.equal(create.status, 201);
    const forbidden = await fetch(`${baseUrl}/accounting/vouchers`, {
      method: 'POST', headers: { authorization: 'Bearer test-key' }, body: '{}',
    });
    assert.equal(forbidden.status, 404);
    assert.equal(calls.length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
