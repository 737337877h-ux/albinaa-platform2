'use strict';

const crypto = require('node:crypto');

const REQUEST_TYPE = 1;
const APPROVAL_DOCUMENT_TYPE = 31;
const APPROVAL_LEVEL = 1;
const PURCHASE_REQUEST_TYPE = 1;
const PURCHASE_APPROVAL_DOCUMENT_TYPE = 40;
const VOUCHER_APPROVAL_DOCUMENT_TYPES = { receipt: 92, payment: 93 };
const VOUCHER_TYPES = { receipt: 1, payment: 2 };
const VOUCHER_PAYMENT_TYPES = { cash: 1, bank_transfer: 2 };
const JOURNAL_DOCUMENT_TYPE = 85;
const JOURNAL_TYPE = 1;
const INVENTORY_COUNT_TYPES = new Set([1, 2]);

class OracleConflictError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OracleConflictError';
    this.code = code;
  }
}

function buildRequestSerial(branchYear, requestType, requestNo) {
  if (![branchYear, requestType, requestNo].every(Number.isSafeInteger) || requestNo < 1 || requestType < 1) {
    throw new Error('Invalid request serial components');
  }
  return `${branchYear}${String(requestType).padStart(6, '0')}${requestNo}`;
}

function buildPurchaseReference(externalReference) {
  return `A${crypto.createHash('sha256').update(externalReference, 'utf8').digest('hex').slice(0, 14).toUpperCase()}`;
}

function buildVoucherSerial(branchYear, documentType, paymentType, requestNo) {
  return `${branchYear}000001${String(documentType).padStart(5, '0')}${paymentType}${String(requestNo).padStart(10, '0')}1`;
}

function buildJournalSerial(branchYear, documentType, journalType, requestNo) {
  return `${branchYear}000001${String(documentType).padStart(5, '0')}${String(journalType).padStart(3, '0')}${requestNo}`;
}

function buildInventorySerial(branchYear, inventoryType, inventoryNo) {
  if (![branchYear, inventoryType, inventoryNo].every(Number.isSafeInteger)
      || branchYear < 1 || inventoryType < 1 || inventoryNo < 1) {
    throw new Error('Invalid inventory serial components');
  }
  return `${branchYear}${String(inventoryType).padStart(6, '0')}33${inventoryNo}`;
}

function buildInventoryReference(externalReference) {
  return buildPurchaseReference(externalReference);
}

class OracleOutRequestWriter {
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
      if (identity.rows[0]?.SESSION_USER !== 'ALBINAAWRITER') throw new Error('Oracle session is not ALBINAAWRITER');
      const requiredPrivileges = await connection.execute(`
        SELECT TABLE_NAME, PRIVILEGE
        FROM USER_TAB_PRIVS
        WHERE OWNER=:schema AND TABLE_NAME IN (
          'S_APPRVD_MOV','P_REQUEST','P_REQUEST_DETAIL','IAS_DOC_SEQ_OTHR',
          'EX_RATE','IAS_PERIOD_EX_RATE_DAY','IAS_RQ_VCHR_MST','IAS_RQ_VCHR_DTL',
          'IAS_RQ_JRNL_MST','IAS_RQ_JRNL_DTL','WAREHOUSE_DETAILS','ITEM_DETAILS',
          'IAS_V_ITM_AVLQTY','IAS_INV_TYPES','IAS_PRIV_INV_TYPE','MASTER_INV','DETAIL_INV'
        )`, {
        schema: this.config.schema,
      });
      const granted = new Set(requiredPrivileges.rows.map((row) => `${row.TABLE_NAME}:${row.PRIVILEGE}`));
      const expected = [
        'S_APPRVD_MOV:INSERT',
        'P_REQUEST:SELECT',
        'P_REQUEST:INSERT',
        'P_REQUEST_DETAIL:SELECT',
        'P_REQUEST_DETAIL:INSERT',
        'IAS_DOC_SEQ_OTHR:SELECT',
        'EX_RATE:SELECT',
        'IAS_PERIOD_EX_RATE_DAY:SELECT',
        'IAS_RQ_VCHR_MST:SELECT',
        'IAS_RQ_VCHR_MST:INSERT',
        'IAS_RQ_VCHR_DTL:SELECT',
        'IAS_RQ_VCHR_DTL:INSERT',
        'IAS_RQ_JRNL_MST:SELECT',
        'IAS_RQ_JRNL_MST:INSERT',
        'IAS_RQ_JRNL_DTL:SELECT',
        'IAS_RQ_JRNL_DTL:INSERT',
        'WAREHOUSE_DETAILS:SELECT',
        'ITEM_DETAILS:SELECT',
        'IAS_V_ITM_AVLQTY:SELECT',
        'IAS_INV_TYPES:SELECT',
        'IAS_PRIV_INV_TYPE:SELECT',
        'MASTER_INV:SELECT',
        'MASTER_INV:INSERT',
        'DETAIL_INV:SELECT',
        'DETAIL_INV:INSERT',
      ];
      const missing = expected.filter((privilege) => !granted.has(privilege));
      if (missing.length) {
        throw new Error(`ALBINAAWRITER is missing IAS20191 privileges: ${missing.join(', ')}`);
      }
    } finally {
      await connection.rollback();
      await connection.close();
    }
  }

  async startReadOnly() {
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
      if (identity.rows[0]?.SESSION_USER !== 'ALBINAA_RO') {
        throw new Error('Oracle read-only Dry Run session is not ALBINAA_RO');
      }
    } finally {
      await connection.rollback();
      await connection.close();
    }
  }

  async close() {
    if (this.pool) await this.pool.close(10);
    this.pool = null;
  }

  async withReadConnection(callback) {
    if (!this.pool) throw new Error('Oracle writer pool is not started');
    const connection = await this.pool.getConnection();
    connection.callTimeout = this.config.oracle.callTimeout;
    try {
      await connection.execute('SET TRANSACTION READ ONLY');
      const result = await callback(connection);
      await connection.rollback();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.close();
    }
  }

  async listCurrencies() {
    return this.withReadConnection(async (connection) => {
      const result = await connection.execute(`
        SELECT CUR_NO,CUR_CODE,CUR_NAME,CUR_E_NAME,CUR_RATE,L_F,STOCK_CUR,
               MIN_CUR_RATE,MAX_CUR_RATE,CUR_FRC_NO,
               TO_CHAR(NVL(UP_DATE,AD_DATE),'YYYY-MM-DD HH24:MI:SS') RATE_UPDATED_AT
        FROM ${this.config.schema}.EX_RATE ORDER BY CUR_NO`);
      return {
        schema: this.config.schema,
        oracleWrite: 'NONE',
        currencies: result.rows.map((row) => ({
          number: String(row.CUR_NO), code: row.CUR_CODE, nameAr: row.CUR_NAME,
          nameEn: row.CUR_E_NAME, rate: String(row.CUR_RATE), local: Number(row.L_F) === 1,
          stockCurrency: Number(row.STOCK_CUR) === 1,
          minRate: row.MIN_CUR_RATE == null ? null : String(row.MIN_CUR_RATE),
          maxRate: row.MAX_CUR_RATE == null ? null : String(row.MAX_CUR_RATE),
          fractionDigits: Number(row.CUR_FRC_NO), rateUpdatedAt: row.RATE_UPDATED_AT,
        })),
      };
    });
  }

  async resolveCurrency(connection, currencyCode) {
    const result = await connection.execute(`
      SELECT CUR_CODE,CUR_NAME,CUR_RATE,L_F,MIN_CUR_RATE,MAX_CUR_RATE,CUR_FRC_NO
      FROM ${this.config.schema}.EX_RATE WHERE CUR_CODE=:currencyCode`, { currencyCode });
    const currency = result.rows[0];
    if (!currency) throw new Error(`IAS20191 currency is invalid: ${currencyCode}`);
    const daily = await connection.execute(`
      SELECT CUR_RATE FROM ${this.config.schema}.IAS_PERIOD_EX_RATE_DAY
      WHERE A_CY=:currencyCode AND BRN_NO=1
        AND TO_DATE(:requestDate,'YYYY-MM-DD') BETWEEN F_DATE AND T_DATE
      ORDER BY F_DATE DESC`, { currencyCode, requestDate: this.config.requestDate }, { maxRows: 1 });
    const rate = Number(daily.rows[0]?.CUR_RATE ?? currency.CUR_RATE);
    const digits = Number(currency.CUR_FRC_NO);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`IAS20191 currency rate is invalid: ${currencyCode}`);
    return {
      code: currency.CUR_CODE, nameAr: currency.CUR_NAME, local: Number(currency.L_F) === 1,
      rate, rateSource: daily.rows[0] ? 'IAS_PERIOD_EX_RATE_DAY' : 'EX_RATE', fractionDigits: digits,
      minRate: currency.MIN_CUR_RATE == null ? null : Number(currency.MIN_CUR_RATE),
      maxRate: currency.MAX_CUR_RATE == null ? null : Number(currency.MAX_CUR_RATE),
    };
  }

  localAmount(amount, currency) {
    if (currency.local) return amount;
    const factor = 10 ** currency.fractionDigits;
    return Math.round((amount * currency.rate + Number.EPSILON) * factor) / factor;
  }

  async voucherIdentifierIssues(connection, input) {
    const issues = [];
    if (input.referenceNo) {
      const reference = await connection.execute(`
        SELECT VOUCHER_NO FROM ${this.config.schema}.IAS_RQ_VCHR_MST
        WHERE UPPER(TRIM(REF_NO))=UPPER(:referenceNo) AND ROWNUM=1`, {
        referenceNo: input.referenceNo,
      });
      if (reference.rows[0]) issues.push({
        code: 'DUPLICATE_REFERENCE_NO', field: 'referenceNo',
        message: 'رقم المرجع مستخدم في طلب سند سابق',
      });
    }
    if (input.noticeNo) {
      const notice = await connection.execute(`
        SELECT VOUCHER_NO FROM ${this.config.schema}.IAS_RQ_VCHR_DTL
        WHERE UPPER(TRIM(NOTE_NO))=UPPER(:noticeNo) AND ROWNUM=1`, {
        noticeNo: input.noticeNo,
      });
      if (notice.rows[0]) issues.push({
        code: 'DUPLICATE_NOTICE_NO', field: 'noticeNo',
        message: 'رقم الإشعار مستخدم في طلب سند سابق',
      });
    }
    return issues;
  }

  async dryRunVoucherRequest(input) {
    return this.withReadConnection(async (connection) => {
      const issues = await this.voucherIdentifierIssues(connection, input);
      const currency = await this.resolveCurrency(connection, input.currencyCode);
      const inputLines = input.lines ?? [{
        amount: input.amount, currencyCode: input.currencyCode, accountCode: input.accountCode,
        analyticalAccountCode: input.analyticalAccountCode,
        analyticalType: input.analyticalType, description: input.description,
      }];
      const lines = [];
      for (const [index, line] of inputLines.entries()) {
        const lineCurrency = await this.resolveCurrency(connection, line.currencyCode || input.currencyCode);
        const localAmount = this.localAmount(line.amount, lineCurrency);
        lines.push({
          lineNo: index + 1, ...line,
          currencyCode: lineCurrency.code, currencyName: lineCurrency.nameAr,
          exchangeRate: lineCurrency.rate, rateSource: lineCurrency.rateSource, localAmount,
          AC_AMT: (input.kind === 'receipt' ? -1 : 1) * localAmount,
          AC_AMTF: lineCurrency.local ? null : (input.kind === 'receipt' ? -1 : 1) * line.amount,
        });
      }
      const documentAmount = input.amount;
      const localAmount = this.localAmount(documentAmount, currency);
      const counterpartyLocalAmount = lines.reduce((sum, line) => sum + line.localAmount, 0);
      const localBalance = Math.round((localAmount - counterpartyLocalAmount + Number.EPSILON) * 100) / 100;
      if (localBalance !== 0) issues.push({
        code: 'UNBALANCED_LOCAL_AMOUNT', field: 'amount',
        message: 'قيمة الصندوق أو البنك لا تساوي مجموع أطراف السند بالعملة المحلية',
      });
      return {
        valid: issues.length === 0, issues, oracleWrite: 'NONE', schema: this.config.schema,
        kind: input.kind, paymentMethod: input.paymentMethod,
        documentAmount, documentCurrency: currency.code,
        documentCurrencyName: currency.nameAr, exchangeRate: currency.rate,
        rateSource: currency.rateSource, localAmount, counterpartyLocalAmount, localBalance,
        localCurrency: (await this.resolveLocalCurrency(connection)).code,
        lines,
        oracleFields: {
          A_CY: currency.code, EX_RATE: currency.rate, CASH_AMT: localAmount,
          CASH_AMTF: currency.local ? null : documentAmount,
        },
      };
    });
  }

  async resolveLocalCurrency(connection) {
    const result = await connection.execute(`
      SELECT CUR_CODE,CUR_NAME,CUR_RATE FROM ${this.config.schema}.EX_RATE WHERE L_F=1`);
    if (result.rows.length !== 1) throw new Error('IAS20191 must define exactly one local currency');
    return { code: result.rows[0].CUR_CODE, nameAr: result.rows[0].CUR_NAME, rate: Number(result.rows[0].CUR_RATE) };
  }

  async dryRunJournalRequest(input) {
    return this.withReadConnection(async (connection) => {
      const lines = [];
      for (const [index, line] of input.lines.entries()) {
        const currency = await this.resolveCurrency(connection, line.currencyCode);
        const local = this.localAmount(line.amount, currency);
        const signed = (line.direction === 'debit' ? 1 : -1);
        lines.push({
          lineNo: index + 1, ...line, currencyName: currency.nameAr,
          exchangeRate: currency.rate, rateSource: currency.rateSource,
          localAmount: local, J_AMT: signed * local,
          J_AMT_F: currency.local ? 0 : signed * line.amount,
        });
      }
      const localBalance = lines.reduce((sum, line) => sum + line.J_AMT, 0);
      const roundedBalance = Math.round((localBalance + Number.EPSILON) * 100) / 100;
      return {
        valid: roundedBalance === 0, oracleWrite: 'NONE', schema: this.config.schema,
        localCurrency: (await this.resolveLocalCurrency(connection)).code,
        localBalance: roundedBalance, lines,
        issues: roundedBalance === 0 ? [] : [{ code: 'UNBALANCED_LOCAL_AMOUNT', message: 'القيد غير متوازن بالعملة المحلية' }],
      };
    });
  }

  async nextDocumentSequence(connection) {
    const result = await connection.execute(`SELECT ${this.config.schema}.IAS_DOC_SEQ_OTHR.NEXTVAL DOC_SEQUENCE FROM DUAL`);
    return result.rows[0].DOC_SEQUENCE;
  }

  async createVoucherRequestDraft(input) {
    if (!this.pool) throw new Error('Oracle writer pool is not started');
    const connection = await this.pool.getConnection();
    connection.callTimeout = this.config.oracle.callTimeout;
    const schema = this.config.schema;
    const referenceToken = buildPurchaseReference(input.externalReference);
    const voucherType = VOUCHER_TYPES[input.kind];
    const paymentType = VOUCHER_PAYMENT_TYPES[input.paymentMethod];
    const documentType = VOUCHER_APPROVAL_DOCUMENT_TYPES[input.kind];
    try {
      await connection.execute(`LOCK TABLE ${schema}.IAS_RQ_VCHR_MST IN EXCLUSIVE MODE`);
      const existing = await connection.execute(`
        SELECT VOUCHER_NO,TO_CHAR(V_SER,'FM99999999999999999999999999999999999999') V_SER
        FROM ${schema}.IAS_RQ_VCHR_MST
        WHERE FIELD10=:referenceToken AND ROWNUM=1`, { referenceToken });
      if (existing.rows[0]) {
        await connection.rollback();
        return { created: false, requestNo: String(existing.rows[0].VOUCHER_NO), requestSerial: existing.rows[0].V_SER };
      }

      await connection.execute(`LOCK TABLE ${schema}.IAS_RQ_VCHR_DTL IN EXCLUSIVE MODE`);
      const identifierIssues = await this.voucherIdentifierIssues(connection, input);
      if (identifierIssues.length) {
        throw new OracleConflictError(
          'DUPLICATE_VOUCHER_IDENTIFIER',
          identifierIssues.map((issue) => issue.message).join('، '),
        );
      }

      const currency = await this.resolveCurrency(connection, input.currencyCode);
      const inputLines = input.lines ?? [{
        amount: input.amount, currencyCode: input.currencyCode, accountCode: input.accountCode,
        analyticalAccountCode: input.analyticalAccountCode,
        analyticalType: input.analyticalType, description: input.description,
      }];
      const prepared = [];
      for (const [index, line] of inputLines.entries()) {
        const lineCurrency = await this.resolveCurrency(connection, line.currencyCode || input.currencyCode);
        const lineLocalAmount = this.localAmount(line.amount, lineCurrency);
        prepared.push({
          ...line, lineNo: index + 1, currency: lineCurrency, lineLocalAmount,
          signedLocal: (input.kind === 'receipt' ? -1 : 1) * lineLocalAmount,
          signedForeign: lineCurrency.local ? null : (input.kind === 'receipt' ? -1 : 1) * line.amount,
        });
      }
      const documentAmount = input.amount;
      const localAmount = this.localAmount(documentAmount, currency);
      const counterpartyLocalAmount = prepared.reduce((sum, line) => sum + line.lineLocalAmount, 0);
      const localBalance = Math.round((localAmount - counterpartyLocalAmount + Number.EPSILON) * 100) / 100;
      if (localBalance !== 0) {
        throw new Error('Voucher request is not balanced in local currency');
      }
      const next = await connection.execute(`
        SELECT NVL(MAX(VOUCHER_NO),0)+1 NEXT_REQUEST_NO FROM ${schema}.IAS_RQ_VCHR_MST
        WHERE VOUCHER_TYPE=:voucherType AND VOUCHER_PAY_TYPE=:paymentType`, { voucherType, paymentType });
      const requestNo = Number(next.rows[0].NEXT_REQUEST_NO);
      const requestSerial = buildVoucherSerial(this.config.branchYear, documentType, paymentType, requestNo);
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
          TO_DATE(:requestDate,'YYYY-MM-DD'),:localAmount,:foreignAmount,:exchangeRate,
          :referenceNo,:description,0,:transfer,:chequeType,:collectorNo,:commissionPercent,
          1,:masterSequence,1,0,0,0,:recipientName,'منصة البناء الراقي',:documentType,
          :referenceToken,0,0,1,SYSDATE,1,1,:branchYear,1,SYS_CONTEXT('USERENV','HOST')
        )`, {
        voucherType, paymentType, requestNo, cashOrBankNo: input.cashOrBankNo,
        currencyCode: currency.code, requestSerial, requestDate: this.config.requestDate,
        localAmount, foreignAmount: currency.local ? null : documentAmount, exchangeRate: currency.rate,
        referenceNo: input.referenceNo, description: input.description,
        transfer: isTransfer ? 1 : null, chequeType: isTransfer ? 0 : null,
        collectorNo: input.collectorNo, commissionPercent: input.commissionPercent,
        masterSequence, recipientName: input.recipientName, documentType, referenceToken,
        branchYear: this.config.branchYear,
      });

      for (const line of prepared) {
        const detailSequence = await this.nextDocumentSequence(connection);
        await connection.execute(`
          INSERT INTO ${schema}.IAS_RQ_VCHR_DTL (
            VOUCHER_TYPE,VOUCHER_PAY_TYPE,VOUCHER_NO,CASH_NO,V_SER,A_CODE,AC_CODE_DTL,
            AC_DTL_TYP,A_CY,AC_DESC,AC_AMT,AC_AMTF,EX_RATE,VALUE_DATE,CHEQUE_VALUED,
            NOTE_NO,REF_NO,RCRD_NO,DOC_SEQUENCE,DOC_BRN_NO,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR
          ) VALUES (
            :voucherType,:paymentType,:requestNo,:cashOrBankNo,:requestSerial,:accountCode,
            :analyticalAccountCode,:analyticalType,:currencyCode,:description,:signedLocal,
            :signedForeign,:exchangeRate,TO_DATE(:requestDate,'YYYY-MM-DD'),:chequeValued,
            :noticeNo,:detailReferenceNo,:lineNo,:detailSequence,1,1,1,:branchYear,1
          )`, {
          voucherType, paymentType, requestNo, cashOrBankNo: input.cashOrBankNo, requestSerial,
          accountCode: line.accountCode, analyticalAccountCode: line.analyticalAccountCode,
          analyticalType: line.analyticalType, currencyCode: line.currency.code,
          description: line.description || input.description, signedLocal: line.signedLocal,
          signedForeign: line.signedForeign, exchangeRate: line.currency.rate,
          requestDate: this.config.requestDate, chequeValued: isTransfer ? 1 : 0,
          noticeNo: line.lineNo === 1 ? input.noticeNo : null,
          detailReferenceNo: line.lineNo === 1 && input.kind === 'payment' ? input.referenceNo : null,
          lineNo: line.lineNo, detailSequence, branchYear: this.config.branchYear,
        });
      }

      await connection.execute(`
        INSERT INTO ${schema}.S_APPRVD_MOV (
          LVL_NO,DOC_TYP,DOC_SER,DOC_NO,DOC_JV_TYP,DOC_DATE,DOC_AMT,
          APPRVD,ORDR_NO,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR
        ) VALUES (1,:documentType,:requestSerial,:requestNo,:voucherType,
          TO_DATE(:requestDate,'YYYY-MM-DD'),:localAmount,0,1,1,1,:branchYear,1)`, {
        documentType, requestSerial, requestNo, voucherType,
        requestDate: this.config.requestDate, localAmount, branchYear: this.config.branchYear,
      });
      await connection.commit();
      return { created: true, requestNo: String(requestNo), requestSerial };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.close();
    }
  }

  async createJournalRequestDraft(input) {
    if (!this.pool) throw new Error('Oracle writer pool is not started');
    const connection = await this.pool.getConnection();
    connection.callTimeout = this.config.oracle.callTimeout;
    const schema = this.config.schema;
    const referenceToken = buildPurchaseReference(input.externalReference);
    try {
      await connection.execute(`LOCK TABLE ${schema}.IAS_RQ_JRNL_MST IN EXCLUSIVE MODE`);
      const existing = await connection.execute(`
        SELECT J_DOC_NO,TO_CHAR(J_SER,'FM99999999999999999999999999999999999999') J_SER
        FROM ${schema}.IAS_RQ_JRNL_MST WHERE FIELD10=:referenceToken AND ROWNUM=1`, { referenceToken });
      if (existing.rows[0]) {
        await connection.rollback();
        return { created: false, requestNo: String(existing.rows[0].J_DOC_NO), requestSerial: existing.rows[0].J_SER };
      }

      const prepared = [];
      for (const [index, line] of input.lines.entries()) {
        const currency = await this.resolveCurrency(connection, line.currencyCode);
        const local = this.localAmount(line.amount, currency);
        const signed = (line.direction === 'debit' ? 1 : -1);
        prepared.push({ ...line, lineNo: index + 1, currency, J_AMT: signed * local, J_AMT_F: currency.local ? 0 : signed * line.amount });
      }
      const balance = prepared.reduce((sum, line) => sum + line.J_AMT, 0);
      if (Math.abs(balance) > 0.000001) throw new Error('Journal request is not balanced in local currency');
      const batchValue = prepared.filter((line) => line.J_AMT > 0).reduce((sum, line) => sum + line.J_AMT, 0);
      const next = await connection.execute(`SELECT NVL(MAX(J_DOC_NO),0)+1 NEXT_REQUEST_NO FROM ${schema}.IAS_RQ_JRNL_MST WHERE JV_TYPE=1`);
      const requestNo = Number(next.rows[0].NEXT_REQUEST_NO);
      const requestSerial = buildJournalSerial(this.config.branchYear, JOURNAL_DOCUMENT_TYPE, JOURNAL_TYPE, requestNo);

      await connection.execute(`
        INSERT INTO ${schema}.IAS_RQ_JRNL_MST (
          JV_TYPE,J_DOC_NO,J_SER,J_DATE,BATCH_VAL,REF_NO,REVRS_JRNL,PERIODICAL_JRNL,
          CASH_RESERVE,STAND_BY,LINK_USE,T_DESC,CLS_ZERO_AC_BLNC,PROCESED,APPROVED,
          INACTIVE,REQ_SIDE,DOC_TYPE,FIELD10,MOVD_YR,AD_U_ID,AD_DATE,CMP_NO,BRN_NO,
          BRN_YEAR,BRN_USR,AD_TRMNL_NM
        ) VALUES (1,:requestNo,:requestSerial,TO_DATE(:requestDate,'YYYY-MM-DD'),:batchValue,
          :referenceNo,0,0,0,0,0,:description,0,0,0,0,'منصة البناء الراقي',:documentType,
          :referenceToken,0,1,SYSDATE,1,1,:branchYear,1,SYS_CONTEXT('USERENV','HOST'))`, {
        requestNo, requestSerial, requestDate: this.config.requestDate, batchValue,
        referenceNo: input.referenceNo, description: input.description,
        documentType: JOURNAL_DOCUMENT_TYPE, referenceToken, branchYear: this.config.branchYear,
      });

      for (const line of prepared) {
        const documentSequence = await this.nextDocumentSequence(connection);
        await connection.execute(`
          INSERT INTO ${schema}.IAS_RQ_JRNL_DTL (
            JV_TYPE,J_DOC_NO,J_SER,A_CODE,AC_CODE_DTL,AC_DTL_TYP,A_CY,J_DESC,J_AMT,
            J_AMT_F,AC_RATE,DOC_BRN_NO,RCRD_NO,RCRD_NO_ORD,DOC_DUE_DATE,REF_NO,
            DOC_SEQUENCE,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR
          ) VALUES (1,:requestNo,:requestSerial,:accountCode,:analyticalAccountCode,
            :analyticalType,:currencyCode,:description,:journalAmount,:foreignAmount,
            :exchangeRate,1,:lineNo,:lineNo,TO_DATE(:requestDate,'YYYY-MM-DD'),
            :referenceNo,:documentSequence,1,1,:branchYear,1)`, {
          requestNo, requestSerial, accountCode: line.accountCode,
          analyticalAccountCode: line.analyticalAccountCode, analyticalType: line.analyticalType,
          currencyCode: line.currency.code, description: line.description || input.description,
          journalAmount: line.J_AMT, foreignAmount: line.J_AMT_F, exchangeRate: line.currency.rate,
          lineNo: line.lineNo, requestDate: this.config.requestDate, referenceNo: input.referenceNo,
          documentSequence, branchYear: this.config.branchYear,
        });
      }

      await connection.execute(`
        INSERT INTO ${schema}.S_APPRVD_MOV (
          LVL_NO,DOC_TYP,DOC_SER,DOC_NO,DOC_JV_TYP,DOC_DATE,DOC_AMT,
          APPRVD,ORDR_NO,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR
        ) VALUES (1,:documentType,:requestSerial,:requestNo,1,
          TO_DATE(:requestDate,'YYYY-MM-DD'),:batchValue,0,1,1,1,:branchYear,1)`, {
        documentType: JOURNAL_DOCUMENT_TYPE, requestSerial, requestNo,
        requestDate: this.config.requestDate, batchValue, branchYear: this.config.branchYear,
      });
      await connection.commit();
      return { created: true, requestNo: String(requestNo), requestSerial };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.close();
    }
  }

  async createDraft(input) {
    if (!this.pool) throw new Error('Oracle writer pool is not started');
    const connection = await this.pool.getConnection();
    connection.callTimeout = this.config.oracle.callTimeout;
    const schema = this.config.schema;
    const externalDocumentSerial = `ALBINAA:${input.externalReference}`;
    try {
      await connection.execute(`LOCK TABLE ${schema}.IAS_OUT_REQUEST_MST IN EXCLUSIVE MODE`);

      const existingResult = await connection.execute(`
        SELECT OUT_REQ_NO, OUT_REQ_SER
        FROM ${schema}.IAS_OUT_REQUEST_MST
        WHERE DOC_SER_EXTRNL = :externalDocumentSerial AND ROWNUM = 1`,
      { externalDocumentSerial });
      if (existingResult.rows[0]) {
        await connection.rollback();
        return {
          created: false,
          requestNo: String(existingResult.rows[0].OUT_REQ_NO),
          requestSerial: String(existingResult.rows[0].OUT_REQ_SER),
        };
      }

      const warehouseResult = await connection.execute(`
        SELECT W_CODE FROM ${schema}.WAREHOUSE_DETAILS
        WHERE W_CODE IN (:sourceWarehouse, :destinationWarehouse) AND NVL(INACTIVE,0)=0`, {
        sourceWarehouse: input.sourceWarehouseCode,
        destinationWarehouse: input.destinationWarehouseCode,
      });
      if (warehouseResult.rows.length !== 2) throw new Error('One or both IAS20191 warehouses are invalid');

      const nextResult = await connection.execute(`
        SELECT NVL(MAX(OUT_REQ_NO),0)+1 NEXT_REQUEST_NO
        FROM ${schema}.IAS_OUT_REQUEST_MST WHERE OUT_REQ_TYPE=:requestType`,
      { requestType: REQUEST_TYPE });
      const requestNo = Number(nextResult.rows[0].NEXT_REQUEST_NO);
      const requestSerial = buildRequestSerial(this.config.branchYear, REQUEST_TYPE, requestNo);

      const preparedLines = [];
      for (const [index, line] of input.lines.entries()) {
        const itemResult = await connection.execute(`
          SELECT P_SIZE FROM ${schema}.ITEM_DETAILS
          WHERE I_CODE=:itemCode AND ITM_UNT=:unitCode AND NVL(INACTIVE,0)=0`, {
          itemCode: line.itemCode,
          unitCode: line.unitCode,
        });
        const item = itemResult.rows[0];
        if (!item || Number(item.P_SIZE) <= 0) throw new Error(`Invalid item/unit on line ${index + 1}`);
        const stockResult = await connection.execute(`
          SELECT NVL(SUM(CASE WHEN W_CODE=:sourceWarehouse THEN AVL_QTY ELSE 0 END),0) SOURCE_QTY,
                 NVL(SUM(CASE WHEN W_CODE=:destinationWarehouse THEN AVL_QTY ELSE 0 END),0) DESTINATION_QTY
          FROM ${schema}.IAS_V_ITM_AVLQTY
          WHERE W_CODE IN (:sourceWarehouse,:destinationWarehouse)
            AND I_CODE=:itemCode AND ITM_UNT=:unitCode`, {
          sourceWarehouse: input.sourceWarehouseCode,
          destinationWarehouse: input.destinationWarehouseCode,
          itemCode: line.itemCode,
          unitCode: line.unitCode,
        });
        const sequenceResult = await connection.execute(`SELECT ${schema}.IAS_DOC_SEQ_OTHR.NEXTVAL DOC_SEQUENCE FROM DUAL`);
        preparedLines.push({
          ...line,
          lineNo: index + 1,
          packageSize: Number(item.P_SIZE),
          packageQuantity: line.quantity * Number(item.P_SIZE),
          sourceAvailable: Number(stockResult.rows[0].SOURCE_QTY),
          destinationAvailable: Number(stockResult.rows[0].DESTINATION_QTY),
          documentSequence: sequenceResult.rows[0].DOC_SEQUENCE,
        });
      }

      await connection.execute(`
        INSERT INTO ${schema}.IAS_OUT_REQUEST_MST (
          OUT_REQ_TYPE,OUT_REQ_NO,OUT_REQ_SER,OUT_REQ_DATE,W_CODE,F_W_CODE,
          REQ_SIDE,DOC_DESC,PROCESSED,INACTIVE,APPROVED,AD_U_ID,AD_DATE,
          EXTERNAL_POST,DOC_SER_EXTRNL,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR,AD_TRMNL_NM,
          USE_REQ_MORE_ONCE
        ) VALUES (
          :requestType,:requestNo,:requestSerial,TO_DATE(:requestDate,'YYYY-MM-DD'),
          :sourceWarehouse,:destinationWarehouse,:requestSide,:notes,
          0,0,0,1,SYSDATE,0,:externalDocumentSerial,1,1,:branchYear,1,
          SYS_CONTEXT('USERENV','HOST'),
          NULL
        )`, {
        requestType: REQUEST_TYPE,
        requestNo,
        requestSerial,
        requestDate: this.config.requestDate,
        sourceWarehouse: input.sourceWarehouseCode,
        destinationWarehouse: input.destinationWarehouseCode,
        requestSide: input.requestSide,
        notes: input.notes,
        externalDocumentSerial,
        branchYear: this.config.branchYear,
      });

      for (const line of preparedLines) {
        await connection.execute(`
          INSERT INTO ${schema}.IAS_OUT_REQUEST_DTL (
            OUT_REQ_TYPE,OUT_REQ_NO,OUT_REQ_SER,I_CODE,ITM_UNT,I_QTY,P_SIZE,P_QTY,
            W_CODE,RCRD_NO,EXTERNAL_POST,USE_ATTCH,DOC_SEQUENCE,AVL_QTY,F_AVL_QTY,
            F_W_CODE,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR,RESERVED
          ) VALUES (
            :requestType,:requestNo,:requestSerial,:itemCode,:unitCode,:quantity,
            :packageSize,:packageQuantity,:sourceWarehouse,:lineNo,0,0,:documentSequence,
            :sourceAvailable,:destinationAvailable,:destinationWarehouse,1,1,:branchYear,1,NULL
          )`, {
          requestType: REQUEST_TYPE,
          requestNo,
          requestSerial,
          itemCode: line.itemCode,
          unitCode: line.unitCode,
          quantity: line.quantity,
          packageSize: line.packageSize,
          packageQuantity: line.packageQuantity,
          sourceWarehouse: input.sourceWarehouseCode,
          destinationWarehouse: input.destinationWarehouseCode,
          lineNo: line.lineNo,
          documentSequence: line.documentSequence,
          sourceAvailable: line.sourceAvailable,
          destinationAvailable: line.destinationAvailable,
          branchYear: this.config.branchYear,
        });
      }

      await connection.execute(`
        INSERT INTO ${schema}.S_APPRVD_MOV (
          LVL_NO,DOC_TYP,DOC_SER,DOC_NO,DOC_JV_TYP,DOC_DATE,DOC_AMT,
          APPRVD,ORDR_NO,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR
        ) VALUES (
          :approvalLevel,:approvalDocumentType,:requestSerial,:requestNo,0,
          TO_DATE(:requestDate,'YYYY-MM-DD'),0,0,1,1,1,:branchYear,1
        )`, {
        approvalLevel: APPROVAL_LEVEL,
        approvalDocumentType: APPROVAL_DOCUMENT_TYPE,
        requestSerial,
        requestNo,
        requestDate: this.config.requestDate,
        branchYear: this.config.branchYear,
      });

      await connection.commit();
      return { created: true, requestNo: String(requestNo), requestSerial };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.close();
    }
  }

  async preparePurchaseRequest(connection, input) {
    const schema = this.config.schema;
    const warehouseResult = await connection.execute(`
      SELECT W_CODE FROM ${schema}.WAREHOUSE_DETAILS
      WHERE W_CODE=:warehouseCode AND NVL(INACTIVE,0)=0`, {
      warehouseCode: input.warehouseCode,
    });
    if (!warehouseResult.rows[0]) throw new Error('IAS20191 purchase-request warehouse is invalid');

    const preparedLines = [];
    for (const [index, line] of input.lines.entries()) {
      const itemResult = await connection.execute(`
        SELECT P_SIZE FROM ${schema}.ITEM_DETAILS
        WHERE I_CODE=:itemCode AND ITM_UNT=:unitCode AND NVL(INACTIVE,0)=0`, {
        itemCode: line.itemCode,
        unitCode: line.unitCode,
      });
      const item = itemResult.rows[0];
      if (!item || Number(item.P_SIZE) <= 0) throw new Error(`Invalid purchase item/unit on line ${index + 1}`);
      preparedLines.push({
        ...line,
        lineNo: index + 1,
        packageSize: Number(item.P_SIZE),
        packageQuantity: line.quantity * Number(item.P_SIZE),
      });
    }
    return preparedLines;
  }

  async dryRunPurchaseRequest(input) {
    if (!this.pool) throw new Error('Oracle writer pool is not started');
    const connection = await this.pool.getConnection();
    connection.callTimeout = this.config.oracle.callTimeout;
    try {
      await connection.execute('SET TRANSACTION READ ONLY');
      const lines = await this.preparePurchaseRequest(connection, input);
      await connection.rollback();
      return {
        valid: true,
        oracleWrite: 'NONE',
        warehouseCode: String(input.warehouseCode),
        lines: lines.map((line) => ({
          itemCode: line.itemCode,
          unitCode: line.unitCode,
          quantity: line.quantity,
          packageSize: line.packageSize,
          packageQuantity: line.packageQuantity,
        })),
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.close();
    }
  }

  async createPurchaseRequestDraft(input) {
    if (!this.pool) throw new Error('Oracle writer pool is not started');
    const connection = await this.pool.getConnection();
    connection.callTimeout = this.config.oracle.callTimeout;
    const schema = this.config.schema;
    const referenceNo = buildPurchaseReference(input.externalReference);
    try {
      await connection.execute(`LOCK TABLE ${schema}.P_REQUEST IN EXCLUSIVE MODE`);

      const existingResult = await connection.execute(`
        SELECT PR_NO, PR_SER
        FROM ${schema}.P_REQUEST
        WHERE PR_TYPE=:requestType AND REF_NO=:referenceNo AND ROWNUM=1`, {
        requestType: PURCHASE_REQUEST_TYPE,
        referenceNo,
      });
      if (existingResult.rows[0]) {
        await connection.rollback();
        return {
          created: false,
          requestNo: String(existingResult.rows[0].PR_NO),
          requestSerial: String(existingResult.rows[0].PR_SER),
        };
      }

      const preparedLines = await this.preparePurchaseRequest(connection, input);
      const nextResult = await connection.execute(`
        SELECT NVL(MAX(PR_NO),0)+1 NEXT_REQUEST_NO
        FROM ${schema}.P_REQUEST WHERE PR_TYPE=:requestType`, {
        requestType: PURCHASE_REQUEST_TYPE,
      });
      const requestNo = Number(nextResult.rows[0].NEXT_REQUEST_NO);
      const requestSerial = buildRequestSerial(this.config.branchYear, PURCHASE_REQUEST_TYPE, requestNo);

      await connection.execute(`
        INSERT INTO ${schema}.P_REQUEST (
          PR_TYPE,PR_NO,PR_SER,PR_DATE,HRCHY_NO,PR_DESC,SIDE_REQ,REQ_AVL_DATE,
          PR_SELECTED,APPROVED,INACTIVE,REF_NO,AD_U_ID,AD_DATE,
          CMP_NO,BRN_NO,BRN_YEAR,BRN_USR,AD_TRMNL_NM,USE_AUTO_SYNC_VNDR
        ) VALUES (
          :requestType,:requestNo,:requestSerial,TO_DATE(:requestDate,'YYYY-MM-DD'),
          :hierarchyNo,:notes,:requestSide,TO_DATE(:requiredDate,'YYYY-MM-DD'),
          0,0,0,:referenceNo,1,SYSDATE,1,1,:branchYear,1,
          SYS_CONTEXT('USERENV','HOST'),0
        )`, {
        requestType: PURCHASE_REQUEST_TYPE,
        requestNo,
        requestSerial,
        requestDate: this.config.requestDate,
        hierarchyNo: input.hierarchyNo,
        notes: input.notes,
        requestSide: input.requestSide,
        requiredDate: input.requiredDate,
        referenceNo,
        branchYear: this.config.branchYear,
      });

      for (const line of preparedLines) {
        const sequenceResult = await connection.execute(`SELECT ${schema}.IAS_DOC_SEQ_OTHR.NEXTVAL DOC_SEQUENCE FROM DUAL`);
        await connection.execute(`
          INSERT INTO ${schema}.P_REQUEST_DETAIL (
            PR_TYPE,PR_NO,PR_SER,I_CODE,I_QTY,ITM_UNT,P_SIZE,P_QTY,W_CODE,RCRD_NO,
            USE_ATTCH,AVL_QTY,ARIV_QTY,PO_QTY,LAST_INCOME_PRICE,DOC_SEQUENCE,
            NOT_PO_PRV_QTY,BATCH_NO,PUR_CNT,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR
          ) VALUES (
            :requestType,:requestNo,:requestSerial,:itemCode,:quantity,:unitCode,
            :packageSize,:packageQuantity,:warehouseCode,:lineNo,
            0,0,0,0,0,:documentSequence,0,'0',0,1,1,:branchYear,1
          )`, {
          requestType: PURCHASE_REQUEST_TYPE,
          requestNo,
          requestSerial,
          itemCode: line.itemCode,
          quantity: line.quantity,
          unitCode: line.unitCode,
          packageSize: line.packageSize,
          packageQuantity: line.packageQuantity,
          warehouseCode: input.warehouseCode,
          lineNo: line.lineNo,
          documentSequence: sequenceResult.rows[0].DOC_SEQUENCE,
          branchYear: this.config.branchYear,
        });
      }

      await connection.execute(`
        INSERT INTO ${schema}.S_APPRVD_MOV (
          LVL_NO,DOC_TYP,DOC_SER,DOC_NO,DOC_JV_TYP,DOC_DATE,DOC_AMT,
          APPRVD,ORDR_NO,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR
        ) VALUES (
          :approvalLevel,:approvalDocumentType,:requestSerial,:requestNo,0,
          TO_DATE(:requestDate,'YYYY-MM-DD'),0,0,1,1,1,:branchYear,1
        )`, {
        approvalLevel: APPROVAL_LEVEL,
        approvalDocumentType: PURCHASE_APPROVAL_DOCUMENT_TYPE,
        requestSerial,
        requestNo,
        requestDate: this.config.requestDate,
        branchYear: this.config.branchYear,
      });

      await connection.commit();
      return { created: true, requestNo: String(requestNo), requestSerial };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.close();
    }
  }

  async prepareInventoryCount(connection, input) {
    const schema = this.config.schema;
    if (!INVENTORY_COUNT_TYPES.has(input.inventoryType)) throw new Error('IAS20191 inventory type is invalid');
    const typeResult = await connection.execute(`
      SELECT T.INV_TYPE,T.INV_NAME,NVL(P.ADD_FLAG,0) ADD_ALLOWED
      FROM ${schema}.IAS_INV_TYPES T
      LEFT JOIN ${schema}.IAS_PRIV_INV_TYPE P
        ON P.INV_TYPE=T.INV_TYPE AND P.U_ID=1
      WHERE T.INV_TYPE=:inventoryType AND ROWNUM=1`, { inventoryType: input.inventoryType });
    const inventoryType = typeResult.rows[0];
    if (!inventoryType) throw new Error('IAS20191 inventory type does not exist');
    if (Number(inventoryType.ADD_ALLOWED) !== 1) throw new Error('Oracle user 1 cannot add this IAS20191 inventory type');

    const warehouseResult = await connection.execute(`
      SELECT W_CODE FROM ${schema}.WAREHOUSE_DETAILS
      WHERE W_CODE=:warehouseCode AND NVL(INACTIVE,0)=0 AND ROWNUM=1`, {
      warehouseCode: input.warehouseCode,
    });
    if (!warehouseResult.rows[0]) throw new Error('Invalid inventory warehouse');

    const keys = new Set();
    const prepared = [];
    for (const [index, line] of input.lines.entries()) {
      const key = `${line.itemCode}|${line.unitCode}|${line.batchNo}`;
      if (keys.has(key)) throw new Error(`Duplicate inventory item/unit/warehouse/batch on line ${index + 1}`);
      keys.add(key);
      const itemResult = await connection.execute(`
        SELECT I_NAME,I_E_NAME,P_SIZE FROM ${schema}.ITEM_DETAILS
        WHERE I_CODE=:itemCode AND ITM_UNT=:unitCode AND NVL(INACTIVE,0)=0 AND ROWNUM=1`, {
        itemCode: line.itemCode, unitCode: line.unitCode,
      });
      const item = itemResult.rows[0];
      if (!item || Number(item.P_SIZE) <= 0) throw new Error(`Invalid inventory item/unit on line ${index + 1}`);
      const availableResult = await connection.execute(`
        SELECT NVL(SUM(AVL_QTY),0) AVAILABLE_QUANTITY
        FROM ${schema}.IAS_V_ITM_AVLQTY
        WHERE I_CODE=:itemCode AND ITM_UNT=:unitCode AND W_CODE=:warehouseCode`, {
        itemCode: line.itemCode, unitCode: line.unitCode, warehouseCode: input.warehouseCode,
      });
      const packageSize = Number(item.P_SIZE);
      prepared.push({
        ...line, warehouseCode: input.warehouseCode, lineNo: index + 1,
        itemNameAr: item.I_NAME, itemNameEn: item.I_E_NAME,
        packageSize, packageQuantity: line.countedQuantity * packageSize,
        availableQuantity: Number(availableResult.rows[0]?.AVAILABLE_QUANTITY ?? 0),
      });
    }
    return {
      inventoryType: {
        code: String(inventoryType.INV_TYPE), nameAr: inventoryType.INV_NAME,
      },
      warehouseCode: String(input.warehouseCode),
      lines: prepared,
    };
  }

  async dryRunInventoryCount(input) {
    return this.withReadConnection(async (connection) => {
      const prepared = await this.prepareInventoryCount(connection, input);
      return {
        valid: true, mode: 'DRY_RUN', oracleWrite: 'NONE', schema: this.config.schema,
        inventoryType: prepared.inventoryType,
        warehouseCode: prepared.warehouseCode,
        description: input.description,
        lines: prepared.lines.map((line) => ({
          lineNo: line.lineNo, itemCode: line.itemCode, itemNameAr: line.itemNameAr,
          itemNameEn: line.itemNameEn, unitCode: line.unitCode,
          warehouseCode: String(line.warehouseCode), countedQuantity: line.countedQuantity,
          packageSize: line.packageSize, packageQuantity: line.packageQuantity,
          availableQuantity: line.availableQuantity,
          differenceQuantity: line.countedQuantity - line.availableQuantity,
          batchNo: line.batchNo, expireDate: line.expireDate,
        })),
      };
    });
  }

  async createInventoryCountDraft(input) {
    if (!this.pool) throw new Error('Oracle writer pool is not started');
    const connection = await this.pool.getConnection();
    connection.callTimeout = this.config.oracle.callTimeout;
    const schema = this.config.schema;
    const referenceNo = buildInventoryReference(input.externalReference);
    try {
      await connection.execute(`LOCK TABLE ${schema}.MASTER_INV IN EXCLUSIVE MODE`);
      const existing = await connection.execute(`
        SELECT INV_NO,TO_CHAR(INV_SER,'FM99999999999999999999999999999999999999') INV_SER
        FROM ${schema}.MASTER_INV
        WHERE INV_TYPE=:inventoryType AND REF_NO=:referenceNo AND ROWNUM=1`, {
        inventoryType: input.inventoryType, referenceNo,
      });
      if (existing.rows[0]) {
        await connection.rollback();
        return {
          created: false, documentNo: String(existing.rows[0].INV_NO),
          documentSerial: existing.rows[0].INV_SER, inventoryType: String(input.inventoryType),
        };
      }

      const prepared = await this.prepareInventoryCount(connection, input);
      const next = await connection.execute(`
        SELECT NVL(MAX(INV_NO),0)+1 NEXT_DOCUMENT_NO
        FROM ${schema}.MASTER_INV WHERE INV_TYPE=:inventoryType`, { inventoryType: input.inventoryType });
      const documentNo = Number(next.rows[0].NEXT_DOCUMENT_NO);
      const documentSerial = buildInventorySerial(this.config.branchYear, input.inventoryType, documentNo);
      await connection.execute(`
        INSERT INTO ${schema}.MASTER_INV (
          INV_TYPE,INV_NO,INV_DATE,ANNUAL,INV_DESC,REF_NO,USE_ATTACH_INV,
          BRN_NO,BRN_YEAR,CMP_NO,BRN_USR,AD_DATE,AD_U_ID,INV_SER,MACHINE_NO,
          AD_TRMNL_NM,UP_TRMNL_NM,UP_CNT,PR_REP,EXTERNAL_POST,PROCESSED
        ) VALUES (
          :inventoryType,:documentNo,TO_DATE(:requestDate,'YYYY-MM-DD'),0,:description,
          :referenceNo,0,1,:branchYear,1,1,SYSDATE,1,:documentSerial,
          NULL,SYS_CONTEXT('USERENV','HOST'),NULL,NULL,NULL,0,0
        )`, {
        inventoryType: input.inventoryType, documentNo, requestDate: this.config.requestDate,
        description: input.description, referenceNo, branchYear: this.config.branchYear, documentSerial,
      });

      for (const line of prepared.lines) {
        await connection.execute(`
          INSERT INTO ${schema}.DETAIL_INV (
            RCRD_NO,I_CODE,ITM_UNT,WT_UNT,ARGMNT_NO,WT_QTY,W_CODE,B_CODE,FLEX_NO,
            ATTCH_DESC_NO1,ATTCH_DESC_NO2,ATTCH_DESC_NO3,ATTCH_DESC_NO4,ATTCH_DESC_NO5,
            I_LENGTH,I_WIDTH,I_HEIGHT,I_NUMBER,I_QTY,ITEM_DESC,BARCODE,USE_ATTCH,
            ATTCH_NO1,ATTCH_NO2,ATTCH_NO3,ATTCH_NO4,ATTCH_NO5,INV_NO,INV_TYPE,INV_SER,
            EXPIRE_DATE,BATCH_NO,AVL_QTY,P_SIZE,P_QTY,PROCESSED_ADJ,EXTERNAL_POST,
            CMP_NO,BRN_NO,BRN_YEAR,BRN_USR,AD_TRMNL_NM,UP_TRMNL_NM,UP_CNT
          ) VALUES (
            :lineNo,:itemCode,:unitCode,NULL,NULL,NULL,:warehouseCode,NULL,NULL,
            NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,:countedQuantity,NULL,NULL,0,
            NULL,NULL,NULL,NULL,NULL,:documentNo,:inventoryType,:documentSerial,
            TO_DATE(:expireDate,'YYYY-MM-DD'),:batchNo,:availableQuantity,:packageSize,
            :packageQuantity,0,0,1,1,:branchYear,1,SYS_CONTEXT('USERENV','HOST'),NULL,NULL
          )`, {
          lineNo: line.lineNo, itemCode: line.itemCode, unitCode: line.unitCode,
          warehouseCode: line.warehouseCode, countedQuantity: line.countedQuantity,
          documentNo, inventoryType: input.inventoryType, documentSerial,
          expireDate: line.expireDate, batchNo: line.batchNo,
          availableQuantity: line.availableQuantity, packageSize: line.packageSize,
          packageQuantity: line.packageQuantity, branchYear: this.config.branchYear,
        });
      }
      await connection.commit();
      return {
        created: true, documentNo: String(documentNo), documentSerial,
        inventoryType: String(input.inventoryType), lineCount: prepared.lines.length,
        oracleWrite: 'INSERT_ONLY', processed: false, externalPost: false,
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
  OracleConflictError, OracleOutRequestWriter, buildPurchaseReference, buildRequestSerial,
  buildVoucherSerial, buildJournalSerial, buildInventorySerial, buildInventoryReference,
};
