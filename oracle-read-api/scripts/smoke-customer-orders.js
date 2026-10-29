'use strict';

const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');
const queries = require('../src/queries');

async function main() {
  const config = loadConfig();
  if (config.oracle.defaultSchema !== 'IAS20261') {
    throw new Error('Customer-order smoke test is restricted to IAS20261');
  }
  oracledb.fetchAsString = [oracledb.NUMBER];
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  try {
    const masterQuery = queries.customerOrders('IAS20261', { kind: 'cash', limit: 2 });
    const masters = await db.select(masterQuery.sql, masterQuery.binds);
    const serials = masters.rows.map((row) => String(row.ORDER_SERIAL));
    const detailQuery = queries.customerOrderDetails('IAS20261', serials);
    const details = detailQuery ? await db.select(detailQuery.sql, detailQuery.binds) : { rows: [] };
    console.log(JSON.stringify({
      success: true, mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema: 'IAS20261',
      masterCount: masters.rows.length, detailCount: details.rows.length,
      serialsAreStrings: serials.every((serial) => typeof serial === 'string'),
    }));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false, mode: 'SELECT_ONLY', oracleWrite: 'NONE',
    error: error.message, errorNum: error.errorNum ?? null,
  }));
  process.exitCode = 1;
});
