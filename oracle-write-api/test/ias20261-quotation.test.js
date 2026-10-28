'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Ias20261QuotationWriter, normalize, serialFor } = require('../src/ias20261-quotation-writer');
const input = { externalReference: 'test-1', customerCode: '10001', currencyCode: 'SR', warehouseCode: '104',
  lines: [{ itemCode: 'a', unitCode: 'unit', quantity: '2', price: '5000', discount: '10' },
    { itemCode: 'b', unitCode: 'unit', quantity: '5', price: '6000', discount: '20' }] };
const config = { schema: 'IAS20261', branchYear: 2026, oracleUserId: 1, oracle: { user: 'ALBINAA20261WRITER', callTimeout: 1000 } };
function fixture(failLine = false, failApproval = false) {
  const calls = [];
  const connection = { execute: async (sql, binds) => {
    calls.push({ sql, binds });
    if (sql.includes('DOC_SER_EXTRNL LIKE')) return { rows: [] };
    if (sql.includes('MAX(QUOT_NO)')) return { rows: [{ NUMBER_VALUE: '6' }] };
    if (sql.includes('SUM(Q*P)')) return { rows: [{ GROSS: '40000', DISCOUNT: '120', NET: '39880' }] };
    if (failApproval && sql.includes('INSERT INTO IAS20261.S_APPRVD_MOV')) throw new Error('approval failed');
    if (failLine && sql.includes('INSERT INTO IAS20261.QUOTATION_DETAIL')) throw new Error('detail failed');
    return { rows: [] };
  }, commit: async () => calls.push({ sql: 'COMMIT' }), rollback: async () => calls.push({ sql: 'ROLLBACK' }), close: async () => calls.push({ sql: 'CLOSE' }) };
  const writer = new Ias20261QuotationWriter({ getConnection: async () => connection }, config);
  writer.prepare = async () => ({ lines: normalize(input).lines.map(l => ({ ...l, packageSize: '1' })), precision: 2, customerName: 'test', rate: '1', approvalLevels: [{ level: '1', name: 'عام', order: '1', status: 'unapproved' }, { level: '2', name: 'مراجعة', order: '2', status: 'unapproved' }] });
  return { writer, calls };
}
test('serial calculation preserves long numbers and rejects unsupported payload fields', () => {
  assert.equal(serialFor('4'), '2026000001524');
  assert.equal(serialFor('9007199254740993'), '2026000001529007199254740993');
  assert.throws(() => normalize({ ...input, tax: 10 }));
  assert.throws(() => normalize({ ...input, lines: [{ ...input.lines[0], quantity: '-1' }] }));
  assert.throws(() => normalize({ ...input, lines: [{ ...input.lines[0], price: '0.000001', discount: '0.000002' }] }));
});
test('save locks before allocation, uses a sequence for each line and aggregates all discounts', async () => {
  const { writer, calls } = fixture(); await writer.createDraft(input);
  assert.ok(calls.findIndex(c => c.sql.includes('ALBINAA_QUOTATION_LOCK')) < calls.findIndex(c => c.sql.includes('MAX(QUOT_NO)')));
  assert.equal(calls.filter(c => c.sql.includes('IAS_DOC_SEQ_OTHR.NEXTVAL')).length, 2);
  assert.ok(calls.some(c => c.sql.includes('SUM(I_QTY*NVL(DIS_AMT_DTL,0))')));
  assert.equal(calls.filter(c => c.sql === 'COMMIT').length, 1);
});
test('partial failure rolls back instead of committing a header without details', async () => {
  const { writer, calls } = fixture(true); await assert.rejects(writer.createDraft(input), /detail failed/);
  assert.ok(calls.some(c => c.sql === 'ROLLBACK'));
  assert.ok(!calls.some(c => c.sql === 'COMMIT'));
});
test('dry run neither locks nor consumes a sequence', async () => {
  const { writer, calls } = fixture(); await writer.dryRun(input);
  assert.ok(!calls.some(c => /NEXTVAL|INSERT|UPDATE|ALBINAA_QUOTATION_LOCK/.test(c.sql)));
});
test('replaying a saved reference performs no insert or sequence operation', async () => {
  const { createHash } = require('node:crypto');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const normalized = normalize(input);
  const marker = `ALBQ:${hash(normalized.externalReference)}:${hash(JSON.stringify(normalized))}`;
  let inserts = 0, prepared = false;
  const connection = { execute: async sql => {
    if (/INSERT|NEXTVAL/.test(sql)) inserts++;
    return { rows: sql.includes('DOC_SER_EXTRNL LIKE') ? [{ DOCUMENT_NO: '6', SERIAL: '2026000001526', MARKER: marker }] : [] };
  }, rollback: async () => {}, close: async () => {} };
  const writer = new Ias20261QuotationWriter({ getConnection: async () => connection }, config);
  writer.prepare = async () => { prepared = true; };
  const result = await writer.createDraft(input);
  assert.equal(result.created, false); assert.equal(inserts, 0); assert.equal(prepared, false);
  await assert.rejects(writer.createDraft({ ...input, notes: 'changed' }), /reference conflict/);
});
test('prepare reads tax from general settings and rejects active, missing or ambiguous tax settings', async () => {
  for (const rows of [[{ USE_VAT: '1' }], [], [{ USE_VAT: null }], [{ USE_VAT: '0' }, { USE_VAT: '0' }]]) {
    const seen = [];
    const connection = { execute: async sql => {
      seen.push(sql);
      if (sql.includes('IAS_PARA_AR')) return { rows: [{ AR_QUOT_SERIAL: '1', NO_OF_DECIMAL_AR: '3' }] };
      if (sql.includes('IAS_PARA_GEN')) return { rows };
      throw new Error('Unexpected query');
    } };
    const writer = new Ias20261QuotationWriter({}, config);
    await assert.rejects(writer.prepare(connection, normalize(input)), /Tax settings/);
    assert.equal(seen.length, 2);
    assert.ok(!seen[0].includes('USE_VAT'));
  }
});


test('configured approval levels are inserted in the document transaction without approval', async () => {
  const { writer, calls } = fixture();
  const result = await writer.createDraft(input);
  const rows = calls.filter(c => c.sql.includes('INSERT INTO IAS20261.S_APPRVD_MOV'));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(c => c.binds.approvalLevel), ['1', '2']);
  assert.ok(rows.every(c => c.binds.serial === result.serial && c.sql.includes('0,0,:approvalOrder')));
  assert.ok(calls.indexOf(rows[1]) < calls.findIndex(c => c.sql === 'COMMIT'));
  assert.equal(result.approvalLevels[0].status, 'unapproved');
});
test('approval insert failure rolls back the entire quotation', async () => {
  const { writer, calls } = fixture(false, true);
  await assert.rejects(writer.createDraft(input), /approval failed/);
  assert.ok(calls.some(c => c.sql === 'ROLLBACK'));
  assert.ok(!calls.some(c => c.sql === 'COMMIT'));
});
