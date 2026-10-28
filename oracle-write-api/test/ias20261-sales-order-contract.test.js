'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertSalesOrderProfile, salesOrderSerial, salesOrderReservationSerial,
  NEXT_ORDER_NUMBER_SQL, NEXT_RESERVATION_NUMBER_SQL } = require('../src/ias20261-sales-order-contract');
const profile = { schema: 'IAS20261', year: 2026, branch: 1, serialType: 1 };

test('reproduces independently verified ARST003 order 2284 and reservation 1577', () => {
  assert.equal(salesOrderSerial(profile, '2284'), '2026000001532284');
  assert.equal(salesOrderReservationSerial(profile, '1577'), '202620000011577');
});

test('does not reuse the order number for the independent reservation sequence', () => {
  assert.notEqual(salesOrderReservationSerial(profile, '1577'), salesOrderReservationSerial(profile, '2284'));
  assert.match(NEXT_ORDER_NUMBER_SQL, /WHERE BRN_NO=1$/);
  assert.match(NEXT_RESERVATION_NUMBER_SQL, /WHERE DOC_TYPE_REF=53$/);
  assert.doesNotMatch(NEXT_RESERVATION_NUMBER_SQL, /BRN_NO/);
});

test('preserves serial digits above the JS safe integer boundary and within Oracle NUMBER precision', () => {
  assert.equal(salesOrderSerial(profile, '9007199254740993'), '2026000001539007199254740993');
  assert.equal(salesOrderSerial(profile, '9'.repeat(26)).length, 38);
  assert.equal(salesOrderReservationSerial(profile, '9'.repeat(26)).length, 37);
});

test('rejects zero, negative, decimal, padded, unsafe numeric and overlong document identities', () => {
  for (const value of [0, 2284, Number.MAX_SAFE_INTEGER + 1, '0', '-1', '01', '1.2', '1e3', ' 1', '9'.repeat(27), null]) {
    assert.throws(() => salesOrderSerial(profile, value), /Document number/);
    assert.throws(() => salesOrderReservationSerial(profile, value), /Document number/);
  }
});

test('fails closed for another year, branch, schema or serial mode', () => {
  for (const invalid of [undefined, {}, {...profile,schema:'IAS20191'}, {...profile,year:2025},
    {...profile,branch:2}, {...profile,serialType:2}]) {
    assert.throws(() => assertSalesOrderProfile(invalid), /Unsupported/);
    assert.throws(() => salesOrderSerial(invalid, '2284'), /Unsupported/);
    assert.throws(() => salesOrderReservationSerial(invalid, '1577'), /Unsupported/);
  }
});
