'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { transferEvidence } = require('../src/queries');

test('uses DOC_SER for movements and requires a distinct linked destination', () => {
  const sql = transferEvidence('IAS20261', ['295602501014']);
  assert.match(sql.source, /TR_SER = :sourceTransferSerial/);
  assert.match(sql.destinations, /F_TR_SER = :sourceTransferSerial/);
  assert.match(sql.destinations, /TR_SER <> :sourceTransferSerial/);
  assert.match(sql.movements, /DOC_SER = :sourceTransferSerial/);
  assert.match(sql.movements, /DOC_TYPE IN \(7, 8\)/);
  assert.doesNotMatch(sql.movements, /TR_POST|STK_PROCESSED|POST_DATE/);
});

test('binds item codes instead of interpolating request values', () => {
  const sql = transferEvidence('IAS20261', ["A' OR 1=1 --"]);
  assert.doesNotMatch(sql.movements, /OR 1=1/);
  assert.equal(sql.itemBinds.item0, "A' OR 1=1 --");
});
