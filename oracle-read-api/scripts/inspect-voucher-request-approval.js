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
      SELECT VOUCHER_TYPE,VOUCHER_PAY_TYPE,VOUCHER_NO,
             TO_CHAR(V_SER,'FM99999999999999999999999999999999999999') V_SER,
             DOC_TYPE,APPROVED,APRV_U_ID,APRV_DATE,PROCESED,CASH_AMT,CASH_AMTF,A_CY
      FROM ${schema}.IAS_RQ_VCHR_MST
      WHERE VOUCHER_NO=:requestNo
      ORDER BY DOC_TYPE,VOUCHER_TYPE,VOUCHER_PAY_TYPE`, { requestNo })).rows;
    const candidates = [];
    for (const master of masters) {
      const approvalRows = (await db.select(`
        SELECT LVL_NO,DOC_TYP,
               TO_CHAR(DOC_SER,'FM99999999999999999999999999999999999999') DOC_SER,
               DOC_NO,DOC_JV_TYP,DOC_AMT,APPRVD,APPRVD_U_ID,APPRVD_DATE,ORDR_NO
        FROM ${schema}.S_APPRVD_MOV
        WHERE DOC_SER=TO_NUMBER(:requestSerial)
        ORDER BY DOC_TYP,ORDR_NO,LVL_NO`, { requestSerial: master.V_SER })).rows;
      candidates.push({ master, approvalRows });
    }
    console.log(JSON.stringify({
      mode: 'SELECT_ONLY', schema, screen: 'GLST018.300', requestNo, candidates,
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message, errorNum: error.errorNum ?? null }));
  process.exitCode = 1;
});
