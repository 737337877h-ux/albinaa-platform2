'use strict';

const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');

const NUMBER_COLUMNS = ['PR_NO', 'PRQ_NO', 'P_REQ_NO', 'REQ_NO', 'REQUEST_NO', 'DOC_NO'];
const SERIAL_COLUMNS = ['PR_SER', 'PRQ_SER', 'P_REQ_SER', 'REQ_SER', 'REQUEST_SER', 'DOC_SER'];

function firstPresent(columns, preferred) {
  return preferred.find((column) => columns.includes(column)) || null;
}

async function main() {
  const requestNo = Number(process.argv[2] || 1);
  if (!Number.isSafeInteger(requestNo) || requestNo < 1) throw new Error('Request number must be a positive integer');
  const config = loadConfig();
  const schema = config.oracle.defaultSchema;
  if (schema !== 'IAS20191') throw new Error('This diagnostic is restricted to IAS20191');
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  try {
    const metadata = await db.select(`
      SELECT TABLE_NAME, COLUMN_ID, COLUMN_NAME, DATA_TYPE, DATA_LENGTH, NULLABLE
      FROM ALL_TAB_COLUMNS
      WHERE OWNER=:schema AND TABLE_NAME IN ('P_REQUEST','P_REQUEST_DETAIL','S_APPRVD_MOV')
      ORDER BY TABLE_NAME, COLUMN_ID`, { schema });
    const columnsByTable = new Map();
    for (const row of metadata.rows) {
      if (!columnsByTable.has(row.TABLE_NAME)) columnsByTable.set(row.TABLE_NAME, []);
      columnsByTable.get(row.TABLE_NAME).push(row.COLUMN_NAME);
    }

    const masterColumns = columnsByTable.get('P_REQUEST') || [];
    const masterNumberColumn = firstPresent(masterColumns, NUMBER_COLUMNS);
    if (!masterNumberColumn) throw new Error('Purchase request number column was not identified');
    const master = await db.select(`
      SELECT * FROM ${schema}.P_REQUEST WHERE ${masterNumberColumn}=:requestNo`, { requestNo });
    const masterRow = master.rows[0] || null;
    const masterSerialColumn = firstPresent(masterColumns, SERIAL_COLUMNS);
    const requestSerial = masterRow && masterSerialColumn ? masterRow[masterSerialColumn] : null;

    const detailColumns = columnsByTable.get('P_REQUEST_DETAIL') || [];
    const detailSerialColumn = firstPresent(detailColumns, SERIAL_COLUMNS);
    const detailNumberColumn = firstPresent(detailColumns, NUMBER_COLUMNS);
    let detailRows = [];
    if (requestSerial != null && detailSerialColumn) {
      detailRows = (await db.select(`
        SELECT * FROM ${schema}.P_REQUEST_DETAIL WHERE ${detailSerialColumn}=:requestSerial`, { requestSerial })).rows;
    } else if (detailNumberColumn) {
      detailRows = (await db.select(`
        SELECT * FROM ${schema}.P_REQUEST_DETAIL WHERE ${detailNumberColumn}=:requestNo`, { requestNo })).rows;
    }

    const approvalRows = requestSerial == null ? [] : (await db.select(`
      SELECT * FROM ${schema}.S_APPRVD_MOV WHERE DOC_SER=:requestSerial
      ORDER BY ORDR_NO, LVL_NO`, { requestSerial })).rows;

    console.log(JSON.stringify({
      mode: 'SELECT_ONLY', schema, screen: 'APST001', requestNo,
      detected: { masterNumberColumn, masterSerialColumn, detailNumberColumn, detailSerialColumn, requestSerial },
      metadata: metadata.rows,
      master: masterRow,
      details: detailRows,
      approvalRows,
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message, errorNum: error.errorNum ?? null }));
  process.exitCode = 1;
});
