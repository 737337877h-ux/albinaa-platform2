'use strict';

// Verified IAS20261 view: 2020 opening + 2020-2026 movements, excluding
// subsequent years' DOC_TYPE=0. Never union annual opening balances again.
function accountStatementQuery(schema, p) {
  if (schema !== 'IAS20261') throw new Error('Historical statements require IAS20261');
  if (!['customer', 'advance'].includes(p.kind) || !/^[0-9]{1,30}$/.test(p.code || '')) throw new Error('Invalid account');
  if (!['SAR', 'YER', 'USD'].includes(p.currency)) throw new Error('Invalid currency');
  for (const date of [p.fromDate, p.toDate]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(Date.parse(date))
      || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Invalid date');
  }
  if (p.fromDate < '2020-01-01' || p.toDate > '2026-12-31' || p.fromDate > p.toDate) {
    throw new Error('Available archive: 2020-01-01 through 2026-12-31');
  }
  const account = p.kind === 'advance'
    ? "A_CODE IN ('113101001','113101002') AND AC_DTL_TYP=5 AND AC_CODE_DTL=:code"
    : 'AC_DTL_TYP=3 AND C_CODE=:code';
  const currency = p.currency === 'SAR' ? "A_CY IN ('SR','SAR')" : p.currency === 'YER' ? "A_CY IN ('YR','YER')" : "A_CY IN ('$','USD')";
  const suffix = p.currency === 'SAR' ? '' : '_F';
  return {
    binds: { code: p.code, fromDate: p.fromDate, toDate: p.toDate },
    sql: `WITH source_rows AS (
      SELECT DOC_DATE, DOC_TYPE, DOC_NO, DOC_SER, BRN_YEAR, BRN_NO,
        DOC_SEQUENCE, RCRD_NO, ROW_ID, DOC_DESC, REF_NO,
        NVL(DR_AMT${suffix},0) DEBIT, NVL(CR_AMT${suffix},0) CREDIT
      FROM ${schema}.IAS_V_POST_DTL_YR
      WHERE ${account} AND ${currency}
        AND DOC_DATE < TO_DATE(:toDate,'YYYY-MM-DD')+1
    ), summary AS (
      SELECT NVL(SUM(CASE WHEN DOC_DATE < TO_DATE(:fromDate,'YYYY-MM-DD') THEN DEBIT-CREDIT ELSE 0 END),0) OPENING,
        NVL(SUM(CASE WHEN DOC_DATE >= TO_DATE(:fromDate,'YYYY-MM-DD') THEN DEBIT ELSE 0 END),0) TOTAL_DEBIT,
        NVL(SUM(CASE WHEN DOC_DATE >= TO_DATE(:fromDate,'YYYY-MM-DD') THEN CREDIT ELSE 0 END),0) TOTAL_CREDIT,
        COUNT(CASE WHEN DOC_DATE >= TO_DATE(:fromDate,'YYYY-MM-DD') THEN 1 END) TOTAL
      FROM source_rows
    ), detail AS (
      SELECT TO_CHAR(DOC_DATE,'YYYY-MM-DD') DOCUMENT_DATE, TO_CHAR(DOC_TYPE) DOCUMENT_TYPE,
        TO_CHAR(DOC_NO) DOCUMENT_NUMBER, TO_CHAR(DOC_SER) DOCUMENT_SERIAL, DOC_DESC, REF_NO,
        DEBIT,CREDIT,
        ROW_NUMBER() OVER (ORDER BY DOC_DATE,BRN_YEAR,BRN_NO,DOC_TYPE,DOC_NO,DOC_SER,DOC_SEQUENCE,RCRD_NO,ROW_ID) RN,
        SUM(DEBIT-CREDIT) OVER (ORDER BY DOC_DATE,BRN_YEAR,BRN_NO,DOC_TYPE,DOC_NO,DOC_SER,DOC_SEQUENCE,RCRD_NO,ROW_ID ROWS UNBOUNDED PRECEDING) PERIOD_RUNNING
      FROM source_rows WHERE DOC_DATE >= TO_DATE(:fromDate,'YYYY-MM-DD')
    ) SELECT s.*,d.* FROM summary s LEFT JOIN detail d ON d.RN<=5000 ORDER BY d.RN`,
  };
}

module.exports = { accountStatementQuery };
