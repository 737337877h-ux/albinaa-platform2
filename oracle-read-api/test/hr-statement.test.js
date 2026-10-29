const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hrStatementQuery } = require('../src/hr-statement');
test('HR bounds and accounts are fixed, identifiers are bound', () => {
  const q = hrStatementQuery('IAS20261', {month:'2026-10',kind:'salary',code:'10001'});
  assert.equal(q.binds.account,'116101001'); assert.equal(q.binds.analyticalType,7);
  assert.ok(q.sql.includes("P.DOC_TYPE<>0")); assert.ok(q.sql.includes("DATE '2026-10-01'"));
  assert.ok(q.sql.includes('P.DR_AMT_F')); assert.ok(!q.sql.includes('DOC_POST=1'));
  assert.equal(hrStatementQuery('IAS20261',{month:'2026-12',kind:'custody',code:'40005'}).binds.analyticalType,5);
});
test('HR rejects earlier months, future schemas and injection', () => {
  for(const p of [{month:'2026-09',code:'10001',kind:'salary'},{month:'2027-01',code:'10001',kind:'salary'},{month:'2026-10',code:"1 OR 1=1",kind:'salary'}]) assert.throws(()=>hrStatementQuery('IAS20261',p));
  assert.throws(()=>hrStatementQuery('IAS20191',{month:'2026-10',code:'10001',kind:'salary'}));
});
