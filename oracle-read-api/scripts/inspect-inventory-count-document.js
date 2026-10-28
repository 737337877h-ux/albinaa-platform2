'use strict';

const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');

const SCHEMA = 'IAS20191';
const TABLES = ['MASTER_INV', 'DETAIL_INV', 'IAS_INV_TYPES', 'IAS_PRIV_INV_TYPE'];

function qualified(table) {
  if (!TABLES.includes(table)) throw new Error('Rejected non-allowlisted Oracle object');
  return `${SCHEMA}.${table}`;
}

async function columns(db, table) {
  const result = await db.select(`SELECT COLUMN_ID, COLUMN_NAME, DATA_TYPE, NULLABLE
FROM ALL_TAB_COLUMNS
WHERE OWNER = :owner
  AND TABLE_NAME = :tableName
ORDER BY COLUMN_ID`, { owner: SCHEMA, tableName: table });
  return result.rows;
}

async function safeRows(db, table, sql, binds) {
  try {
    const result = await db.select(sql, binds);
    return { table, readable: true, rows: result.rows, error: null };
  } catch (error) {
    return {
      table,
      readable: false,
      rows: [],
      error: error.message,
      errorNum: error.errorNum ?? null,
    };
  }
}

async function main() {
  const documentNo = Number(process.env.INVT008_DOCUMENT_NO || 3);
  const userId = Number(process.env.INVT008_USER_ID || 1);
  if (!Number.isSafeInteger(documentNo) || documentNo <= 0) throw new Error('Invalid document number');
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('Invalid user id');

  const config = loadConfig();
  oracledb.fetchAsString = [oracledb.NUMBER];
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  try {
    const tableColumns = {};
    for (const table of TABLES) tableColumns[table] = await columns(db, table);

    const master = await safeRows(
      db,
      'MASTER_INV',
      `SELECT * FROM ${qualified('MASTER_INV')} WHERE INV_NO = :documentNo AND ROWNUM <= 10`,
      { documentNo },
    );

    const masterSerials = master.rows
      .map((row) => row.INV_SER)
      .filter((value) => value !== null && value !== undefined);
    const detailColumnNames = new Set(tableColumns.DETAIL_INV.map((column) => column.COLUMN_NAME));
    let detail;
    if (detailColumnNames.has('INV_NO')) {
      detail = await safeRows(
        db,
        'DETAIL_INV',
        `SELECT * FROM ${qualified('DETAIL_INV')} WHERE INV_NO = :documentNo AND ROWNUM <= 100`,
        { documentNo },
      );
    } else if (detailColumnNames.has('INV_SER') && masterSerials.length > 0) {
      const serialBinds = Object.fromEntries(masterSerials.map((serial, index) => [`serial${index}`, serial]));
      const serialPlaceholders = masterSerials.map((_, index) => `:serial${index}`).join(', ');
      detail = await safeRows(
        db,
        'DETAIL_INV',
        `SELECT * FROM ${qualified('DETAIL_INV')} WHERE INV_SER IN (${serialPlaceholders}) AND ROWNUM <= 100`,
        serialBinds,
      );
    } else {
      detail = {
        table: 'DETAIL_INV',
        readable: tableColumns.DETAIL_INV.length > 0,
        rows: [],
        error: 'No bounded document key was available for the detail lookup',
      };
    }

    const inventoryTypes = await safeRows(
      db,
      'IAS_INV_TYPES',
      `SELECT * FROM ${qualified('IAS_INV_TYPES')} WHERE ROWNUM <= 100`,
      {},
    );
    const permissions = await safeRows(
      db,
      'IAS_PRIV_INV_TYPE',
      `SELECT * FROM ${qualified('IAS_PRIV_INV_TYPE')} WHERE U_ID = :userId AND ROWNUM <= 100`,
      { userId },
    );
    const mappingProven = master.rows.length > 0 && detail.rows.length > 0;

    console.log(JSON.stringify({
      success: true,
      mode: 'SELECT_ONLY',
      oracleWrite: 'NONE',
      screen: 'INVT008.230',
      schema: SCHEMA,
      documentNo,
      userId,
      purpose: 'VERIFY_MANUAL_INVENTORY_MASTER_DETAIL_AND_TYPE_PERMISSIONS',
      tableColumns,
      master,
      detail,
      inventoryTypes,
      permissions,
      mappingProven,
      nextGate: mappingProven
        ? 'DEFINE_READ_MODEL_DRY_RUN_AND_PLATFORM_PERMISSIONS_WITHOUT_POSTING'
        : 'FIX_SELECT_VISIBILITY_OR_DOCUMENT_KEY_LOOKUP',
      cautions: [
        'The sample remains an unposted IAS20191 YemenSoft document.',
        'Permission rows are evidence about YemenSoft user 1 only, not platform role authorization.',
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
