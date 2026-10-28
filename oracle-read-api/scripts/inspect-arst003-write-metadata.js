'use strict';

const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');
const {
  ARST003_SEQUENCE_CONTROL_TABLES,
  approvalRowsQuery,
  candidateMetadataQuery,
  columnDefaultsMetadataQuery,
  constraintMetadataQuery,
  detailDocumentSequenceEvidence,
  detailRowsQuery,
  groupMetadata,
  indexMetadataQuery,
  privilegeMetadataQuery,
  recentRowsQuery,
  requiredColumnsMetadataQuery,
  sequenceCandidateMetadataQuery,
  sequenceControlMetadataQuery,
  sequenceControlRowsQuery,
  serialGeneratorEvidenceQueries,
  storedSourceReferenceQuery,
  triggerMetadataQuery,
} = require('../src/arst003-discovery');

const SCHEMA = 'IAS20191';

async function safeSelect(db, sql, binds) {
  try {
    const result = await db.select(sql, binds);
    return { rows: result.rows, error: null };
  } catch (error) {
    return { rows: [], error: { message: error.message, errorNum: error.errorNum ?? null } };
  }
}

async function main() {
  const config = loadConfig();
  if (config.oracle.defaultSchema !== SCHEMA) {
    throw new Error(`ARST003 write-metadata discovery is restricted to ${SCHEMA}`);
  }
  oracledb.fetchAsString = [oracledb.NUMBER];
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  try {
    const metadata = await db.select(candidateMetadataQuery(), { owner: SCHEMA });
    const groupedMetadata = groupMetadata(metadata.rows);
    const masterColumns = groupedMetadata.get('SALES_ORDER') || [];
    const detailColumns = groupedMetadata.get('ORDER_DETAIL') || [];
    if (!masterColumns.length) throw new Error('SALES_ORDER metadata is not visible to ALBINAA_RO');
    if (!detailColumns.length) throw new Error('ORDER_DETAIL metadata is not visible to ALBINAA_RO');
    const recent = await db.select(recentRowsQuery(SCHEMA, 'SALES_ORDER', masterColumns, 20), { rowLimit: 20 });
    const observedRequests = recent.rows
      .filter((row) => ['1', '4', '6'].includes(String(row.BILL_DOC_TYPE)))
      .slice(0, 3)
      .map((row) => ({
        SO_TYPE: row.SO_TYPE,
        ORDER_NO: row.ORDER_NO,
        ORDER_SER: row.ORDER_SER,
        BILL_DOC_TYPE: row.BILL_DOC_TYPE,
        APPROVED: row.APPROVED,
        BRN_NO: row.BRN_NO,
        BRN_YEAR: row.BRN_YEAR,
        CMP_NO: row.CMP_NO,
        AD_DATE: row.AD_DATE,
      }));
    if (!observedRequests.length) throw new Error('No confirmed ARST003 sample rows were found');

    const approvalQuery = approvalRowsQuery(SCHEMA, observedRequests);
    const requiredColumns = await safeSelect(db, requiredColumnsMetadataQuery(), { owner: SCHEMA });
    const constraints = await safeSelect(db, constraintMetadataQuery(), { owner: SCHEMA });
    const indexes = await safeSelect(db, indexMetadataQuery(), { owner: SCHEMA });
    const triggers = await safeSelect(db, triggerMetadataQuery(), { owner: SCHEMA });
    const privileges = await safeSelect(db, privilegeMetadataQuery(), { owner: SCHEMA });
    const sequenceCandidates = await safeSelect(db, sequenceCandidateMetadataQuery(30), { owner: SCHEMA });
    const detailQuery = detailRowsQuery(SCHEMA, 'ORDER_DETAIL', detailColumns, observedRequests, 100);
    const detailRows = await safeSelect(db, detailQuery.sql, detailQuery.binds);
    const detailSequenceEvidence = detailDocumentSequenceEvidence(
      detailRows.rows,
      sequenceCandidates.rows,
    );
    const storedSourceReferences = await safeSelect(db, storedSourceReferenceQuery(200), { owner: SCHEMA });
    const columnDefaults = await safeSelect(db, columnDefaultsMetadataQuery(), { owner: SCHEMA });
    const sequenceControlMetadata = await safeSelect(db, sequenceControlMetadataQuery(), { owner: SCHEMA });
    const sequenceControlTables = groupMetadata(sequenceControlMetadata.rows);
    const sequenceControlRows = [];
    for (const table of ARST003_SEQUENCE_CONTROL_TABLES) {
      const columns = sequenceControlTables.get(table) || [];
      if (!columns.length) {
        sequenceControlRows.push({ table, rows: [], error: { message: 'Metadata is not visible to ALBINAA_RO', errorNum: 942 } });
        continue;
      }
      const rows = await safeSelect(db, sequenceControlRowsQuery(SCHEMA, table, columns, 100), {});
      sequenceControlRows.push({ table, ...rows });
    }
    const approvalRows = await safeSelect(db, approvalQuery.sql, approvalQuery.binds);
    const approvalMappingProven = approvalRows.error == null && approvalRows.rows.length > 0;
    const storedSourceReferencesVisible = storedSourceReferences.error == null
      && storedSourceReferences.rows.length > 0;
    const serialGeneratorEvidence = {};
    for (const [name, query] of Object.entries(serialGeneratorEvidenceQueries(SCHEMA, 50))) {
      serialGeneratorEvidence[name] = await safeSelect(db, query.sql, query.binds);
    }

    console.log(JSON.stringify({
      success: true,
      mode: 'SELECT_ONLY',
      oracleWrite: 'NONE',
      schema: SCHEMA,
      screen: 'ARST003',
      purpose: 'DISCOVER_SEQUENCE_REQUIRED_FIELDS_KEYS_AND_APPROVAL_METADATA',
      observedRequests,
      requiredColumns,
      constraints,
      indexes,
      triggers,
      privileges,
      sequenceCandidates,
      detailRows,
      detailSequenceEvidence,
      storedSourceReferences,
      columnDefaults,
      sequenceControlMetadata,
      sequenceControlRows,
      serialGeneratorEvidence,
      approvalRows,
      mappingStatus: {
        masterDetailMappingProven: true,
        paymentTypeMappingProven: true,
        requiredFieldsEnumerated: requiredColumns.error == null && requiredColumns.rows.length > 0,
        masterOrderNumberSequenceMappingProven: false,
        detailDocumentSequenceMappingProven: detailSequenceEvidence.mappingProven,
        databaseColumnDefaultsVisible: columnDefaults.error == null && columnDefaults.rows.length > 0,
        defaultValueMappingProven: false,
        approvalMappingProven,
        storedSourceReferencesVisible,
        serialGeneratorsProven: false,
      },
      nextGate: !approvalMappingProven
        ? 'APPROVE_ONE_EXISTING_ARST003_SAMPLE_IN_YEMENSOFT_THEN_REPEAT_SELECT_ONLY_CHECK'
        : storedSourceReferencesVisible
          ? 'REVIEW_STORED_SOURCE_REFERENCES_FOR_THE_TRUE_ORDER_NO_AND_ORDER_SER_GENERATOR'
          : 'CAPTURE_THE_YEMENSOFT_ARST003_NUMBER_GENERATION_SELECT_WITH_A_DBA_RUN_V_SQL_QUERY',
      cautions: [
        'IAS_DOC_SEQ_OTHR is proven only for ORDER_DETAIL.DOC_SEQ when observed DOC_SEQ values are consecutive and LAST_NUMBER is the next value.',
        'IAS_DOC_SEQ_OTHR is not proven as the generator of SALES_ORDER.ORDER_NO or SALES_ORDER.ORDER_SER.',
        'Sequence rows were read as metadata only; LAST_NUMBER was not used or allocated.',
        'Sequence-control rows were read as-is and must be matched to ARST003 before any generator is implemented.',
        'Stored source output is metadata text only; no stored object was invoked.',
        'Historical serial patterns and sequence LAST_NUMBER values are diagnostic evidence only and do not prove an allocator.',
        'No NEXTVAL, CURRVAL, procedure, package, trigger body, or default expression was executed.',
        'Required columns are based only on Oracle NOT NULL metadata; business validations still require a YemenSoft sample comparison.',
        'IAS20261 was not queried.',
        'No INSERT, UPDATE, DELETE, MERGE, commit, or Oracle write was executed.',
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
