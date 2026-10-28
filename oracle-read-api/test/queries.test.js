'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { advanceAccounts, createdRequests, customerOrderDetails, customerOrders, customerOrdersMetadata, customerOrdersProfile, inventoryCount, inventoryTransferRequest, itemLabels, items, journalRequest, requestCatalog, transferByOutRequest, transferDraftReadiness, transferEvidence, voucherRequest } = require('../src/queries');

test('builds customer-order metadata discovery as a bound SELECT-only query', () => {
  const query = customerOrdersMetadata('IAS20261');
  assert.match(query.sql, /^SELECT /);
  assert.match(query.sql, /ALL_TAB_COLUMNS/);
  assert.match(query.sql, /TABLE_NAME IN \(:masterTable,:detailTable\)/);
  assert.deepEqual(query.binds, {
    owner: 'IAS20261', masterTable: 'SALES_ORDER', detailTable: 'ORDER_DETAIL',
  });
  assert.doesNotMatch(query.sql, /\b(INSERT|UPDATE|DELETE|MERGE|EXECUTE|NEXTVAL|CURRVAL)\b/i);
});

test('profiles customer-order document types without exposing order rows', () => {
  const sql = customerOrdersProfile('IAS20261');
  assert.match(sql, /^SELECT /);
  assert.match(sql, /IAS20261\.SALES_ORDER/);
  assert.match(sql, /GROUP BY BILL_DOC_TYPE/);
  assert.match(sql, /WITHOUT_CUSTOMER_CODE/);
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|MERGE|EXECUTE|NEXTVAL|CURRVAL)\b/i);
});

test('builds paged bound customer-order and detail reads', () => {
  const masters = customerOrders('IAS20261', { kind: 'credit', afterSerial: '20260001', limit: 50, search: '20011' });
  assert.match(masters.sql, /IAS20261\.SALES_ORDER/);
  assert.match(masters.sql, /M\.BILL_DOC_TYPE=:documentType/);
  assert.match(masters.sql, /M\.ORDER_SER>TO_NUMBER\(:afterSerial\)/);
  assert.match(masters.sql, /COALESCE\(M\.C_MOBILE,TO_CHAR\(M\.MOBILE_NO\)\)/);
  assert.equal(masters.binds.documentType, 4);
  assert.equal(masters.binds.afterSerial, '20260001');
  assert.equal(masters.binds.rowLimit, 50);
  assert.equal(masters.binds.searchPattern, '%20011%');
  const details = customerOrderDetails('IAS20261', ['20260001', '20260002']);
  assert.match(details.sql, /IAS20261\.ORDER_DETAIL/);
  assert.match(details.sql, /IAS20261\.ITEM_DETAILS/);
  assert.deepEqual(details.binds, { serial0: '20260001', serial1: '20260002' });
  for (const sql of [masters.sql, details.sql]) {
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|MERGE|EXECUTE|NEXTVAL|CURRVAL)\b/i);
  }
});

test('rejects unsafe customer-order serials before constructing detail SQL', () => {
  assert.throws(() => customerOrderDetails('IAS20261', ['1) OR 1=1']), /Invalid customer-order serial/);
});

test('builds a SELECT-only advance account balance query for the two approved source accounts', () => {
  const sql = advanceAccounts('IAS20261');
  assert.match(sql, /^SELECT /);
  assert.match(sql, /IAS20261\.GLS_ACCNT_DTL/);
  assert.match(sql, /IAS20261\.GLS_V_AC_DTL_CCPJACTV_BLNC/);
  assert.match(sql, /113101001/);
  assert.match(sql, /113101002/);
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|MERGE|EXECUTE|NEXTVAL|CURRVAL)\b/i);
});

test('uses DOC_SER for movements and requires a distinct linked destination', () => {
  const sql = transferEvidence('IAS20261', ['295602501014']);
  assert.match(sql.source, /TR_SER = :sourceTransferSerial/);
  assert.match(sql.destinations, /F_TR_SER = :sourceTransferSerial/);
  assert.match(sql.destinations, /TR_SER <> :sourceTransferSerial/);
  assert.match(sql.movements, /DOC_SER = :sourceTransferSerial/);
  assert.match(sql.movements, /DOC_TYPE IN \(7, 8\)/);
  assert.doesNotMatch(sql.movements, /TR_POST|STK_PROCESSED|POST_DATE/);
});

test('links an issued transfer document to its outgoing request serial', () => {
  const sql = transferByOutRequest('IAS20261');
  assert.match(sql, /IAS20261\.IAS_WHTRNS_MST/);
  assert.match(sql, /IAS20261\.IAS_WHTRNS_DTL/);
  assert.match(sql, /D\.DOC_TYPE_REF = 31/);
  assert.match(sql, /D\.DOC_SER_REF = :outReqSer/);
  assert.match(sql, /TO_CHAR\(M\.TR_SER/);
  assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE|MERGE|EXECUTE|NEXTVAL|CURRVAL/i);
});

test('builds SELECT-only IAS20261 journal readback queries for DOC_TYP 85', () => {
  const sql = journalRequest('IAS20261');
  assert.match(sql.master, /IAS20261\.IAS_RQ_JRNL_MST/);
  assert.match(sql.master, /J_SER=:requestSerial/);
  assert.match(sql.details, /IAS20261\.IAS_RQ_JRNL_DTL/);
  assert.match(sql.approval, /DOC_TYP=85/);
  assert.match(sql.approval, /DOC_JV_TYP=1/);
  assert.doesNotMatch(Object.values(sql).join('\n'), /\b(INSERT|UPDATE|DELETE|MERGE|EXECUTE|NEXTVAL|CURRVAL)\b/i);
});

test('builds SELECT-only IAS20261 transfer draft readiness metadata queries', () => {
  const check = transferDraftReadiness('IAS20261');
  assert.ok(check.required.IAS_OUT_REQUEST_MST.includes('DOC_SER_EXTRNL'));
  assert.ok(check.required.IAS_OUT_REQUEST_DTL.includes('DOC_SEQUENCE'));
  assert.ok(check.required.S_APPRVD_MOV.includes('DOC_TYP'));
  assert.match(check.columns, /^SELECT /);
  assert.match(check.columns, /ALL_TAB_COLUMNS/);
  assert.match(check.objects, /^SELECT /);
  assert.match(check.objects, /IAS_DOC_SEQ_OTHR/);
  for (const statement of [check.columns, check.objects]) {
    assert.doesNotMatch(statement, /INSERT|UPDATE|DELETE|MERGE|EXECUTE|NEXTVAL|CURRVAL/i);
  }
});

test('builds a bound IAS20261 inventory-transfer request readback', () => {
  const sql = inventoryTransferRequest('IAS20261');
  assert.match(sql.master, /IAS20261\.IAS_OUT_REQUEST_MST/);
  assert.match(sql.master, /TO_CHAR\(F_W_CODE\) AS SOURCE_WAREHOUSE_CODE/);
  assert.match(sql.master, /TO_CHAR\(W_CODE\) AS DESTINATION_WAREHOUSE_CODE/);
  assert.match(sql.details, /IAS20261\.IAS_OUT_REQUEST_DTL/);
  assert.match(sql.details, /F_AVL_QTY AS SOURCE_AVAILABLE/);
  assert.match(sql.details, /AVL_QTY AS DESTINATION_AVAILABLE/);
  assert.match(sql.approval, /DOC_TYP=31/);
  for (const statement of Object.values(sql)) {
    assert.match(statement, /^SELECT /);
    assert.match(statement, /:requestSerial/);
    assert.doesNotMatch(statement, /INSERT|UPDATE|DELETE|MERGE|EXECUTE|NEXTVAL|CURRVAL/i);
  }
});

test('builds IAS20261 receipt-request readback queries restricted to DOC_TYP 92', () => {
  const sql = voucherRequest('IAS20261');
  assert.match(sql.master, /IAS20261\.IAS_RQ_VCHR_MST/);
  assert.match(sql.master, /VOUCHER_TYPE=1/);
  assert.match(sql.master, /DOC_TYPE=92/);
  assert.match(sql.details, /IAS20261\.IAS_RQ_VCHR_DTL/);
  assert.match(sql.approval, /DOC_TYP=92/);
  for (const statement of Object.values(sql)) {
    assert.match(statement, /^SELECT /);
    assert.match(statement, /:requestSerial/);
    assert.doesNotMatch(statement, /INSERT|UPDATE|DELETE|MERGE|EXECUTE|NEXTVAL|CURRVAL/i);
  }
});

test('builds IAS20261 payment-request readback queries restricted to DOC_TYP 93', () => {
  const sql = voucherRequest('IAS20261', 2);
  assert.match(sql.master, /IAS20261\.IAS_RQ_VCHR_MST/);
  assert.match(sql.master, /VOUCHER_TYPE=2/);
  assert.match(sql.master, /DOC_TYPE=93/);
  assert.match(sql.details, /VOUCHER_TYPE=2/);
  assert.match(sql.approval, /DOC_TYP=93/);
  for (const statement of Object.values(sql)) {
    assert.match(statement, /^SELECT /);
    assert.match(statement, /:requestSerial/);
    assert.doesNotMatch(statement, /INSERT|UPDATE|DELETE|MERGE|EXECUTE|NEXTVAL|CURRVAL/i);
  }
});

test('binds item codes instead of interpolating request values', () => {
  const sql = transferEvidence('IAS20261', ["A' OR 1=1 --"]);
  assert.doesNotMatch(sql.movements, /OR 1=1/);
  assert.equal(sql.itemBinds.item0, "A' OR 1=1 --");
});

test('binds direct item search and label values', () => {
  const search = items('IAS20191', "A' OR 1=1 --", 20);
  assert.doesNotMatch(search.rows, /OR 1=1/);
  assert.deepEqual(search.binds, { search0: '%A%', search1: '%OR%', search2: '%1%', rowLimit: 20 });

  const labels = itemLabels('IAS20191', ["X' OR 1=1 --"]);
  assert.doesNotMatch(labels.sql, /OR 1=1/);
  assert.equal(labels.binds.item0, "X' OR 1=1 --");
});

test('uses AND terms for smart item search without requiring a contiguous phrase', () => {
  const search = items('IAS20261', 'كوع 3 فابكو', 20);
  assert.match(search.rows, /:search0/);
  assert.match(search.rows, /:search1/);
  assert.match(search.rows, /:search2/);
  assert.match(search.rows, /\)\n    AND \(UPPER\(I_CODE\)/);
  assert.deepEqual(search.binds, {
    search0: '%كوع%', search1: '%3%', search2: '%فابكو%', rowLimit: 20,
  });
});

test('builds schema-specific request catalogs from explicit read-only privilege mappings', () => {
  const sql = requestCatalog('IAS20191', ['116101001', '211101001', '211102001']);
  assert.match(sql.cashboxes, /P\.CASH_TYPE = 1/);
  assert.match(sql.banks, /P\.CASH_TYPE = 2/);
  assert.match(sql.cashboxes, /P\.RCVD/);
  assert.match(sql.banks, /P\.PYMNT/);
  assert.match(sql.collectors, /COLLERCTOR/);
  assert.match(sql.customers, /C\.COL_NO/);
  assert.match(sql.customers, /C\.C_MOBILE/);
  assert.match(sql.vendors, /V\.V_MOBILE/);
  assert.match(sql.employees, /E\.MOBILE_NO/);
  assert.match(sql.analyticalAccounts, /ROWNUM <= 5000/);
  assert.match(sql.analyticalAccounts, /UNION ALL/);
  assert.match(sql.analyticalAccounts, /D\.AC_CODE IN \('116101001', '211101001', '211102001'\)/);
  for (const statement of Object.values(sql)) {
    assert.match(statement, /^SELECT /);
    assert.doesNotMatch(statement, /INSERT|UPDATE|DELETE|MERGE|EXECUTE|NEXTVAL/i);
  }
});

test('rejects unsafe prioritized account codes before building catalog SQL', () => {
  assert.throws(
    () => requestCatalog('IAS20191', ["211101001' OR 1=1 --"]),
    /Invalid prioritized account code/,
  );
});

test('builds SELECT-only created-request status queries for every supported request type', () => {
  const sql = createdRequests('IAS20191');
  assert.deepEqual(Object.keys(sql), ['purchases', 'vouchers', 'journals', 'inventoryCounts', 'inventoryTransfers']);
  assert.match(sql.purchases, /P_REQUEST/);
  assert.match(sql.vouchers, /IAS_RQ_VCHR_MST/);
  assert.match(sql.vouchers, /IAS_RQ_VCHR_DTL/);
  assert.match(sql.vouchers, /PLATFORM_CUSTOMER_CODE/);
  assert.match(sql.journals, /IAS_RQ_JRNL_MST/);
  assert.match(sql.inventoryCounts, /MASTER_INV/);
  assert.match(sql.inventoryCounts, /REQUEST_KIND/);
  assert.match(sql.inventoryCounts, /REF_NO LIKE 'A______________'/);
  assert.match(sql.inventoryTransfers, /IAS_OUT_REQUEST_MST/);
  for (const statement of Object.values(sql)) {
    assert.match(statement, /^SELECT /);
    assert.doesNotMatch(statement, /= \(SELECT MAX\(/);
    assert.doesNotMatch(statement, /INSERT|UPDATE|DELETE|MERGE|EXECUTE|NEXTVAL/i);
  }
  for (const statement of [sql.purchases, sql.vouchers, sql.journals, sql.inventoryTransfers]) {
    assert.match(statement, /S_APPRVD_MOV/);
    assert.match(statement, /ROW_NUMBER\(\) OVER/);
    assert.match(statement, /منصة البناء الراقي/);
  }
});

test('builds bounded SELECT-only INVT008.230 master, detail, and type-permission queries', () => {
  const sql = inventoryCount('IAS20191');
  assert.match(sql.master, /IAS20191\.MASTER_INV/);
  assert.match(sql.master, /INV_NO = :documentNo/);
  assert.match(sql.details, /IAS20191\.DETAIL_INV/);
  assert.match(sql.details, /IAS20191\.ITEM_DETAILS/);
  assert.match(sql.details, /ITEM_NAME_AR/);
  assert.match(sql.details, /INV_SER = :inventorySerial/);
  assert.match(sql.details, /ROWNUM <= 500/);
  assert.match(sql.type, /IAS20191\.IAS_INV_TYPES/);
  assert.match(sql.type, /IAS20191\.IAS_PRIV_INV_TYPE/);
  assert.match(sql.type, /P\.U_ID = :oracleUserId/);
  for (const statement of Object.values(sql)) {
    assert.match(statement, /^SELECT /);
    assert.doesNotMatch(statement, /INSERT|UPDATE|DELETE|MERGE|EXECUTE|NEXTVAL|CURRVAL/i);
  }
});
