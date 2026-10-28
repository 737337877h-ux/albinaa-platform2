'use strict';

const SAFE_IDENTIFIER = /^[A-Z][A-Z0-9_$#]{0,29}$/;
const ARST003_TABLES = Object.freeze(['SALES_ORDER', 'ORDER_DETAIL', 'S_APPRVD_MOV']);
const ARST003_SEQUENCE_CONTROL_TABLES = Object.freeze(['S_SEQ_CTL', 'S_SEQ_VALUES']);
const BILL_DOC_TYPE_MAP = Object.freeze({
  1: 'cash',
  4: 'credit',
  6: 'transfer',
});
const KEY_COLUMNS = new Set([
  'SO_NO', 'SO_SER', 'SO_DATE', 'SO_TYPE', 'ORDER_TYPE', 'SALES_TYPE',
  'ORDER_NO', 'ORDER_SER', 'ORDER_DATE', 'ORDER_STATUS', 'ORDER_METHOD', 'ORDER_CUR',
  'PAY_TYPE', 'PAYMENT_TYPE', 'PAY_METHOD', 'CASH_NO', 'BANK_NO', 'TRANSFER',
  'C_CODE', 'C_NAME', 'C_A_NAME', 'C_E_NAME', 'COL_NO', 'SM_NO', 'W_CODE',
  'A_CY', 'EX_RATE', 'SO_AMT', 'SO_AMT_F', 'NET_AMT', 'NET_AMT_F',
  'REF_NO', 'DOC_DESC', 'SO_DESC', 'APPROVED', 'APRV_U_ID', 'APRV_DATE',
  'PROCESSED', 'INACTIVE', 'BRN_NO', 'BRN_YEAR', 'CMP_NO', 'AD_DATE',
  'UP_DATE', 'DOC_SER_EXTRNL', 'BILL_DOC_TYPE', 'BILL_DUE_DATE', 'ORDER_AMT',
  'I_CODE', 'I_QTY', 'FREE_QTY', 'ITM_UNT', 'P_SIZE', 'P_QTY', 'I_PRICE',
  'RCRD_NO', 'BARCODE', 'ITEM_DESC', 'VAT_PER', 'VAT_AMT', 'DOC_SEQUENCE', 'DOC_SEQ',
]);

function candidateMetadataQuery() {
  return `SELECT C.TABLE_NAME, C.COLUMN_ID, C.COLUMN_NAME, C.DATA_TYPE,
       C.DATA_LENGTH, C.DATA_PRECISION, C.DATA_SCALE, C.NULLABLE
FROM ALL_TAB_COLUMNS C
WHERE C.OWNER = :owner
  AND C.TABLE_NAME IN ('SALES_ORDER', 'ORDER_DETAIL', 'IAS_V_NY_SALES_ORDER', 'IAS_V_NY_ORDER_DETAIL')
ORDER BY C.TABLE_NAME, C.COLUMN_ID`;
}

function requiredColumnsMetadataQuery() {
  return `SELECT TABLE_NAME, COLUMN_ID, COLUMN_NAME, DATA_TYPE, DATA_LENGTH,
       DATA_PRECISION, DATA_SCALE, NULLABLE, DEFAULT_LENGTH
FROM ALL_TAB_COLUMNS
WHERE OWNER = :owner
  AND TABLE_NAME IN ('SALES_ORDER', 'ORDER_DETAIL', 'S_APPRVD_MOV')
  AND NULLABLE = 'N'
ORDER BY TABLE_NAME, COLUMN_ID`;
}

function columnDefaultsMetadataQuery() {
  return `SELECT TABLE_NAME, COLUMN_ID, COLUMN_NAME, DATA_TYPE, DEFAULT_LENGTH, DATA_DEFAULT
FROM ALL_TAB_COLUMNS
WHERE OWNER = :owner
  AND TABLE_NAME IN ('SALES_ORDER', 'ORDER_DETAIL', 'S_APPRVD_MOV')
  AND DEFAULT_LENGTH > 0
ORDER BY TABLE_NAME, COLUMN_ID`;
}

function sequenceControlMetadataQuery() {
  return `SELECT TABLE_NAME, COLUMN_ID, COLUMN_NAME, DATA_TYPE, DATA_LENGTH,
       DATA_PRECISION, DATA_SCALE, NULLABLE, DEFAULT_LENGTH
FROM ALL_TAB_COLUMNS
WHERE OWNER = :owner
  AND TABLE_NAME IN ('S_SEQ_CTL', 'S_SEQ_VALUES')
ORDER BY TABLE_NAME, COLUMN_ID`;
}

function sequenceControlRowsQuery(schema, tableName, columns, limit = 100) {
  assertIdentifier(schema, 'schema');
  assertIdentifier(tableName, 'table name');
  if (!ARST003_SEQUENCE_CONTROL_TABLES.includes(tableName)) {
    throw new Error(`Unsupported sequence control table: ${tableName}`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('limit must be between 1 and 200');
  const names = scalarColumnNames(columns);
  if (!names.length) throw new Error(`${tableName} has no supported scalar columns`);
  return `SELECT ${names.join(', ')}
FROM ${schema}.${tableName}
WHERE ROWNUM <= ${limit}`;
}

function constraintMetadataQuery() {
  return `SELECT C.TABLE_NAME, C.CONSTRAINT_NAME, C.CONSTRAINT_TYPE,
       CC.COLUMN_NAME, CC.POSITION, C.R_OWNER, C.R_CONSTRAINT_NAME,
       C.DELETE_RULE, C.STATUS, C.VALIDATED
FROM ALL_CONSTRAINTS C
LEFT JOIN ALL_CONS_COLUMNS CC
  ON CC.OWNER = C.OWNER
 AND CC.CONSTRAINT_NAME = C.CONSTRAINT_NAME
 AND CC.TABLE_NAME = C.TABLE_NAME
WHERE C.OWNER = :owner
  AND C.TABLE_NAME IN ('SALES_ORDER', 'ORDER_DETAIL', 'S_APPRVD_MOV')
ORDER BY C.TABLE_NAME, C.CONSTRAINT_TYPE, C.CONSTRAINT_NAME, CC.POSITION`;
}

function indexMetadataQuery() {
  return `SELECT I.TABLE_NAME, I.INDEX_NAME, I.UNIQUENESS, I.INDEX_TYPE,
       I.STATUS, IC.COLUMN_NAME, IC.COLUMN_POSITION
FROM ALL_INDEXES I
JOIN ALL_IND_COLUMNS IC
  ON IC.INDEX_OWNER = I.OWNER
 AND IC.INDEX_NAME = I.INDEX_NAME
 AND IC.TABLE_OWNER = I.TABLE_OWNER
 AND IC.TABLE_NAME = I.TABLE_NAME
WHERE I.TABLE_OWNER = :owner
  AND I.TABLE_NAME IN ('SALES_ORDER', 'ORDER_DETAIL', 'S_APPRVD_MOV')
ORDER BY I.TABLE_NAME, I.INDEX_NAME, IC.COLUMN_POSITION`;
}

function triggerMetadataQuery() {
  return `SELECT TABLE_NAME, TRIGGER_NAME, TRIGGER_TYPE, TRIGGERING_EVENT,
       ACTION_TYPE, STATUS
FROM ALL_TRIGGERS
WHERE TABLE_OWNER = :owner
  AND TABLE_NAME IN ('SALES_ORDER', 'ORDER_DETAIL', 'S_APPRVD_MOV')
ORDER BY TABLE_NAME, TRIGGER_NAME`;
}

function privilegeMetadataQuery() {
  return `SELECT TABLE_NAME, PRIVILEGE, GRANTOR, GRANTABLE
FROM ALL_TAB_PRIVS
WHERE TABLE_SCHEMA = :owner
  AND GRANTEE = 'ALBINAA_RO'
  AND TABLE_NAME IN ('SALES_ORDER', 'ORDER_DETAIL', 'S_APPRVD_MOV')
ORDER BY TABLE_NAME, PRIVILEGE`;
}

function sequenceCandidateMetadataQuery(limit = 30) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be between 1 and 100');
  return `SELECT * FROM (
  SELECT SEQUENCE_NAME, MIN_VALUE, MAX_VALUE, INCREMENT_BY,
         CYCLE_FLAG, ORDER_FLAG, CACHE_SIZE, LAST_NUMBER
  FROM ALL_SEQUENCES
  WHERE SEQUENCE_OWNER = :owner
    AND (
      SEQUENCE_NAME LIKE '%ORDER%'
      OR SEQUENCE_NAME LIKE '%SALES%'
      OR SEQUENCE_NAME LIKE 'SO%'
      OR SEQUENCE_NAME LIKE '%DOC%SEQ%'
    )
  ORDER BY SEQUENCE_NAME
)
WHERE ROWNUM <= ${limit}`;
}

function storedSourceReferenceQuery(limit = 200) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('limit must be between 1 and 500');
  return `SELECT * FROM (
  SELECT OWNER, NAME, TYPE, LINE, TEXT
  FROM ALL_SOURCE
  WHERE OWNER = :owner
    AND (
      UPPER(TEXT) LIKE '%SALES_ORDER%'
      OR UPPER(TEXT) LIKE '%ORDER_SER%'
      OR UPPER(TEXT) LIKE '%ORDER_NO%'
      OR UPPER(TEXT) LIKE '%S_SEQ_CTL%'
      OR UPPER(TEXT) LIKE '%IAS_DOC_SEQ_OTHR%'
    )
  ORDER BY NAME, TYPE, LINE
)
WHERE ROWNUM <= ${limit}`;
}

function serialGeneratorEvidenceQueries(schema, limit = 50) {
  assertIdentifier(schema, 'schema');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be between 1 and 100');
  const commonBinds = {
    owner: schema,
    branchNo: 1,
    branchYear: 2019,
    rowLimit: limit,
  };
  return {
    salesOrderHistory: {
      sql: `SELECT * FROM (
  SELECT ORDER_NO, ORDER_SER, SO_TYPE, BILL_DOC_TYPE, BRN_NO, BRN_YEAR,
         CMP_NO, BRN_USR, AD_U_ID, AD_DATE, AD_TRMNL_NM
  FROM ${schema}.SALES_ORDER
  WHERE BRN_NO = :branchNo
    AND BRN_YEAR = :branchYear
    AND ORDER_SER IS NOT NULL
  ORDER BY ORDER_SER DESC
)
WHERE ROWNUM <= :rowLimit`,
      binds: { branchNo: commonBinds.branchNo, branchYear: commonBinds.branchYear, rowLimit: limit },
    },
    reservationHistory: {
      sql: `SELECT * FROM (
  SELECT DOC_TYPE, DOC_NO, DOC_SER, DOC_NO_REF, DOC_TYPE_REF, DOC_SER_REF,
         BRN_NO, BRN_YEAR, CMP_NO, BRN_USR, AD_U_ID, AD_DATE
  FROM ${schema}.IAS_RESERVE_MST
  WHERE DOC_TYPE = 2
    AND DOC_TYPE_REF = 53
    AND BRN_NO = :branchNo
    AND BRN_YEAR = :branchYear
    AND DOC_SER IS NOT NULL
  ORDER BY DOC_SER DESC
)
WHERE ROWNUM <= :rowLimit`,
      binds: { branchNo: commonBinds.branchNo, branchYear: commonBinds.branchYear, rowLimit: limit },
    },
    sequenceCatalog: {
      sql: `SELECT * FROM (
  SELECT SEQUENCE_NAME, MIN_VALUE, MAX_VALUE, INCREMENT_BY, CYCLE_FLAG,
         ORDER_FLAG, CACHE_SIZE, LAST_NUMBER
  FROM ALL_SEQUENCES
  WHERE SEQUENCE_OWNER = :owner
  ORDER BY SEQUENCE_NAME
)
WHERE ROWNUM <= :rowLimit`,
      binds: { owner: commonBinds.owner, rowLimit: 100 },
    },
    serialColumnMetadata: {
      sql: `SELECT TABLE_NAME, COLUMN_ID, COLUMN_NAME, DATA_TYPE, DATA_LENGTH,
       DATA_PRECISION, DATA_SCALE, NULLABLE, DEFAULT_LENGTH, DATA_DEFAULT
FROM ALL_TAB_COLUMNS
WHERE OWNER = :owner
  AND (
    (TABLE_NAME = 'SALES_ORDER' AND COLUMN_NAME IN ('ORDER_NO', 'ORDER_SER'))
    OR (TABLE_NAME = 'IAS_RESERVE_MST' AND COLUMN_NAME IN ('DOC_NO', 'DOC_SER'))
  )
ORDER BY TABLE_NAME, COLUMN_ID`,
      binds: { owner: commonBinds.owner },
    },
    serialTableTriggers: {
      sql: `SELECT TABLE_NAME, TRIGGER_NAME, TRIGGER_TYPE, TRIGGERING_EVENT,
       ACTION_TYPE, STATUS
FROM ALL_TRIGGERS
WHERE TABLE_OWNER = :owner
  AND TABLE_NAME IN ('SALES_ORDER', 'IAS_RESERVE_MST')
ORDER BY TABLE_NAME, TRIGGER_NAME`,
      binds: { owner: commonBinds.owner },
    },
  };
}

function approvalRowsQuery(schema, masterRows) {
  assertIdentifier(schema, 'schema');
  if (!Array.isArray(masterRows) || !masterRows.length) throw new Error('masterRows are required');
  const binds = {};
  const placeholders = masterRows.map((row, index) => {
    if (row.ORDER_SER == null) throw new Error(`master row ${index + 1} is missing ORDER_SER`);
    binds[`orderSer${index}`] = row.ORDER_SER;
    return `:orderSer${index}`;
  });
  return {
    sql: `SELECT LVL_NO, DOC_TYP, DOC_SER, DOC_NO, DOC_JV_TYP, DOC_DATE,
       DOC_AMT, APPRVD, APPRVD_U_ID, APPRVD_DATE, APPRVD_DESC, ORDR_NO,
       CMP_NO, BRN_NO, BRN_YEAR, BRN_USR, AD_U_ID, AD_DATE, AD_TRMNL_NM
FROM ${schema}.S_APPRVD_MOV
WHERE DOC_SER IN (${placeholders.join(', ')})
ORDER BY DOC_SER, ORDR_NO, LVL_NO`,
    binds,
  };
}

function reservationRowsQueries(schema, masterRows) {
  assertIdentifier(schema, 'schema');
  if (!Array.isArray(masterRows) || !masterRows.length) throw new Error('masterRows are required');
  const binds = {};
  const placeholders = masterRows.map((row, index) => {
    if (row.ORDER_SER == null) throw new Error(`master row ${index + 1} is missing ORDER_SER`);
    binds[`orderSer${index}`] = row.ORDER_SER;
    return `:orderSer${index}`;
  });
  const serialList = placeholders.join(', ');
  return {
    master: {
      sql: `SELECT DOC_TYPE, DOC_NO, DOC_SER, DOC_NO_REF, DOC_TYPE_REF,
       DOC_SER_REF, C_CODE, CC_CODE, PJ_NO, ACTV_NO, BRN_NO, CMP_NO,
       BRN_USR, BRN_YEAR, AD_U_ID, AD_DATE, UP_U_ID, UP_DATE
FROM ${schema}.IAS_RESERVE_MST
WHERE DOC_TYPE_REF = 53
  AND DOC_SER_REF IN (${serialList})
ORDER BY DOC_SER_REF, DOC_SER, DOC_NO`,
      binds: { ...binds },
    },
    detail: {
      sql: `SELECT DOC_TYPE, DOC_NO, DOC_SER, DOC_NO_REF, DOC_TYPE_REF,
       DOC_SER_REF, I_CODE, ITM_UNT, W_CODE, EXPIRE_DATE, BATCH_NO,
       I_QTY, P_SIZE, P_QTY, CP_QTY, RESERVED, C_CODE, CC_CODE, PJ_NO,
       ACTV_NO, T_DATE, DOC_SEQUENCE, RCRD_NO, ITEM_DESC, AD_U_ID,
       AD_DATE, UP_U_ID, UP_DATE, BRN_NO, BRN_YEAR, CMP_NO, BRN_USR
FROM ${schema}.IAS_RESERVE_DTL
WHERE DOC_TYPE_REF = 53
  AND DOC_SER_REF IN (${serialList})
ORDER BY DOC_SER_REF, DOC_SER, RCRD_NO`,
      binds: { ...binds },
    },
  };
}

function customerRequestKind(billDocType) {
  if (billDocType == null) return null;
  return BILL_DOC_TYPE_MAP[String(billDocType)] || null;
}

function assertIdentifier(value, label) {
  if (!SAFE_IDENTIFIER.test(value)) throw new Error(`Unsafe ${label}: ${value}`);
  return value;
}

function groupMetadata(rows) {
  const tables = new Map();
  for (const row of rows) {
    if (!tables.has(row.TABLE_NAME)) tables.set(row.TABLE_NAME, []);
    tables.get(row.TABLE_NAME).push(row);
  }
  return tables;
}

function tableRole(tableName, columns) {
  const names = new Set(columns.map((column) => column.COLUMN_NAME));
  if (tableName === 'SALES_ORDER' || tableName === 'IAS_V_NY_SALES_ORDER') return 'master';
  if (tableName === 'ORDER_DETAIL' || tableName === 'IAS_V_NY_ORDER_DETAIL') return 'detail';
  if (names.has('I_CODE') || names.has('I_QTY') || /DTL|DETAIL/.test(tableName)) return 'detail';
  return 'related';
}

function selectedColumnNames(columns) {
  const supported = columns.filter((column) => /^(NUMBER|VARCHAR2|CHAR|DATE|TIMESTAMP)/.test(column.DATA_TYPE));
  const selected = supported.filter((column) =>
    KEY_COLUMNS.has(column.COLUMN_NAME)
    || /(^|_)(TYPE|PAY|CASH|BANK|TRANS|CREDIT|AMT|RATE|CY|APPROV|PROCES|INACTIVE|REF|DATE)$/.test(column.COLUMN_NAME));
  const fallback = supported.slice(0, 40);
  const names = [...new Set((selected.length ? selected : fallback).map((column) => column.COLUMN_NAME))];
  return names.slice(0, 80);
}

function scalarColumnNames(columns) {
  return columns
    .filter((column) => /^(NUMBER|VARCHAR2|NVARCHAR2|CHAR|NCHAR|DATE|TIMESTAMP)/.test(column.DATA_TYPE))
    .map((column) => assertIdentifier(column.COLUMN_NAME, 'column name'));
}

function rowsBySerialQuery(schema, tableName, columns, serialColumn, serials, orderColumns = []) {
  assertIdentifier(schema, 'schema');
  assertIdentifier(tableName, 'table name');
  assertIdentifier(serialColumn, 'serial column');
  if (!Array.isArray(serials) || !serials.length) throw new Error('serials are required');
  const names = scalarColumnNames(columns);
  if (!names.includes(serialColumn)) throw new Error(`${tableName} is missing ${serialColumn}`);
  const binds = {};
  const placeholders = serials.map((serial, index) => {
    binds[`serial${index}`] = serial;
    return `:serial${index}`;
  });
  const available = new Set(names);
  const safeOrder = orderColumns
    .filter((name) => available.has(name))
    .map((name) => assertIdentifier(name, 'order column'));
  return {
    sql: `SELECT ${names.join(', ')}
FROM ${schema}.${tableName}
WHERE ${serialColumn} IN (${placeholders.join(', ')})
${safeOrder.length ? `ORDER BY ${safeOrder.join(', ')}` : ''}`,
    binds,
  };
}

function recentRowsQuery(schema, tableName, columns, limit = 20) {
  assertIdentifier(schema, 'schema');
  assertIdentifier(tableName, 'table name');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be between 1 and 100');
  const names = selectedColumnNames(columns);
  if (!names.length) throw new Error(`${tableName} has no supported scalar columns`);
  names.forEach((name) => assertIdentifier(name, 'column name'));
  const available = new Set(names);
  const documentNumber = ['SO_NO', 'ORDER_NO', 'DOC_NO', 'RCRD_NO']
    .find((name) => available.has(name)) || names[0];
  const recentFilter = available.has('AD_DATE') ? 'WHERE AD_DATE >= SYSDATE - 14' : '';
  const order = available.has('UP_DATE') && available.has('AD_DATE')
    ? `NVL(UP_DATE, AD_DATE) DESC, ${documentNumber} DESC`
    : available.has('AD_DATE') ? `AD_DATE DESC, ${documentNumber} DESC`
      : '';
  return `SELECT * FROM (
  SELECT ${names.join(', ')}
  FROM ${schema}.${tableName}
  ${recentFilter}
  ${order ? `ORDER BY ${order}` : ''}
)
WHERE ROWNUM <= :rowLimit`;
}

function detailRowsQuery(schema, tableName, columns, masterRows, limit = 100) {
  assertIdentifier(schema, 'schema');
  assertIdentifier(tableName, 'table name');
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('limit must be between 1 and 500');
  if (!Array.isArray(masterRows) || !masterRows.length) throw new Error('masterRows are required');
  const available = new Set(columns.map((column) => column.COLUMN_NAME));
  const required = ['SO_TYPE', 'ORDER_NO', 'ORDER_SER'];
  for (const name of required) {
    if (!available.has(name)) throw new Error(`${tableName} is missing ${name}`);
  }
  const names = selectedColumnNames(columns);
  names.forEach((name) => assertIdentifier(name, 'column name'));
  const binds = { rowLimit: limit };
  const predicates = masterRows.map((row, index) => {
    for (const name of required) {
      if (row[name] == null) throw new Error(`master row ${index + 1} is missing ${name}`);
    }
    binds[`soType${index}`] = row.SO_TYPE;
    binds[`orderNo${index}`] = row.ORDER_NO;
    binds[`orderSer${index}`] = row.ORDER_SER;
    const branch = available.has('BRN_NO') && row.BRN_NO != null
      ? ` AND BRN_NO = :brnNo${index}`
      : '';
    if (branch) binds[`brnNo${index}`] = row.BRN_NO;
    return `(SO_TYPE = :soType${index} AND ORDER_NO = :orderNo${index} AND ORDER_SER = :orderSer${index}${branch})`;
  });
  const order = available.has('RCRD_NO') ? 'ORDER_SER, RCRD_NO' : 'ORDER_SER';
  return {
    sql: `SELECT * FROM (
  SELECT ${names.join(', ')}
  FROM ${schema}.${tableName}
  WHERE ${predicates.join('\n     OR ')}
  ORDER BY ${order}
)
WHERE ROWNUM <= :rowLimit`,
    binds,
  };
}

function differingFields(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const fields = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return fields.filter((field) => {
    const values = new Set(rows.map((row) => row[field] == null ? '<NULL>' : String(row[field])));
    return values.size > 1;
  });
}

function detailDocumentSequenceEvidence(detailRows, sequenceRows) {
  const rows = Array.isArray(detailRows) ? detailRows : [];
  const sequences = Array.isArray(sequenceRows) ? sequenceRows : [];
  const candidate = sequences.find((row) => row.SEQUENCE_NAME === 'IAS_DOC_SEQ_OTHR') || null;
  const documentSequences = rows
    .map((row) => Number(row.DOC_SEQ))
    .filter((value) => Number.isSafeInteger(value))
    .sort((left, right) => left - right);
  const uniqueSequences = [...new Set(documentSequences)];
  const consecutive = uniqueSequences.every((value, index) =>
    index === 0 || value === uniqueSequences[index - 1] + 1);
  const lastNumber = candidate == null ? null : Number(candidate.LAST_NUMBER);
  const incrementBy = candidate == null ? null : Number(candidate.INCREMENT_BY);
  const maximumObserved = uniqueSequences.length ? uniqueSequences[uniqueSequences.length - 1] : null;
  const proven = rows.length > 0
    && documentSequences.length === rows.length
    && uniqueSequences.length === rows.length
    && consecutive
    && candidate != null
    && incrementBy === 1
    && lastNumber === maximumObserved + 1;

  return {
    observedRowCount: rows.length,
    observedDocSequences: uniqueSequences,
    sequenceName: candidate?.SEQUENCE_NAME || null,
    incrementBy: Number.isFinite(incrementBy) ? incrementBy : null,
    lastNumber: Number.isFinite(lastNumber) ? lastNumber : null,
    maximumObserved,
    mappingProven: proven,
  };
}

function summarizeTable(tableName, columns, rows, error = null) {
  return {
    table: tableName,
    role: tableRole(tableName, columns),
    columns: columns.map((column) => ({
      name: column.COLUMN_NAME,
      position: Number(column.COLUMN_ID),
      type: column.DATA_TYPE,
      nullable: column.NULLABLE === 'Y',
    })),
    rows,
    differingFields: differingFields(rows),
    error,
  };
}

module.exports = {
  ARST003_SEQUENCE_CONTROL_TABLES,
  ARST003_TABLES,
  BILL_DOC_TYPE_MAP,
  approvalRowsQuery,
  candidateMetadataQuery,
  columnDefaultsMetadataQuery,
  constraintMetadataQuery,
  customerRequestKind,
  detailDocumentSequenceEvidence,
  detailRowsQuery,
  differingFields,
  groupMetadata,
  indexMetadataQuery,
  privilegeMetadataQuery,
  recentRowsQuery,
  reservationRowsQueries,
  requiredColumnsMetadataQuery,
  rowsBySerialQuery,
  scalarColumnNames,
  sequenceCandidateMetadataQuery,
  sequenceControlMetadataQuery,
  sequenceControlRowsQuery,
  serialGeneratorEvidenceQueries,
  selectedColumnNames,
  storedSourceReferenceQuery,
  summarizeTable,
  tableRole,
  triggerMetadataQuery,
};
