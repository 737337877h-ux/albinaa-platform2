'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { quotationList, quotationLines } = require('../src/quotations');

test('quotation search and long cursor are bound without numeric rounding', () => {
  const serial = '20260000015241234567890';
  const query = quotationList({ search: "' OR 1=1 --", afterSerial: serial, limit: 25 });
  assert.equal(query.binds.afterSerial, serial);
  assert.equal(query.binds.fetchLimit, 26);
  assert.ok(!query.sql.includes("' OR 1=1 --"));
  assert.equal(quotationLines(serial).binds.serial, serial);
});

test('invalid cursors and page sizes fail before database access', () => {
  for (const limit of [0, 101, 1.5, NaN]) assert.throws(() => quotationList({ limit }));
  assert.throws(() => quotationList({ afterSerial: '1 OR 1=1' }));
  assert.throws(() => quotationLines('1;DELETE'));
});
