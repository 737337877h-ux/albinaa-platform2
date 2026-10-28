'use strict';

const path = require('node:path');
const oracledb = require(path.resolve(__dirname, '../../oracle-read-api/node_modules/oracledb'));

const WRITER_USER = 'ALBINAAWRITER';
const TEST_SCHEMA = 'IAS20191';
const REQUEST_TYPE = 1;
const REQUEST_NO = 2;
const REQUEST_SERIAL = '20190000012';
const BRANCH_YEAR = 2019;
const SOURCE_WAREHOUSE = 1;
const DESTINATION_WAREHOUSE = 2;
const ITEM_CODE = '00101-01-01';
const ITEM_UNIT = 'حبة';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function one(connection, sql, binds = {}) {
  const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  return result.rows[0] || null;
}

async function main() {
  const password = required('ORACLE_TEST_WRITER_PASSWORD');
  if (password.length < 12) {
    throw new Error('A weak test-writer password is rejected; change it to at least 12 characters');
  }

  oracledb.initOracleClient({ libDir: required('ORACLE_CLIENT_LIB_DIR') });
  const connection = await oracledb.getConnection({
    user: WRITER_USER,
    password,
    connectString: required('ORACLE_CONNECT_STRING'),
  });

  try {
    const identity = await one(connection, "SELECT SYS_CONTEXT('USERENV','SESSION_USER') SESSION_USER FROM DUAL");
    if (identity?.SESSION_USER !== WRITER_USER) throw new Error('Unexpected Oracle session user');

    const state = await one(connection, `
      SELECT COUNT(*) REQUEST_COUNT,
             NVL(MAX(OUT_REQ_NO),0) MAX_REQUEST_NO,
             NVL(MAX(OUT_REQ_SER),0) MAX_REQUEST_SERIAL
      FROM ${TEST_SCHEMA}.IAS_OUT_REQUEST_MST
      WHERE OUT_REQ_TYPE = :requestType`, { requestType: REQUEST_TYPE });
    if (Number(state.REQUEST_COUNT) !== 1 || Number(state.MAX_REQUEST_NO) !== 1 || String(state.MAX_REQUEST_SERIAL) !== '20190000011') {
      throw new Error('IAS20191 request state changed; expected only the official request number 1');
    }

    const duplicate = await one(connection, `
      SELECT COUNT(*) DUPLICATE_COUNT
      FROM ${TEST_SCHEMA}.IAS_OUT_REQUEST_MST
      WHERE OUT_REQ_NO = :requestNo OR OUT_REQ_SER = :requestSerial`,
    { requestNo: REQUEST_NO, requestSerial: REQUEST_SERIAL });
    if (Number(duplicate.DUPLICATE_COUNT) !== 0) throw new Error('Test request number 2 already exists');

    const warehouses = await one(connection, `
      SELECT COUNT(*) WAREHOUSE_COUNT
      FROM ${TEST_SCHEMA}.WAREHOUSE_DETAILS
      WHERE W_CODE IN (:sourceWarehouse, :destinationWarehouse)
        AND NVL(INACTIVE,0) = 0`,
    { sourceWarehouse: SOURCE_WAREHOUSE, destinationWarehouse: DESTINATION_WAREHOUSE });
    if (Number(warehouses.WAREHOUSE_COUNT) !== 2) throw new Error('The two IAS20191 test warehouses are not available');

    const item = await one(connection, `
      SELECT P_SIZE
      FROM ${TEST_SCHEMA}.ITEM_DETAILS
      WHERE I_CODE = :itemCode AND ITM_UNT = :itemUnit AND NVL(INACTIVE,0) = 0`,
    { itemCode: ITEM_CODE, itemUnit: ITEM_UNIT });
    if (!item || Number(item.P_SIZE) !== 1) throw new Error('The IAS20191 test item/unit is not available');

    const sequence = await one(connection, `SELECT ${TEST_SCHEMA}.IAS_DOC_SEQ_OTHR.NEXTVAL DOC_SEQUENCE FROM DUAL`);

    await connection.execute(`
      INSERT INTO ${TEST_SCHEMA}.IAS_OUT_REQUEST_MST (
        OUT_REQ_TYPE, OUT_REQ_NO, OUT_REQ_SER, OUT_REQ_DATE, W_CODE, F_W_CODE,
        REQ_SIDE, DOC_DESC, PROCESSED, INACTIVE, APPROVED, AD_U_ID, AD_DATE,
        EXTERNAL_POST, CMP_NO, BRN_NO, BRN_YEAR, BRN_USR, AD_TRMNL_NM
      ) VALUES (
        :requestType, :requestNo, :requestSerial, TO_DATE(:requestDate,'YYYY-MM-DD'),
        :sourceWarehouse, :destinationWarehouse, :requestSide, :description,
        0, 0, 0, 1, SYSDATE, 0, 1, 1, :branchYear, 1, :terminalName
      )`, {
      requestType: REQUEST_TYPE,
      requestNo: REQUEST_NO,
      requestSerial: REQUEST_SERIAL,
      requestDate: '2020-12-31',
      sourceWarehouse: SOURCE_WAREHOUSE,
      destinationWarehouse: DESTINATION_WAREHOUSE,
      requestSide: 'منصة البناء الراقي',
      description: 'تجربة كتابة تكامل - غير معتمد',
      branchYear: BRANCH_YEAR,
      terminalName: 'ALBINAA-INTEGRATION',
    }, { autoCommit: false });

    await connection.execute(`
      INSERT INTO ${TEST_SCHEMA}.IAS_OUT_REQUEST_DTL (
        OUT_REQ_TYPE, OUT_REQ_NO, OUT_REQ_SER, I_CODE, ITM_UNT, I_QTY, P_SIZE,
        P_QTY, W_CODE, RCRD_NO, EXTERNAL_POST, USE_ATTCH, DOC_SEQUENCE,
        AVL_QTY, F_AVL_QTY, F_W_CODE, CMP_NO, BRN_NO, BRN_YEAR, BRN_USR
      ) VALUES (
        :requestType, :requestNo, :requestSerial, :itemCode, :itemUnit, 1, 1,
        1, :sourceWarehouse, 1, 0, 0, :documentSequence, 0, 0,
        :destinationWarehouse, 1, 1, :branchYear, 1
      )`, {
      requestType: REQUEST_TYPE,
      requestNo: REQUEST_NO,
      requestSerial: REQUEST_SERIAL,
      itemCode: ITEM_CODE,
      itemUnit: ITEM_UNIT,
      sourceWarehouse: SOURCE_WAREHOUSE,
      destinationWarehouse: DESTINATION_WAREHOUSE,
      documentSequence: sequence.DOC_SEQUENCE,
      branchYear: BRANCH_YEAR,
    }, { autoCommit: false });

    const verified = await one(connection, `
      SELECT M.OUT_REQ_NO, M.OUT_REQ_SER, M.W_CODE, M.F_W_CODE, M.APPROVED,
             M.PROCESSED, D.I_CODE, D.ITM_UNT, D.I_QTY, D.DOC_SEQUENCE
      FROM ${TEST_SCHEMA}.IAS_OUT_REQUEST_MST M
      JOIN ${TEST_SCHEMA}.IAS_OUT_REQUEST_DTL D ON D.OUT_REQ_SER = M.OUT_REQ_SER
      WHERE M.OUT_REQ_SER = :requestSerial`, { requestSerial: REQUEST_SERIAL });
    if (!verified) throw new Error('Inserted request could not be verified before commit');

    await connection.commit();
    console.log(JSON.stringify({
      success: true,
      schema: TEST_SCHEMA,
      writer: WRITER_USER,
      request: verified,
      oracleWrite: 'INSERT_ONLY',
    }));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
