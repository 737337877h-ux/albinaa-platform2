'use strict';

const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');

const SCHEMAS = ['IAS20191', 'IAS20261'];
const CANDIDATE_NAMES = [
  'IAS_AUD_ITM_MST',
  'IAS_AUD_ITM_DTL',
  'IAS_AUD_ITM_OTHR_MST',
  'IAS_AUD_ITM_OTHR_DTL',
  'IAS_AUDIT_DOC',
];

const objectQuery = `SELECT OWNER, OBJECT_NAME, OBJECT_TYPE, STATUS
FROM ALL_OBJECTS
WHERE OWNER = :owner
  AND (
    OBJECT_NAME IN (${CANDIDATE_NAMES.map((_, index) => `:name${index}`).join(', ')})
    OR OBJECT_NAME LIKE '%AUD%ITM%'
  )
ORDER BY OBJECT_TYPE, OBJECT_NAME`;

const columnQuery = `SELECT TABLE_NAME, COLUMN_ID, COLUMN_NAME, DATA_TYPE, DATA_LENGTH,
       DATA_PRECISION, DATA_SCALE, NULLABLE, DATA_DEFAULT
FROM ALL_TAB_COLUMNS
WHERE OWNER = :owner
  AND (
    TABLE_NAME IN (${CANDIDATE_NAMES.map((_, index) => `:name${index}`).join(', ')})
    OR TABLE_NAME LIKE '%AUD%ITM%'
  )
ORDER BY TABLE_NAME, COLUMN_ID`;

const constraintQuery = `SELECT C.TABLE_NAME, C.CONSTRAINT_NAME, C.CONSTRAINT_TYPE,
       CC.COLUMN_NAME, CC.POSITION, C.R_OWNER, C.R_CONSTRAINT_NAME,
       C.DELETE_RULE, C.STATUS, C.SEARCH_CONDITION
FROM ALL_CONSTRAINTS C
LEFT JOIN ALL_CONS_COLUMNS CC
  ON CC.OWNER = C.OWNER
 AND CC.CONSTRAINT_NAME = C.CONSTRAINT_NAME
 AND CC.TABLE_NAME = C.TABLE_NAME
WHERE C.OWNER = :owner
  AND (
    C.TABLE_NAME IN (${CANDIDATE_NAMES.map((_, index) => `:name${index}`).join(', ')})
    OR C.TABLE_NAME LIKE '%AUD%ITM%'
  )
ORDER BY C.TABLE_NAME, C.CONSTRAINT_TYPE, C.CONSTRAINT_NAME, CC.POSITION`;

const indexQuery = `SELECT I.TABLE_NAME, I.INDEX_NAME, I.UNIQUENESS,
       IC.COLUMN_NAME, IC.COLUMN_POSITION
FROM ALL_INDEXES I
JOIN ALL_IND_COLUMNS IC
  ON IC.INDEX_OWNER = I.OWNER
 AND IC.INDEX_NAME = I.INDEX_NAME
 AND IC.TABLE_OWNER = I.TABLE_OWNER
 AND IC.TABLE_NAME = I.TABLE_NAME
WHERE I.TABLE_OWNER = :owner
  AND (
    I.TABLE_NAME IN (${CANDIDATE_NAMES.map((_, index) => `:name${index}`).join(', ')})
    OR I.TABLE_NAME LIKE '%AUD%ITM%'
  )
ORDER BY I.TABLE_NAME, I.INDEX_NAME, IC.COLUMN_POSITION`;

const triggerQuery = `SELECT TABLE_NAME, TRIGGER_NAME, TRIGGER_TYPE, TRIGGERING_EVENT, STATUS
FROM ALL_TRIGGERS
WHERE TABLE_OWNER = :owner
  AND (
    TABLE_NAME IN (${CANDIDATE_NAMES.map((_, index) => `:name${index}`).join(', ')})
    OR TABLE_NAME LIKE '%AUD%ITM%'
  )
ORDER BY TABLE_NAME, TRIGGER_NAME`;

const privilegeQuery = `SELECT TABLE_NAME, PRIVILEGE, GRANTOR
FROM ALL_TAB_PRIVS
WHERE TABLE_SCHEMA = :owner
  AND GRANTEE = 'ALBINAA_RO'
  AND (
    TABLE_NAME IN (${CANDIDATE_NAMES.map((_, index) => `:name${index}`).join(', ')})
    OR TABLE_NAME LIKE '%AUD%ITM%'
  )
ORDER BY TABLE_NAME, PRIVILEGE`;

function binds(owner) {
  return Object.fromEntries([
    ['owner', owner],
    ...CANDIDATE_NAMES.map((name, index) => [`name${index}`, name]),
  ]);
}

async function safeSelect(db, sql, queryBinds) {
  try {
    const result = await db.select(sql, queryBinds);
    return { rows: result.rows, error: null };
  } catch (error) {
    return {
      rows: [],
      error: { message: error.message, errorNum: error.errorNum ?? null },
    };
  }
}

async function inspectSchema(db, schema) {
  const queryBinds = binds(schema);
  const [objects, columns, constraints, indexes, triggers, privileges] = await Promise.all([
    safeSelect(db, objectQuery, queryBinds),
    safeSelect(db, columnQuery, queryBinds),
    safeSelect(db, constraintQuery, queryBinds),
    safeSelect(db, indexQuery, queryBinds),
    safeSelect(db, triggerQuery, queryBinds),
    safeSelect(db, privilegeQuery, queryBinds),
  ]);

  const visibleTables = [...new Set(columns.rows.map((row) => row.TABLE_NAME))];
  return {
    schema,
    visibleTables,
    objects,
    columns,
    constraints,
    indexes,
    triggers,
    privileges,
    conclusionGate: visibleTables.length === 0
      ? 'NO_INVENTORY_AUDIT_METADATA_VISIBLE_TO_ALBINAA_RO'
      : 'REVIEW_METADATA_BEFORE_SAMPLE_DOCUMENT',
  };
}

async function main() {
  const config = loadConfig();
  oracledb.fetchAsString = [oracledb.NUMBER];
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  try {
    const schemas = [];
    for (const schema of SCHEMAS) schemas.push(await inspectSchema(db, schema));
    const metadataVisible = schemas.every((schema) => schema.visibleTables.length > 0);
    console.log(JSON.stringify({
      success: true,
      mode: 'SELECT_ONLY',
      oracleWrite: 'NONE',
      screen: 'INVT008.230',
      purpose: 'DISCOVER_INVENTORY_AUDIT_METADATA',
      candidateTables: CANDIDATE_NAMES,
      schemas,
      nextGate: metadataVisible
        ? 'CREATE_ONE_IAS20191_SAMPLE_IN_YEMENSOFT_THEN_COMPARE_ROWS'
        : 'ORACLE_ADMIN_CONFIRM_OBJECTS_THEN_GRANT_SELECT_TO_ALBINAA_RO',
      cautions: [
        'Table names are candidates until a YemenSoft-created IAS20191 sample proves the exact master/detail pair.',
        'IAS20261 remains SELECT-only and no sample document will be created there.',
        'No business rows, quantities, procedures, sequences, or Oracle write statement were executed.',
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
