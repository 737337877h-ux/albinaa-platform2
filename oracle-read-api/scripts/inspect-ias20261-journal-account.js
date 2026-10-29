'use strict';

// SELECT-only readiness check for a journal main account used by the platform.

const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');

const accountCode = String(process.argv[2] || '312401001').trim();
if (!/^\d{1,30}$/.test(accountCode)) throw new Error('Invalid account code');

async function main() {
  const config = loadConfig();
  const schema = config.oracle.defaultSchema;
  const database = new OracleReadPool(oracledb, config.oracle);
  await database.start();
  try {
    const [account, currencies, analyticalAccounts, recentUsage] = await Promise.all([
      database.select(`SELECT A_CODE AS ACCOUNT_CODE, A_NAME AS NAME_AR,
       A_GROUPING AS GROUPING_CODE, CLASS_NO, AC_DTL_TYP AS ANALYTICAL_TYPE
FROM ${schema}.ACCOUNT
WHERE A_CODE = :accountCode`, { accountCode }),
      database.select(`SELECT A_CODE AS ACCOUNT_CODE, A_CY AS CURRENCY_CODE, NVL(INACTIVE, 0) AS INACTIVE
FROM ${schema}.ACCOUNT_CURR
WHERE A_CODE = :accountCode
ORDER BY A_CY`, { accountCode }),
      database.select(`SELECT TO_CHAR(AC_CODE_DTL) AS ANALYTICAL_ACCOUNT_CODE,
       AC_CODE_DTL_L_NM AS NAME_AR, GRP_CODE AS ANALYTICAL_TYPE,
       TO_CHAR(CONN_BRN_NO) AS CONNECTION_BRANCH, NVL(INACTV, 0) AS INACTIVE
FROM ${schema}.GLS_ACCNT_DTL
WHERE AC_CODE = :accountCode
ORDER BY AC_CODE_DTL`, { accountCode }),
      database.select(`SELECT * FROM (
  SELECT TO_CHAR(J_SER, 'FM99999999999999999999999999999999999999') AS JOURNAL_SERIAL,
       TO_CHAR(AC_CODE_DTL) AS ANALYTICAL_ACCOUNT_CODE, AC_DTL_TYP AS ANALYTICAL_TYPE,
       A_CY AS CURRENCY_CODE, J_AMT AS AMOUNT_LOCAL, J_AMT_F AS AMOUNT_FOREIGN,
       J_DESC AS DESCRIPTION
  FROM ${schema}.IAS_RQ_JRNL_DTL
  WHERE A_CODE = :accountCode
  ORDER BY J_SER DESC, RCRD_NO DESC
) WHERE ROWNUM <= 10`, { accountCode }),
    ]);
    process.stdout.write(`${JSON.stringify({
      schema,
      sessionUser: config.oracle.user,
      mode: 'SELECT_ONLY',
      oracleWrite: 'NONE',
      accountCode,
      account: account.rows[0] ?? null,
      currencies: currencies.rows,
      analyticalAccounts: analyticalAccounts.rows,
      recentUsage: recentUsage.rows,
    }, null, 2)}\n`);
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
