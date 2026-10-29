'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  createHandler, validatePurchasePayload, validateReceiptPayload, validateTransferPayload,
} = require('../src/ias20261-purchase-server');

const config = { apiKey: 'test-key', schema: 'IAS20261' };

async function withServer(writer, callback) {
  const server = http.createServer(createHandler(config, writer));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('validates a multi-line IAS20261 purchase request', () => {
  const value = validatePurchasePayload({
    externalReference: 'platform-purchase:test-1', warehouseCode: '102',
    requestSide: 'منصة البناء الراقي', notes: 'اختبار', requiredDate: '2026-08-29',
    lines: [
      { itemCode: '111100202001', unitCode: 'حبة', quantity: 2 },
      { itemCode: '971012502005', unitCode: 'ماصورة', quantity: 1 },
    ],
  });
  assert.equal(value.warehouseCode, 102);
  assert.equal(value.requiredDate, '2026-08-29');
  assert.equal(value.lines.length, 2);
});

test('validates an IAS20261 inventory transfer request', () => {
  const value = validateTransferPayload({
    externalReference: 'inventory-transfer:test-1', sourceWarehouseCode: '102', destinationWarehouseCode: '101',
    lines: [{ itemCode: '111100202001', unitCode: 'حبة', quantity: 1 }],
  });
  assert.equal(value.sourceWarehouseCode, 102);
  assert.equal(value.destinationWarehouseCode, 101);
  assert.equal(value.lines.length, 1);
  assert.throws(() => validateTransferPayload({
    externalReference: 'inventory-transfer:test-1', sourceWarehouseCode: '102', destinationWarehouseCode: '102',
    lines: [{ itemCode: '111100202001', unitCode: 'حبة', quantity: 1 }],
  }), /Invalid transfer warehouses/);
});

test('validates receipt-only IAS20261 voucher payloads', () => {
  const value = validateReceiptPayload({
    kind: 'receipt', paymentMethod: 'cash', externalReference: 'receipt:test-1',
    currencyCode: 'SR', amount: 1, cashOrBankNo: 101,
    description: 'اختبار سند قبض', collectorNo: 1, recipientName: 'عميل تجريبي',
    lines: [{
      accountCode: '112101001', analyticalAccountCode: '10001', analyticalType: 3,
      currencyCode: 'SR', amount: 1,
    }],
  });
  assert.equal(value.kind, 'receipt');
  assert.equal(value.lines.length, 1);
  assert.equal(value.recipientName, 'عميل تجريبي');
  assert.throws(() => validateReceiptPayload({ ...value, kind: 'payment' }), /receipt only/);
  assert.throws(() => validateReceiptPayload({ ...value, recipientName: '' }), /recipientName is required/);
  assert.equal(validateReceiptPayload({ ...value, referenceNo: '123456789012345' }).referenceNo, '123456789012345');
  assert.equal(validateReceiptPayload({ ...value, referenceNo: '١٧٨٨٩٢٩٦٩٥٢٠٠٤' }).referenceNo, '17889296952004');
  assert.throws(
    () => validateReceiptPayload({ ...value, referenceNo: '1234567890123456' }),
    /Invalid referenceNo/,
  );
  assert.throws(
    () => validateReceiptPayload({ ...value, referenceNo: 'ابجدهوزح' }),
    /رقم المرجع يتجاوز حد Oracle \(15 بايت\)/,
  );
});

test('exposes transfer Dry Run and draft routes only when a dedicated transfer writer is supplied', async () => {
  const purchaseWriter = { dryRun: async () => ({}), createDraft: async () => ({ created: true }) };
  const calls = [];
  const transferWriter = {
    dryRun: async (value) => { calls.push(['dry-run', value]); return { valid: true, oracleWrite: 'NONE' }; },
    createDraft: async (value) => { calls.push(['create', value]); return { created: true, requestNo: '31', requestSerial: '202600000131' }; },
  };
  const server = http.createServer(createHandler(config, purchaseWriter, transferWriter));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    assert.deepEqual(await (await fetch(`${baseUrl}/health`)).json(), {
      status: 'ok', mode: 'IAS20261_PURCHASE_TRANSFER_DRAFT_INSERT_ONLY', schema: 'IAS20261',
    });
    const payload = {
      externalReference: 'inventory-transfer:test-1', sourceWarehouseCode: '102', destinationWarehouseCode: '101',
      lines: [{ itemCode: '111100202001', unitCode: 'حبة', quantity: 1 }],
    };
    const dryRun = await fetch(`${baseUrl}/inventory/out-requests/dry-run`, {
      method: 'POST', headers: { authorization: 'Bearer test-key' }, body: JSON.stringify(payload),
    });
    assert.equal(dryRun.status, 200);
    assert.equal(calls[0][0], 'dry-run');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('exposes receipt Dry Run and draft routes only when a dedicated receipt writer is supplied', async () => {
  const purchaseWriter = { dryRun: async () => ({}), createDraft: async () => ({ created: true }) };
  const transferWriter = { dryRun: async () => ({}), createDraft: async () => ({ created: true }) };
  const calls = [];
  const receiptWriter = {
    dryRun: async (value) => { calls.push(['dry-run', value]); return { valid: true, oracleWrite: 'NONE' }; },
    createDraft: async (value) => {
      calls.push(['create', value]);
      return { created: true, requestNo: '6', requestSerial: '202600000100092100000000061' };
    },
  };
  const server = http.createServer(createHandler(config, purchaseWriter, transferWriter, receiptWriter));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    assert.deepEqual(await (await fetch(`${baseUrl}/health`)).json(), {
      status: 'ok', mode: 'IAS20261_PURCHASE_TRANSFER_RECEIPT_DRAFT_INSERT_ONLY', schema: 'IAS20261',
    });
    const payload = {
      kind: 'receipt', paymentMethod: 'cash', externalReference: 'receipt:test-1',
      currencyCode: 'SR', amount: 1, cashOrBankNo: 101, description: 'اختبار',
      recipientName: 'مستلم تجريبي',
      lines: [{
        accountCode: '112101001', analyticalAccountCode: '10001', analyticalType: 3,
        currencyCode: 'SR', amount: 1,
      }],
    };
    const dryRun = await fetch(`${baseUrl}/accounting/receipts/dry-run`, {
      method: 'POST', headers: { authorization: 'Bearer test-key' }, body: JSON.stringify(payload),
    });
    assert.equal(dryRun.status, 200);
    assert.equal(calls[0][0], 'dry-run');

    const payment = await fetch(`${baseUrl}/accounting/receipts`, {
      method: 'POST', headers: { authorization: 'Bearer test-key' },
      body: JSON.stringify({ ...payload, kind: 'payment' }),
    });
    assert.equal(payment.status, 400);
    assert.equal(calls.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('exposes only health and purchase routes', async () => {
  const calls = [];
  const writer = {
    dryRun: async (value) => { calls.push(['dry-run', value]); return { valid: true, schema: 'IAS20261' }; },
    createDraft: async (value) => { calls.push(['create', value]); return { created: true, requestNo: '4', requestSerial: '20260000014' }; },
  };
  await withServer(writer, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      status: 'ok', mode: 'IAS20261_PURCHASE_DRAFT_INSERT_ONLY', schema: 'IAS20261',
    });

    const payload = {
      externalReference: 'platform-purchase:test-1', warehouseCode: '102', requiredDate: '2026-08-29',
      lines: [{ itemCode: '111100202001', unitCode: 'حبة', quantity: 2 }],
    };
    const dryRun = await fetch(`${baseUrl}/purchasing/requests/dry-run`, {
      method: 'POST', headers: { authorization: 'Bearer test-key' }, body: JSON.stringify(payload),
    });
    assert.equal(dryRun.status, 200);

    const forbidden = await fetch(`${baseUrl}/accounting/vouchers`, {
      method: 'POST', headers: { authorization: 'Bearer test-key' }, body: '{}',
    });
    assert.equal(forbidden.status, 404);
    assert.equal(calls.length, 1);
  });
});
