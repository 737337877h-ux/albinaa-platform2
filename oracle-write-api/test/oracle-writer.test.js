'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OracleConflictError, OracleOutRequestWriter, buildInventoryReference, buildInventorySerial,
} = require('../src/oracle-writer');

function startupDriver(privileges) {
  const connection = {
    async execute(sql) {
      if (/SESSION_USER/.test(sql)) return { rows: [{ SESSION_USER: 'ALBINAAWRITER' }] };
      return { rows: privileges };
    },
    async rollback() {},
    async close() {},
  };
  const pool = { async getConnection() { return connection; }, async close() {} };
  return {
    OUT_FORMAT_OBJECT: 1,
    initOracleClient() {},
    async createPool() { return pool; },
  };
}

const startupConfig = {
  schema: 'IAS20191',
  oracle: {
    clientLibDir: 'C:/oracle', user: 'ALBINAAWRITER', password: 'hidden', connectString: 'test',
    poolMin: 1, poolMax: 1, poolIncrement: 1, queueTimeout: 1000,
  },
};

const requiredPrivileges = [
  { TABLE_NAME: 'S_APPRVD_MOV', PRIVILEGE: 'INSERT' },
  { TABLE_NAME: 'P_REQUEST', PRIVILEGE: 'SELECT' },
  { TABLE_NAME: 'P_REQUEST', PRIVILEGE: 'INSERT' },
  { TABLE_NAME: 'P_REQUEST_DETAIL', PRIVILEGE: 'SELECT' },
  { TABLE_NAME: 'P_REQUEST_DETAIL', PRIVILEGE: 'INSERT' },
  { TABLE_NAME: 'IAS_DOC_SEQ_OTHR', PRIVILEGE: 'SELECT' },
  { TABLE_NAME: 'EX_RATE', PRIVILEGE: 'SELECT' },
  { TABLE_NAME: 'IAS_PERIOD_EX_RATE_DAY', PRIVILEGE: 'SELECT' },
  { TABLE_NAME: 'IAS_RQ_VCHR_MST', PRIVILEGE: 'SELECT' },
  { TABLE_NAME: 'IAS_RQ_VCHR_MST', PRIVILEGE: 'INSERT' },
  { TABLE_NAME: 'IAS_RQ_VCHR_DTL', PRIVILEGE: 'SELECT' },
  { TABLE_NAME: 'IAS_RQ_VCHR_DTL', PRIVILEGE: 'INSERT' },
  { TABLE_NAME: 'IAS_RQ_JRNL_MST', PRIVILEGE: 'SELECT' },
  { TABLE_NAME: 'IAS_RQ_JRNL_MST', PRIVILEGE: 'INSERT' },
  { TABLE_NAME: 'IAS_RQ_JRNL_DTL', PRIVILEGE: 'SELECT' },
  { TABLE_NAME: 'IAS_RQ_JRNL_DTL', PRIVILEGE: 'INSERT' },
  { TABLE_NAME: 'WAREHOUSE_DETAILS', PRIVILEGE: 'SELECT' },
  { TABLE_NAME: 'ITEM_DETAILS', PRIVILEGE: 'SELECT' },
  { TABLE_NAME: 'IAS_V_ITM_AVLQTY', PRIVILEGE: 'SELECT' },
  { TABLE_NAME: 'IAS_INV_TYPES', PRIVILEGE: 'SELECT' },
  { TABLE_NAME: 'IAS_PRIV_INV_TYPE', PRIVILEGE: 'SELECT' },
  { TABLE_NAME: 'MASTER_INV', PRIVILEGE: 'SELECT' },
  { TABLE_NAME: 'MASTER_INV', PRIVILEGE: 'INSERT' },
  { TABLE_NAME: 'DETAIL_INV', PRIVILEGE: 'SELECT' },
  { TABLE_NAME: 'DETAIL_INV', PRIVILEGE: 'INSERT' },
];

test('starts only when the isolated writer has the purchase-request grants', async () => {
  const writer = new OracleOutRequestWriter(startupDriver(requiredPrivileges), startupConfig);
  await writer.start();
  await writer.close();
});

test('rejects startup when the approval-row INSERT grant is missing', async () => {
  const writer = new OracleOutRequestWriter(startupDriver(requiredPrivileges.slice(1)), startupConfig);
  await assert.rejects(writer.start(), /S_APPRVD_MOV:INSERT/);
});

test('builds the verified INVT008.230 serial and stable reference', () => {
  assert.equal(buildInventorySerial(2019, 1, 3), '2019000001333');
  assert.equal(buildInventorySerial(2019, 2, 7), '2019000002337');
  assert.equal(buildInventoryReference('inventory-count:web:one').length, 15);
  assert.equal(buildInventoryReference('inventory-count:web:one'), buildInventoryReference('inventory-count:web:one'));
});

function inventoryInput() {
  return {
    externalReference: 'inventory-count:web:test-3', inventoryType: 1,
    warehouseCode: 1,
    description: 'جرد متعدد الأصناف من المنصة',
    lines: [
      { itemCode: '00101-01-01', unitCode: 'حبة', countedQuantity: 1, batchNo: '0', expireDate: '1900-01-01' },
      { itemCode: '00103-01-09', unitCode: 'حبة', countedQuantity: 2, batchNo: '0', expireDate: '1900-01-01' },
    ],
  };
}

function inventoryConnection(calls, existing = null) {
  return {
    callTimeout: 0,
    async execute(sql, binds) {
      calls.push({ sql, binds });
      if (/FROM IAS20191\.MASTER_INV\s+WHERE INV_TYPE=:inventoryType AND REF_NO/.test(sql)) {
        return { rows: existing ? [existing] : [] };
      }
      if (/IAS_INV_TYPES/.test(sql)) return { rows: [{ INV_TYPE: 1, INV_NAME: 'جرد يدوي', ADD_ALLOWED: 1 }] };
      if (/WAREHOUSE_DETAILS/.test(sql)) return { rows: [{ W_CODE: binds.warehouseCode }] };
      if (/ITEM_DETAILS/.test(sql)) return { rows: [{ I_NAME: `صنف ${binds.itemCode}`, I_E_NAME: null, P_SIZE: 1 }] };
      if (/IAS_V_ITM_AVLQTY/.test(sql)) return { rows: [{ AVAILABLE_QUANTITY: 0 }] };
      if (/NEXT_DOCUMENT_NO/.test(sql)) return { rows: [{ NEXT_DOCUMENT_NO: 4 }] };
      return { rows: [] };
    },
    async commit() {}, async rollback() {}, async close() {},
  };
}

test('inventory Dry Run validates multiple lines without lock or write', async () => {
  const calls = [];
  const writer = new OracleOutRequestWriter({}, { schema: 'IAS20191', oracle: { callTimeout: 5000 } });
  writer.pool = { async getConnection() { return inventoryConnection(calls); } };
  const result = await writer.dryRunInventoryCount(inventoryInput());
  assert.equal(result.valid, true);
  assert.equal(result.oracleWrite, 'NONE');
  assert.equal(result.warehouseCode, '1');
  assert.equal(result.lines.length, 2);
  assert.deepEqual(result.lines.map((line) => line.warehouseCode), ['1', '1']);
  assert.equal(result.lines[1].itemNameAr, 'صنف 00103-01-09');
  assert.equal(calls.some((call) => /LOCK TABLE|INSERT INTO/.test(call.sql)), false);
});

test('creates an unprocessed multi-line IAS20191 inventory draft atomically', async () => {
  const calls = [];
  let commits = 0;
  const connection = inventoryConnection(calls);
  connection.commit = async () => { commits += 1; };
  const writer = new OracleOutRequestWriter({}, {
    schema: 'IAS20191', branchYear: 2019, requestDate: '2020-12-31', oracle: { callTimeout: 5000 },
  });
  writer.pool = { async getConnection() { return connection; } };
  const result = await writer.createInventoryCountDraft(inventoryInput());
  assert.deepEqual(result, {
    created: true, documentNo: '4', documentSerial: '2019000001334', inventoryType: '1',
    lineCount: 2, oracleWrite: 'INSERT_ONLY', processed: false, externalPost: false,
  });
  assert.equal(commits, 1);
  const master = calls.find((call) => /INSERT INTO IAS20191\.MASTER_INV/.test(call.sql));
  const details = calls.filter((call) => /INSERT INTO IAS20191\.DETAIL_INV/.test(call.sql));
  assert.ok(master);
  assert.equal(details.length, 2);
  assert.match(master.sql, /EXTERNAL_POST,PROCESSED/);
  assert.match(master.sql, /:documentSerial,\s*NULL,SYS_CONTEXT\('USERENV','HOST'\)/);
  assert.match(details[0].sql, /PROCESSED_ADJ,EXTERNAL_POST/);
});

test('writes a YemenSoft level-one approval row with each new IAS20191 draft', async () => {
  const statements = [];
  const calls = [];
  const connection = {
    callTimeout: 0,
    async execute(sql, binds) {
      statements.push(sql);
      calls.push({ sql, binds });
      if (/DOC_SER_EXTRNL =/.test(sql)) return { rows: [] };
      if (/FROM IAS20191\.WAREHOUSE_DETAILS/.test(sql)) return { rows: [{ W_CODE: 1 }, { W_CODE: 2 }] };
      if (/NEXT_REQUEST_NO/.test(sql)) return { rows: [{ NEXT_REQUEST_NO: 5 }] };
      if (/SELECT P_SIZE/.test(sql)) return { rows: [{ P_SIZE: 1 }] };
      if (/SOURCE_QTY/.test(sql)) return { rows: [{ SOURCE_QTY: 0, DESTINATION_QTY: 0 }] };
      if (/IAS_DOC_SEQ_OTHR\.NEXTVAL/.test(sql)) return { rows: [{ DOC_SEQUENCE: 10 }] };
      return { rows: [] };
    },
    async commit() {},
    async rollback() {},
    async close() {},
  };
  const writer = new OracleOutRequestWriter({}, {
    schema: 'IAS20191',
    branchYear: 2019,
    requestDate: '2020-12-31',
    oracle: { callTimeout: 5000 },
  });
  writer.pool = { async getConnection() { return connection; } };

  const result = await writer.createDraft({
    externalReference: 'test-null-flags',
    sourceWarehouseCode: '2',
    destinationWarehouseCode: '1',
    requestSide: 'AlBinaa test',
    notes: 'Test draft',
    lines: [{ itemCode: '00103-01-04', unitCode: 'حبة', quantity: 1 }],
  });

  assert.deepEqual(result, { created: true, requestNo: '5', requestSerial: '20190000015' });
  const masterInsert = statements.find((sql) => /INSERT INTO IAS20191\.IAS_OUT_REQUEST_MST/.test(sql));
  const detailInsert = statements.find((sql) => /INSERT INTO IAS20191\.IAS_OUT_REQUEST_DTL/.test(sql));
  const approvalInsert = statements.find((sql) => /INSERT INTO IAS20191\.S_APPRVD_MOV/.test(sql));
  assert.match(masterInsert, /AD_TRMNL_NM,\s*USE_REQ_MORE_ONCE/);
  assert.match(masterInsert, /SYS_CONTEXT\('USERENV','HOST'\),\s*NULL\s*\)/);
  assert.match(detailInsert, /BRN_USR,RESERVED/);
  assert.match(detailInsert, /:branchYear,1,NULL\s*\)/);
  assert.match(approvalInsert, /LVL_NO,DOC_TYP,DOC_SER,DOC_NO,DOC_JV_TYP,DOC_DATE,DOC_AMT/);
  assert.match(approvalInsert, /:approvalLevel,:approvalDocumentType,:requestSerial,:requestNo,0/);
  assert.deepEqual(calls.find((call) => call.sql === approvalInsert).binds, {
    approvalLevel: 1,
    approvalDocumentType: 31,
    requestSerial: '20190000015',
    requestNo: 5,
    requestDate: '2020-12-31',
    branchYear: 2019,
  });

  const approvalCallIndex = statements.indexOf(approvalInsert);
  const commitWasLast = statements.length - 1 === approvalCallIndex;
  assert.equal(commitWasLast, true);
});

function purchaseInput() {
  return {
    externalReference: 'purchase-request:test-2',
    warehouseCode: 1,
    hierarchyNo: 1,
    requiredDate: '2020-12-31',
    requestSide: 'منصة البناء الراقي',
    notes: 'طلب شراء تجريبي',
    lines: [{ itemCode: '00103-01-07', unitCode: 'حبة', quantity: 20 }],
  };
}

test('purchase Dry Run validates Oracle data without a lock, sequence, or insert', async () => {
  const statements = [];
  const connection = {
    callTimeout: 0,
    async execute(sql) {
      statements.push(sql);
      if (/WAREHOUSE_DETAILS/.test(sql)) return { rows: [{ W_CODE: 1 }] };
      if (/ITEM_DETAILS/.test(sql)) return { rows: [{ P_SIZE: 2 }] };
      return { rows: [] };
    },
    async rollback() {},
    async close() {},
  };
  const writer = new OracleOutRequestWriter({}, { schema: 'IAS20191', oracle: { callTimeout: 5000 } });
  writer.pool = { async getConnection() { return connection; } };

  const result = await writer.dryRunPurchaseRequest(purchaseInput());

  assert.equal(result.valid, true);
  assert.equal(result.oracleWrite, 'NONE');
  assert.equal(result.lines[0].packageQuantity, 40);
  assert.equal(statements.some((sql) => /INSERT|LOCK TABLE|NEXTVAL/.test(sql)), false);
});

test('creates an idempotent purchase draft and YemenSoft DOC_TYP 40 approval row in one transaction', async () => {
  const calls = [];
  let commits = 0;
  const connection = {
    callTimeout: 0,
    async execute(sql, binds) {
      calls.push({ sql, binds });
      if (/WHERE PR_TYPE=:requestType AND REF_NO=/.test(sql)) return { rows: [] };
      if (/WAREHOUSE_DETAILS/.test(sql)) return { rows: [{ W_CODE: 1 }] };
      if (/ITEM_DETAILS/.test(sql)) return { rows: [{ P_SIZE: 1 }] };
      if (/NEXT_REQUEST_NO/.test(sql)) return { rows: [{ NEXT_REQUEST_NO: 2 }] };
      if (/NEXTVAL/.test(sql)) return { rows: [{ DOC_SEQUENCE: 12 }] };
      return { rows: [] };
    },
    async commit() { commits += 1; },
    async rollback() {},
    async close() {},
  };
  const writer = new OracleOutRequestWriter({}, {
    schema: 'IAS20191', branchYear: 2019, requestDate: '2020-12-31', oracle: { callTimeout: 5000 },
  });
  writer.pool = { async getConnection() { return connection; } };

  const result = await writer.createPurchaseRequestDraft(purchaseInput());

  assert.deepEqual(result, { created: true, requestNo: '2', requestSerial: '20190000012' });
  assert.equal(commits, 1);
  assert.ok(calls.find((call) => /INSERT INTO IAS20191\.P_REQUEST \(/.test(call.sql)));
  assert.ok(calls.find((call) => /INSERT INTO IAS20191\.P_REQUEST_DETAIL/.test(call.sql)));
  const approval = calls.find((call) => /INSERT INTO IAS20191\.S_APPRVD_MOV/.test(call.sql));
  assert.equal(approval.binds.approvalDocumentType, 40);
  assert.equal(approval.binds.approvalLevel, 1);
  assert.equal(approval.binds.requestSerial, '20190000012');
});

test('purchase create returns the existing request for an idempotent retry', async () => {
  let commits = 0;
  const connection = {
    callTimeout: 0,
    async execute(sql) {
      if (/WHERE PR_TYPE=:requestType AND REF_NO=/.test(sql)) return { rows: [{ PR_NO: 2, PR_SER: 20190000012 }] };
      return { rows: [] };
    },
    async commit() { commits += 1; },
    async rollback() {},
    async close() {},
  };
  const writer = new OracleOutRequestWriter({}, { schema: 'IAS20191', oracle: { callTimeout: 5000 } });
  writer.pool = { async getConnection() { return connection; } };

  const result = await writer.createPurchaseRequestDraft(purchaseInput());

  assert.deepEqual(result, { created: false, requestNo: '2', requestSerial: '20190000012' });
  assert.equal(commits, 0);
});

test('creates a mixed-currency bank receipt request and approval row atomically', async () => {
  const calls = [];
  let sequence = 48;
  let commits = 0;
  const connection = {
    callTimeout: 0,
    async execute(sql, binds) {
      calls.push({ sql, binds });
      if (/WHERE FIELD10=/.test(sql)) return { rows: [] };
      if (/FROM IAS20191\.EX_RATE WHERE CUR_CODE/.test(sql)) {
        if (binds.currencyCode === 'YER') return { rows: [{ CUR_CODE: 'YER', CUR_NAME: 'ريال يمني', CUR_RATE: 0.0064, L_F: 2, MIN_CUR_RATE: null, MAX_CUR_RATE: 0.0066, CUR_FRC_NO: 2 }] };
        return { rows: [{ CUR_CODE: 'R s', CUR_NAME: 'ريال سعودي', CUR_RATE: 1, L_F: 1, MIN_CUR_RATE: null, MAX_CUR_RATE: null, CUR_FRC_NO: 2 }] };
      }
      if (/IAS_PERIOD_EX_RATE_DAY/.test(sql)) return { rows: [] };
      if (/NEXT_REQUEST_NO/.test(sql)) return { rows: [{ NEXT_REQUEST_NO: 2 }] };
      if (/NEXTVAL/.test(sql)) return { rows: [{ DOC_SEQUENCE: ++sequence }] };
      return { rows: [] };
    },
    async commit() { commits += 1; }, async rollback() {}, async close() {},
  };
  const writer = new OracleOutRequestWriter({}, { schema: 'IAS20191', branchYear: 2019, requestDate: '2020-12-31', oracle: { callTimeout: 5000 } });
  writer.pool = { async getConnection() { return connection; } };
  const result = await writer.createVoucherRequestDraft({
    kind: 'receipt', paymentMethod: 'bank_transfer', externalReference: 'receipt:test-2',
    currencyCode: 'YER', amount: 9375, cashOrBankNo: 1, description: 'حوالة',
    lines: [
      { currencyCode: 'R s', amount: 40, accountCode: '112101001', analyticalAccountCode: '20027', analyticalType: 3, description: 'الأول' },
      { currencyCode: 'R s', amount: 20, accountCode: '112101001', analyticalAccountCode: '20031', analyticalType: 3, description: 'الثاني' },
    ],
    referenceNo: '1212', noticeNo: '1343', collectorNo: 1, commissionPercent: 3, recipientName: null,
  });
  assert.deepEqual(result, { created: true, requestNo: '2', requestSerial: '201900000100092200000000021' });
  assert.equal(commits, 1);
  const master = calls.find((call) => /INSERT INTO IAS20191\.IAS_RQ_VCHR_MST/.test(call.sql));
  const details = calls.filter((call) => /INSERT INTO IAS20191\.IAS_RQ_VCHR_DTL/.test(call.sql));
  const approval = calls.find((call) => /INSERT INTO IAS20191\.S_APPRVD_MOV/.test(call.sql));
  assert.equal(master.binds.localAmount, 60);
  assert.equal(master.binds.foreignAmount, 9375);
  assert.equal(master.binds.transfer, 1);
  assert.deepEqual(details.map((call) => call.binds.currencyCode), ['R s', 'R s']);
  assert.deepEqual(details.map((call) => call.binds.signedLocal), [-40, -20]);
  assert.deepEqual(details.map((call) => call.binds.signedForeign), [null, null]);
  assert.deepEqual(details.map((call) => call.binds.noticeNo), ['1343', null]);
  assert.equal(approval.binds.documentType, 92);
});

test('voucher Dry Run rejects duplicate reference and notice numbers without writing', async () => {
  const statements = [];
  const connection = {
    callTimeout: 0,
    async execute(sql) {
      statements.push(sql);
      if (/IAS_RQ_VCHR_MST[\s\S]*TRIM\(REF_NO\)/.test(sql)) return { rows: [{ VOUCHER_NO: 2 }] };
      if (/IAS_RQ_VCHR_DTL[\s\S]*TRIM\(NOTE_NO\)/.test(sql)) return { rows: [{ VOUCHER_NO: 2 }] };
      if (/FROM IAS20191\.EX_RATE WHERE CUR_CODE/.test(sql)) return { rows: [{ CUR_CODE: 'YER', CUR_NAME: 'ريال يمني', CUR_RATE: 0.0064, L_F: 2, MIN_CUR_RATE: null, MAX_CUR_RATE: 0.0066, CUR_FRC_NO: 2 }] };
      if (/IAS_PERIOD_EX_RATE_DAY/.test(sql)) return { rows: [] };
      if (/WHERE L_F=1/.test(sql)) return { rows: [{ CUR_CODE: 'R s', CUR_NAME: 'ريال سعودي', CUR_RATE: 1 }] };
      return { rows: [] };
    },
    async rollback() {}, async close() {},
  };
  const writer = new OracleOutRequestWriter({}, { schema: 'IAS20191', requestDate: '2020-12-31', oracle: { callTimeout: 5000 } });
  writer.pool = { async getConnection() { return connection; } };
  const result = await writer.dryRunVoucherRequest({
    kind: 'payment', paymentMethod: 'bank_transfer', currencyCode: 'YER', amount: 10000,
    referenceNo: '10001231556', noticeNo: '1343',
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.issues.map((issue) => issue.code), ['DUPLICATE_REFERENCE_NO', 'DUPLICATE_NOTICE_NO']);
  assert.equal(statements.some((sql) => /INSERT|LOCK TABLE|NEXTVAL/.test(sql)), false);
});

test('voucher Dry Run balances independent master and detail currencies in local currency', async () => {
  const statements = [];
  const connection = {
    callTimeout: 0,
    async execute(sql, binds) {
      statements.push(sql);
      if (/IAS_RQ_VCHR_(?:MST|DTL)/.test(sql) && /TRIM\(/.test(sql)) return { rows: [] };
      if (/FROM IAS20191\.EX_RATE WHERE CUR_CODE/.test(sql)) {
        if (binds.currencyCode === 'YER') return { rows: [{ CUR_CODE: 'YER', CUR_NAME: 'ريال يمني', CUR_RATE: 0.0064, L_F: 2, MIN_CUR_RATE: null, MAX_CUR_RATE: 0.0066, CUR_FRC_NO: 2 }] };
        return { rows: [{ CUR_CODE: 'R s', CUR_NAME: 'ريال سعودي', CUR_RATE: 1, L_F: 1, MIN_CUR_RATE: null, MAX_CUR_RATE: null, CUR_FRC_NO: 2 }] };
      }
      if (/IAS_PERIOD_EX_RATE_DAY/.test(sql)) return { rows: [] };
      if (/WHERE L_F=1/.test(sql)) return { rows: [{ CUR_CODE: 'R s', CUR_NAME: 'ريال سعودي', CUR_RATE: 1 }] };
      return { rows: [] };
    },
    async rollback() {}, async close() {},
  };
  const writer = new OracleOutRequestWriter({}, { schema: 'IAS20191', requestDate: '2020-12-31', oracle: { callTimeout: 5000 } });
  writer.pool = { async getConnection() { return connection; } };
  const balanced = await writer.dryRunVoucherRequest({
    kind: 'receipt', paymentMethod: 'cash', currencyCode: 'YER', amount: 9375,
    lines: [{ currencyCode: 'R s', amount: 60 }],
  });
  assert.equal(balanced.valid, true);
  assert.equal(balanced.localAmount, 60);
  assert.equal(balanced.counterpartyLocalAmount, 60);
  assert.equal(balanced.localBalance, 0);
  assert.equal(balanced.lines[0].currencyCode, 'R s');

  const inversePayment = await writer.dryRunVoucherRequest({
    kind: 'payment', paymentMethod: 'cash', currencyCode: 'R s', amount: 60,
    lines: [{ currencyCode: 'YER', amount: 9375 }],
  });
  assert.equal(inversePayment.valid, true);
  assert.equal(inversePayment.localAmount, 60);
  assert.equal(inversePayment.counterpartyLocalAmount, 60);
  assert.equal(inversePayment.localBalance, 0);
  assert.equal(inversePayment.documentCurrency, 'R s');
  assert.equal(inversePayment.lines[0].currencyCode, 'YER');
  assert.equal(inversePayment.lines[0].amount, 9375);
  assert.equal(inversePayment.lines[0].AC_AMT, 60);
  assert.equal(inversePayment.lines[0].AC_AMTF, 9375);

  const unbalanced = await writer.dryRunVoucherRequest({
    kind: 'receipt', paymentMethod: 'cash', currencyCode: 'YER', amount: 9375,
    lines: [{ currencyCode: 'R s', amount: 59 }],
  });
  assert.equal(unbalanced.valid, false);
  assert.equal(unbalanced.localBalance, 1);
  assert.equal(unbalanced.issues.at(-1).code, 'UNBALANCED_LOCAL_AMOUNT');
  assert.equal(statements.some((sql) => /INSERT|LOCK TABLE|NEXTVAL/.test(sql)), false);
});

test('voucher create rechecks uniqueness under table locks and rolls back a duplicate', async () => {
  const statements = [];
  let rollbacks = 0;
  const connection = {
    callTimeout: 0,
    async execute(sql) {
      statements.push(sql);
      if (/WHERE FIELD10=/.test(sql)) return { rows: [] };
      if (/IAS_RQ_VCHR_MST[\s\S]*TRIM\(REF_NO\)/.test(sql)) return { rows: [{ VOUCHER_NO: 2 }] };
      return { rows: [] };
    },
    async commit() { throw new Error('commit must not run'); },
    async rollback() { rollbacks += 1; }, async close() {},
  };
  const writer = new OracleOutRequestWriter({}, { schema: 'IAS20191', oracle: { callTimeout: 5000 } });
  writer.pool = { async getConnection() { return connection; } };
  await assert.rejects(writer.createVoucherRequestDraft({
    kind: 'receipt', paymentMethod: 'cash', externalReference: 'receipt:duplicate',
    referenceNo: '10001231556', noticeNo: null,
  }), (error) => error instanceof OracleConflictError && error.code === 'DUPLICATE_VOUCHER_IDENTIFIER');
  assert.equal(rollbacks, 1);
  assert.equal(statements.some((sql) => /INSERT INTO/.test(sql)), false);
  assert.equal(statements.filter((sql) => /LOCK TABLE/.test(sql)).length, 2);
});

test('creates a balanced mixed-currency journal request and approval row atomically', async () => {
  const calls = [];
  let sequence = 60;
  let commits = 0;
  const connection = {
    callTimeout: 0,
    async execute(sql, binds) {
      calls.push({ sql, binds });
      if (/WHERE FIELD10=/.test(sql)) return { rows: [] };
      if (/FROM IAS20191\.EX_RATE WHERE CUR_CODE/.test(sql)) {
        if (binds.currencyCode === 'YER') return { rows: [{ CUR_CODE: 'YER', CUR_NAME: 'ريال يمني', CUR_RATE: 0.0064, L_F: 2, MIN_CUR_RATE: null, MAX_CUR_RATE: 0.0066, CUR_FRC_NO: 2 }] };
        return { rows: [{ CUR_CODE: 'R s', CUR_NAME: 'ريال سعودي', CUR_RATE: 1, L_F: 1, MIN_CUR_RATE: null, MAX_CUR_RATE: null, CUR_FRC_NO: 2 }] };
      }
      if (/IAS_PERIOD_EX_RATE_DAY/.test(sql)) return { rows: [] };
      if (/NEXT_REQUEST_NO/.test(sql)) return { rows: [{ NEXT_REQUEST_NO: 4 }] };
      if (/NEXTVAL/.test(sql)) return { rows: [{ DOC_SEQUENCE: ++sequence }] };
      return { rows: [] };
    },
    async commit() { commits += 1; }, async rollback() {}, async close() {},
  };
  const writer = new OracleOutRequestWriter({}, { schema: 'IAS20191', branchYear: 2019, requestDate: '2020-12-31', oracle: { callTimeout: 5000 } });
  writer.pool = { async getConnection() { return connection; } };
  const result = await writer.createJournalRequestDraft({
    externalReference: 'journal:test-4', description: 'قيد تجريبي', referenceNo: '2323',
    lines: [
      { direction: 'debit', currencyCode: 'R s', amount: 60, accountCode: '111202001', analyticalAccountCode: '2', analyticalType: 2, description: null },
      { direction: 'credit', currencyCode: 'YER', amount: 9375, accountCode: '112101001', analyticalAccountCode: '20031', analyticalType: 3, description: null },
    ],
  });
  assert.deepEqual(result, { created: true, requestNo: '4', requestSerial: '2019000001000850014' });
  assert.equal(commits, 1);
  const details = calls.filter((call) => /INSERT INTO IAS20191\.IAS_RQ_JRNL_DTL/.test(call.sql));
  assert.deepEqual(details.map((call) => call.binds.journalAmount), [60, -60]);
  assert.deepEqual(details.map((call) => call.binds.foreignAmount), [0, -9375]);
  const approval = calls.find((call) => /INSERT INTO IAS20191\.S_APPRVD_MOV/.test(call.sql));
  assert.equal(approval.binds.batchValue, 60);
  assert.equal(approval.binds.documentType, 85);
});
