'use strict';

const fs = require('fs');
const path = require('path');
const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');
const {
  approvalRowsQuery,
  customerRequestKind,
  reservationRowsQueries,
} = require('../src/arst003-discovery');

const SCHEMA = 'IAS20191';
const requestNo = Number(process.env.ARST003_REQUEST_NO || 7);
const outputPath = process.env.ARST003_REVIEW_OUTPUT
  || path.join(__dirname, '..', 'tmp', `arst003-request-${requestNo}-review.json`);

function masterQuery() {
  return `SELECT SO_TYPE, ORDER_NO, ORDER_SER, ORDER_DATE, BILL_DOC_TYPE,
       C_CODE, C_NAME, C_MOBILE, MOBILE_NO, ORDER_CUR, CUR_RATE, ORDER_AMT,
       W_CODE, A_DESC, REF_DOC_NO, DELIVERY_DATE, APPROVED, APRV_U_ID,
       APRV_DATE, APRV_DSC, PROCESED, INACTIVE, BRN_NO, BRN_YEAR, CMP_NO,
       BRN_USR, AD_U_ID, AD_DATE, AD_TRMNL_NM
FROM ${SCHEMA}.SALES_ORDER
WHERE ORDER_NO = :requestNo
ORDER BY ORDER_SER`;
}

function detailQuery(masterRows) {
  const binds = {};
  const predicates = masterRows.map((row, index) => {
    binds[`orderSer${index}`] = row.ORDER_SER;
    binds[`soType${index}`] = row.SO_TYPE;
    binds[`orderNo${index}`] = row.ORDER_NO;
    binds[`brnNo${index}`] = row.BRN_NO;
    return `(ORDER_SER = :orderSer${index} AND SO_TYPE = :soType${index}
      AND ORDER_NO = :orderNo${index} AND BRN_NO = :brnNo${index})`;
  });
  return {
    sql: `SELECT SO_TYPE, ORDER_NO, ORDER_SER, RCRD_NO, DOC_SEQ, I_CODE,
       ITM_UNT, W_CODE, I_QTY, FREE_QTY, P_SIZE, P_QTY, I_PRICE,
       I_PRICE_VAT, VAT_PER, VAT_AMT, ITEM_DESC, BARCODE,
       BRN_NO, BRN_YEAR, CMP_NO, BRN_USR
FROM ${SCHEMA}.ORDER_DETAIL
WHERE ${predicates.join('\n   OR ')}
ORDER BY ORDER_SER, RCRD_NO`,
    binds,
  };
}

async function optionalSelect(db, query) {
  try {
    const result = await db.select(query.sql, query.binds);
    return { rows: result.rows, error: null };
  } catch (error) {
    return {
      rows: [],
      error: {
        message: error.message,
        errorNum: error.errorNum ?? null,
      },
    };
  }
}

function writeResult(payload) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(payload, null, 2));
  console.log(`\nSaved review: ${outputPath}`);
}

async function main() {
  if (!Number.isSafeInteger(requestNo) || requestNo < 1) {
    throw new Error('ARST003_REQUEST_NO must be a positive integer');
  }
  const config = loadConfig();
  if (config.oracle.defaultSchema !== SCHEMA) {
    throw new Error(`ARST003 review is restricted to ${SCHEMA}`);
  }
  oracledb.fetchAsString = [oracledb.NUMBER];
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  try {
    const masterRows = (await db.select(masterQuery(), { requestNo })).rows;
    const detailRows = masterRows.length
      ? (await db.select(detailQuery(masterRows).sql, detailQuery(masterRows).binds)).rows
      : [];
    const reservations = masterRows.length ? reservationRowsQueries(SCHEMA, masterRows) : null;
    const reservationMaster = reservations
      ? await optionalSelect(db, reservations.master)
      : { rows: [], error: null };
    const reservationDetail = reservations
      ? await optionalSelect(db, reservations.detail)
      : { rows: [], error: null };
    const approvalRows = masterRows.length
      ? await db.select(...Object.values(approvalRowsQuery(SCHEMA, masterRows)))
      : { rows: [] };
    const requestKinds = [...new Set(masterRows
      .map((row) => customerRequestKind(row.BILL_DOC_TYPE))
      .filter(Boolean))];
    const detailCounts = masterRows.map((master) => ({
      orderSerial: master.ORDER_SER,
      itemCount: detailRows.filter((detail) => String(detail.ORDER_SER) === String(master.ORDER_SER)).length,
    }));
    const approved = masterRows.length > 0
      && masterRows.every((row) => String(row.APPROVED) === '1')
      && approvalRows.rows.length > 0
      && approvalRows.rows.every((row) => String(row.APPRVD) === '1');

    writeResult({
      success: true,
      mode: 'SELECT_ONLY',
      oracleWrite: 'NONE',
      schema: SCHEMA,
      screen: 'ARST003',
      requestNo,
      found: masterRows.length > 0,
      requestKinds,
      masterRows,
      detailRows,
      detailCounts,
      reservationMasterRows: reservationMaster.rows,
      reservationDetailRows: reservationDetail.rows,
      reservationReadErrors: {
        master: reservationMaster.error,
        detail: reservationDetail.error,
      },
      reservationMappingVisible: reservationMaster.rows.length > 0
        && reservationDetail.rows.length > 0,
      approvalRows: approvalRows.rows,
      approved,
      cautions: [
        `Only request number ${requestNo}, its exact ORDER_SER keys, and reservations referencing DOC_TYPE_REF 53 were read from IAS20191.`,
        'A missing reservation row or SELECT privilege is reported and never replaced by an inferred mapping.',
        'No INSERT, UPDATE, DELETE, MERGE, procedure, sequence NEXTVAL, commit, or Oracle write was executed.',
      ],
    });
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  const payload = {
    success: false,
    mode: 'SELECT_ONLY',
    oracleWrite: 'NONE',
    schema: SCHEMA,
    screen: 'ARST003',
    requestNo,
    error: error.message,
    errorNum: error.errorNum ?? null,
  };
  writeResult(payload);
  process.exitCode = 1;
});
