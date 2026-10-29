'use strict';

const RELEVANT_COLUMNS = [
  'A_CODE', 'A_NAME', 'A_NAME_E', 'AC_CODE', 'AC_CODE_DTL', 'AC_DESC',
  'BANK_NO', 'BANK_NAME', 'CASH_NO', 'CASH_NAME',
  'C_CODE', 'C_A_NAME', 'C_E_NAME', 'V_CODE', 'V_A_NAME', 'V_E_NAME',
  'EMP_NO', 'EMP_NAME', 'COL_NO', 'COL_NAME', 'COMMISSION', 'COMM_PER',
  'INACTIVE', 'BRN_NO', 'CONN_BRN_NO', 'A_CY', 'CUR_CODE',
];

const TABLE_PATTERN = /(CUSTOMER|VENDOR|SUPPLIER|EMP|ACCOUNT|CASH|BANK|COLLECT|COMM|VCHR|DEBT|CRED)/;

function tableNamesQuery() {
  return `SELECT DISTINCT TABLE_NAME
FROM ALL_TAB_COLUMNS
WHERE OWNER = :owner
ORDER BY TABLE_NAME`;
}

function columnsByNameQuery() {
  const columnBinds = Object.fromEntries(RELEVANT_COLUMNS.map((column, index) => [`column${index}`, column]));
  return {
    sql: `SELECT TABLE_NAME, COLUMN_ID, COLUMN_NAME, DATA_TYPE, DATA_LENGTH,
       DATA_PRECISION, DATA_SCALE, NULLABLE
FROM ALL_TAB_COLUMNS
WHERE OWNER = :owner
  AND COLUMN_NAME IN (${RELEVANT_COLUMNS.map((_, index) => `:column${index}`).join(', ')})
ORDER BY TABLE_NAME, COLUMN_ID`,
    binds: { ...columnBinds },
  };
}

function tableColumnsQuery(tableNames) {
  if (!Array.isArray(tableNames) || tableNames.length < 1 || tableNames.length > 100) {
    throw new Error('tableNames must contain between 1 and 100 names');
  }
  const binds = Object.fromEntries(tableNames.map((table, index) => [`table${index}`, table]));
  return {
    sql: `SELECT TABLE_NAME, COLUMN_ID, COLUMN_NAME, DATA_TYPE, DATA_LENGTH,
       DATA_PRECISION, DATA_SCALE, NULLABLE
FROM ALL_TAB_COLUMNS
WHERE OWNER = :owner
  AND TABLE_NAME IN (${tableNames.map((_, index) => `:table${index}`).join(', ')})
ORDER BY TABLE_NAME, COLUMN_ID`,
    binds,
  };
}

function candidateTableNames(rows) {
  return rows.map((row) => row.TABLE_NAME).filter((table) => TABLE_PATTERN.test(table));
}

function categoryNames(tableName, columns) {
  const columnSet = new Set(columns);
  const tableMatches = (pattern) => pattern.test(tableName);
  const hasAnyColumn = (...names) => names.some((name) => columnSet.has(name));
  const categories = [];
  if (tableMatches(/CASH|BOX|FUND|SAFE/) || hasAnyColumn('CASH_NO', 'CASH_NAME')) categories.push('cashboxes');
  if (tableMatches(/BANK/) || hasAnyColumn('BANK_NO', 'BANK_NAME')) categories.push('banks');
  if (tableMatches(/CUSTOMER/) || hasAnyColumn('C_CODE', 'C_A_NAME', 'C_E_NAME')) categories.push('customers');
  if (tableMatches(/VENDOR|SUPPLIER/) || hasAnyColumn('V_CODE', 'V_A_NAME', 'V_E_NAME')) categories.push('vendors');
  if (tableMatches(/(^|_)(S_)?EMP/) || hasAnyColumn('EMP_NO', 'EMP_NAME')) categories.push('employees');
  if (tableMatches(/COLLECT|COMM/) || hasAnyColumn('COL_NO', 'COL_NAME', 'COMMISSION', 'COMM_PER')) categories.push('collectorsAndCommission');
  if (tableMatches(/DEBT/)) categories.push('debtors');
  if (tableMatches(/CRED/)) categories.push('creditors');
  if (tableMatches(/ACCOUNT/) || hasAnyColumn('A_CODE', 'A_NAME', 'A_NAME_E', 'AC_CODE', 'AC_CODE_DTL', 'AC_DESC')) categories.push('accounts');
  return categories;
}

function summarizeMetadata(schema, rows) {
  const tables = new Map();
  for (const row of rows) {
    if (!tables.has(row.TABLE_NAME)) tables.set(row.TABLE_NAME, []);
    tables.get(row.TABLE_NAME).push({
      name: row.COLUMN_NAME,
      position: Number(row.COLUMN_ID),
      type: row.DATA_TYPE,
      length: row.DATA_LENGTH == null ? null : Number(row.DATA_LENGTH),
      precision: row.DATA_PRECISION == null ? null : Number(row.DATA_PRECISION),
      scale: row.DATA_SCALE == null ? null : Number(row.DATA_SCALE),
      nullable: row.NULLABLE === 'Y',
    });
  }

  const categories = {
    cashboxes: [], banks: [], customers: [], vendors: [], employees: [],
    collectorsAndCommission: [], debtors: [], creditors: [], accounts: [],
  };
  for (const [table, columns] of tables) {
    const entry = { table, columns };
    for (const category of categoryNames(table, columns.map((column) => column.name))) {
      categories[category].push(entry);
    }
  }

  return {
    schema,
    visibility: 'ALBINAA_RO_GRANTED_OBJECTS_ONLY',
    tableCount: tables.size,
    categories,
  };
}

function compareSummaries(left, right) {
  const tableMap = (summary) => {
    const result = new Map();
    for (const entries of Object.values(summary.categories)) {
      for (const entry of entries) result.set(entry.table, new Set(entry.columns.map((column) => column.name)));
    }
    return result;
  };
  const leftTables = tableMap(left);
  const rightTables = tableMap(right);
  const onlyInLeft = [...leftTables.keys()].filter((table) => !rightTables.has(table)).sort();
  const onlyInRight = [...rightTables.keys()].filter((table) => !leftTables.has(table)).sort();
  const columnDifferences = [];
  for (const [table, leftColumns] of leftTables) {
    const rightColumns = rightTables.get(table);
    if (!rightColumns) continue;
    const onlyLeft = [...leftColumns].filter((column) => !rightColumns.has(column)).sort();
    const onlyRight = [...rightColumns].filter((column) => !leftColumns.has(column)).sort();
    if (onlyLeft.length || onlyRight.length) columnDifferences.push({ table, onlyInLeft: onlyLeft, onlyInRight: onlyRight });
  }
  return {
    leftSchema: left.schema,
    rightSchema: right.schema,
    tablesOnlyInLeft: onlyInLeft,
    tablesOnlyInRight: onlyInRight,
    columnDifferences,
  };
}

module.exports = {
  candidateTableNames,
  categoryNames,
  columnsByNameQuery,
  compareSummaries,
  summarizeMetadata,
  tableColumnsQuery,
  tableNamesQuery,
};
