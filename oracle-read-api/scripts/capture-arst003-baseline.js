'use strict';

const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');
const {
  candidateMetadataQuery,
  detailRowsQuery,
  groupMetadata,
  recentRowsQuery,
} = require('../src/arst003-discovery');

const SCHEMA = 'IAS20191';

async function summary(db, tableName) {
  const result = await db.select(`SELECT COUNT(*) AS ROW_COUNT,
       TO_CHAR(MAX(ORDER_SER), 'FM99999999999999999999999999999999999999') AS MAX_ORDER_SER,
       MAX(ORDER_NO) AS MAX_ORDER_NO
FROM ${SCHEMA}.${tableName}`);
  return result.rows[0] ?? null;
}

async function snapshot(db) {
  const metadata = await db.select(candidateMetadataQuery(), { owner: SCHEMA });
  const grouped = groupMetadata(metadata.rows);
  const masterColumns = grouped.get('SALES_ORDER') || [];
  const detailColumns = grouped.get('ORDER_DETAIL') || [];
  if (!masterColumns.length || !detailColumns.length) {
    throw new Error('SALES_ORDER and ORDER_DETAIL metadata must both be visible to ALBINAA_RO');
  }
  const masterResult = await db.select(
    recentRowsQuery(SCHEMA, 'SALES_ORDER', masterColumns, 50),
    { rowLimit: 50 },
  );
  const masterRows = masterResult.rows;
  let detailRows = [];
  if (masterRows.length) {
    const query = detailRowsQuery(SCHEMA, 'ORDER_DETAIL', detailColumns, masterRows, 500);
    detailRows = (await db.select(query.sql, query.binds)).rows;
  }
  return {
    masterColumns,
    detailColumns,
    master: {
      summary: await summary(db, 'SALES_ORDER'),
      recentRows: masterRows,
    },
    detail: {
      summary: await summary(db, 'ORDER_DETAIL'),
      recentRows: detailRows,
    },
  };
}

async function main() {
  const config = loadConfig();
  if (config.oracle.defaultSchema !== SCHEMA) {
    throw new Error(`ARST003 baseline capture is restricted to ${SCHEMA}`);
  }
  oracledb.fetchAsString = [oracledb.NUMBER];
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  try {
    console.log(JSON.stringify({
      success: true,
      mode: 'SELECT_ONLY',
      oracleWrite: 'NONE',
      schema: SCHEMA,
      screen: 'ARST003',
      purpose: 'CAPTURE_BASELINE_BEFORE_ONE_YEMENSOFT_CUSTOMER_REQUEST_SAMPLE',
      capturedAt: new Date().toISOString(),
      snapshot: await snapshot(db),
      nextGate: 'CREATE_ONE_UNAPPROVED_IAS20191_ARST003_SAMPLE_IN_YEMENSOFT_THEN_COMPARE',
      cautions: [
        'Create the sample only in IAS20191 and leave it unapproved until the comparison is complete.',
        'Do not create or change any IAS20261 row.',
        'No sequence value was read or allocated.',
        'No INSERT, UPDATE, DELETE, MERGE, procedure, commit, or Oracle write was executed.',
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

module.exports = { snapshot };
