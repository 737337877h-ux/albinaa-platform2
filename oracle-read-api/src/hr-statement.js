'use strict';

function hrStatementQuery(schema, p) {
  if (schema !== 'IAS20261') throw new Error('Employee statements require IAS20261');
  if (!/^2026-(10|11|12)$/.test(p.month || '')) throw new Error('Available HR period: October through December 2026');
  if (!/^\d{1,20}$/.test(p.code || '')) throw new Error('Invalid employee account');
  if (!['salary', 'custody'].includes(p.kind)) throw new Error('Invalid account kind');
  const account = p.kind === 'salary' ? '116101001' : '116201001';
  const type = p.kind === 'salary' ? 7 : 5;
  return {
    binds: { code: p.code, account, analyticalType: type, fromDate: `${p.month}-01` },
    sql: `WITH source_rows AS (
      SELECT ROWIDTOCHAR(P.ROWID) SOURCE_ROW, P.A_CY,
        P.DOC_DATE, P.DOC_TYPE, P.DOC_NO, P.DOC_SER, P.RCRD_NO, P.BRN_NO, P.DOC_DESC,
        E.L_F CURRENCY_MODE,
        CASE WHEN E.L_F=1 THEN NVL(P.DR_AMT,0) WHEN E.L_F=2 THEN NVL(P.DR_AMT_F,0) END DEBIT,
        CASE WHEN E.L_F=1 THEN NVL(P.CR_AMT,0) WHEN E.L_F=2 THEN NVL(P.CR_AMT_F,0) END CREDIT
      FROM IAS20261.IAS_POST_DTL P LEFT JOIN IAS20261.EX_RATE E ON E.CUR_CODE=P.A_CY
      WHERE P.A_CODE=:account AND P.AC_DTL_TYP=:analyticalType AND P.AC_CODE_DTL=:code
        AND P.DOC_TYPE<>0 AND P.DOC_DATE>=DATE '2026-10-01'
        AND P.DOC_DATE<ADD_MONTHS(TO_DATE(:fromDate,'YYYY-MM-DD'),1)
    ), summary AS (
      SELECT A_CY CURRENCY,
        SUM(CASE WHEN DOC_DATE<TO_DATE(:fromDate,'YYYY-MM-DD') THEN DEBIT-CREDIT ELSE 0 END) OPENING,
        SUM(CASE WHEN DOC_DATE>=TO_DATE(:fromDate,'YYYY-MM-DD') THEN DEBIT ELSE 0 END) TOTAL_DEBIT,
        SUM(CASE WHEN DOC_DATE>=TO_DATE(:fromDate,'YYYY-MM-DD') THEN CREDIT ELSE 0 END) TOTAL_CREDIT,
        SUM(CASE WHEN CURRENCY_MODE IS NULL OR CURRENCY_MODE NOT IN (1,2) THEN 1 ELSE 0 END) INVALID_CURRENCY
      FROM source_rows GROUP BY A_CY
    ), detail AS (
      SELECT A_CY, SOURCE_ROW, TO_CHAR(DOC_DATE,'YYYY-MM-DD') DOCUMENT_DATE,
        TO_CHAR(DOC_TYPE) DOCUMENT_TYPE, TO_CHAR(DOC_NO) DOCUMENT_NUMBER,
        TO_CHAR(DOC_SER) DOCUMENT_SERIAL, TO_CHAR(RCRD_NO) RECORD_NUMBER, TO_CHAR(BRN_NO) BRANCH_NUMBER,
        DOC_DESC, TO_CHAR(DEBIT,'TM9','NLS_NUMERIC_CHARACTERS=''.,''') DEBIT,
        TO_CHAR(CREDIT,'TM9','NLS_NUMERIC_CHARACTERS=''.,''') CREDIT,
        ROW_NUMBER() OVER (ORDER BY DOC_DATE,DOC_SER,RCRD_NO,SOURCE_ROW) RN
      FROM source_rows WHERE DOC_DATE>=TO_DATE(:fromDate,'YYYY-MM-DD')
    ), total AS (SELECT COUNT(*) TOTAL FROM detail)
    SELECT total.TOTAL, (SELECT COUNT(*) FROM ${p.kind === 'salary' ? "IAS20261.S_EMP WHERE TO_CHAR(EMP_NO)=:code" : "IAS20261.GLS_ACCNT_DTL WHERE AC_CODE=:account AND AC_CODE_DTL=:code AND AC_DTL_TYP=5"}) ACCOUNT_EXISTS,
      s.CURRENCY,s.INVALID_CURRENCY,
      TO_CHAR(s.OPENING,'TM9','NLS_NUMERIC_CHARACTERS=''.,''') OPENING,
      TO_CHAR(s.TOTAL_DEBIT,'TM9','NLS_NUMERIC_CHARACTERS=''.,''') TOTAL_DEBIT,
      TO_CHAR(s.TOTAL_CREDIT,'TM9','NLS_NUMERIC_CHARACTERS=''.,''') TOTAL_CREDIT,
      d.* FROM total LEFT JOIN summary s ON 1=1
      LEFT JOIN detail d ON d.A_CY=s.CURRENCY AND d.RN<=5000 ORDER BY d.RN,s.CURRENCY`,
  };
}
module.exports = { hrStatementQuery };
