'use strict';

const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');

const MASTER_NUMBER_COLUMNS = ['VOUCHER_NO', 'REQ_NO', 'RQ_NO', 'DOC_NO'];
const MASTER_SERIAL_COLUMNS = ['V_SER', 'VOUCHER_SER', 'REQ_SER', 'RQ_SER', 'DOC_SER'];
const DETAIL_NUMBER_COLUMNS = ['VOUCHER_NO', 'REQ_NO', 'RQ_NO', 'DOC_NO'];
const DETAIL_SERIAL_COLUMNS = ['V_SER', 'CONN_V_SER', 'VOUCHER_SER', 'REQ_SER', 'RQ_SER', 'DOC_SER'];

function firstPresent(columns, preferred) {
  return preferred.find((column) => columns.includes(column)) || null;
}

async function main() {
  const requestNo = Number(process.argv[2] || 1);
  if (!Number.isSafeInteger(requestNo) || requestNo < 1) throw new Error('Request number must be a positive integer');
  const config = loadConfig();
  const schema = config.oracle.defaultSchema;
  if (schema !== 'IAS20191') throw new Error('This diagnostic is restricted to IAS20191');
  oracledb.fetchAsString = [oracledb.NUMBER];
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  try {
    const metadata = await db.select(`
      SELECT TABLE_NAME, COLUMN_ID, COLUMN_NAME, DATA_TYPE, DATA_LENGTH, NULLABLE
      FROM ALL_TAB_COLUMNS
      WHERE OWNER=:schema AND TABLE_NAME IN ('IAS_RQ_VCHR_MST','IAS_RQ_VCHR_DTL','S_APPRVD_MOV')
      ORDER BY TABLE_NAME, COLUMN_ID`, { schema });
    const columnsByTable = new Map();
    for (const row of metadata.rows) {
      if (!columnsByTable.has(row.TABLE_NAME)) columnsByTable.set(row.TABLE_NAME, []);
      columnsByTable.get(row.TABLE_NAME).push(row.COLUMN_NAME);
    }

    const masterColumns = columnsByTable.get('IAS_RQ_VCHR_MST') || [];
    const masterNumberColumn = firstPresent(masterColumns, MASTER_NUMBER_COLUMNS);
    const masterSerialColumn = firstPresent(masterColumns, MASTER_SERIAL_COLUMNS);
    if (!masterNumberColumn) throw new Error('GL request number column was not identified');
    const masterRows = (await db.select(`
      SELECT * FROM ${schema}.IAS_RQ_VCHR_MST
      WHERE ${masterNumberColumn}=:requestNo`, { requestNo })).rows;

    const detailColumns = columnsByTable.get('IAS_RQ_VCHR_DTL') || [];
    const detailNumberColumn = firstPresent(detailColumns, DETAIL_NUMBER_COLUMNS);
    const detailSerialColumn = firstPresent(detailColumns, DETAIL_SERIAL_COLUMNS);
    const matches = [];
    for (const master of masterRows) {
      const requestSerial = masterSerialColumn ? master[masterSerialColumn] : null;
      let details = [];
      if (requestSerial != null && detailSerialColumn) {
        details = (await db.select(`
          SELECT * FROM ${schema}.IAS_RQ_VCHR_DTL
          WHERE ${detailSerialColumn}=:requestSerial`, { requestSerial })).rows;
      } else if (detailNumberColumn) {
        details = (await db.select(`
          SELECT * FROM ${schema}.IAS_RQ_VCHR_DTL
          WHERE ${detailNumberColumn}=:requestNo`, { requestNo })).rows;
      }
      const approvalRows = requestSerial == null ? [] : (await db.select(`
        SELECT * FROM ${schema}.S_APPRVD_MOV
        WHERE DOC_SER=:requestSerial
        ORDER BY DOC_TYP, ORDR_NO, LVL_NO`, { requestSerial })).rows;
      matches.push({ requestSerial, master, details, approvalRows });
    }

    console.log(JSON.stringify({
      mode: 'SELECT_ONLY', schema, screen: 'GLST018.300', requestNo,
      detected: { masterNumberColumn, masterSerialColumn, detailNumberColumn, detailSerialColumn },
      matches,
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message, errorNum: error.errorNum ?? null }));
  process.exitCode = 1;
});
