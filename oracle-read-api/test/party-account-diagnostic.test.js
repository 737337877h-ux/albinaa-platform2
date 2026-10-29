'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  analyticalRowsQuery,
  assertIdentifier,
  candidateColumnsQuery,
  candidateTables,
  conclusionGate,
  partyRowsQuery,
  voucherEvidenceQuery,
} = require('../src/party-account-diagnostic');

test('builds SELECT-only diagnostic queries with bounded target rows', () => {
  const metadata = candidateColumnsQuery();
  const party = partyRowsQuery('IAS20191', 'S_EMP', ['EMP_NO', 'AC_CODE', 'GRP_CODE'], 'EMP_NO');
  const analytical = analyticalRowsQuery('IAS20261');
  const evidence = voucherEvidenceQuery('IAS20261');
  for (const query of [metadata, party, analytical, evidence]) {
    assert.match(query.sql, /^SELECT /);
    assert.doesNotMatch(query.sql, /INSERT|UPDATE|DELETE|MERGE|EXECUTE|NEXTVAL/i);
    assert.doesNotMatch(query.sql, /;/);
  }
  assert.equal(party.binds.code0, '1');
  assert.equal(analytical.binds.vendorAccount2, '211102001');
  assert.match(evidence.sql, /IAS20261\.IAS_RQ_VCHR_DTL/);
  assert.match(evidence.sql, /ROWNUM <= 200/);
});

test('finds only tables that combine a party identifier and account metadata', () => {
  const rows = [
    { TABLE_NAME: 'S_EMP', COLUMN_NAME: 'EMP_NO' },
    { TABLE_NAME: 'S_EMP', COLUMN_NAME: 'AC_CODE' },
    { TABLE_NAME: 'V_DETAILS', COLUMN_NAME: 'V_CODE' },
    { TABLE_NAME: 'OTHER', COLUMN_NAME: 'AC_CODE_DTL' },
  ];
  assert.deepEqual(candidateTables(rows), [{ table: 'S_EMP', columns: ['EMP_NO', 'AC_CODE'] }]);
});

test('rejects dynamic Oracle identifiers outside dictionary-safe syntax', () => {
  assert.equal(assertIdentifier('IAS20191'), 'IAS20191');
  assert.throws(() => assertIdentifier('IAS20191.S_EMP'), /Invalid Oracle identifier/);
  assert.throws(() => assertIdentifier('S_EMP WHERE 1=1'), /Invalid Oracle identifier/);
});

test('treats matching historical voucher rows as confirmed evidence', () => {
  assert.equal(conclusionGate({
    analyticalError: null,
    analyticalRows: [],
    voucherEvidence: [{ A_CODE: '116101001', AC_CODE_DTL: '1', AC_DTL_TYP: 7 }],
  }), 'HISTORICAL_VOUCHER_EVIDENCE_FOUND');
});
