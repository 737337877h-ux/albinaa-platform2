'use strict';

const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');

const APPROVAL_NAME = /(APPR|APR[VW]|LEVEL|LVL)/i;

function integerArg(index, fallback) {
  const value = Number(process.argv[index] || fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Request identifiers must be positive integers');
  return value;
}

async function main() {
  const requestNoA = integerArg(2, 6);
  const requestNoB = integerArg(3, 7);
  const requestSerialA = String(integerArg(4, 20190000016));
  const requestSerialB = String(integerArg(5, 20190000017));
  const config = loadConfig();
  const schema = config.oracle.defaultSchema;
  if (schema !== 'IAS20191') throw new Error('This diagnostic is restricted to IAS20191');
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  try {
    const metadata = await db.select(`
      SELECT TABLE_NAME, COLUMN_NAME
      FROM ALL_TAB_COLUMNS
      WHERE OWNER = :schema
        AND (COLUMN_NAME IN ('OUT_REQ_NO','OUT_REQ_SER','OUT_REQ_TYPE')
             OR UPPER(TABLE_NAME) LIKE '%APPR%'
             OR UPPER(COLUMN_NAME) LIKE '%APPR%'
             OR UPPER(COLUMN_NAME) LIKE '%LEVEL%'
             OR UPPER(COLUMN_NAME) LIKE '%LVL%')
      ORDER BY TABLE_NAME, COLUMN_ID`, { schema });

    const tables = new Map();
    for (const row of metadata.rows) {
      if (!tables.has(row.TABLE_NAME)) tables.set(row.TABLE_NAME, []);
      tables.get(row.TABLE_NAME).push(row.COLUMN_NAME);
    }
    const candidates = [...tables.entries()].filter(([table, columns]) =>
      (columns.includes('OUT_REQ_SER') || columns.includes('OUT_REQ_NO')) &&
      (APPROVAL_NAME.test(table) || columns.some((column) => APPROVAL_NAME.test(column))));
    const matches = [];
    for (const [table, columns] of candidates) {
      if (!/^[A-Z0-9_$#]+$/.test(table)) continue;
      const serialColumn = columns.includes('OUT_REQ_SER');
      const sql = serialColumn
        ? `SELECT * FROM ${schema}.${table} WHERE OUT_REQ_SER IN (:valueA,:valueB)`
        : `SELECT * FROM ${schema}.${table} WHERE OUT_REQ_NO IN (:valueA,:valueB)`;
      const result = await db.select(sql, serialColumn
        ? { valueA: requestSerialA, valueB: requestSerialB }
        : { valueA: requestNoA, valueB: requestNoB });
      if (result.rows.length) matches.push({ table, columns, rows: result.rows });
    }
    console.log(JSON.stringify({
      mode: 'SELECT_ONLY', schema,
      compared: { requestNoA, requestNoB, requestSerialA, requestSerialB },
      visibleCandidateTables: candidates.map(([table, columns]) => ({ table, columns })),
      matches,
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message, errorNum: error.errorNum ?? null }));
  process.exitCode = 1;
});
