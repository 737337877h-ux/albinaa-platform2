'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  candidateTableNames,
  categoryNames,
  columnsByNameQuery,
  compareSummaries,
  summarizeMetadata,
  tableColumnsQuery,
  tableNamesQuery,
} = require('../src/request-catalog-metadata');

test('builds small metadata-only SELECT statements with bound identifiers', () => {
  const queries = [
    { sql: tableNamesQuery() },
    columnsByNameQuery(),
    tableColumnsQuery(['CUSTOMER', 'BANKS']),
  ];
  for (const query of queries) {
    assert.match(query.sql, /^SELECT /);
    assert.match(query.sql, /ALL_TAB_COLUMNS/);
    assert.match(query.sql, /OWNER = :owner/);
    assert.doesNotMatch(query.sql, /INSERT|UPDATE|DELETE|MERGE|EXECUTE|NEXTVAL/i);
    assert.doesNotMatch(query.sql, /REGEXP_LIKE/);
  }
  assert.deepEqual(candidateTableNames([{ TABLE_NAME: 'CUSTOMER' }, { TABLE_NAME: 'ITEM_DETAILS' }]), ['CUSTOMER']);
});

test('classifies catalog candidates without assigning business mappings', () => {
  assert.deepEqual(categoryNames('CUSTOMER', ['C_CODE', 'C_A_NAME', 'COL_NO']), ['customers', 'collectorsAndCommission']);
  assert.deepEqual(categoryNames('BANKS', ['BANK_NO', 'A_CODE']), ['banks', 'accounts']);
});

test('summarizes and compares each schema independently', () => {
  const row = (table, position, name) => ({
    TABLE_NAME: table, COLUMN_ID: position, COLUMN_NAME: name, DATA_TYPE: 'VARCHAR2',
    DATA_LENGTH: 30, DATA_PRECISION: null, DATA_SCALE: null, NULLABLE: 'Y',
  });
  const left = summarizeMetadata('IAS20191', [row('CUSTOMER', 1, 'C_CODE'), row('CUSTOMER', 2, 'COL_NO')]);
  const right = summarizeMetadata('IAS20261', [row('CUSTOMER', 1, 'C_CODE'), row('CUSTOMER', 2, 'COMM_PER')]);
  const comparison = compareSummaries(left, right);
  assert.equal(left.schema, 'IAS20191');
  assert.equal(right.schema, 'IAS20261');
  assert.deepEqual(comparison.columnDifferences, [{ table: 'CUSTOMER', onlyInLeft: ['COL_NO'], onlyInRight: ['COMM_PER'] }]);
});
