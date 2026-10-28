'use strict';

const PARTY_COLUMNS = ['EMP_NO', 'V_CODE'];
const ACCOUNT_COLUMNS = ['A_CODE', 'AC_CODE', 'AC_CODE_DTL', 'AC_DTL_TYP', 'GRP_CODE'];
const DISPLAY_COLUMNS = [
  'EMP_NO', 'EMP_L_NM', 'EMP_F_NM', 'V_CODE', 'V_A_NAME', 'V_E_NAME',
  'A_CODE', 'AC_CODE', 'AC_CODE_DTL', 'AC_DTL_TYP', 'GRP_CODE',
  'BRN_NO', 'CONN_BRN_NO', 'INACTIVE',
];

function assertIdentifier(value, label = 'identifier') {
  if (!/^[A-Z][A-Z0-9_$#]{0,29}$/.test(String(value))) {
    throw new Error(`Invalid Oracle ${label}`);
  }
  return String(value);
}

function candidateColumnsQuery() {
  const names = [...new Set([...PARTY_COLUMNS, ...ACCOUNT_COLUMNS, ...DISPLAY_COLUMNS])];
  const binds = Object.fromEntries(names.map((name, index) => [`column${index}`, name]));
  return {
    sql: `SELECT TABLE_NAME, COLUMN_ID, COLUMN_NAME
FROM ALL_TAB_COLUMNS
WHERE OWNER = :owner
  AND COLUMN_NAME IN (${names.map((_, index) => `:column${index}`).join(', ')})
ORDER BY TABLE_NAME, COLUMN_ID`,
    binds,
  };
}

function candidateTables(rows) {
  const tables = new Map();
  for (const row of rows) {
    if (!tables.has(row.TABLE_NAME)) tables.set(row.TABLE_NAME, []);
    tables.get(row.TABLE_NAME).push(row.COLUMN_NAME);
  }
  return [...tables]
    .map(([table, columns]) => ({ table, columns }))
    .filter(({ columns }) => PARTY_COLUMNS.some((name) => columns.includes(name))
      && ACCOUNT_COLUMNS.some((name) => columns.includes(name)));
}

function partyRowsQuery(schema, table, columns, partyColumn) {
  assertIdentifier(schema, 'schema');
  assertIdentifier(table, 'table');
  assertIdentifier(partyColumn, 'party column');
  const projection = DISPLAY_COLUMNS.filter((name) => columns.includes(name));
  if (!projection.includes(partyColumn)) throw new Error('Party column is not visible in candidate table');
  const codes = partyColumn === 'EMP_NO' ? ['1'] : ['10001', '20001'];
  return {
    sql: `SELECT ${projection.join(', ')}
FROM ${schema}.${table}
WHERE TO_CHAR(${partyColumn}) IN (${codes.map((_, index) => `:code${index}`).join(', ')})
  AND ROWNUM <= 100
ORDER BY ${partyColumn}`,
    binds: Object.fromEntries(codes.map((code, index) => [`code${index}`, code])),
  };
}

function analyticalRowsQuery(schema) {
  assertIdentifier(schema, 'schema');
  return {
    sql: `SELECT D.AC_CODE, TO_CHAR(D.AC_CODE_DTL) AS AC_CODE_DTL,
       D.AC_CODE_DTL_L_NM, D.AC_CODE_DTL_F_NM, D.GRP_CODE, D.CONN_BRN_NO
FROM ${schema}.GLS_ACCNT_DTL D
WHERE (D.CONN_BRN_NO IS NULL OR D.CONN_BRN_NO = :branchNo)
  AND (
       D.AC_CODE IN (:employeeAccount, :vendorAccount1, :vendorAccount2)
       OR TO_CHAR(D.AC_CODE_DTL) IN (:employeeCode, :vendorCode1, :vendorCode2)
  )
  AND ROWNUM <= 500
ORDER BY D.AC_CODE, D.AC_CODE_DTL`,
    binds: {
      branchNo: 1,
      employeeAccount: '116101001',
      vendorAccount1: '211101001',
      vendorAccount2: '211102001',
      employeeCode: '1',
      vendorCode1: '10001',
      vendorCode2: '20001',
    },
  };
}

function voucherEvidenceQuery(schema) {
  assertIdentifier(schema, 'schema');
  return {
    sql: `SELECT * FROM (
  SELECT D.VOUCHER_TYPE, D.VOUCHER_PAY_TYPE, D.VOUCHER_NO,
         TO_CHAR(D.V_SER) AS V_SER, D.RCRD_NO, D.A_CODE,
         TO_CHAR(D.AC_CODE_DTL) AS AC_CODE_DTL, D.AC_DTL_TYP,
         D.A_CY, D.AC_DESC, D.AC_AMT, D.AC_AMTF, D.DOC_BRN_NO
  FROM ${schema}.IAS_RQ_VCHR_DTL D
  WHERE D.A_CODE IN (:employeeAccount, :vendorAccount1, :vendorAccount2)
     OR TO_CHAR(D.AC_CODE_DTL) IN (:employeeCode, :vendorCode1, :vendorCode2)
  ORDER BY D.V_SER DESC, D.RCRD_NO
)
WHERE ROWNUM <= 200`,
    binds: {
      employeeAccount: '116101001',
      vendorAccount1: '211101001',
      vendorAccount2: '211102001',
      employeeCode: '1',
      vendorCode1: '10001',
      vendorCode2: '20001',
    },
  };
}

function conclusionGate({ analyticalError, analyticalRows, voucherEvidence }) {
  if (voucherEvidence.length) return 'HISTORICAL_VOUCHER_EVIDENCE_FOUND';
  if (analyticalError) return 'ANALYTICAL_ACCOUNT_TABLE_NOT_READABLE';
  if (analyticalRows.length) return 'REVIEW_EXACT_ACCOUNT_AND_ANALYTICAL_TYPE_BEFORE_MAPPING';
  return 'NO_CONFIRMED_ANALYTICAL_LINK_VISIBLE_TO_ALBINAA_RO';
}

module.exports = {
  analyticalRowsQuery,
  assertIdentifier,
  candidateColumnsQuery,
  candidateTables,
  conclusionGate,
  partyRowsQuery,
  voucherEvidenceQuery,
};
