'use strict';

const crypto = require('node:crypto');

const VOUCHER_TYPE = 1;
const APPROVAL_DOCUMENT_TYPE = 92;
const PAYMENT_TYPES = { cash: 1, bank_transfer: 2 };

class Ias20261ReceiptConflictError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'Ias20261ReceiptConflictError';
    this.code = code;
  }
}

function buildReceiptSerial(branchYear, paymentType, requestNo) {
  if (![branchYear, paymentType, requestNo].every(Number.isSafeInteger)
      || branchYear < 1 || ![1, 2].includes(paymentType) || requestNo < 1) {
    throw new Error('Invalid receipt serial components');
  }
  return `${branchYear}000001${String(APPROVAL_DOCUMENT_TYPE).padStart(5, '0')}${paymentType}${String(requestNo).padStart(10, '0')}1`;
}

function buildReceiptReference(externalReference) {
  return `A${crypto.createHash('sha256').update(externalReference, 'utf8').digest('hex').slice(0, 14).toUpperCase()}`;
}

class Ias20261ReceiptWriter {
  constructor(driver, config) {
    this.driver = driver;
    this.config = config;
    this.pool = null;
  }

  async start() {
    this.driver.initOracleClient({ libDir: this.config.oracle.clientLibDir });
    this.driver.outFormat = this.driver.OUT_FORMAT_OBJECT;
    this.pool = await this.driver.createPool({
      user: this.config.oracle.user,
      password: this.config.oracle.password,
      connectString: this.config.oracle.connectString,
      poolMin: this.config.oracle.poolMin,
      poolMax: this.config.oracle.poolMax,
      poolIncrement: this.config.oracle.poolIncrement,
      queueTimeout: this.config.oracle.queueTimeout,
    });
    const connection = await this.pool.getConnection();
    try {
      const identity = await connection.execute("SELECT SYS_CONTEXT('USERENV','SESSION_USER') SESSION_USER FROM DUAL");
      if (identity.rows[0]?.SESSION_USER !== 'ALBINAA20261WRITER') {
        throw new Error('Oracle session is not ALBINAA20261WRITER');
      }
      const result = await connection.execute(`
        SELECT TABLE_NAME,PRIVILEGE
        FROM USER_TAB_PRIVS
        WHERE OWNER=:schema
          AND TABLE_NAME IN (
            'IAS_RQ_VCHR_MST','IAS_RQ_VCHR_DTL','S_APPRVD_MOV','IAS_DOC_SEQ_OTHR',
            'EX_RATE','IAS_PERIOD_EX_RATE_DAY','PRIV_CASH','CASH_IN_HAND','CASH_AT_BANK',
            'ACCOUNT_CURR','CUSTOMER_CURR','GLS_ACCNT_DTL','COLLERCTOR'
          )`, { schema: this.config.schema });
      const granted = new Set(result.rows.map((row) => `${row.TABLE_NAME}:${row.PRIVILEGE}`));
      const expected = [
        'IAS_RQ_VCHR_MST:SELECT','IAS_RQ_VCHR_MST:INSERT',
        'IAS_RQ_VCHR_DTL:SELECT','IAS_RQ_VCHR_DTL:INSERT',
        'S_APPRVD_MOV:INSERT','IAS_DOC_SEQ_OTHR:SELECT',
        'EX_RATE:SELECT','IAS_PERIOD_EX_RATE_DAY:SELECT',
        'PRIV_CASH:SELECT','CASH_IN_HAND:SELECT','CASH_AT_BANK:SELECT',
        'ACCOUNT_CURR:SELECT','CUSTOMER_CURR:SELECT','GLS_ACCNT_DTL:SELECT',
        'COLLERCTOR:SELECT',
      ];
      const missing = expected.filter((privilege) => !granted.has(privilege));
      if (missing.length) throw new Error(`ALBINAA20261WRITER is missing IAS20261 receipt privileges: ${missing.join(', ')}`);
      const forbidden = [...granted].filter((privilege) => /:(UPDATE|DELETE|ALTER|EXECUTE)$/.test(privilege));
      if (forbidden.length) throw new Error(`ALBINAA20261WRITER has forbidden IAS20261 receipt privileges: ${forbidden.join(', ')}`);
    } finally {
      await connection.rollback();
      await connection.close();
    }
  }

  async close() {
    if (this.pool) await this.pool.close(10);
    this.pool = null;
  }

  async resolveCurrency(connection, currencyCode) {
    const result = await connection.execute(`
      SELECT CUR_CODE,CUR_NAME,CUR_RATE,L_F,MIN_CUR_RATE,MAX_CUR_RATE,CUR_FRC_NO
      FROM ${this.config.schema}.EX_RATE WHERE CUR_CODE=:currencyCode`, { currencyCode });
    const currency = result.rows[0];
    if (!currency) throw new Error(`IAS20261 currency is invalid: ${currencyCode}`);
    const daily = await connection.execute(`
      SELECT CUR_RATE FROM ${this.config.schema}.IAS_PERIOD_EX_RATE_DAY
      WHERE A_CY=:currencyCode AND BRN_NO=1 AND TRUNC(SYSDATE) BETWEEN F_DATE AND T_DATE
      ORDER BY F_DATE DESC`, { currencyCode }, { maxRows: 1 });
    const rate = Number(daily.rows[0]?.CUR_RATE ?? currency.CUR_RATE);
    const fractionDigits = Number(currency.CUR_FRC_NO);
    if (!Number.isFinite(rate) || rate <= 0 || !Number.isInteger(fractionDigits)
        || fractionDigits < 0 || fractionDigits > 6) {
      throw new Error(`IAS20261 currency rate is invalid: ${currencyCode}`);
    }
    return {
      code: currency.CUR_CODE,
      nameAr: currency.CUR_NAME,
      local: Number(currency.L_F) === 1,
      rate,
      rateSource: daily.rows[0] ? 'IAS_PERIOD_EX_RATE_DAY' : 'EX_RATE',
      fractionDigits,
    };
  }

  localAmount(amount, currency) {
    if (currency.local) return amount;
    const factor = 10 ** currency.fractionDigits;
    return Math.round((amount * currency.rate + Number.EPSILON) * factor) / factor;
  }

  async validateLocation(connection, input) {
    const schema = this.config.schema;
    const table = input.paymentMethod === 'cash' ? 'CASH_IN_HAND' : 'CASH_AT_BANK';
    const numberColumn = input.paymentMethod === 'cash' ? 'CASH_NO' : 'BANK_NO';
    const cashType = input.paymentMethod === 'cash' ? 1 : 2;
    const location = await connection.execute(`
      SELECT L.A_CODE AS ACCOUNT_CODE
      FROM ${schema}.PRIV_CASH P
      JOIN ${schema}.${table} L ON L.${numberColumn}=P.CASH_NO
      WHERE P.U_ID=:oracleUserId AND P.CASH_TYPE=:cashType AND NVL(P.RCVD,0)=1
        AND P.CASH_NO=:cashOrBankNo AND NVL(L.INACTIVE,0)=0
        AND (L.CONN_BRN_NO IS NULL OR L.CONN_BRN_NO=1) AND ROWNUM=1`, {
      oracleUserId: this.config.oracleUserId,
      cashType,
      cashOrBankNo: input.cashOrBankNo,
    });
    if (!location.rows[0]) throw new Error('IAS20261 receipt cashbox or bank is invalid or not receipt-enabled');
    const accountCode = String(location.rows[0].ACCOUNT_CODE);
    const currency = await connection.execute(`
      SELECT 1 AS ALLOWED FROM ${schema}.ACCOUNT_CURR
      WHERE A_CODE=:accountCode AND A_CY=:currencyCode AND NVL(INACTIVE,0)=0 AND ROWNUM=1`, {
      accountCode,
      currencyCode: input.currencyCode,
    });
    if (!currency.rows[0]) throw new Error('IAS20261 receipt location currency is not enabled');
    return accountCode;
  }

  async validateLine(connection, line, index) {
    const schema = this.config.schema;
    if (line.analyticalType !== 3) {
      const account = await connection.execute(`
        SELECT 1 AS VALID_ACCOUNT FROM ${schema}.GLS_ACCNT_DTL
        WHERE AC_CODE=:accountCode AND AC_CODE_DTL=:analyticalAccountCode
          AND GRP_CODE=:analyticalType
          AND (CONN_BRN_NO IS NULL OR CONN_BRN_NO=1) AND ROWNUM=1`, {
        accountCode: line.accountCode,
        analyticalAccountCode: line.analyticalAccountCode,
        analyticalType: line.analyticalType,
      });
      if (!account.rows[0]) throw new Error(`Invalid IAS20261 receipt account on line ${index + 1}`);
    }
    const currency = line.analyticalType === 3
      ? await connection.execute(`
        SELECT 1 AS ALLOWED FROM ${schema}.CUSTOMER_CURR
        WHERE C_CODE=:analyticalAccountCode AND A_CY=:currencyCode
          AND NVL(INACTIVE,0)=0 AND ROWNUM=1`, {
        analyticalAccountCode: line.analyticalAccountCode,
        currencyCode: line.currencyCode,
      })
      : await connection.execute(`
        SELECT 1 AS ALLOWED FROM ${schema}.ACCOUNT_CURR
        WHERE A_CODE=:accountCode AND A_CY=:currencyCode
          AND NVL(INACTIVE,0)=0 AND ROWNUM=1`, {
        accountCode: line.accountCode,
        currencyCode: line.currencyCode,
      });
    if (!currency.rows[0]) throw new Error(`IAS20261 receipt account currency is not enabled on line ${index + 1}`);
  }

  async validateCollector(connection, collectorNo) {
    if (collectorNo == null) return;
    const result = await connection.execute(`
      SELECT 1 AS ALLOWED
      FROM ${this.config.schema}.COLLERCTOR C
      WHERE C.COL_NO=:collectorNo AND NVL(C.INACTIVE,0)=0 AND ROWNUM=1`, { collectorNo });
    if (!result.rows[0]) throw new Error('IAS20261 receipt collector is invalid or not allowed');
  }

  async identifierIssues(connection, input) {
    const issues = [];
    if (input.referenceNo) {
      const reference = await connection.execute(`
        SELECT VOUCHER_NO FROM ${this.config.schema}.IAS_RQ_VCHR_MST
        WHERE UPPER(TRIM(REF_NO))=UPPER(:referenceNo) AND ROWNUM=1`, { referenceNo: input.referenceNo });
      if (reference.rows[0]) issues.push({
        code: 'DUPLICATE_REFERENCE_NO', field: 'referenceNo', message: 'رقم المرجع مستخدم في طلب سند سابق',
      });
    }
    if (input.noticeNo) {
      const notice = await connection.execute(`
        SELECT VOUCHER_NO FROM ${this.config.schema}.IAS_RQ_VCHR_DTL
        WHERE UPPER(TRIM(NOTE_NO))=UPPER(:noticeNo) AND ROWNUM=1`, { noticeNo: input.noticeNo });
      if (notice.rows[0]) issues.push({
        code: 'DUPLICATE_NOTICE_NO', field: 'noticeNo', message: 'رقم الإشعار مستخدم في طلب سند سابق',
      });
    }
    return issues;
  }

  async prepare(connection, input) {
    if (input.kind !== 'receipt') throw new Error('IAS20261 receipt writer accepts receipt requests only');
    const issues = await this.identifierIssues(connection, input);
    await this.validateLocation(connection, input);
    await this.validateCollector(connection, input.collectorNo);
    const documentCurrency = await this.resolveCurrency(connection, input.currencyCode);
    const lines = [];
    for (const [index, line] of input.lines.entries()) {
      await this.validateLine(connection, line, index);
      const currency = await this.resolveCurrency(connection, line.currencyCode || input.currencyCode);
      const localAmount = this.localAmount(line.amount, currency);
      lines.push({
        ...line,
        lineNo: index + 1,
        currency,
        localAmount,
        signedLocal: -localAmount,
        signedForeign: currency.local ? null : -line.amount,
      });
    }
    const documentLocalAmount = this.localAmount(input.amount, documentCurrency);
    const counterpartyLocalAmount = lines.reduce((sum, line) => sum + line.localAmount, 0);
    const localBalance = Math.round((documentLocalAmount - counterpartyLocalAmount + Number.EPSILON) * 100) / 100;
    if (localBalance !== 0) issues.push({
      code: 'UNBALANCED_LOCAL_AMOUNT', field: 'amount',
      message: 'قيمة الصندوق أو البنك لا تساوي مجموع أطراف سند القبض بالعملة المحلية',
    });
    return { issues, documentCurrency, documentLocalAmount, counterpartyLocalAmount, localBalance, lines };
  }

  async dryRun(input) {
    if (!this.pool) throw new Error('IAS20261 receipt writer is not started');
    const connection = await this.pool.getConnection();
    connection.callTimeout = this.config.oracle.callTimeout;
    try {
      await connection.execute('SET TRANSACTION READ ONLY');
      const prepared = await this.prepare(connection, input);
      await connection.rollback();
      return {
        valid: prepared.issues.length === 0,
        issues: prepared.issues,
        mode: 'DRY_RUN',
        oracleWrite: 'NONE',
        schema: this.config.schema,
        saveAllowed: prepared.issues.length === 0,
        kind: 'receipt',
        paymentMethod: input.paymentMethod,
        documentAmount: input.amount,
        documentCurrency: prepared.documentCurrency.code,
        documentCurrencyName: prepared.documentCurrency.nameAr,
        exchangeRate: prepared.documentCurrency.rate,
        rateSource: prepared.documentCurrency.rateSource,
        localAmount: prepared.documentLocalAmount,
        counterpartyLocalAmount: prepared.counterpartyLocalAmount,
        localBalance: prepared.localBalance,
        lines: prepared.lines.map((line) => ({
          lineNo: line.lineNo,
          accountCode: line.accountCode,
          analyticalAccountCode: line.analyticalAccountCode,
          analyticalType: line.analyticalType,
          currencyCode: line.currency.code,
          currencyName: line.currency.nameAr,
          amount: line.amount,
          exchangeRate: line.currency.rate,
          rateSource: line.currency.rateSource,
          localAmount: line.localAmount,
        })),
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.close();
    }
  }

  async nextDocumentSequence(connection) {
    const result = await connection.execute(`SELECT ${this.config.schema}.IAS_DOC_SEQ_OTHR.NEXTVAL DOC_SEQUENCE FROM DUAL`);
    return result.rows[0].DOC_SEQUENCE;
  }

  async createDraft(input) {
    if (!this.pool) throw new Error('IAS20261 receipt writer is not started');
    if (input.kind !== 'receipt') throw new Error('IAS20261 receipt writer accepts receipt requests only');
    const connection = await this.pool.getConnection();
    connection.callTimeout = this.config.oracle.callTimeout;
    const schema = this.config.schema;
    const referenceToken = buildReceiptReference(input.externalReference);
    const paymentType = PAYMENT_TYPES[input.paymentMethod];
    try {
      await connection.execute(`LOCK TABLE ${schema}.IAS_RQ_VCHR_MST IN EXCLUSIVE MODE NOWAIT`);
      const existing = await connection.execute(`
        SELECT VOUCHER_NO,TO_CHAR(V_SER,'FM99999999999999999999999999999999999999') V_SER
        FROM ${schema}.IAS_RQ_VCHR_MST WHERE FIELD10=:referenceToken AND ROWNUM=1`, { referenceToken });
      if (existing.rows[0]) {
        await connection.rollback();
        return {
          created: false,
          requestNo: String(existing.rows[0].VOUCHER_NO),
          requestSerial: existing.rows[0].V_SER,
          schema,
        };
      }

      await connection.execute(`LOCK TABLE ${schema}.IAS_RQ_VCHR_DTL IN EXCLUSIVE MODE NOWAIT`);
      const prepared = await this.prepare(connection, input);
      if (prepared.issues.length) {
        throw new Ias20261ReceiptConflictError(
          'INVALID_RECEIPT_DRAFT',
          prepared.issues.map((issue) => issue.message).join('، '),
        );
      }
      const next = await connection.execute(`
        SELECT NVL(MAX(VOUCHER_NO),0)+1 NEXT_REQUEST_NO FROM ${schema}.IAS_RQ_VCHR_MST
        WHERE VOUCHER_TYPE=:voucherType AND VOUCHER_PAY_TYPE=:paymentType`, {
        voucherType: VOUCHER_TYPE,
        paymentType,
      });
      const requestNo = Number(next.rows[0].NEXT_REQUEST_NO);
      const requestSerial = buildReceiptSerial(this.config.branchYear, paymentType, requestNo);
      const masterSequence = await this.nextDocumentSequence(connection);
      const isTransfer = input.paymentMethod === 'bank_transfer';

      await connection.execute(`
        INSERT INTO ${schema}.IAS_RQ_VCHR_MST (
          VOUCHER_TYPE,VOUCHER_PAY_TYPE,VOUCHER_NO,CASH_NO,A_CY,V_SER,VOUCHER_DATE,
          CASH_AMT,CASH_AMTF,EX_RATE,REF_NO,A_DESC,STAND_BY,TRANSFER,CHEQ_TYPE,COL_NO,
          COMM_PER,V_TYPE_NO,DOC_SEQUENCE,DOC_BRN_NO,PROCESED,APPROVED,INACTIVE,
          REC_NAME,REQ_SIDE,DOC_TYPE,FIELD10,MOVE_CHEQ_PY,MOVD_YR,AD_U_ID,AD_DATE,
          CMP_NO,BRN_NO,BRN_YEAR,BRN_USR,AD_TRMNL_NM
        ) VALUES (
          :voucherType,:paymentType,:requestNo,:cashOrBankNo,:currencyCode,:requestSerial,
          TRUNC(SYSDATE),:localAmount,:foreignAmount,:exchangeRate,
          :referenceNo,:description,0,:transfer,:chequeType,:collectorNo,:commissionPercent,
          1,:masterSequence,1,0,0,0,:recipientName,'منصة البناء الراقي',:documentType,
          :referenceToken,0,0,:oracleUserId,SYSDATE,1,1,:branchYear,1,SYS_CONTEXT('USERENV','HOST')
        )`, {
        voucherType: VOUCHER_TYPE,
        paymentType,
        requestNo,
        cashOrBankNo: input.cashOrBankNo,
        currencyCode: prepared.documentCurrency.code,
        requestSerial,
        localAmount: prepared.documentLocalAmount,
        foreignAmount: prepared.documentCurrency.local ? null : input.amount,
        exchangeRate: prepared.documentCurrency.rate,
        referenceNo: input.referenceNo,
        description: input.description,
        transfer: isTransfer ? 1 : null,
        chequeType: isTransfer ? 0 : null,
        collectorNo: input.collectorNo,
        commissionPercent: input.commissionPercent,
        recipientName: input.recipientName,
        masterSequence,
        documentType: APPROVAL_DOCUMENT_TYPE,
        referenceToken,
        oracleUserId: this.config.oracleUserId,
        branchYear: this.config.branchYear,
      });

      for (const line of prepared.lines) {
        const detailSequence = await this.nextDocumentSequence(connection);
        await connection.execute(`
          INSERT INTO ${schema}.IAS_RQ_VCHR_DTL (
            VOUCHER_TYPE,VOUCHER_PAY_TYPE,VOUCHER_NO,CASH_NO,V_SER,A_CODE,AC_CODE_DTL,
            AC_DTL_TYP,A_CY,AC_DESC,AC_AMT,AC_AMTF,EX_RATE,VALUE_DATE,CHEQUE_VALUED,
            NOTE_NO,REF_NO,RCRD_NO,DOC_SEQUENCE,DOC_BRN_NO,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR
          ) VALUES (
            :voucherType,:paymentType,:requestNo,:cashOrBankNo,:requestSerial,:accountCode,
            :analyticalAccountCode,:analyticalType,:currencyCode,:description,:signedLocal,
            :signedForeign,:exchangeRate,TRUNC(SYSDATE),:chequeValued,
            :noticeNo,:referenceNo,:lineNo,:detailSequence,1,1,1,:branchYear,1
          )`, {
          voucherType: VOUCHER_TYPE,
          paymentType,
          requestNo,
          cashOrBankNo: input.cashOrBankNo,
          requestSerial,
          accountCode: line.accountCode,
          analyticalAccountCode: line.analyticalAccountCode,
          analyticalType: line.analyticalType,
          currencyCode: line.currency.code,
          description: line.description || input.description,
          signedLocal: line.signedLocal,
          signedForeign: line.signedForeign,
          exchangeRate: line.currency.rate,
          chequeValued: isTransfer ? 1 : 0,
          noticeNo: line.lineNo === 1 ? input.noticeNo : null,
          referenceNo: line.lineNo === 1 ? input.referenceNo : null,
          lineNo: line.lineNo,
          detailSequence,
          branchYear: this.config.branchYear,
        });
      }

      await connection.execute(`
        INSERT INTO ${schema}.S_APPRVD_MOV (
          LVL_NO,DOC_TYP,DOC_SER,DOC_NO,DOC_JV_TYP,DOC_DATE,DOC_AMT,
          APPRVD,ORDR_NO,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR,AD_U_ID,AD_DATE,AD_TRMNL_NM
        ) VALUES (
          1,:documentType,:requestSerial,:requestNo,:voucherType,TRUNC(SYSDATE),
          :localAmount,0,1,1,1,:branchYear,1,:oracleUserId,SYSDATE,SYS_CONTEXT('USERENV','HOST')
        )`, {
        documentType: APPROVAL_DOCUMENT_TYPE,
        requestSerial,
        requestNo,
        voucherType: VOUCHER_TYPE,
        localAmount: prepared.documentLocalAmount,
        branchYear: this.config.branchYear,
        oracleUserId: this.config.oracleUserId,
      });
      await connection.commit();
      return {
        created: true,
        requestNo: String(requestNo),
        requestSerial,
        schema,
        status: 'pending_approval',
        oracleWrite: 'INSERT_ONLY',
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.close();
    }
  }
}

module.exports = {
  Ias20261ReceiptConflictError,
  Ias20261ReceiptWriter,
  buildReceiptReference,
  buildReceiptSerial,
};
