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
  oracledb.fetchAsString = [oracledb.NUMBER];
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  try {
    const masters = (await db.select(`
      SELECT * FROM ${schema}.IAS_RQ_JRNL_MST
      WHERE J_DOC_NO=:requestNo
      ORDER BY DOC_TYPE,JV_TYPE,J_SER`, { requestNo })).rows;
    const matches = [];
    for (const master of masters) {
      const requestSerial = String(master.J_SER);
      const details = (await db.select(`
        SELECT * FROM ${schema}.IAS_RQ_JRNL_DTL
        WHERE J_SER=TO_NUMBER(:requestSerial)
        ORDER BY RCRD_NO,RCRD_NO_ORD`, { requestSerial })).rows;
      const approvalRows = (await db.select(`
        SELECT LVL_NO,DOC_TYP,
               TO_CHAR(DOC_SER,'FM99999999999999999999999999999999999999') DOC_SER,
               DOC_NO,DOC_JV_TYP,DOC_DATE,DOC_AMT,APPRVD,APPRVD_U_ID,APPRVD_DATE,ORDR_NO
        FROM ${schema}.S_APPRVD_MOV
        WHERE DOC_SER=TO_NUMBER(:requestSerial)
        ORDER BY DOC_TYP,ORDR_NO,LVL_NO`, { requestSerial })).rows;
      matches.push({ requestSerial, master, details, approvalRows });
    }
    console.log(JSON.stringify({
      mode: 'SELECT_ONLY', schema, screen: 'GLST017.298', requestNo, matches,
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message, errorNum: error.errorNum ?? null }));
  process.exitCode = 1;
});
