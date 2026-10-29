'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHandler, validatePaymentPayload } = require('../src/ias20261-payment-server');

const config = { apiKey: 'test-key', schema: 'IAS20261' };

function payload() {
  return {
    kind: 'payment', paymentMethod: 'cash', externalReference: 'payment:test-1',
    currencyCode: 'SR', amount: 1, cashOrBankNo: 101,
    description: 'اختبار سند صرف', recipientName: 'مستلم تجريبي',
    lines: [{
      accountCode: '112101001', analyticalAccountCode: '10001', analyticalType: 3,
      currencyCode: 'YR', amount: 140,
    }],
  };
}

test('validates payment-only payloads and Oracle byte limits', () => {
  const value = validatePaymentPayload(payload());
  assert.equal(value.kind, 'payment');
  assert.equal(value.recipientName, 'مستلم تجريبي');
  assert.equal(validatePaymentPayload({ ...payload(), referenceNo: '١٢٣٤٥٦٧٨٩٠١٢٣٤' }).referenceNo, '12345678901234');
  assert.throws(() => validatePaymentPayload({ ...payload(), kind: 'receipt' }), /payment only/);
  assert.throws(() => validatePaymentPayload({ ...payload(), recipientName: '' }), /recipientName is required/);
  assert.throws(
    () => validatePaymentPayload({ ...payload(), referenceNo: '1234567890123456' }),
    /رقم المرجع يتجاوز حد Oracle \(15 بايت\)/,
  );
});

test('exposes payment Dry Run and idempotent draft creation only', async () => {
  const calls = [];
  const writer = {
    dryRun: async (value) => { calls.push(['dry-run', value]); return { valid: true, oracleWrite: 'NONE', saveAllowed: true }; },
    createDraft: async (value) => {
      calls.push(['create', value]);
      return { created: true, requestNo: '6', requestSerial: '202600000100093100000000061', oracleWrite: 'INSERT_ONLY' };
    },
  };
  const server = http.createServer(createHandler(config, writer));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    assert.deepEqual(await (await fetch(`${baseUrl}/health`)).json(), {
      status: 'ok', mode: 'IAS20261_PAYMENT_DRAFT_INSERT_ONLY', schema: 'IAS20261',
    });
    const dryRun = await fetch(`${baseUrl}/accounting/payments/dry-run`, {
      method: 'POST', headers: { authorization: 'Bearer test-key' }, body: JSON.stringify(payload()),
    });
    assert.equal(dryRun.status, 200);
    assert.equal(calls.length, 1);
    const create = await fetch(`${baseUrl}/accounting/payments`, {
      method: 'POST', headers: { authorization: 'Bearer test-key' }, body: JSON.stringify(payload()),
    });
    assert.equal(create.status, 201);
    assert.equal((await create.json()).oracleWrite, 'INSERT_ONLY');
    assert.equal(calls.length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
