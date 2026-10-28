'use strict';

const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');

const SCHEMA = 'IAS20191';
const CANDIDATE_TABLES = [
  'IAS_INV_MANAGEMENT',
  'IAS_INV_MANAGEMENT_TMP',
  'IAS_ITEMS_COLLECT_TMP',
  'IAS_ITEMS_STORE_TMP',
  'IAS_ITEMS_NOT_STORE_TMP',
];

function qualified(table) {
  if (!CANDIDATE_TABLES.includes(table)) throw new Error('Rejected non-allowlisted Oracle object');
  return `${SCHEMA}.${table}`;
}

async function inspectTable(db, table, documentNo) {
  const columnsResult = await db.select(`SELECT COLUMN_ID, COLUMN_NAME, DATA_TYPE, NULLABLE
FROM ALL_TAB_COLUMNS
WHERE OWNER = :owner
  AND TABLE_NAME = :tableName
ORDER BY COLUMN_ID`, { owner: SCHEMA, tableName: table });
  const columns = columnsResult.rows;
  if (columns.length === 0) {
    return {
      table,
      readable: false,
      columns: [],
      rows: [],
      error: 'Object metadata is not visible to ALBINAA_RO',
    };
  }

  const columnNames = new Set(columns.map((column) => column.COLUMN_NAME));
  if (!columnNames.has('DOC_NO')) {
    return {
      table,
      readable: true,
      columns,
      rows: [],
      error: 'DOC_NO is not available for the bounded sample lookup',
    };
  }

  try {
    const result = await db.select(`SELECT *
FROM ${qualified(table)}
WHERE DOC_NO = :documentNo
  AND ROWNUM <= 50`, { documentNo });
    return {
      table,
      readable: true,
      columns,
      rows: result.rows,
      error: null,
    };
  } catch (error) {
    return {
      table,
      readable: false,
      columns,
      rows: [],
      error: error.message,
      errorNum: error.errorNum ?? null,
    };
  }
}

async function main() {
  const documentNo = Number(process.env.INVT008_DOCUMENT_NO || 3);
  if (!Number.isSafeInteger(documentNo) || documentNo <= 0) {
    throw new Error('INVT008 document number must be a positive integer');
  }

  const config = loadConfig();
  oracledb.fetchAsString = [oracledb.NUMBER];
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  try {
    const candidates = [];
    for (const table of CANDIDATE_TABLES) {
      candidates.push(await inspectTable(db, table, documentNo));
    }
    const matches = candidates.filter((candidate) => candidate.rows.length > 0);
    const persistentMatch = matches.some((candidate) => candidate.table === 'IAS_INV_MANAGEMENT');

    console.log(JSON.stringify({
      success: true,
      mode: 'SELECT_ONLY',
      oracleWrite: 'NONE',
      screen: 'INVT008.230',
      schema: SCHEMA,
      documentNo,
      purpose: 'FIND_YEMENSOFT_MANUAL_INVENTORY_SAMPLE_ROWS',
      candidates,
      matchingTables: matches.map((candidate) => candidate.table),
      mappingProven: persistentMatch,
      nextGate: persistentMatch
        ? 'REVIEW_IAS_INV_MANAGEMENT_FIELDS_AND_DOCUMENT_LIFECYCLE'
        : 'REVIEW_OTHER_TABLES_OR_CAPTURE_YEMENSOFT_SQL_EVIDENCE',
      cautions: [
        'Temporary-table rows can be session-specific and are not a durable integration source.',
        'The saved IAS20191 sample must remain unposted until its lifecycle is verified.',
        'IAS20261 was not queried and no production data was changed.',
        'No INSERT, UPDATE, DELETE, MERGE, procedure, sequence, commit, or Oracle write was executed.',
      ],
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ success: false, error: error.message, errorNum: error.errorNum ?? null }));
  process.exitCode = 1;
});
