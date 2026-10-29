'use strict';

const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');

const SCHEMA = 'IAS20261';
const OBJECTS = ['P_REQUEST', 'P_REQUEST_DETAIL', 'S_APPRVD_MOV', 'IAS_DOC_SEQ_OTHR'];

function pick(row, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row || {}, name)) return row[name];
  }
  return null;
}

async function main() {
  const config = loadConfig();
  if (!config.oracle.allowedSchemas.has(SCHEMA)) {
    throw new Error(`${SCHEMA} must be present in ORACLE_ALLOWED_SCHEMAS`);
  }

  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  try {
    async function safeSelect(label, sql, binds = {}) {
      try {
        const result = await db.select(sql, binds);
        return { label, rows: result.rows, error: null };
      } catch (error) {
        return { label, rows: [], error: { message: error.message, errorNum: error.errorNum ?? null } };
      }
    }

    const [columns, constraints, objects, grants, writerUser] = await Promise.all([
      safeSelect('columns', `
        SELECT TABLE_NAME,COLUMN_ID,COLUMN_NAME,DATA_TYPE,DATA_LENGTH,DATA_PRECISION,
               DATA_SCALE,NULLABLE,DATA_DEFAULT
        FROM ALL_TAB_COLUMNS
        WHERE OWNER=:schema AND TABLE_NAME IN ('P_REQUEST','P_REQUEST_DETAIL','S_APPRVD_MOV')
        ORDER BY TABLE_NAME,COLUMN_ID`, { schema: SCHEMA }),
      safeSelect('constraints', `
        SELECT C.TABLE_NAME,C.CONSTRAINT_NAME,C.CONSTRAINT_TYPE,C.STATUS,
               CC.POSITION,CC.COLUMN_NAME
        FROM ALL_CONSTRAINTS C
        JOIN ALL_CONS_COLUMNS CC
          ON CC.OWNER=C.OWNER AND CC.CONSTRAINT_NAME=C.CONSTRAINT_NAME
        WHERE C.OWNER=:schema
          AND C.TABLE_NAME IN ('P_REQUEST','P_REQUEST_DETAIL','S_APPRVD_MOV')
        ORDER BY C.TABLE_NAME,C.CONSTRAINT_NAME,CC.POSITION`, { schema: SCHEMA }),
      safeSelect('objects', `
        SELECT OWNER,OBJECT_NAME,OBJECT_TYPE,STATUS
        FROM ALL_OBJECTS
        WHERE OWNER=:schema
          AND OBJECT_NAME IN ('P_REQUEST','P_REQUEST_DETAIL','S_APPRVD_MOV','IAS_DOC_SEQ_OTHR')
        ORDER BY OBJECT_NAME,OBJECT_TYPE`, { schema: SCHEMA }),
      safeSelect('grants', `
        SELECT OWNER,TABLE_NAME,PRIVILEGE,GRANTOR
        FROM USER_TAB_PRIVS
        WHERE OWNER=:schema
          AND TABLE_NAME IN ('P_REQUEST','P_REQUEST_DETAIL','S_APPRVD_MOV','IAS_DOC_SEQ_OTHR')
        ORDER BY TABLE_NAME,PRIVILEGE`, { schema: SCHEMA }),
      safeSelect('writerUser', `
        SELECT USERNAME,TO_CHAR(CREATED,'YYYY-MM-DD HH24:MI:SS') CREATED_AT
        FROM ALL_USERS
        WHERE USERNAME='ALBINAA20261WRITER'`),
    ]);

    const recent = await safeSelect('recentRequests', `
      SELECT * FROM (
        SELECT PR_TYPE,PR_NO,PR_SER,PR_DATE,HRCHY_NO,PR_DESC,SIDE_REQ,
               REQ_AVL_DATE,PR_SELECTED,APPROVED,INACTIVE,REF_NO,
               CMP_NO,BRN_NO,BRN_YEAR,BRN_USR,AD_U_ID,AD_DATE
        FROM ${SCHEMA}.P_REQUEST
        ORDER BY PR_DATE DESC,PR_NO DESC
      ) WHERE ROWNUM <= 5`);

    const sample = recent.rows[0] || null;
    let details = [];
    let approvals = [];
    if (sample) {
      const requestSerial = pick(sample, ['PR_SER']);
      const requestNo = pick(sample, ['PR_NO']);
      const requestType = pick(sample, ['PR_TYPE']);
      const detailResult = await safeSelect('sampleDetails', `
        SELECT PR_TYPE,PR_NO,PR_SER,I_CODE,I_QTY,ITM_UNT,P_SIZE,P_QTY,W_CODE,
               RCRD_NO,DOC_SEQUENCE,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR
        FROM ${SCHEMA}.P_REQUEST_DETAIL
        WHERE PR_SER=:requestSerial AND PR_NO=:requestNo AND PR_TYPE=:requestType
        ORDER BY RCRD_NO`, { requestSerial, requestNo, requestType });
      details = detailResult.rows;
      const approvalResult = await safeSelect('sampleApprovals', `
        SELECT LVL_NO,DOC_TYP,DOC_SER,DOC_NO,DOC_JV_TYP,DOC_DATE,DOC_AMT,
               APPRVD,ORDR_NO,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR
        FROM ${SCHEMA}.S_APPRVD_MOV
        WHERE DOC_SER=:requestSerial AND DOC_NO=:requestNo
        ORDER BY ORDR_NO,LVL_NO`, { requestSerial, requestNo });
      approvals = approvalResult.rows;
    }

    const objectNames = new Set(objects.rows.map((row) => `${row.OBJECT_NAME}:${row.OBJECT_TYPE}:${row.STATUS}`));
    const columnNames = new Map();
    for (const row of columns.rows) {
      if (!columnNames.has(row.TABLE_NAME)) columnNames.set(row.TABLE_NAME, new Set());
      columnNames.get(row.TABLE_NAME).add(row.COLUMN_NAME);
    }
    const requiredColumns = {
      P_REQUEST: ['PR_TYPE','PR_NO','PR_SER','PR_DATE','HRCHY_NO','PR_DESC','SIDE_REQ','REQ_AVL_DATE','PR_SELECTED','APPROVED','INACTIVE','REF_NO','CMP_NO','BRN_NO','BRN_YEAR','BRN_USR'],
      P_REQUEST_DETAIL: ['PR_TYPE','PR_NO','PR_SER','I_CODE','I_QTY','ITM_UNT','P_SIZE','P_QTY','W_CODE','RCRD_NO','DOC_SEQUENCE','CMP_NO','BRN_NO','BRN_YEAR','BRN_USR'],
      S_APPRVD_MOV: ['LVL_NO','DOC_TYP','DOC_SER','DOC_NO','DOC_DATE','APPRVD','ORDR_NO','CMP_NO','BRN_NO','BRN_YEAR','BRN_USR'],
    };
    const missingColumns = Object.entries(requiredColumns).flatMap(([table, names]) =>
      names.filter((name) => !columnNames.get(table)?.has(name)).map((name) => `${table}.${name}`));

    console.log(JSON.stringify({
      mode: 'SELECT_ONLY',
      schema: SCHEMA,
      screen: 'APST001.125',
      checks: {
        tablesPresent: ['P_REQUEST','P_REQUEST_DETAIL','S_APPRVD_MOV'].every((name) =>
          objectNames.has(`${name}:TABLE:VALID`)),
        sequencePresent: [...objectNames].some((value) => value.startsWith('IAS_DOC_SEQ_OTHR:SEQUENCE:')),
        missingColumns,
        sampleFound: Boolean(sample),
        sampleDetailCount: details.length,
        sampleApprovalCount: approvals.length,
      },
      queryErrors: [columns, constraints, objects, grants, writerUser, recent]
        .filter((result) => result.error)
        .map((result) => ({ query: result.label, ...result.error })),
      objects: objects.rows,
      grants: grants.rows,
      writerUser: writerUser.rows[0] || null,
      constraints: constraints.rows,
      columns: columns.rows,
      recentRequests: recent.rows,
      sampleDetails: details,
      sampleApprovals: approvals,
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message, errorNum: error.errorNum ?? null }));
  process.exitCode = 1;
});
