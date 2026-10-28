'use strict';

const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');

const SCHEMAS = ['IAS20191', 'IAS20261'];
const TABLES = {
  master: 'STK_ADJUSTMENT',
  detail: 'STK_ADJUSTMENT_DET',
};

const MASTER_COLUMNS = [
  'STK_TYPE',
  'ADJUST_TYPE',
  'DOC_NO',
  'DOC_SER',
  'DOC_DATE',
  'REF_NO',
  'STK_DESC',
  'STK_POST',
  'HUNG',
  'FILL_TYPE',
  'AD_U_ID',
  'AD_DATE',
  'UP_U_ID',
  'UP_DATE',
  'UP_CNT',
  'POST_U_ID',
  'POST_DATE',
  'UNPOST_U_ID',
  'UNPOST_DATE',
  'CMP_NO',
  'BRN_NO',
  'BRN_YEAR',
  'BRN_USR',
  'AD_TRMNL_NM',
  'UP_TRMNL_NM',
];

const DETAIL_COLUMNS = [
  'ADJUST_TYPE',
  'DOC_NO',
  'DOC_SER',
  'RCRD_NO',
  'I_CODE',
  'W_CODE',
  'ITM_UNT',
  'P_SIZE',
  'P_QTY',
  'PLS_MINS',
  'MAN_P_QTY',
  'AVL_QTY',
  'MAN_AVL_PQTY',
  'PI_PRICE',
  'PI_I_QTY',
  'PR_I_QTY',
  'INC_QTY',
  'INC_COST',
  'BAL_QTY',
  'REAL_COST',
  'EXPIRE_DATE',
  'BATCH_NO',
  'BARCODE',
  'CMP_NO',
  'BRN_NO',
  'BRN_YEAR',
  'BRN_USR',
];

function qualified(schema, table) {
  if (!SCHEMAS.includes(schema) || !Object.values(TABLES).includes(table)) {
    throw new Error('Rejected non-allowlisted Oracle object');
  }
  return `${schema}.${table}`;
}

async function visibleColumns(db, schema, table, candidates) {
  const binds = Object.fromEntries([
    ['owner', schema],
    ['tableName', table],
    ...candidates.map((column, index) => [`column${index}`, column]),
  ]);
  const placeholders = candidates.map((_, index) => `:column${index}`).join(', ');
  const result = await db.select(`SELECT COLUMN_NAME
FROM ALL_TAB_COLUMNS
WHERE OWNER = :owner
  AND TABLE_NAME = :tableName
  AND COLUMN_NAME IN (${placeholders})
ORDER BY COLUMN_ID`, binds);
  const visible = new Set(result.rows.map((row) => row.COLUMN_NAME));
  return candidates.filter((column) => visible.has(column));
}

async function snapshotTable(db, schema, table, candidates, rowLimit) {
  const columns = await visibleColumns(db, schema, table, candidates);
  if (columns.length === 0) {
    return {
      table,
      readable: false,
      columns: [],
      summary: null,
      recentRows: [],
      error: 'No selected columns are visible to ALBINAA_RO',
    };
  }

  const objectName = qualified(schema, table);
  const summaryResult = await db.select(`SELECT COUNT(*) AS ROW_COUNT,
       TO_CHAR(MAX(DOC_SER), 'FM99999999999999999999999999999999999999') AS MAX_DOC_SER,
       MAX(DOC_NO) AS MAX_DOC_NO
FROM ${objectName}`);
  const orderColumns = ['DOC_SER', 'DOC_NO', 'RCRD_NO'].filter((column) => columns.includes(column));
  const orderClause = orderColumns.length > 0
    ? `ORDER BY ${orderColumns.map((column) => `${column} DESC`).join(', ')}`
    : '';
  const recentResult = await db.select(`SELECT *
FROM (
  SELECT ${columns.join(', ')}
  FROM ${objectName}
  ${orderClause}
)
WHERE ROWNUM <= :rowLimit`, { rowLimit });

  return {
    table,
    readable: true,
    columns,
    summary: summaryResult.rows[0] ?? null,
    recentRows: recentResult.rows,
    error: null,
  };
}

async function snapshotSchema(db, schema) {
  try {
    const master = await snapshotTable(db, schema, TABLES.master, MASTER_COLUMNS, 10);
    const detail = await snapshotTable(db, schema, TABLES.detail, DETAIL_COLUMNS, 30);
    return {
      schema,
      master,
      detail,
      conclusionGate: master.readable && detail.readable
        ? (schema === 'IAS20191'
          ? 'BASELINE_READY_FOR_ONE_UNPOSTED_YEMENSOFT_SAMPLE'
          : 'PRODUCTION_REFERENCE_CAPTURED_SELECT_ONLY')
        : 'STOCK_ADJUSTMENT_TABLES_NOT_READABLE',
    };
  } catch (error) {
    return {
      schema,
      error: error.message,
      errorNum: error.errorNum ?? null,
      conclusionGate: 'STOCK_ADJUSTMENT_BASELINE_FAILED',
    };
  }
}

async function main() {
  const config = loadConfig();
  oracledb.fetchAsString = [oracledb.NUMBER];
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  try {
    const schemas = [];
    for (const schema of SCHEMAS) schemas.push(await snapshotSchema(db, schema));
    const testSchemaReady = schemas.find((entry) => entry.schema === 'IAS20191')?.conclusionGate
      === 'BASELINE_READY_FOR_ONE_UNPOSTED_YEMENSOFT_SAMPLE';
    console.log(JSON.stringify({
      success: true,
      mode: 'SELECT_ONLY',
      oracleWrite: 'NONE',
      screen: 'INVT008.230',
      purpose: 'CAPTURE_STOCK_ADJUSTMENT_BASELINE_BEFORE_YEMENSOFT_SAMPLE',
      capturedAt: new Date().toISOString(),
      schemas,
      nextGate: testSchemaReady
        ? 'CREATE_ONE_UNPOSTED_IAS20191_SAMPLE_IN_YEMENSOFT_THEN_COMPARE'
        : 'FIX_IAS20191_SELECT_VISIBILITY_BEFORE_ANY_SAMPLE',
      cautions: [
        'This captures existing rows only and does not prove the screen mapping by itself.',
        'Create no sample in IAS20261; it remains production SELECT-only.',
        'Do not post the IAS20191 sample until the saved master/detail rows are verified.',
        'No INSERT, UPDATE, DELETE, MERGE, procedure, sequence, commit, or Oracle write was executed.',
      ],
    }, null, 2));
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ success: false, error: error.message, errorNum: error.errorNum ?? null }));
    process.exitCode = 1;
  });
}

module.exports = {
  SCHEMAS,
  snapshotSchema,
};
