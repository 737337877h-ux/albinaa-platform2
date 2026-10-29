'use strict';

// Fixed schema; all user input is bound. Serial and monetary values stay strings.
function quotationList({ search = '', afterSerial = null, limit = 25 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid limit');
  if (afterSerial !== null && !/^\d{1,38}$/.test(afterSerial)) throw new Error('Invalid cursor');
  if (typeof search !== 'string' || search.length > 100) throw new Error('Invalid search');
  return {
    sql: `SELECT * FROM (
      SELECT TO_CHAR(Q.QUOT_SER) SERIAL, TO_CHAR(Q.QUOT_NO) DOCUMENT_NO,
        TO_CHAR(Q.QUOT_DATE,'YYYY-MM-DD') DOCUMENT_DATE, Q.C_NAME CUSTOMER_NAME,
        Q.QUOT_CUR CURRENCY, TO_CHAR(Q.QUOT_AMT) AMOUNT,
        TO_CHAR(Q.DISC_AMT) DISCOUNT, TO_CHAR(Q.VAT_AMT) VAT,
        TO_CHAR(Q.OTHR_AMT) OTHER_AMOUNT, Q.APPROVED, Q.PROCESSED, Q.INACTIVE,
        TO_CHAR(Q.BRN_NO) BRANCH_NO, T.QT_A_NAME TYPE_NAME
      FROM IAS20261.QUOTATION Q
      LEFT JOIN IAS20261.IAS_QUOT_TYPES T ON T.QT_TYPE=Q.QT_TYPE
      WHERE (:afterSerial IS NULL OR Q.QUOT_SER < TO_NUMBER(:afterSerial))
        AND (:search IS NULL OR INSTR(UPPER(Q.C_NAME),UPPER(:search)) > 0
          OR INSTR(TO_CHAR(Q.QUOT_NO),:search) > 0)
      ORDER BY Q.QUOT_SER DESC
    ) WHERE ROWNUM <= :fetchLimit`,
    binds: { afterSerial, search: search.trim() || null, fetchLimit: limit + 1 },
  };
}

function quotationLines(serial) {
  if (!/^\d{1,38}$/.test(serial)) throw new Error('Invalid serial');
  return {
    sql: `SELECT TO_CHAR(D.RCRD_NO) LINE_NO, D.I_CODE ITEM_CODE,
      COALESCE(TRIM(D.ITEM_DESC),
        (SELECT COALESCE(MAX(TRIM(I.I_NAME)),MAX(TRIM(I.I_E_NAME)))
         FROM IAS20261.ITEM_DETAILS I WHERE I.I_CODE=D.I_CODE),D.I_CODE) DESCRIPTION,
      D.ITM_UNT UNIT, TO_CHAR(D.I_QTY) QUANTITY, TO_CHAR(D.P_SIZE) PACKAGE_SIZE,
      TO_CHAR(D.I_PRICE) PRICE, TO_CHAR(D.DIS_AMT) DISCOUNT, TO_CHAR(D.VAT_AMT) VAT,
      TO_CHAR(D.W_CODE) WAREHOUSE
      FROM IAS20261.QUOTATION_DETAIL D WHERE D.QUOT_SER=TO_NUMBER(:serial)
      ORDER BY D.RCRD_NO`,
    binds: { serial },
  };
}

module.exports = { quotationList, quotationLines };
