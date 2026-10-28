'use strict';

const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');
const {
  analyticalRowsQuery,
  candidateColumnsQuery,
  candidateTables,
  conclusionGate,
  partyRowsQuery,
  voucherEvidenceQuery,
} = require('../src/party-account-diagnostic');

const SCHEMAS = ['IAS20191', 'IAS20261'];

async function inspectSchema(db, schema) {
  const metadataQuery = candidateColumnsQuery();
  const metadata = await db.select(metadataQuery.sql, { owner: schema, ...metadataQuery.binds });
  const candidates = candidateTables(metadata.rows);
  const partyMatches = [];
  const candidateErrors = [];
  for (const candidate of candidates) {
    for (const partyColumn of ['EMP_NO', 'V_CODE'].filter((name) => candidate.columns.includes(name))) {
      try {
        const query = partyRowsQuery(schema, candidate.table, candidate.columns, partyColumn);
        const result = await db.select(query.sql, query.binds);
        if (result.rows.length) {
          partyMatches.push({ table: candidate.table, partyColumn, rows: result.rows });
        }
      } catch (error) {
        candidateErrors.push({
          table: candidate.table,
          partyColumn,
          error: error.message,
          errorNum: error.errorNum ?? null,
        });
      }
    }
  }
  let analyticalRows = [];
  let analyticalError = null;
  try {
    const analyticalQuery = analyticalRowsQuery(schema);
    const analytical = await db.select(analyticalQuery.sql, analyticalQuery.binds);
    analyticalRows = analytical.rows;
  } catch (error) {
    analyticalError = { table: 'GLS_ACCNT_DTL', error: error.message, errorNum: error.errorNum ?? null };
  }
  let voucherEvidence = [];
  let voucherEvidenceError = null;
  try {
    const evidenceQuery = voucherEvidenceQuery(schema);
    const evidence = await db.select(evidenceQuery.sql, evidenceQuery.binds);
    voucherEvidence = evidence.rows;
  } catch (error) {
    voucherEvidenceError = {
      table: 'IAS_RQ_VCHR_DTL',
      error: error.message,
      errorNum: error.errorNum ?? null,
    };
  }
  return {
    schema,
    partyMatches,
    candidateErrors,
    analyticalRows,
    analyticalError,
    voucherEvidence,
    voucherEvidenceError,
    conclusionGate: conclusionGate({ analyticalError, analyticalRows, voucherEvidence }),
  };
}

async function main() {
  const config = loadConfig();
  oracledb.fetchAsString = [oracledb.NUMBER];
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  try {
    const schemas = [];
    for (const schema of SCHEMAS) {
      try {
        schemas.push(await inspectSchema(db, schema));
      } catch (error) {
        schemas.push({ schema, error: error.message, errorNum: error.errorNum ?? null });
      }
    }
    console.log(JSON.stringify({
      success: schemas.some((result) => !result.error),
      mode: 'SELECT_ONLY',
      oracleWrite: 'NONE',
      purpose: 'VERIFY_EMPLOYEE_AND_VENDOR_ANALYTICAL_ACCOUNT_LINKS',
      targets: {
        employee: { code: '1', confirmedMainAccount: '116101001' },
        vendors: [
          { code: '10001', confirmedMainAccounts: ['211101001', '211102001'] },
          { code: '20001', confirmedMainAccounts: ['211101001', '211102001'] },
        ],
      },
      schemas,
      cautions: [
        'A main account is not enough to infer an analytical account code or type.',
        'Voucher evidence is historical SELECT-only evidence and does not create or approve a request.',
        'Only rows visible to ALBINAA_RO are reported.',
        'No INSERT, UPDATE, DELETE, MERGE, procedure, sequence, or Oracle write was executed.',
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
