'use strict';

// SELECT-only value sampling for fields displayed by INVI008.

const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');

const itemCode = String(process.argv[2] || '111100101003').trim();
if (!/^[A-Za-z0-9._/-]{1,30}$/.test(itemCode)) {
  throw new Error('Invalid item code');
}

async function main() {
  const config = loadConfig();
  const schema = config.oracle.defaultSchema;
  const database = new OracleReadPool(oracledb, config.oracle);
  await database.start();

  try {
    const [details, availability, recentMovements, movementSummary, currencies] = await Promise.all([
      database.select(`SELECT I_CODE AS ITEM_CODE, MAX(I_NAME) AS NAME_AR, MAX(I_DESC) AS DESCRIPTION_AR,
       MAX(PRIMARY_COST) AS PRIMARY_COST, MAX(I_CWTAVG) AS WEIGHTED_AVERAGE_COST,
       MAX(VNDR_PRICE) AS VENDOR_PRICE, MAX(MARK_ITM) AS BRAND, MAX(COMPANY_ITM) AS MANUFACTURER
FROM ${schema}.ITEM_DETAILS
WHERE I_CODE = :itemCode
GROUP BY I_CODE`, { itemCode }),
      database.select(`SELECT TO_CHAR(W_CODE) AS WAREHOUSE_CODE, ITM_UNT AS UNIT_NAME,
       I_PRICE AS CURRENT_SALE_PRICE, AVL_QTY AS AVAILABLE_QUANTITY, RSRV_QTY AS RESERVED_QUANTITY
FROM ${schema}.IAS_V_ITM_AVLQTY
WHERE I_CODE = :itemCode
ORDER BY W_CODE, ITM_UNT`, { itemCode }),
      database.select(`SELECT * FROM (
  SELECT DOC_TYPE, BILL_DOC_TYPE, TO_CHAR(DOC_NO) AS DOCUMENT_NUMBER,
       TO_CHAR(DOC_SER, 'FM99999999999999999999999999999999999999') AS DOCUMENT_SERIAL,
       TO_CHAR(I_DATE, 'YYYY-MM-DD') AS MOVEMENT_DATE, I_QTY, P_SIZE, P_QTY,
       I_COST, STK_COST, A_CY AS CURRENCY_CODE, AC_RATE AS EXCHANGE_RATE,
       IN_OUT, TO_CHAR(W_CODE) AS WAREHOUSE_CODE, TO_CHAR(C_CODE) AS CUSTOMER_CODE,
       TO_CHAR(V_CODE) AS VENDOR_CODE
  FROM ${schema}.ITEM_MOVEMENT
  WHERE I_CODE = :itemCode
  ORDER BY I_DATE DESC, DOC_SEQUENCE DESC
) WHERE ROWNUM <= 30`, { itemCode }),
      database.select(`SELECT IN_OUT, DOC_TYPE, BILL_DOC_TYPE, A_CY AS CURRENCY_CODE,
       COUNT(*) AS MOVEMENT_COUNT, MIN(I_DATE) AS FIRST_DATE, MAX(I_DATE) AS LAST_DATE,
       SUM(NVL(P_QTY, 0)) AS PRIMARY_QUANTITY, SUM(NVL(I_COST, 0) * NVL(I_QTY, 0)) AS VALUE_SUM,
       SUM(NVL(I_QTY, 0)) AS ITEM_QUANTITY
FROM ${schema}.ITEM_MOVEMENT
WHERE I_CODE = :itemCode
GROUP BY IN_OUT, DOC_TYPE, BILL_DOC_TYPE, A_CY
ORDER BY IN_OUT, DOC_TYPE, BILL_DOC_TYPE, A_CY`, { itemCode }),
      database.select(`SELECT CUR_CODE AS CURRENCY_CODE, CUR_NAME AS CURRENCY_NAME,
       NVL(STOCK_CUR, 0) AS STOCK_CURRENCY
FROM ${schema}.EX_RATE
ORDER BY CUR_NO`),
    ]);

    process.stdout.write(`${JSON.stringify({
      schema,
      sessionUser: config.oracle.user,
      mode: 'SELECT_ONLY_SAMPLE',
      itemCode,
      details: details.rows[0] ?? null,
      availability: availability.rows,
      recentMovements: recentMovements.rows,
      movementSummary: movementSummary.rows,
      currencies: currencies.rows,
    }, null, 2)}\n`);
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
