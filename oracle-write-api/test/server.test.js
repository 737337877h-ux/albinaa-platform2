'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validatePayload, validatePurchaseRequestPayload,
  validateVoucherRequestPayload, validateJournalRequestPayload, validateInventoryCountPayload,
} = require('../src/server');
const {
  buildPurchaseReference, buildRequestSerial, buildVoucherSerial, buildJournalSerial,
} = require('../src/oracle-writer');

test('builds the verified YemenSoft request serial format', () => {
  assert.equal(buildRequestSerial(2019, 1, 1), '20190000011');
  assert.equal(buildRequestSerial(2019, 1, 2), '20190000012');
  assert.equal(buildRequestSerial(2019, 1, 10), '201900000110');
});

test('validates and normalizes a draft request', () => {
  assert.deepEqual(validatePayload({
    externalReference: 'inventory-transfer:123', sourceWarehouseCode: '1', destinationWarehouseCode: '2',
    lines: [{ itemCode: '00101-01-01', unitCode: 'حبة', quantity: 1 }],
  }), {
    externalReference: 'inventory-transfer:123', sourceWarehouseCode: 1, destinationWarehouseCode: 2,
    requestSide: 'منصة البناء الراقي', notes: 'طلب تجريبي من منصة البناء الراقي',
    lines: [{ itemCode: '00101-01-01', unitCode: 'حبة', quantity: 1 }],
  });
});

test('rejects same warehouses and invalid idempotency keys', () => {
  assert.throws(() => validatePayload({ externalReference: 'bad value', sourceWarehouseCode: '1', destinationWarehouseCode: '1', lines: [{}] }));
});

test('validates and normalizes an IAS20191 purchase request', () => {
  assert.deepEqual(validatePurchaseRequestPayload({
    externalReference: 'purchase-request:test-2',
    warehouseCode: '1',
    lines: [{ itemCode: '00103-01-07', unitCode: 'حبة', quantity: 20 }],
  }), {
    externalReference: 'purchase-request:test-2',
    warehouseCode: 1,
    hierarchyNo: 1,
    requiredDate: '2020-12-31',
    requestSide: 'منصة البناء الراقي',
    notes: 'طلب شراء تجريبي من منصة البناء الراقي',
    lines: [{ itemCode: '00103-01-07', unitCode: 'حبة', quantity: 20 }],
  });
});

test('creates a stable 15-character purchase idempotency reference', () => {
  const reference = buildPurchaseReference('purchase-request:test-2');
  assert.equal(reference.length, 15);
  assert.equal(reference, buildPurchaseReference('purchase-request:test-2'));
  assert.notEqual(reference, buildPurchaseReference('purchase-request:test-3'));
});

test('builds verified voucher and journal serials without numeric precision loss', () => {
  assert.equal(buildVoucherSerial(2019, 92, 1, 1), '201900000100092100000000011');
  assert.equal(buildVoucherSerial(2019, 93, 2, 1), '201900000100093200000000011');
  assert.equal(buildJournalSerial(2019, 85, 1, 3), '2019000001000850013');
});

test('accepts only cash or bank-transfer voucher requests', () => {
  const value = validateVoucherRequestPayload({
    kind: 'receipt', paymentMethod: 'bank_transfer', externalReference: 'receipt:test',
    currencyCode: 'YER', amount: 10000, cashOrBankNo: 1,
    accountCode: '112101001', analyticalAccountCode: '20027', analyticalType: 3,
    description: 'حوالة', referenceNo: '123', noticeNo: '456', collectorNo: 1,
  });
  assert.equal(value.kind, 'receipt');
  assert.equal(value.amount, 10000);
  assert.equal(value.lines.length, 1);
  assert.throws(() => validateVoucherRequestPayload({ ...value, paymentMethod: 'bank_cheque' }), /paymentMethod/);
  assert.throws(() => validateVoucherRequestPayload({ ...value, kind: 'payment', recipientName: null }), /recipientName/);
  assert.throws(() => validateVoucherRequestPayload({ ...value, commissionPercent: 101 }), /commissionPercent/);
});

test('normalizes multiple voucher detail lines and totals their document amount', () => {
  const value = validateVoucherRequestPayload({
    kind: 'payment', paymentMethod: 'cash', externalReference: 'payment:multi', currencyCode: 'R s',
    cashOrBankNo: 1, description: 'صرف متعدد', recipientName: 'المستلم',
    lines: [
      { amount: 40, accountCode: '1', analyticalAccountCode: '10', analyticalType: 2 },
      { amount: 60, accountCode: '2', analyticalAccountCode: '20', analyticalType: 3, description: 'السطر الثاني' },
    ],
  });
  assert.equal(value.amount, 100);
  assert.equal(value.lines.length, 2);
  assert.deepEqual(value.lines.map((line) => line.currencyCode), ['R s', 'R s']);
  assert.equal(value.lines[0].description, 'صرف متعدد');
});

test('keeps the cash or bank currency independent from voucher detail currencies', () => {
  const value = validateVoucherRequestPayload({
    kind: 'receipt', paymentMethod: 'cash', externalReference: 'receipt:mixed-currency',
    currencyCode: 'YER', amount: 9375, cashOrBankNo: 1, description: 'قبض متعدد العملات',
    lines: [
      { currencyCode: 'R s', amount: 60, accountCode: '112101001', analyticalAccountCode: '20027', analyticalType: 3 },
    ],
  });
  assert.equal(value.amount, 9375);
  assert.equal(value.currencyCode, 'YER');
  assert.equal(value.lines[0].currencyCode, 'R s');
  assert.throws(() => validateVoucherRequestPayload({ ...value, amount: undefined }), /amount is required/);
});

test('validates balanced-candidate journal request lines', () => {
  const value = validateJournalRequestPayload({
    externalReference: 'journal:test', description: 'قيد تجريبي', lines: [
      { direction: 'debit', currencyCode: 'R s', amount: 150, accountCode: '111202001', analyticalAccountCode: '2', analyticalType: 2 },
      { direction: 'credit', currencyCode: 'R s', amount: 150, accountCode: '112101001', analyticalAccountCode: '20031', analyticalType: 3 },
    ],
  });
  assert.equal(value.lines.length, 2);
  assert.equal(value.lines[1].direction, 'credit');
});

test('validates a non-analytical journal account without a fabricated detail code', () => {
  const value = validateJournalRequestPayload({
    externalReference: 'journal:discount', description: 'خصم', lines: [
      { direction: 'debit', currencyCode: 'YR', amount: 150, accountCode: '312401001', analyticalAccountCode: '', analyticalType: 0 },
      { direction: 'credit', currencyCode: 'YR', amount: 150, accountCode: '112101001', analyticalAccountCode: '20031', analyticalType: 3 },
    ],
  });
  assert.equal(value.lines[0].analyticalAccountCode, null);
  assert.equal(value.lines[0].analyticalType, 0);
});

test('validates a multi-line IAS20191 inventory-count draft', () => {
  const result = validateInventoryCountPayload({
    externalReference: 'inventory-count:web:test', inventoryType: 1,
    warehouseCode: '1',
    description: 'جرد من المنصة',
    lines: [
      { itemCode: '00101-01-01', unitCode: 'حبة', countedQuantity: 0 },
      { itemCode: '00103-01-09', unitCode: 'حبة', countedQuantity: 2, batchNo: 'B1' },
    ],
  });
  assert.equal(result.warehouseCode, 1);
  assert.equal(result.lines.length, 2);
  assert.deepEqual(result.lines.map((line) => line.warehouseCode), [1, 1]);
  assert.equal(result.lines[0].expireDate, '1900-01-01');
  assert.equal(result.lines[0].batchNo, '0');
  assert.equal(result.lines[0].countedQuantity, 0);
  assert.throws(() => validateInventoryCountPayload({ ...result, inventoryType: 3 }), /inventoryType/);
});
