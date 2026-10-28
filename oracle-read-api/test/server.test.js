'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHandler } = require('../src/server');

const config = {
  apiKey: 'secret',
  oracle: { defaultSchema: 'IAS20261', allowedSchemas: new Set(['IAS20261']) },
};

test('HR statement remains authenticated, GET-only and refuses truncated results', async () => {
  await withServer({select:async()=>({rows:[{TOTAL:5001}]})},async base=>{
    const url=`${base}/hr/statement?schema=IAS20261&month=2026-10&kind=salary&code=10001`;
    assert.equal((await fetch(url)).status,401);
    assert.equal((await fetch(url,{headers:{authorization:'Bearer secret'}})).status,422);
    assert.equal((await fetch(url,{method:'POST',headers:{authorization:'Bearer secret'}})).status,405);
    assert.equal((await fetch(url.replace('2026-10','2026-09'),{headers:{authorization:'Bearer secret'}})).status,400);
  });
});

const catalogConfig = {
  apiKey: 'secret',
  oracle: { defaultSchema: 'IAS20191', allowedSchemas: new Set(['IAS20191', 'IAS20261']) },
};

async function withServer(db, run) {
  const server = http.createServer(createHandler(config, db));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('rejects unauthenticated data reads and all non-GET methods', async () => {
  await withServer({ select: async () => ({ rows: [] }) }, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/inventory/warehouses/101?schema=IAS20261`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/inventory/warehouses/101`, {
      method: 'POST', headers: { authorization: 'Bearer secret' },
    })).status, 405);
  });
});

test('historical statement endpoint requires auth and rejects incomplete large reports', async () => {
  const db = { select: async (sql, binds) => {
    assert.match(sql, /IAS20261\.IAS_V_POST_DTL_YR/);
    assert.equal(binds.code, '20011');
    return { rows: [{ TOTAL: 5001 }] };
  } };
  await withServer(db, async base => {
    const url = `${base}/accounting/statement?schema=IAS20261&kind=advance&code=20011&currency=YER&fromDate=2025-01-01&toDate=2026-09-06`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { authorization: 'Bearer secret' } })).status, 422);
    assert.equal((await fetch(url.replace('2025-01-01', '2019-01-01'), { headers: { authorization: 'Bearer secret' } })).status, 400);
  });
});

test('returns IAS20261 currencies through the SELECT-only gateway', async () => {
  const db = { select: async (sql) => {
    assert.match(sql, /IAS20261\.EX_RATE/);
    return { rows: [{
      CUR_NO: 1, CUR_CODE: 'YR', CUR_NAME: 'ريال يمني', CUR_E_NAME: 'Yemeni Rial',
      CUR_RATE: 1, L_F: 1, STOCK_CUR: 1, MIN_CUR_RATE: 1, MAX_CUR_RATE: 1,
      CUR_FRC_NO: 2, RATE_UPDATED_AT: '2026-08-28 01:00:00',
    }] };
  } };
  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/accounting/currencies?schema=IAS20261`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, 'SELECT_ONLY');
    assert.equal(body.oracleWrite, 'NONE');
    assert.equal(body.schema, 'IAS20261');
    assert.equal(body.currencies[0].code, 'YR');
  });
});

test('health advertises the direct catalog capabilities used by platform monitoring', async () => {
  await withServer({ select: async () => ({ rows: [] }) }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.mode, 'SELECT_ONLY');
    assert.ok(body.capabilities.includes('request-catalog'));
    assert.ok(body.capabilities.includes('accounting-currencies'));
    assert.ok(body.capabilities.includes('customer-orders'));
  });
});

test('returns IAS20261 customer-order metadata without reading business rows', async () => {
  const rows = [
    { TABLE_NAME: 'ORDER_DETAIL', COLUMN_ID: 1, COLUMN_NAME: 'ORDER_SER', DATA_TYPE: 'NUMBER' },
    { TABLE_NAME: 'SALES_ORDER', COLUMN_ID: 1, COLUMN_NAME: 'ORDER_SER', DATA_TYPE: 'NUMBER' },
  ];
  const db = { select: async (sql, binds) => {
    assert.match(sql, /ALL_TAB_COLUMNS/);
    assert.deepEqual(binds, {
      owner: 'IAS20261', masterTable: 'SALES_ORDER', detailTable: 'ORDER_DETAIL',
    });
    return { rows };
  } };
  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/customer-orders/metadata?schema=IAS20261`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, 'SELECT_ONLY');
    assert.equal(body.oracleWrite, 'NONE');
    assert.equal(body.tables.SALES_ORDER[0].COLUMN_NAME, 'ORDER_SER');
    assert.equal(body.tables.ORDER_DETAIL[0].COLUMN_NAME, 'ORDER_SER');
  });
});

test('blocks customer-order metadata reads outside IAS20261', async () => {
  const server = http.createServer(createHandler(catalogConfig, { select: async () => ({ rows: [] }) }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/customer-orders/metadata?schema=IAS20191`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /IAS20261/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('profiles IAS20261 customer-order types as aggregate SELECT-only evidence', async () => {
  const db = { select: async (sql) => {
    assert.match(sql, /GROUP BY BILL_DOC_TYPE/);
    return { rows: [{
      BILL_DOCUMENT_TYPE: '1', ORDER_COUNT: 10, WITHOUT_CUSTOMER_CODE: 10,
      WITH_CUSTOMER_CODE: 0, WITHOUT_CUSTOMER_NAME: 0,
      FIRST_ORDER_DATE: '2026-01-01', LAST_ORDER_DATE: '2026-08-31',
    }] };
  } };
  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/customer-orders/profile?schema=IAS20261`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.oracleWrite, 'NONE');
    assert.deepEqual(body.documentTypes[0], {
      billDocumentType: '1', orderCount: 10, withoutCustomerCode: 10,
      withCustomerCode: 0, withoutCustomerName: 0,
      firstOrderDate: '2026-01-01', lastOrderDate: '2026-08-31',
    });
  });
});

test('returns paged cash and credit customer orders with their lines', async () => {
  const db = { select: async (sql, binds) => {
    if (sql.includes('.ORDER_DETAIL')) {
      assert.equal(binds.serial0, '202600001');
      return { rows: [{
        ORDER_SERIAL: '202600001', LINE_NO: 1, ITEM_CODE: 'ITEM-1', ITEM_NAME: 'صنف',
        UNIT_CODE: 'حبة', QUANTITY: 2, PACKAGE_SIZE: 1, PACKAGE_QUANTITY: 2,
        UNIT_PRICE: 50, WAREHOUSE_CODE: '101', VAT_AMOUNT: 0, OTHER_AMOUNT: 0,
        CANCELED: 0, EXTERNAL_POST: 0,
      }] };
    }
    assert.equal(binds.documentType, 1);
    return { rows: [{
      SALES_ORDER_TYPE: '1', ORDER_NO: '9', ORDER_SERIAL: '202600001', ORDER_DATE: '2026-09-01',
      CURRENCY_CODE: 'YER', EXCHANGE_RATE: 1, CUSTOMER_CODE: null, CUSTOMER_NAME: 'عميل نقدي',
      BILL_DOCUMENT_TYPE: '1', ORDER_AMOUNT: 100, APPROVED: 0, PROCESSED: 0, INACTIVE: 0,
    }] };
  } };
  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/customer-orders?schema=IAS20261&kind=cash&limit=1`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.items[0].kind, 'cash');
    assert.equal(body.items[0].customerCodeRequired, false);
    assert.equal(body.items[0].customerBindingStatus, 'cash_name_only');
    assert.equal(body.items[0].lines[0].itemCode, 'ITEM-1');
    assert.equal(body.nextAfterSerial, '202600001');
  });
});

test('marks a credit order without C_CODE invalid for customer binding', async () => {
  const db = { select: async (sql) => sql.includes('.ORDER_DETAIL') ? { rows: [] } : { rows: [{
    SALES_ORDER_TYPE: '1', ORDER_NO: '10', ORDER_SERIAL: '202600002', ORDER_DATE: '2026-09-01',
    CURRENCY_CODE: 'YER', CUSTOMER_CODE: null, CUSTOMER_NAME: 'عميل آجل',
    BILL_DOCUMENT_TYPE: '4', ORDER_AMOUNT: 10, APPROVED: 0, PROCESSED: 0, INACTIVE: 0,
  }] } };
  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/customer-orders?schema=IAS20261&kind=credit&limit=2`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    const item = (await response.json()).items[0];
    assert.equal(item.customerCodeRequired, true);
    assert.equal(item.customerBindingStatus, 'missing_required_code');
  });
});

test('reports IAS20261 transfer draft readiness from metadata without writing', async () => {
  const requiredColumns = {
    IAS_OUT_REQUEST_MST: [
      'OUT_REQ_TYPE', 'OUT_REQ_NO', 'OUT_REQ_SER', 'OUT_REQ_DATE', 'W_CODE', 'F_W_CODE',
      'REQ_SIDE', 'DOC_DESC', 'PROCESSED', 'INACTIVE', 'APPROVED', 'AD_U_ID', 'AD_DATE',
      'EXTERNAL_POST', 'DOC_SER_EXTRNL', 'CMP_NO', 'BRN_NO', 'BRN_YEAR', 'BRN_USR',
      'AD_TRMNL_NM', 'USE_REQ_MORE_ONCE',
    ],
    IAS_OUT_REQUEST_DTL: [
      'OUT_REQ_TYPE', 'OUT_REQ_NO', 'OUT_REQ_SER', 'I_CODE', 'ITM_UNT', 'I_QTY',
      'P_SIZE', 'P_QTY', 'W_CODE', 'RCRD_NO', 'EXTERNAL_POST', 'USE_ATTCH',
      'DOC_SEQUENCE', 'AVL_QTY', 'F_AVL_QTY', 'F_W_CODE', 'CMP_NO', 'BRN_NO',
      'BRN_YEAR', 'BRN_USR', 'RESERVED',
    ],
    S_APPRVD_MOV: [
      'LVL_NO', 'DOC_TYP', 'DOC_SER', 'DOC_NO', 'DOC_JV_TYP', 'DOC_DATE', 'DOC_AMT',
      'APPRVD', 'ORDR_NO', 'CMP_NO', 'BRN_NO', 'BRN_YEAR', 'BRN_USR',
    ],
  };
  const db = { select: async (sql) => {
    if (sql.includes('ALL_TAB_COLUMNS')) {
      return { rows: Object.entries(requiredColumns).flatMap(([TABLE_NAME, names]) =>
        names.map((COLUMN_NAME, index) => ({ TABLE_NAME, COLUMN_NAME, COLUMN_ID: index + 1 }))) };
    }
    if (sql.includes('ALL_OBJECTS')) return { rows: [
      { OBJECT_NAME: 'IAS_OUT_REQUEST_MST', OBJECT_TYPE: 'TABLE', STATUS: 'VALID' },
      { OBJECT_NAME: 'IAS_OUT_REQUEST_DTL', OBJECT_TYPE: 'TABLE', STATUS: 'VALID' },
      { OBJECT_NAME: 'S_APPRVD_MOV', OBJECT_TYPE: 'TABLE', STATUS: 'VALID' },
      { OBJECT_NAME: 'IAS_DOC_SEQ_OTHR', OBJECT_TYPE: 'SEQUENCE', STATUS: 'VALID' },
    ] };
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health/transfer-draft-readiness?schema=IAS20261`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.compatible, true);
    assert.equal(body.mode, 'SELECT_ONLY');
    assert.equal(body.oracleWrite, 'NONE');
    assert.deepEqual(body.missing, []);
    assert.deepEqual(body.missingObjects, []);
  });
});

test('returns raw evidence with long serials preserved as strings', async () => {
  const db = {
    async select(sql) {
      if (sql.includes('TR_SER = :sourceTransferSerial') && sql.includes('TR_NO')) return { rows: [{
        TRANSFER_SERIAL: '20260000011119', TRANSFER_DOCUMENT_NUMBER: '9', WAREHOUSE_CODE: '102',
        DESTINATION_WAREHOUSE_CODE: '101', TR_POST: null, STK_PROCESSED: 0, POST_DATE: null,
      }] };
      if (sql.includes('SOURCE_TRANSFER_SERIAL')) return { rows: [{
        TRANSFER_SERIAL: '20260000011129', SOURCE_TRANSFER_SERIAL: '20260000011119', WAREHOUSE_CODE: '101',
      }] };
      return { rows: [
        { DOCUMENT_SERIAL: '20260000011119', DOCUMENT_TYPE: 7, ITEM_CODE: '295602501014', WAREHOUSE_CODE: '102' },
        { DOCUMENT_SERIAL: '20260000011129', DOCUMENT_TYPE: 8, ITEM_CODE: '295602501014', WAREHOUSE_CODE: '101' },
      ] };
    },
  };
  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/inventory/transfers/evidence?sourceTransferSerial=20260000011119&sourceWarehouseCode=102&destinationWarehouseCode=101&itemCodes=295602501014&schema=IAS20261`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source.transferSerial, '20260000011119');
    assert.equal(body.destinationDocuments[0].transferSerial, '20260000011129');
    assert.equal(body.movements[1].documentType, 8);
  });
});

test('finds issued transfer documents by outgoing request serial', async () => {
  const db = { select: async (sql, binds) => {
    assert.match(sql, /D\.DOC_SER_REF = :outReqSer/);
    assert.deepEqual(binds, { outReqSer: '20260000014' });
    return { rows: [{
      TRANSFER_SERIAL: '20260000011131', TRANSFER_DOCUMENT_NUMBER: '31', REQUEST_SERIAL: '20260000014',
      WAREHOUSE_CODE: '102', DESTINATION_WAREHOUSE_CODE: '101', SOURCE_TRANSFER_SERIAL: null,
      TR_POST: 1, STK_PROCESSED: 1, POST_DATE: '2026-08-29 05:00:00',
    }] };
  } };
  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/inventory/transfers/by-out-request?outReqSer=20260000014&schema=IAS20261`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.requestSerial, '20260000014');
    assert.equal(body.documents[0].transferSerial, '20260000011131');
    assert.equal(body.documents[0].transferDocumentNumber, '31');
  });
});

test('serves direct inventory lookup routes from allowlisted IAS20261 with SELECT only', async () => {
  await withServer({ select: async (sql) => {
    assert.match(sql, /IAS20261\.ITEM_DETAILS/);
    return { rows: [] };
  } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/inventory/items?schema=IAS20261`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.snapshotRunId, 'live:IAS20261');
    assert.deepEqual(body.items, []);
  });
});

test('reads back one IAS20261 purchase request with its lines and DOC_TYP 40 approval', async () => {
  const db = { select: async (sql, binds) => {
    assert.equal(binds.requestSerial, '20260000014');
    if (sql.includes('.P_REQUEST_DETAIL')) return { rows: [{ LINE_NO: 1, ITEM_CODE: '111100101001' }] };
    if (sql.includes('.S_APPRVD_MOV')) return { rows: [{ DOCUMENT_TYPE: 40, APPROVED: 0 }] };
    return { rows: [{ REQUEST_NO: '4', REQUEST_SERIAL: '20260000014' }] };
  } };
  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/requests/purchases/20260000014?schema=IAS20261`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.schema, 'IAS20261');
    assert.equal(result.request.REQUEST_SERIAL, '20260000014');
    assert.equal(result.lines.length, 1);
    assert.equal(result.approvals[0].DOCUMENT_TYPE, 40);
  });
});

test('reads back one IAS20261 receipt request with its lines and DOC_TYP 92 approval', async () => {
  const db = { select: async (sql, binds) => {
    assert.equal(binds.requestSerial, '202600000100092100000000061');
    if (sql.includes('.IAS_RQ_VCHR_DTL')) return { rows: [{ LINE_NO: 1, ACCOUNT_CODE: '112101001' }] };
    if (sql.includes('.S_APPRVD_MOV')) return { rows: [{ DOCUMENT_TYPE: 92, APPROVED: 0 }] };
    return { rows: [{ REQUEST_NO: '6', REQUEST_SERIAL: '202600000100092100000000061', VOUCHER_TYPE: '1' }] };
  } };
  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/requests/receipts/202600000100092100000000061?schema=IAS20261`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.schema, 'IAS20261');
    assert.equal(result.request.REQUEST_SERIAL, '202600000100092100000000061');
    assert.equal(result.lines.length, 1);
    assert.equal(result.approvals[0].DOCUMENT_TYPE, 92);
  });
});

test('reads back one IAS20261 payment request with its lines and DOC_TYP 93 approval', async () => {
  const db = { select: async (sql, binds) => {
    assert.equal(binds.requestSerial, '202600000100093100000000061');
    if (sql.includes('.IAS_RQ_VCHR_DTL')) return { rows: [{ LINE_NO: 1, ACCOUNT_CODE: '112101001', LOCAL_AMOUNT: 1 }] };
    if (sql.includes('.S_APPRVD_MOV')) return { rows: [{ DOCUMENT_TYPE: 93, APPROVED: 0 }] };
    return { rows: [{ REQUEST_NO: '6', REQUEST_SERIAL: '202600000100093100000000061', VOUCHER_TYPE: '2' }] };
  } };
  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/requests/payments/202600000100093100000000061?schema=IAS20261`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.schema, 'IAS20261');
    assert.equal(result.request.VOUCHER_TYPE, '2');
    assert.equal(result.lines.length, 1);
    assert.equal(result.approvals[0].DOCUMENT_TYPE, 93);
  });
});

test('reads back one IAS20261 journal request with its lines and DOC_TYP 85 approval', async () => {
  const serial = '2026000001000850018';
  const db = { select: async (sql, binds) => {
    assert.equal(binds.requestSerial, serial);
    if (sql.includes('.IAS_RQ_JRNL_DTL')) return { rows: [
      { LINE_NO: 1, ACCOUNT_CODE: '112101001', LOCAL_AMOUNT: 1 },
      { LINE_NO: 2, ACCOUNT_CODE: '111202007', LOCAL_AMOUNT: -1 },
    ] };
    if (sql.includes('.S_APPRVD_MOV')) return { rows: [{ DOCUMENT_TYPE: 85, APPROVED: 0 }] };
    return { rows: [{ REQUEST_NO: '8', REQUEST_SERIAL: serial, JOURNAL_TYPE: '1' }] };
  } };
  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/requests/journals/${serial}?schema=IAS20261`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.schema, 'IAS20261');
    assert.equal(result.request.JOURNAL_TYPE, '1');
    assert.equal(result.lines.length, 2);
    assert.equal(result.approvals[0].DOCUMENT_TYPE, 85);
  });
});

test('lists only explicitly requested IAS20261 request kinds and blocks broad reads', async () => {
  const db = { select: async (sql) => {
    if (sql.includes('IAS20261.P_REQUEST')) return { rows: [{
        REQUEST_KIND: 'purchase', REQUEST_NO: '3', REQUEST_SERIAL: '20260000013',
        DESCRIPTION: 'طلب شراء', MASTER_APPROVED: 0, INACTIVE: 0, APPROVAL_CODE: 0,
        APPROVAL_LEVEL: 1, CREATED_AT: '2026-08-29 01:00:00',
      }] };
    if (sql.includes('IAS20261.IAS_RQ_VCHR_MST')) return { rows: [
      {
        REQUEST_KIND: 'receipt', REQUEST_NO: '6', REQUEST_SERIAL: '202600000100092100000000061',
        DESCRIPTION: 'سند قبض', COLLECTOR_NO: '1', PLATFORM_CUSTOMER_CODE: '30124', MASTER_APPROVED: 0, INACTIVE: 0, APPROVAL_CODE: 0,
        APPROVAL_LEVEL: 1, CREATED_AT: '2026-08-29 06:00:00',
      },
      {
        REQUEST_KIND: 'payment', REQUEST_NO: '6', REQUEST_SERIAL: '202600000100093100000000061',
        DESCRIPTION: 'سند صرف', MASTER_APPROVED: 0, INACTIVE: 0, APPROVAL_CODE: 0,
        APPROVAL_LEVEL: 1, CREATED_AT: '2026-08-29 06:05:00',
      },
    ] };
    if (sql.includes('IAS20261.IAS_RQ_JRNL_MST')) return { rows: [{
      REQUEST_KIND: 'journal', REQUEST_NO: '8', REQUEST_SERIAL: '2026000001000850018',
      DESCRIPTION: 'قيد يومي', MASTER_APPROVED: 0, INACTIVE: 0, APPROVAL_CODE: 0,
      APPROVAL_LEVEL: 1, CREATED_AT: '2026-08-29 06:10:00',
    }] };
    if (sql.includes('IAS20261.MASTER_INV')) return { rows: [{
      REQUEST_KIND: 'inventory_count', REQUEST_NO: '9', REQUEST_SERIAL: '2026000002339',
      DESCRIPTION: 'جرد من تطبيق البناء الراقي', MASTER_APPROVED: 0, INACTIVE: 0,
      APPROVAL_CODE: null, APPROVAL_LEVEL: null, CREATED_AT: '2026-08-29 06:15:00',
    }] };
    assert.match(sql, /IAS20261\.IAS_OUT_REQUEST_MST/);
    return { rows: [{
      REQUEST_KIND: 'inventory_transfer', REQUEST_NO: '31', REQUEST_SERIAL: '202600000131',
      DESCRIPTION: 'طلب تحويل', MASTER_APPROVED: 0, INACTIVE: 0, APPROVAL_CODE: 0,
      APPROVAL_LEVEL: 1, CREATED_AT: '2026-08-29 04:55:00',
    }] };
  } };
  await withServer(db, async (baseUrl) => {
    const allowed = await fetch(`${baseUrl}/requests/created?schema=IAS20261&kind=purchase`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(allowed.status, 200);
    assert.deepEqual((await allowed.json()).items.map((item) => item.kind), ['purchase']);

    const transfer = await fetch(`${baseUrl}/requests/created?schema=IAS20261&kind=inventory_transfer`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(transfer.status, 200);
    assert.deepEqual((await transfer.json()).items.map((item) => item.kind), ['inventory_transfer']);

    const receipt = await fetch(`${baseUrl}/requests/created?schema=IAS20261&kind=receipt`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(receipt.status, 200);
    const receiptItems = (await receipt.json()).items;
    assert.deepEqual(receiptItems.map((item) => item.kind), ['receipt']);
    assert.equal(receiptItems[0].collectorNo, '1');
    assert.equal(receiptItems[0].platformCustomerCode, '30124');

    const payment = await fetch(`${baseUrl}/requests/created?schema=IAS20261&kind=payment`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(payment.status, 200);
    assert.deepEqual((await payment.json()).items.map((item) => item.kind), ['payment']);

    const journal = await fetch(`${baseUrl}/requests/created?schema=IAS20261&kind=journal`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(journal.status, 200);
    assert.deepEqual((await journal.json()).items.map((item) => item.kind), ['journal']);

    const inventoryCount = await fetch(`${baseUrl}/requests/created?schema=IAS20261&kind=inventory_count`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(inventoryCount.status, 200);
    assert.deepEqual((await inventoryCount.json()).items.map((item) => item.kind), ['inventory_count']);

    const blocked = await fetch(`${baseUrl}/requests/created?schema=IAS20261`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(blocked.status, 400);
    assert.match((await blocked.json()).message, /supported request kinds/);
  });
});

test('reads back one IAS20261 inventory-transfer request with lines and DOC_TYP 31 approval', async () => {
  const db = { select: async (sql, binds) => {
    assert.equal(binds.requestSerial, '202600000131');
    if (sql.includes('.IAS_OUT_REQUEST_DTL')) return { rows: [{
      LINE_NO: 1, ITEM_CODE: '111100202001', UNIT_CODE: 'حبة', QUANTITY: 1,
      SOURCE_WAREHOUSE_CODE: '102', DESTINATION_WAREHOUSE_CODE: '101',
    }] };
    if (sql.includes('.S_APPRVD_MOV')) return { rows: [{ DOCUMENT_TYPE: 31, APPROVED: 0 }] };
    return { rows: [{ REQUEST_NO: '31', REQUEST_SERIAL: '202600000131', APPROVED: 0 }] };
  } };
  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/requests/inventory-transfers/202600000131?schema=IAS20261`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.request.REQUEST_SERIAL, '202600000131');
    assert.equal(result.lines[0].SOURCE_WAREHOUSE_CODE, '102');
    assert.equal(result.approvals[0].DOCUMENT_TYPE, 31);
  });
});

test('returns the proven INVT008.230 document as SELECT-only data and computes only proven unit differences', async () => {
  const db = {
    async select(sql, binds) {
      if (sql.includes('.MASTER_INV')) return { rows: [{
        INVENTORY_NUMBER: '3', INVENTORY_TYPE: '1', INVENTORY_SERIAL: '2019000001333',
        INVENTORY_DATE: '2020-12-31', DESCRIPTION: 'تجريبي3', ANNUAL: 0, PROCESSED: 0,
        EXTERNAL_POST: 0, BRANCH_NUMBER: 1, BRANCH_YEAR: 2019, COMPANY_NUMBER: 1,
      }] };
      if (sql.includes('.IAS_INV_TYPES')) return { rows: [{
        INVENTORY_TYPE: '1', NAME_AR: 'جرد يدوي', ADD_ALLOWED: 1, VIEW_ALLOWED: 1,
      }] };
      if (sql.includes('.DETAIL_INV')) {
        assert.equal(binds.inventorySerial, '2019000001333');
        return { rows: [
          { LINE_NUMBER: 1, ITEM_CODE: '00101-01-01', ITEM_NAME_AR: 'كوع حديد', UNIT_CODE: 'حبة', WAREHOUSE_CODE: '1', COUNTED_QUANTITY: 1, PACKAGE_SIZE: 1, PACKAGE_QUANTITY: 1, AVAILABLE_QUANTITY: 0, PROCESSED_ADJUSTMENT: 0 },
          { LINE_NUMBER: 2, ITEM_CODE: 'MULTI', UNIT_CODE: 'كرتون', WAREHOUSE_CODE: '1', COUNTED_QUANTITY: 2, PACKAGE_SIZE: 12, PACKAGE_QUANTITY: 24, AVAILABLE_QUANTITY: 10, PROCESSED_ADJUSTMENT: 0 },
        ] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const server = http.createServer(createHandler(catalogConfig, db));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/inventory/counts/3?schema=IAS20191&inventoryType=1&branchNo=1&branchYear=2019&oracleUserId=1`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, 'SELECT_ONLY');
    assert.equal(body.oracleWrite, 'NONE');
    assert.equal(body.document.serial, '2019000001333');
    assert.equal(body.lines[0].itemNameAr, 'كوع حديد');
    assert.equal(body.lines[0].differenceQuantity, '1');
    assert.equal(body.lines[0].conversionProven, true);
    assert.equal(body.lines[1].differenceQuantity, null);
    assert.equal(body.lines[1].conversionProven, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('reads IAS20261 inventory-count documents through the same SELECT-only response', async () => {
  const server = http.createServer(createHandler(catalogConfig, { select: async (sql) => {
    if (sql.includes('.MASTER_INV')) return { rows: [{
      INVENTORY_NUMBER: '9', INVENTORY_TYPE: '2', INVENTORY_SERIAL: '2026000002339',
      INVENTORY_DATE: '2026-08-29', DESCRIPTION: 'جرد من التطبيق', ANNUAL: 0,
      PROCESSED: 0, EXTERNAL_POST: 0, BRANCH_NUMBER: 1, BRANCH_YEAR: 2026, COMPANY_NUMBER: 1,
    }] };
    if (sql.includes('.IAS_INV_TYPES')) return { rows: [{
      INVENTORY_TYPE: '2', NAME_AR: 'جرد من التطبيق', ADD_ALLOWED: 1, VIEW_ALLOWED: 1,
    }] };
    if (sql.includes('.DETAIL_INV')) return { rows: [{
      LINE_NUMBER: 1, ITEM_CODE: '230800105001', ITEM_NAME_AR: 'حديد تركي 8',
      UNIT_CODE: 'طن', WAREHOUSE_CODE: '101', COUNTED_QUANTITY: 1,
      PACKAGE_SIZE: 1, PACKAGE_QUANTITY: 1, AVAILABLE_QUANTITY: 5, PROCESSED_ADJUSTMENT: 0,
    }] };
    throw new Error(`Unexpected SQL: ${sql}`);
  } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/inventory/counts/9?schema=IAS20261&inventoryType=2&branchNo=1&branchYear=2026&oracleUserId=1`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.schema, 'IAS20261');
    assert.equal(body.document.number, '9');
    assert.equal(body.lines[0].itemCode, '230800105001');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('returns purpose-filtered cash and bank catalogs without confusing overlapping numbers', async () => {
  const observedBinds = [];
  const db = {
    async select(sql, binds) {
      observedBinds.push({ sql, keys: Object.keys(binds).sort() });
      if (sql.includes('CASH_TYPE = 1')) return { rows: [
        { CODE: '1', NAME_AR: 'صندوق', ACCOUNT_CODE: '111101001', RECEIPT_ALLOWED: 1, PAYMENT_ALLOWED: 0 },
      ] };
      if (sql.includes('CASH_TYPE = 2')) return { rows: [
        { CODE: '1', NAME_AR: 'بنك', ACCOUNT_CODE: '111202001', RECEIPT_ALLOWED: 1, PAYMENT_ALLOWED: 1 },
      ] };
      if (sql.includes('IAS_V_USR_COLLECTOR_PRV')) return { rows: [] };
      if (sql.includes('.CUSTOMER_CURR')) return { rows: [] };
      if (sql.includes('.CUSTOMER')) return { rows: [] };
      if (sql.includes('.V_DETAILS')) return { rows: [] };
      if (sql.includes('.S_EMP')) return { rows: [] };
      if (sql.includes('.ACCOUNT_CURR')) return { rows: [] };
      if (sql.includes('.ACCOUNT')) return { rows: [] };
      if (sql.includes('.GLS_ACCNT_DTL')) return { rows: [
        { CODE: 'unclassified', NAME_AR: 'حساب غير مصنف', ACCOUNT_CODE: '100', ANALYTICAL_TYPE: 3 },
      ] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const server = http.createServer(createHandler(catalogConfig, db));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/requests/catalog?schema=IAS20191&purpose=receipt&oracleUserId=1&branchNo=1`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, 'SELECT_ONLY');
    assert.deepEqual(body.cashboxes.map((row) => row.nameAr), ['صندوق']);
    assert.deepEqual(body.banks.map((row) => row.nameAr), ['بنك']);
    assert.deepEqual(body.parties.debtors, []);
    assert.deepEqual(body.parties.creditors, []);
    assert.deepEqual(body.parties.other.map((row) => row.code), ['unclassified']);
    assert.deepEqual(observedBinds.find((row) => row.sql.includes('CASH_TYPE = 1')).keys, ['branchNo', 'oracleUserId']);
    assert.deepEqual(observedBinds.find((row) => row.sql.includes('IAS_V_USR_COLLECTOR_PRV')).keys, ['oracleUserId']);
    assert.deepEqual(observedBinds.find((row) => row.sql.includes('.ACCOUNT')).keys, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('applies the confirmed IAS20261 cash, bank, employee, and advances hierarchy', async () => {
  const db = {
    async select(sql) {
      if (sql.includes('CASH_TYPE = 1')) return { rows: [
        { CODE: '1', NAME_AR: 'صندوق صحيح', ACCOUNT_CODE: '111101002', RECEIPT_ALLOWED: 1, PAYMENT_ALLOWED: 1 },
        { CODE: '2', NAME_AR: 'صندوق خارج التصنيف', ACCOUNT_CODE: '999', RECEIPT_ALLOWED: 1, PAYMENT_ALLOWED: 1 },
      ] };
      if (sql.includes('CASH_TYPE = 2')) return { rows: [
        { CODE: '7', NAME_AR: 'بنك صحيح', ACCOUNT_CODE: '111202007', RECEIPT_ALLOWED: 1, PAYMENT_ALLOWED: 1 },
        { CODE: '8', NAME_AR: 'بنك خارج التصنيف', ACCOUNT_CODE: '111202008', RECEIPT_ALLOWED: 1, PAYMENT_ALLOWED: 1 },
      ] };
      if (sql.includes('IAS_V_USR_COLLECTOR_PRV')) return { rows: [] };
      if (sql.includes('.CUSTOMER_CURR')) return { rows: [
        { CODE: 'D1', CURRENCY_CODE: 'SR' },
        { CODE: 'D1', CURRENCY_CODE: 'YR' },
      ] };
      if (sql.includes('.CUSTOMER')) return { rows: [
        { CODE: 'D1', NAME_AR: 'سلفة مرتبطة كذلك بعميل', MASTER_ACCOUNT_CODE: '112101001', COLLECTOR_CODE: null },
      ] };
      if (sql.includes('.V_DETAILS')) return { rows: [
        { CODE: 'V1', NAME_AR: 'مورد' },
      ] };
      if (sql.includes('.S_EMP')) return { rows: [
        { CODE: 'E1', NAME_AR: 'موظف', MASTER_ACCOUNT_CODE: null },
      ] };
      if (sql.includes('.ACCOUNT_CURR')) return { rows: [
        { ACCOUNT_CODE: '112101001', CURRENCY_CODE: 'SR' },
        { ACCOUNT_CODE: '112101001', CURRENCY_CODE: 'YR' },
        { ACCOUNT_CODE: '116101001', CURRENCY_CODE: 'YR' },
        { ACCOUNT_CODE: '116201001', CURRENCY_CODE: 'SR' },
        { ACCOUNT_CODE: '113101001', CURRENCY_CODE: 'YR' },
        { ACCOUNT_CODE: '113101002', CURRENCY_CODE: 'SR' },
        { ACCOUNT_CODE: '111202007', CURRENCY_CODE: '$' },
        { ACCOUNT_CODE: '111202007', CURRENCY_CODE: 'SR' },
        { ACCOUNT_CODE: '211102001', CURRENCY_CODE: 'YR' },
        { ACCOUNT_CODE: '312401001', CURRENCY_CODE: '$' },
        { ACCOUNT_CODE: '312401001', CURRENCY_CODE: 'SR' },
        { ACCOUNT_CODE: '312401001', CURRENCY_CODE: 'YR' },
        { ACCOUNT_CODE: '999', CURRENCY_CODE: '$' },
      ] };
      if (sql.includes('.ACCOUNT')) return { rows: [
        { CODE: '112101001', NAME_AR: 'العملاء' },
        { CODE: '116101001', NAME_AR: 'الموظفون' },
        { CODE: '116201001', NAME_AR: 'العهد' },
        { CODE: '113101001', NAME_AR: 'مدينون' },
        { CODE: '113101002', NAME_AR: 'مدينون آخرون' },
        { CODE: '111202007', NAME_AR: 'حساب البنك', ANALYTICAL_TYPE: 2 },
        { CODE: '211102001', NAME_AR: 'الموردون' },
        { CODE: '312401001', NAME_AR: 'الخصم المسموح به', ANALYTICAL_TYPE: 0 },
        { CODE: '999', NAME_AR: 'حساب آخر' },
      ] };
      if (sql.includes('.GLS_ACCNT_DTL')) return { rows: [
        { CODE: 'D1', NAME_AR: 'سلفة مرتبطة كذلك بعميل', ACCOUNT_CODE: '112101001', ANALYTICAL_TYPE: 2 },
        { CODE: 'E1', NAME_AR: 'موظف', ACCOUNT_CODE: '116101001', ANALYTICAL_TYPE: 4 },
        { CODE: 'D1', NAME_AR: 'سلفة أولى', ACCOUNT_CODE: '113101001', ANALYTICAL_TYPE: 2 },
        { CODE: 'D2', NAME_AR: 'سلفة أخرى', ACCOUNT_CODE: '113101002', ANALYTICAL_TYPE: 2 },
        { CODE: 'C1', NAME_AR: 'عهدة موظف', ACCOUNT_CODE: '116201001', ANALYTICAL_TYPE: 4 },
        { CODE: 'V1', NAME_AR: 'مورد', ACCOUNT_CODE: '211102001', ANALYTICAL_TYPE: 7 },
        { CODE: 'O1', NAME_AR: 'تفصيلي آخر', ACCOUNT_CODE: '999', ANALYTICAL_TYPE: 1 },
      ] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const server = http.createServer(createHandler(catalogConfig, db));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/requests/catalog?schema=IAS20261&purpose=payment&oracleUserId=1&branchNo=1`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.cashboxes.map((row) => row.code), ['1']);
    assert.deepEqual(body.banks.map((row) => row.code), ['7']);
    assert.deepEqual(body.parties.employees[0].linkedAccounts.map((row) => row.accountCode), ['116101001']);
    assert.deepEqual(body.parties.vendors[0].linkedAccounts.map((row) => row.accountCode), ['211102001']);
    assert.deepEqual(body.parties.customers.map((row) => row.code), ['D1']);
    assert.deepEqual(body.parties.customers[0].linkedAccounts[0].currencyCodes, ['SR', 'YR']);
    assert.deepEqual(body.parties.debtors.map((row) => row.code), ['D1', 'D2']);
    assert.equal(body.parties.debtors.length, new Set(body.parties.debtors.map((row) => row.code)).size);
    assert.deepEqual(body.parties.debtors.map((row) => row.linkedAccounts[0].accountGroupNameAr), ['السلف', 'السلف']);
    assert.deepEqual(body.parties.debtors.map((row) => row.linkedAccounts[0].currencyCodes), [['YR'], ['SR']]);
    assert.deepEqual(body.parties.custodies.map((row) => row.code), ['C1']);
    assert.equal(body.parties.custodies[0].linkedAccounts[0].accountGroupNameAr, 'العهد');
    assert.deepEqual(body.parties.custodies[0].linkedAccounts[0].currencyCodes, ['SR']);
    assert.deepEqual(body.parties.bank_accounts.map((row) => row.code), ['7']);
    assert.equal(body.parties.bank_accounts[0].linkedAccounts[0].accountCode, '111202007');
    assert.equal(body.parties.bank_accounts[0].linkedAccounts[0].analyticalAccountCode, '7');
    assert.equal(body.parties.bank_accounts[0].linkedAccounts[0].analyticalType, 2);
    assert.deepEqual(body.parties.bank_accounts[0].linkedAccounts[0].currencyCodes, ['$', 'SR']);
    assert.deepEqual(body.parties.other.map((row) => row.code), ['312401001', 'O1']);
    const adjustmentAccount = body.parties.other.find((row) => row.code === '312401001').linkedAccounts[0];
    assert.equal(adjustmentAccount.analyticalType, 0);
    assert.equal(adjustmentAccount.analyticalAccountCode, '');
    assert.deepEqual(adjustmentAccount.currencyCodes, ['$', 'SR', 'YR']);
    assert.deepEqual(body.accountHierarchy.banks, [
      '111202001', '111202002', '111202003', '111202004', '111202005', '111202006', '111202007',
    ]);
    assert.deepEqual(body.accountHierarchy.vendors, ['211101001', '211102001']);
    assert.deepEqual(body.accountHierarchy.custodies, ['116201001']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('uses only the confirmed IAS20191 customer, supplier, and employee account links', async () => {
  const db = {
    async select(sql) {
      if (sql.includes('CASH_TYPE = 1') || sql.includes('CASH_TYPE = 2') || sql.includes('IAS_V_USR_COLLECTOR_PRV')) {
        return { rows: [] };
      }
      if (sql.includes('.CUSTOMER_CURR')) return { rows: [
        { CODE: '20067', CURRENCY_CODE: 'R s' },
      ] };
      if (sql.includes('.CUSTOMER')) return { rows: [
        { CODE: '20067', NAME_AR: 'ابراهيم احمد الهميس', MASTER_ACCOUNT_CODE: '112101001', COLLECTOR_CODE: null },
      ] };
      if (sql.includes('.V_DETAILS')) return { rows: [
        { CODE: '10001', NAME_AR: 'دار الناصرة' },
        { CODE: '20001', NAME_AR: 'مورد خارجي' },
        { CODE: '30001', NAME_AR: 'مورد غير مفحوص' },
      ] };
      if (sql.includes('.S_EMP')) return { rows: [
        { CODE: '1', NAME_AR: 'عبد الرحمن مطهر القلصي', MASTER_ACCOUNT_CODE: null },
        { CODE: '2', NAME_AR: 'موظف غير مفحوص', MASTER_ACCOUNT_CODE: null },
      ] };
      if (sql.includes('.ACCOUNT_CURR')) return { rows: [
        { ACCOUNT_CODE: '112101001', CURRENCY_CODE: 'R s' },
        { ACCOUNT_CODE: '116101001', CURRENCY_CODE: 'R s' },
        { ACCOUNT_CODE: '211101001', CURRENCY_CODE: 'R s' },
        { ACCOUNT_CODE: '211102001', CURRENCY_CODE: 'YER' },
      ] };
      if (sql.includes('.ACCOUNT')) return { rows: [
        { CODE: '112101001', NAME_AR: 'العملاء' },
        { CODE: '116101001', NAME_AR: 'الموظفون' },
        { CODE: '211101001', NAME_AR: 'الموردون المحليون' },
        { CODE: '211102001', NAME_AR: 'الموردون الخارجيون' },
      ] };
      if (sql.includes('.GLS_ACCNT_DTL')) return { rows: [
        { CODE: '10001', NAME_AR: 'دار الناصرة', ACCOUNT_CODE: '211101001', ANALYTICAL_TYPE: 8 },
      ] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const server = http.createServer(createHandler(catalogConfig, db));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/requests/catalog?schema=IAS20191&purpose=receipt&oracleUserId=1&branchNo=1`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.parties.customers[0].linkedAccounts, [{
      accountCode: '112101001',
      accountName: 'العملاء',
      analyticalAccountCode: '20067',
      analyticalAccountName: 'ابراهيم احمد الهميس',
      analyticalType: 3,
      currencyCodes: ['R s'],
    }]);
    assert.deepEqual(body.parties.vendors[0].linkedAccounts, [{
      accountCode: '211101001',
      accountName: 'الموردون المحليون',
      analyticalAccountCode: '10001',
      analyticalAccountName: 'دار الناصرة',
      analyticalType: 4,
      currencyCodes: ['R s'],
    }]);
    assert.deepEqual(body.parties.vendors[1].linkedAccounts, [{
      accountCode: '211102001',
      accountName: 'الموردون الخارجيون',
      analyticalAccountCode: '20001',
      analyticalAccountName: 'مورد خارجي',
      analyticalType: 4,
      currencyCodes: ['YER'],
    }]);
    assert.deepEqual(body.parties.vendors[2].linkedAccounts, []);
    assert.deepEqual(body.parties.employees[0].linkedAccounts, [{
      accountCode: '116101001',
      accountName: 'الموظفون',
      analyticalAccountCode: '1',
      analyticalAccountName: 'عبد الرحمن مطهر القلصي',
      analyticalType: 7,
      currencyCodes: ['R s'],
    }]);
    assert.deepEqual(body.parties.employees[1].linkedAccounts, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('returns a unified SELECT-only approval list including inventory transfers', async () => {
  const db = {
    async select(sql) {
      if (sql.includes('.P_REQUEST ')) return { rows: [{
        REQUEST_KIND: 'purchase', REQUEST_NO: '3', REQUEST_SERIAL: '20190000013', DESCRIPTION: 'شراء',
        MASTER_APPROVED: 1, INACTIVE: 0, CREATED_AT: '2026-08-24 02:07:02',
        APPROVAL_LEVEL: 1, APPROVAL_CODE: 1, APPROVAL_USER_ID: '1', APPROVAL_DATE: '2026-08-24 02:09:26',
      }] };
      if (sql.includes('.IAS_OUT_REQUEST_MST ')) return { rows: [{
        REQUEST_KIND: 'inventory_transfer', REQUEST_NO: '4', REQUEST_SERIAL: '20190000014', DESCRIPTION: 'تحويل',
        MASTER_APPROVED: 0, INACTIVE: 0, CREATED_AT: '2026-08-23 17:31:19',
        APPROVAL_LEVEL: 1, APPROVAL_CODE: 0, APPROVAL_USER_ID: null, APPROVAL_DATE: null,
      }] };
      return { rows: [] };
    },
  };
  const server = http.createServer(createHandler(catalogConfig, db));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/requests/created?schema=IAS20191&limit=20`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.oracleWrite, 'NONE');
    assert.deepEqual(body.items.map((item) => [item.kind, item.status]), [
      ['purchase', 'approved'], ['inventory_transfer', 'pending_approval'],
    ]);
    const purchasesOnly = await fetch(`http://127.0.0.1:${port}/requests/created?schema=IAS20191&limit=20&kind=purchase`, {
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(purchasesOnly.status, 200);
    assert.deepEqual((await purchasesOnly.json()).items.map((item) => item.kind), ['purchase']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
