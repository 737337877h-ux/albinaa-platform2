'use strict';

const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');

const CURRENCY_TABLE_PATTERN = /(CURRENCY|CURR|EXCH_CUR|EX_RATE|CUR_RATE|CY_RATE)/;
const CURRENCY_COLUMNS = new Set([
  'A_CY', 'A_CY_NAME', 'A_CY_NAME_A', 'A_CY_NAME_E',
  'CUR_CODE', 'CURR_CODE', 'CURRENCY_CODE', 'CY_CODE',
  'CUR_NAME', 'CURR_NAME', 'CURRENCY_NAME', 'CY_NAME',
  'EX_RATE', 'EXCHANGE_RATE', 'CUR_RATE', 'CY_RATE',
  'FROM_CY', 'TO_CY', 'F_CY', 'T_CY',
  'RATE_DATE', 'EX_RATE_DATE', 'CUR_DATE',
  'LOCAL_CY', 'LOCAL_CURR', 'LOCAL_CURRENCY', 'MAIN_CY',
]);

async function main() {
  const config = loadConfig();
  const schema = String(process.argv[2] || config.oracle.defaultSchema).toUpperCase();
  if (!['IAS20191', 'IAS20261'].includes(schema)) {
    throw new Error('This diagnostic is restricted to IAS20191 and IAS20261');
  }

  oracledb.fetchAsString = [oracledb.NUMBER];
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  try {
    const metadata = await db.select(`
      SELECT TABLE_NAME, COLUMN_ID, COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION, DATA_SCALE, NULLABLE
      FROM ALL_TAB_COLUMNS
      WHERE OWNER=:schema
        AND (
          REGEXP_LIKE(TABLE_NAME, '(CURRENCY|CURR|EXCH_CUR|EX_RATE|CUR_RATE|CY_RATE)')
          OR COLUMN_NAME IN (
            'A_CY','A_CY_NAME','A_CY_NAME_A','A_CY_NAME_E',
            'CUR_CODE','CURR_CODE','CURRENCY_CODE','CY_CODE',
            'CUR_NAME','CURR_NAME','CURRENCY_NAME','CY_NAME',
            'EX_RATE','EXCHANGE_RATE','CUR_RATE','CY_RATE',
            'FROM_CY','TO_CY','F_CY','T_CY',
            'RATE_DATE','EX_RATE_DATE','CUR_DATE',
            'LOCAL_CY','LOCAL_CURR','LOCAL_CURRENCY','MAIN_CY'
          )
        )
      ORDER BY TABLE_NAME, COLUMN_ID`, { schema });

    const columnsByTable = new Map();
    for (const row of metadata.rows) {
      if (!columnsByTable.has(row.TABLE_NAME)) columnsByTable.set(row.TABLE_NAME, []);
      columnsByTable.get(row.TABLE_NAME).push(row);
    }

    const candidates = [];
    for (const [table, columns] of columnsByTable) {
      const columnNames = columns.map((column) => column.COLUMN_NAME);
      const relevantColumns = columnNames.filter((column) => CURRENCY_COLUMNS.has(column));
      const tableNameMatch = CURRENCY_TABLE_PATTERN.test(table);
      if (!tableNameMatch && relevantColumns.length < 2) continue;

      let sampleRows = [];
      let sampleError = null;
      if (tableNameMatch) {
        try {
          sampleRows = (await db.select(`SELECT * FROM ${schema}.${table} WHERE ROWNUM <= 20`)).rows;
        } catch (error) {
          sampleError = { message: error.message, errorNum: error.errorNum ?? null };
        }
      }
      candidates.push({ table, relevantColumns, columns, sampleRows, sampleError });
    }

    const currencySourceCandidates = candidates.filter((candidate) =>
      CURRENCY_TABLE_PATTERN.test(candidate.table));

    console.log(JSON.stringify({
      mode: 'SELECT_ONLY',
      schema,
      purpose: 'DISCOVER_SCHEMA_SPECIFIC_CURRENCY_AND_EXCHANGE_RATE_METADATA',
      candidates,
      nextGate: currencySourceCandidates.length === 0
        ? 'No visible currency metadata was found; grant ALBINAA_RO SELECT on the confirmed currency/rate tables after identifying them as the schema owner.'
        : null,
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message, errorNum: error.errorNum ?? null }));
  process.exitCode = 1;
});
