'use strict';

const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');

const checks = [
  {
    name: 'cashbox',
    sql: `SELECT H.A_CODE AS ACCOUNT_CODE
FROM IAS20261.PRIV_CASH P
JOIN IAS20261.CASH_IN_HAND H ON H.CASH_NO=P.CASH_NO
WHERE P.U_ID=:oracleUserId AND P.CASH_TYPE=1 AND NVL(P.RCVD,0)=1
  AND P.CASH_NO=:cashOrBankNo AND NVL(H.INACTIVE,0)=0
  AND (H.CONN_BRN_NO IS NULL OR H.CONN_BRN_NO=1) AND ROWNUM=1`,
    binds: { oracleUserId: 1, cashOrBankNo: 101 },
  },
  {
    name: 'cashboxCurrency',
    sql: `SELECT 1 AS ALLOWED FROM IAS20261.ACCOUNT_CURR
WHERE A_CODE='111101002' AND A_CY=:currencyCode AND NVL(INACTIVE,0)=0 AND ROWNUM=1`,
    binds: { currencyCode: 'SR' },
  },
  {
    name: 'collector',
    sql: `SELECT 1 AS ALLOWED FROM IAS20261.COLLERCTOR
WHERE COL_NO=:collectorNo AND NVL(INACTIVE,0)=0 AND ROWNUM=1`,
    binds: { collectorNo: 1 },
  },
  {
    name: 'customerAccountCatalog',
    sql: `SELECT TO_CHAR(AC_CODE) AS ACCOUNT_CODE,TO_CHAR(AC_CODE_DTL) AS ANALYTICAL_ACCOUNT_CODE,
       GRP_CODE AS ANALYTICAL_TYPE,TO_CHAR(CONN_BRN_NO) AS CONNECTION_BRANCH
FROM IAS20261.GLS_ACCNT_DTL
WHERE AC_CODE=:accountCode AND AC_CODE_DTL=:analyticalAccountCode
  AND (CONN_BRN_NO IS NULL OR CONN_BRN_NO=1) AND ROWNUM=1`,
    binds: { accountCode: '112101001', analyticalAccountCode: '10001' },
  },
  {
    name: 'customerAccount',
    sql: `SELECT 1 AS VALID_ACCOUNT FROM IAS20261.GLS_ACCNT_DTL
WHERE AC_CODE=:accountCode AND AC_CODE_DTL=:analyticalAccountCode
  AND GRP_CODE=:analyticalType
  AND (CONN_BRN_NO IS NULL OR CONN_BRN_NO=1) AND ROWNUM=1`,
    binds: { accountCode: '112101001', analyticalAccountCode: '10001', analyticalType: 3 },
  },
  {
    name: 'customerCurrency',
    sql: `SELECT 1 AS ALLOWED FROM IAS20261.CUSTOMER_CURR
WHERE C_CODE=:customerCode AND A_CY=:currencyCode AND NVL(INACTIVE,0)=0 AND ROWNUM=1`,
    binds: { customerCode: '10001', currencyCode: 'SR' },
  },
  {
    name: 'exchangeRate',
    sql: `SELECT CUR_CODE,CUR_RATE,L_F,CUR_FRC_NO
FROM IAS20261.EX_RATE WHERE CUR_CODE=:currencyCode`,
    binds: { currencyCode: 'SR' },
  },
  {
    name: 'dailyExchangeRate',
    sql: `SELECT CUR_RATE FROM IAS20261.IAS_PERIOD_EX_RATE_DAY
WHERE A_CY=:currencyCode AND BRN_NO=1 AND TRUNC(SYSDATE) BETWEEN F_DATE AND T_DATE
ORDER BY F_DATE DESC`,
    binds: { currencyCode: 'SR' },
  },
];

async function main() {
  const config = loadConfig();
  const pool = new OracleReadPool(oracledb, config.oracle);
  await pool.start();
  try {
    const results = [];
    for (const check of checks) {
      try {
        const result = await pool.select(check.sql, check.binds);
        results.push({ name: check.name, ok: true, rowCount: result.rows.length, evidence: result.rows[0] ?? null });
      } catch (error) {
        results.push({ name: check.name, ok: false, errorNum: error.errorNum ?? null, message: error.message });
      }
    }
    console.log(JSON.stringify({ mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema: 'IAS20261', checks: results }, null, 2));
    if (results.some((result) => !result.ok || result.rowCount < 1)) process.exitCode = 2;
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ mode: 'SELECT_ONLY', oracleWrite: 'NONE', errorNum: error.errorNum ?? null, message: error.message }));
  process.exitCode = 1;
});
