const test = require('node:test');
const assert = require('node:assert/strict');
const { accountStatementQuery } = require('../src/account-statement');
const input = { kind: 'customer', code: '30876', currency: 'YER', fromDate: '2025-01-01', toDate: '2026-09-06' };
test('statement reads annual deduplicated view with bound account and dates', () => {
  const q = accountStatementQuery('IAS20261', input);
  assert.match(q.sql, /IAS_V_POST_DTL_YR/);
  assert.match(q.sql, /AC_DTL_TYP=3 AND C_CODE=:code/);
  assert.match(q.sql, /DR_AMT_F/);
  assert.doesNotMatch(q.sql, /30876|UNION|NEXTVAL|INSERT|DELETE|UPDATE/);
  assert.deepEqual(q.binds, { code: input.code, fromDate: input.fromDate, toDate: input.toDate });
});
test('advance numbering cannot collide with a customer, SAR uses local value', () => {
  const q = accountStatementQuery('IAS20261', { ...input, kind: 'advance', currency: 'SAR', code: '20011' });
  assert.match(q.sql, /AC_DTL_TYP=5 AND AC_CODE_DTL=:code/);
  assert.match(q.sql, /113101001','113101002/);
  assert.doesNotMatch(q.sql, /DR_AMT_F/);
});
test('rejects unknown schema, injection, invalid and unavailable periods', () => {
  assert.throws(() => accountStatementQuery('IAS20251', input));
  for (const p of [{ code: "1' OR 1=1" }, { currency: 'XXX' }, { fromDate: '2019-01-01' }, { fromDate: '2026-02-30' }, { toDate: '2024-01-01' }]) {
    assert.throws(() => accountStatementQuery('IAS20261', { ...input, ...p }));
  }
});
