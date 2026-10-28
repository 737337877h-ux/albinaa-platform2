'use strict';

const http = require('node:http');
const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleOutRequestWriter } = require('../src/oracle-writer');
const { createHandler } = require('../src/server');

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function main() {
  const config = loadConfig();
  const writer = new OracleOutRequestWriter(oracledb, config);
  const server = http.createServer(createHandler(config, writer));
  try {
    await writer.start();
    const port = await listen(server);
    const url = `http://127.0.0.1:${port}/inventory/out-requests`;
    const options = {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        externalReference: 'writer-api-smoke-v1',
        sourceWarehouseCode: '1',
        destinationWarehouseCode: '2',
        requestSide: 'منصة البناء الراقي',
        notes: 'اختبار Oracle Write API - غير معتمد',
        lines: [{ itemCode: '00101-01-01', unitCode: 'حبة', quantity: 1 }],
      }),
    };
    const firstResponse = await fetch(url, options);
    const first = await firstResponse.json();
    if (![200, 201].includes(firstResponse.status) || !first.requestNo || !first.requestSerial) {
      throw new Error(`First API request failed with status ${firstResponse.status}`);
    }
    const retryResponse = await fetch(url, options);
    const retry = await retryResponse.json();
    if (retryResponse.status !== 200 || retry.created !== false
      || retry.requestNo !== first.requestNo || retry.requestSerial !== first.requestSerial) {
      throw new Error('Idempotent retry did not return the same Oracle request');
    }
    console.log(JSON.stringify({
      success: true,
      schema: config.schema,
      firstCallCreated: first.created,
      idempotentRetryCreated: retry.created,
      requestNo: retry.requestNo,
      requestSerial: retry.requestSerial,
    }));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await writer.close();
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
