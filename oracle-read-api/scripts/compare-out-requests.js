'use strict';

const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');

function printable(value) {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return '<binary>';
  return value;
}

function differences(left, right) {
  const result = {};
  for (const key of [...new Set([...Object.keys(left || {}), ...Object.keys(right || {})])]) {
    const a = printable(left?.[key] ?? null);
    const b = printable(right?.[key] ?? null);
    if (JSON.stringify(a) !== JSON.stringify(b)) result[key] = { uiRequest: a, apiRequest: b };
  }
  return result;
}

async function main() {
  const uiRequestNumber = Number(process.argv[2] || 1);
  const apiRequestNumber = Number(process.argv[3] || 4);
  if (!Number.isInteger(uiRequestNumber) || !Number.isInteger(apiRequestNumber)) throw new Error('Request numbers must be integers');
  const config = loadConfig();
  if (config.oracle.defaultSchema !== 'IAS20191') throw new Error('This diagnostic is restricted to IAS20191');
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  try {
    const master = await db.select(`SELECT * FROM IAS20191.IAS_OUT_REQUEST_MST WHERE OUT_REQ_NO IN (:uiRequest, :apiRequest)`, {
      uiRequest: uiRequestNumber, apiRequest: apiRequestNumber,
    });
    const detail = await db.select(`SELECT * FROM IAS20191.IAS_OUT_REQUEST_DTL WHERE OUT_REQ_NO IN (:uiRequest, :apiRequest)`, {
      uiRequest: uiRequestNumber, apiRequest: apiRequestNumber,
    });
    const byNumber = (rows, number) => rows.find((row) => Number(row.OUT_REQ_NO) === number);
    const uiMaster = byNumber(master.rows, uiRequestNumber);
    const apiMaster = byNumber(master.rows, apiRequestNumber);
    const uiDetail = byNumber(detail.rows, uiRequestNumber);
    const apiDetail = byNumber(detail.rows, apiRequestNumber);
    if (!uiMaster || !apiMaster || !uiDetail || !apiDetail) throw new Error('Comparison requests are missing');
    console.log(JSON.stringify({
      mode: 'SELECT_ONLY', schema: 'IAS20191', uiRequestNumber, apiRequestNumber,
      masterDifferences: differences(uiMaster, apiMaster),
      detailDifferences: differences(uiDetail, apiDetail),
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message, errorNum: error.errorNum ?? null }));
  process.exitCode = 1;
});
