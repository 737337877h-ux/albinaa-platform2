'use strict';

const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');
const {
  candidateTableNames,
  columnsByNameQuery,
  compareSummaries,
  summarizeMetadata,
  tableColumnsQuery,
  tableNamesQuery,
} = require('../src/request-catalog-metadata');

const SCHEMAS = ['IAS20191', 'IAS20261'];

async function main() {
  const config = loadConfig();
  oracledb.fetchAsString = [oracledb.NUMBER];
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  try {
    const summaries = [];
    for (const schema of SCHEMAS) {
      try {
        const names = await db.select(tableNamesQuery(), { owner: schema });
        const candidateTables = candidateTableNames(names.rows);
        const namedColumnsQuery = columnsByNameQuery();
        const namedColumns = await db.select(namedColumnsQuery.sql, { owner: schema, ...namedColumnsQuery.binds });
        const metadata = new Map(namedColumns.rows.map((row) => [`${row.TABLE_NAME}:${row.COLUMN_NAME}`, row]));
        for (let offset = 0; offset < candidateTables.length; offset += 100) {
          const query = tableColumnsQuery(candidateTables.slice(offset, offset + 100));
          const result = await db.select(query.sql, { owner: schema, ...query.binds });
          for (const row of result.rows) metadata.set(`${row.TABLE_NAME}:${row.COLUMN_NAME}`, row);
        }
        summaries.push(summarizeMetadata(schema, [...metadata.values()]));
      } catch (error) {
        const contextual = new Error(`${schema} metadata discovery failed: ${error.message}`);
        contextual.errorNum = error.errorNum ?? null;
        throw contextual;
      }
    }
    console.log(JSON.stringify({
      mode: 'SELECT_ONLY',
      oracleWrite: 'NONE',
      purpose: 'DISCOVER_SCHEMA_SPECIFIC_REQUEST_CATALOG_METADATA',
      schemas: summaries,
      comparison: compareSummaries(summaries[0], summaries[1]),
      cautions: [
        'Results include only objects currently visible to ALBINAA_RO.',
        'Candidate classification is metadata-only and is not yet an approved business mapping.',
        'No business rows, balances, vouchers, journals, procedures, or sequences were read.',
      ],
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message, errorNum: error.errorNum ?? null }));
  process.exitCode = 1;
});
