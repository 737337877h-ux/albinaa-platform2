'use strict';

const crypto = require('node:crypto');

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function request(path, payload) {
  const baseUrl = process.env.ORACLE_WRITE_API_URL?.trim() || 'http://127.0.0.1:3012';
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${required('ORACLE_WRITE_API_KEY')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path} failed with HTTP ${response.status}: ${result.message || 'unknown error'}`);
  return result;
}

async function main() {
  const payload = {
    externalReference: process.env.PURCHASE_TEST_REFERENCE?.trim() || `purchase-request:${crypto.randomUUID()}`,
    warehouseCode: '1',
    hierarchyNo: 1,
    requiredDate: '2020-12-31',
    requestSide: 'منصة البناء الراقي',
    notes: 'IAS20191 purchase request level-one approval test',
    lines: [{ itemCode: '00103-01-07', unitCode: 'حبة', quantity: 1 }],
  };
  const dryRun = await request('/purchasing/requests/dry-run', payload);
  const first = await request('/purchasing/requests', payload);
  const retry = await request('/purchasing/requests', payload);
  console.log(JSON.stringify({
    success: true,
    schema: 'IAS20191',
    dryRunValid: dryRun.valid,
    firstCallCreated: first.created,
    idempotentRetryCreated: retry.created,
    requestNo: first.requestNo,
    requestSerial: first.requestSerial,
  }));
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
