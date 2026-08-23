'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHandler } = require('../src/server');

const config = {
  apiKey: 'secret',
  oracle: { defaultSchema: 'IAS20261', allowedSchemas: new Set(['IAS20261']) },
};

async function withServer(db, run) {
  const server = http.createServer(createHandler(config, db));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('rejects unauthenticated data reads and all non-GET methods', async () => {
  await withServer({ select: async () => ({ rows: [] }) }, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/inventory/warehouses/101?schema=IAS20261`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/inventory/warehouses/101`, {
      method: 'POST', headers: { authorization: 'Bearer secret' },
    })).status, 405);
  });
});

test('returns raw evidence with long serials preserved as strings', async () => {
  const db = {
    async select(sql) {
      if (sql.includes('TR_SER = :sourceTransferSerial') && sql.includes('TR_NO')) return { rows: [{
        TRANSFER_SERIAL: '20260000011119', TRANSFER_DOCUMENT_NUMBER: '9', WAREHOUSE_CODE: '102',
        DESTINATION_WAREHOUSE_CODE: '101', TR_POST: null, STK_PROCESSED: 0, POST_DATE: null,
      }] };
      if (sql.includes('SOURCE_TRANSFER_SERIAL')) return { rows: [{
        TRANSFER_SERIAL: '20260000011129', SOURCE_TRANSFER_SERIAL: '20260000011119', WAREHOUSE_CODE: '101',
      }] };
      return { rows: [
        { DOCUMENT_SERIAL: '20260000011119', DOCUMENT_TYPE: 7, ITEM_CODE: '295602501014', WAREHOUSE_CODE: '102' },
        { DOCUMENT_SERIAL: '20260000011129', DOCUMENT_TYPE: 8, ITEM_CODE: '295602501014', WAREHOUSE_CODE: '101' },
      ] };
    },
  };
  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/inventory/transfers/evidence?sourceTransferSerial=20260000011119&sourceWarehouseCode=102&destinationWarehouseCode=101&itemCodes=295602501014&schema=IAS20261`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source.transferSerial, '20260000011119');
    assert.equal(body.destinationDocuments[0].transferSerial, '20260000011129');
    assert.equal(body.movements[1].documentType, 8);
  });
});
