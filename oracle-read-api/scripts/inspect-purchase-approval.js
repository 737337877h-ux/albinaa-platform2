'use strict';

const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');

async function main() {
  const requestNo = Number(process.argv[2] || 1);
  if (!Number.isSafeInteger(requestNo) || requestNo < 1) throw new Error('Request number must be a positive integer');
  const config = loadConfig();
  const schema = config.oracle.defaultSchema;
  if (schema !== 'IAS20191') throw new Error('This diagnostic is restricted to IAS20191');
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  try {
    const master = await db.select(`
      SELECT PR_NO, PR_SER, PR_TYPE, APPROVED, APRV_U_ID, APRV_DATE
      FROM ${schema}.P_REQUEST WHERE PR_NO=:requestNo`, { requestNo });
    const row = master.rows[0];
    if (!row) throw new Error('Purchase request was not found');
    const approvals = await db.select(`
      SELECT LVL_NO, DOC_TYP, DOC_SER, DOC_NO, APPRVD, APPRVD_U_ID, APPRVD_DATE, ORDR_NO
      FROM ${schema}.S_APPRVD_MOV
      WHERE DOC_SER=:requestSerial AND DOC_TYP IN (32,40)
      ORDER BY DOC_TYP, ORDR_NO, LVL_NO`, { requestSerial: row.PR_SER });
    console.log(JSON.stringify({ mode: 'SELECT_ONLY', schema, screen: 'APST001', master: row, candidates: approvals.rows }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message, errorNum: error.errorNum ?? null }));
  process.exitCode = 1;
});
