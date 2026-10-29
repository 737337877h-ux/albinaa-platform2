'use strict';

const oracledb = require('oracledb');

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const user = required('ORACLE_USER').toUpperCase();
  const schema = required('ORACLE_SCHEMA').toUpperCase();
  if (user !== 'ALBINAA_RO') throw new Error('Metadata inspection must use ALBINAA_RO');
  if (schema !== 'IAS20191') throw new Error('Metadata inspection is pinned to IAS20191');

  oracledb.initOracleClient({ libDir: required('ORACLE_CLIENT_LIB_DIR') });
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  oracledb.fetchAsString = [oracledb.NUMBER];
  const connection = await oracledb.getConnection({
    user,
    password: required('ORACLE_PASSWORD'),
    connectString: required('ORACLE_CONNECT_STRING'),
  });
  connection.callTimeout = 15000;
  try {
    await connection.execute('SET TRANSACTION READ ONLY');
    const tables = ['IAS_RQ_VCHR_MST', 'IAS_RQ_VCHR_DTL', 'IAS_RQ_JRNL_MST', 'IAS_RQ_JRNL_DTL'];
    const columns = await connection.execute(`
      SELECT TABLE_NAME,COLUMN_ID,COLUMN_NAME,DATA_TYPE,DATA_LENGTH,DATA_PRECISION,DATA_SCALE,NULLABLE
      FROM ALL_TAB_COLUMNS
      WHERE OWNER=:schema AND TABLE_NAME IN (${tables.map((_, index) => `:table${index}`).join(',')})
        AND NULLABLE='N'
      ORDER BY TABLE_NAME,COLUMN_ID`, {
      schema,
      ...Object.fromEntries(tables.map((table, index) => [`table${index}`, table])),
    });
    const constraints = await connection.execute(`
      SELECT C.TABLE_NAME,C.CONSTRAINT_NAME,C.CONSTRAINT_TYPE,CC.POSITION,CC.COLUMN_NAME
      FROM ALL_CONSTRAINTS C
      JOIN ALL_CONS_COLUMNS CC
        ON CC.OWNER=C.OWNER AND CC.CONSTRAINT_NAME=C.CONSTRAINT_NAME AND CC.TABLE_NAME=C.TABLE_NAME
      WHERE C.OWNER=:schema AND C.TABLE_NAME IN (${tables.map((_, index) => `:table${index}`).join(',')})
        AND C.CONSTRAINT_TYPE IN ('P','U','R')
      ORDER BY C.TABLE_NAME,C.CONSTRAINT_NAME,CC.POSITION`, {
      schema,
      ...Object.fromEntries(tables.map((table, index) => [`table${index}`, table])),
    });
    console.log(JSON.stringify({
      success: true,
      mode: 'SELECT_ONLY',
      oracleWrite: 'NONE',
      schema,
      requiredColumns: columns.rows,
      keyConstraints: constraints.rows,
    }, null, 2));
  } finally {
    await connection.rollback();
    await connection.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ success: false, error: error.message, errorNum: error.errorNum ?? null }));
  process.exitCode = 1;
});
