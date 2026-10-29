'use strict';

const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');
const {
  BILL_DOC_TYPE_MAP,
  candidateMetadataQuery,
  customerRequestKind,
  detailRowsQuery,
  groupMetadata,
  recentRowsQuery,
  summarizeTable,
  tableRole,
} = require('../src/arst003-discovery');

const SCHEMA = 'IAS20191';

async function main() {
  const config = loadConfig();
  if (config.oracle.defaultSchema !== SCHEMA) throw new Error(`ARST003 discovery is restricted to ${SCHEMA}`);
  oracledb.fetchAsString = [oracledb.NUMBER];
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  try {
    const metadata = await db.select(candidateMetadataQuery(), { owner: SCHEMA });
    const tables = groupMetadata(metadata.rows);
    const evidence = [];
    for (const [tableName, columns] of tables) {
      if (tableRole(tableName, columns) === 'detail') continue;
      try {
        const query = recentRowsQuery(SCHEMA, tableName, columns, 20);
        const result = await db.select(query, { rowLimit: 20 });
        evidence.push(summarizeTable(tableName, columns, result.rows));
      } catch (error) {
        evidence.push(summarizeTable(tableName, columns, [], {
          message: error.message,
          errorNum: error.errorNum ?? null,
        }));
      }
    }
    const masters = evidence.filter((entry) => entry.role === 'master' && entry.rows.length);
    const observedRequests = masters.flatMap((entry) => entry.rows.map((row) => ({
      table: entry.table,
      ...row,
      REQUEST_KIND: customerRequestKind(row.BILL_DOC_TYPE),
    })));
    for (const [tableName, columns] of tables) {
      if (tableRole(tableName, columns) !== 'detail') continue;
      try {
        if (!observedRequests.length) throw new Error('No master rows were found for a targeted detail read');
        const query = detailRowsQuery(SCHEMA, tableName, columns, observedRequests, 100);
        const result = await db.select(query.sql, query.binds);
        evidence.push(summarizeTable(tableName, columns, result.rows));
      } catch (error) {
        evidence.push(summarizeTable(tableName, columns, [], {
          message: error.message,
          errorNum: error.errorNum ?? null,
        }));
      }
    }
    const observedDetails = evidence
      .filter((entry) => entry.role === 'detail')
      .flatMap((entry) => entry.rows.map((row) => ({ table: entry.table, ...row })));
    const observedKinds = new Set(observedRequests.map((row) => row.REQUEST_KIND).filter(Boolean));
    const paymentTypeMappingProven = ['cash', 'credit', 'transfer']
      .every((kind) => observedKinds.has(kind));
    const structureMappingProven = masters.length > 0
      && observedRequests.length >= 3
      && observedDetails.length > 0;
    console.log(JSON.stringify({
      success: true,
      mode: 'SELECT_ONLY',
      oracleWrite: 'NONE',
      schema: SCHEMA,
      screen: 'ARST003',
      purpose: 'COMPARE_EXISTING_CUSTOMER_REQUEST_TYPES_CASH_CREDIT_TRANSFER',
      confirmedBillDocTypeMapping: {
        ...BILL_DOC_TYPE_MAP,
        evidence: 'USER_CONFIRMED_FROM_THREE_EXISTING_IAS20191_ARST003_REQUESTS',
      },
      candidateTableCount: evidence.length,
      evidence,
      observedRequestCount: observedRequests.length,
      observedRequests,
      observedDetailCount: observedDetails.length,
      observedDetails,
      structureMappingProven,
      paymentTypeMappingProven,
      mappingProven: structureMappingProven && paymentTypeMappingProven,
      nextGate: structureMappingProven && paymentTypeMappingProven
        ? 'DISCOVER_SEQUENCE_REQUIRED_WRITE_FIELDS_AND_APPROVAL_METADATA_BEFORE_ANY_DRY_RUN_OR_WRITE'
        : 'VERIFY_THE_THREE_MASTER_KEYS_AND_DETAIL_ROWS',
      cautions: [
        'Only existing IAS20191 rows visible to ALBINAA_RO were read.',
        'Detail rows were read only for the exact master keys reported above.',
        'IAS20191 BILL_DOC_TYPE labels are confirmed as 1 cash, 4 credit, and 6 transfer.',
        'This IAS20191 mapping must not be copied to IAS20261 without separate SELECT-only evidence.',
        'IAS20261 was not queried.',
        'No INSERT, UPDATE, DELETE, MERGE, procedure, sequence, commit, or Oracle write was executed.',
      ],
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ success: false, error: error.message, errorNum: error.errorNum ?? null }));
  process.exitCode = 1;
});
