'use strict';

const crypto = require('node:crypto');

const JOURNAL_DOCUMENT_TYPE = 85;
const JOURNAL_TYPE = 1;

class Ias20261JournalConflictError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'Ias20261JournalConflictError';
    this.code = code;
  }
}

function buildJournalReference(externalReference) {
  return `A${crypto.createHash('sha256').update(externalReference, 'utf8').digest('hex').slice(0, 14).toUpperCase()}`;
}

function buildJournalSerial(branchYear, requestNo) {
  if (![branchYear, requestNo].every(Number.isSafeInteger) || branchYear < 1 || requestNo < 1) {
    throw new Error('Invalid journal serial components');
  }
  return `${branchYear}000001${String(JOURNAL_DOCUMENT_TYPE).padStart(5, '0')}${String(JOURNAL_TYPE).padStart(3, '0')}${requestNo}`;
}

class Ias20261JournalWriter {
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
      if (identity.rows[0]?.SESSION_USER !== 'ALBINAA20261JRNWRITER') {
        throw new Error('Oracle session is not ALBINAA20261JRNWRITER');
      }
      const result = await connection.execute(`
        SELECT TABLE_NAME,PRIVILEGE
        FROM USER_TAB_PRIVS
        WHERE OWNER=:schema
          AND TABLE_NAME IN (
            'IAS_RQ_JRNL_MST','IAS_RQ_JRNL_DTL','S_APPRVD_MOV','IAS_DOC_SEQ_OTHR',
            'EX_RATE','IAS_PERIOD_EX_RATE_DAY','ACCOUNT_CURR','CUSTOMER_CURR','GLS_ACCNT_DTL',
            'CASH_AT_BANK'
          )`, { schema: this.config.schema });
      const granted = new Set(result.rows.map((row) => `${row.TABLE_NAME}:${row.PRIVILEGE}`));
      const expected = [
        'IAS_RQ_JRNL_MST:SELECT','IAS_RQ_JRNL_MST:INSERT',
        'IAS_RQ_JRNL_DTL:SELECT','IAS_RQ_JRNL_DTL:INSERT',
        'S_APPRVD_MOV:INSERT','IAS_DOC_SEQ_OTHR:SELECT',
        'EX_RATE:SELECT','IAS_PERIOD_EX_RATE_DAY:SELECT',
        'ACCOUNT_CURR:SELECT','CUSTOMER_CURR:SELECT','GLS_ACCNT_DTL:SELECT',
        'CASH_AT_BANK:SELECT',
      ];
      const missing = expected.filter((privilege) => !granted.has(privilege));
      if (missing.length) {
        throw new Error(`ALBINAA20261JRNWRITER is missing IAS20261 journal privileges: ${missing.join(', ')}`);
      }
      const forbidden = [...granted].filter((privilege) => /:(UPDATE|DELETE|ALTER|EXECUTE)$/.test(privilege));
      if (forbidden.length) {
        throw new Error(`ALBINAA20261JRNWRITER has forbidden IAS20261 journal privileges: ${forbidden.join(', ')}`);
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

  async resolveCurrency(connection, currencyCode) {
    const result = await connection.execute(`
      SELECT CUR_CODE,CUR_NAME,CUR_RATE,L_F,CUR_FRC_NO
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

  async validateLine(connection, line, index) {
    const schema = this.config.schema;
    if (line.analyticalType === 0) {
      if (line.analyticalAccountCode != null) {
        throw new Error(`IAS20261 non-analytical journal account must not include details on line ${index + 1}`);
      }
    } else if (line.analyticalType === 2) {
      const bank = await connection.execute(`
        SELECT 1 AS VALID_ACCOUNT FROM ${schema}.CASH_AT_BANK
        WHERE A_CODE=:accountCode AND BANK_NO=:analyticalAccountCode
          AND NVL(INACTIVE,0)=0
          AND (CONN_BRN_NO IS NULL OR CONN_BRN_NO=1) AND ROWNUM=1`, {
        accountCode: line.accountCode,
        analyticalAccountCode: line.analyticalAccountCode,
      });
      if (!bank.rows[0]) throw new Error(`Invalid IAS20261 journal bank account on line ${index + 1}`);
    } else if (line.analyticalType !== 3) {
      const account = await connection.execute(`
        SELECT 1 AS VALID_ACCOUNT FROM ${schema}.GLS_ACCNT_DTL
        WHERE AC_CODE=:accountCode AND AC_CODE_DTL=:analyticalAccountCode
          AND GRP_CODE=:analyticalType
          AND (CONN_BRN_NO IS NULL OR CONN_BRN_NO=1) AND ROWNUM=1`, {
        accountCode: line.accountCode,
        analyticalAccountCode: line.analyticalAccountCode,
        analyticalType: line.analyticalType,
      });
      if (!account.rows[0]) throw new Error(`Invalid IAS20261 journal account on line ${index + 1}`);
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
    if (!currency.rows[0]) throw new Error(`IAS20261 journal account currency is not enabled on line ${index + 1}`);
  }

  async prepare(connection, input) {
    const lines = [];
    for (const [index, line] of input.lines.entries()) {
      await this.validateLine(connection, line, index);
      const currency = await this.resolveCurrency(connection, line.currencyCode);
      const localAmount = this.localAmount(line.amount, currency);
      const signed = line.direction === 'debit' ? 1 : -1;
      lines.push({
        ...line,
        lineNo: index + 1,
        currency,
        localAmount,
        journalAmount: signed * localAmount,
        foreignAmount: currency.local ? 0 : signed * line.amount,
      });
    }
    const rawBalance = lines.reduce((sum, line) => sum + line.journalAmount, 0);
    const localBalance = Math.round((rawBalance + Number.EPSILON) * 100) / 100;
    const issues = localBalance === 0 ? [] : [{
      code: 'UNBALANCED_LOCAL_AMOUNT',
      field: 'lines',
      message: 'القيد غير متوازن بالعملة المحلية حسب سعر صرف IAS20261',
    }];
    return { lines, localBalance, issues };
  }

  async dryRun(input) {
    if (!this.pool) throw new Error('IAS20261 journal writer is not started');
    const connection = await this.pool.getConnection();
    connection.callTimeout = this.config.oracle.callTimeout;
    try {
      await connection.execute('SET TRANSACTION READ ONLY');
      const prepared = await this.prepare(connection, input);
      const localCurrency = await this.resolveLocalCurrency(connection);
      await connection.rollback();
      return {
        valid: prepared.issues.length === 0,
        issues: prepared.issues,
        mode: 'DRY_RUN',
        oracleWrite: 'NONE',
        schema: this.config.schema,
        saveAllowed: prepared.issues.length === 0,
        localCurrency: localCurrency.code,
        localBalance: prepared.localBalance,
        lines: prepared.lines.map((line) => ({
          lineNo: line.lineNo,
          direction: line.direction,
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

  async resolveLocalCurrency(connection) {
    const result = await connection.execute(`
      SELECT CUR_CODE,CUR_NAME,CUR_RATE FROM ${this.config.schema}.EX_RATE WHERE L_F=1`);
    if (result.rows.length !== 1) throw new Error('IAS20261 must define exactly one local currency');
    return { code: result.rows[0].CUR_CODE, nameAr: result.rows[0].CUR_NAME, rate: Number(result.rows[0].CUR_RATE) };
  }

  async nextDocumentSequence(connection) {
    const result = await connection.execute(`SELECT ${this.config.schema}.IAS_DOC_SEQ_OTHR.NEXTVAL DOC_SEQUENCE FROM DUAL`);
    return result.rows[0].DOC_SEQUENCE;
  }

  async createDraft(input) {
    if (!this.pool) throw new Error('IAS20261 journal writer is not started');
    const connection = await this.pool.getConnection();
    connection.callTimeout = this.config.oracle.callTimeout;
    const schema = this.config.schema;
    const referenceToken = buildJournalReference(input.externalReference);
    try {
      await connection.execute(`LOCK TABLE ${schema}.IAS_RQ_JRNL_MST IN EXCLUSIVE MODE NOWAIT`);
      const existing = await connection.execute(`
        SELECT J_DOC_NO,TO_CHAR(J_SER,'FM99999999999999999999999999999999999999') J_SER
        FROM ${schema}.IAS_RQ_JRNL_MST WHERE FIELD10=:referenceToken AND ROWNUM=1`, { referenceToken });
      if (existing.rows[0]) {
        await connection.rollback();
        return {
          created: false,
          requestNo: String(existing.rows[0].J_DOC_NO),
          requestSerial: existing.rows[0].J_SER,
          schema,
        };
      }

      await connection.execute(`LOCK TABLE ${schema}.IAS_RQ_JRNL_DTL IN EXCLUSIVE MODE NOWAIT`);
      const prepared = await this.prepare(connection, input);
      if (prepared.issues.length) {
        throw new Ias20261JournalConflictError(
          'INVALID_JOURNAL_DRAFT',
          prepared.issues.map((issue) => issue.message).join('، '),
        );
      }
      const next = await connection.execute(`
        SELECT NVL(MAX(J_DOC_NO),0)+1 NEXT_REQUEST_NO
        FROM ${schema}.IAS_RQ_JRNL_MST WHERE JV_TYPE=:journalType`, { journalType: JOURNAL_TYPE });
      const requestNo = Number(next.rows[0].NEXT_REQUEST_NO);
      const requestSerial = buildJournalSerial(this.config.branchYear, requestNo);
      const batchValue = prepared.lines
        .filter((line) => line.journalAmount > 0)
        .reduce((sum, line) => sum + line.journalAmount, 0);

      await connection.execute(`
        INSERT INTO ${schema}.IAS_RQ_JRNL_MST (
          JV_TYPE,J_DOC_NO,J_SER,J_DATE,BATCH_VAL,REF_NO,REVRS_JRNL,PERIODICAL_JRNL,
          CASH_RESERVE,STAND_BY,LINK_USE,T_DESC,CLS_ZERO_AC_BLNC,PROCESED,APPROVED,
          INACTIVE,REQ_SIDE,DOC_TYPE,FIELD10,MOVD_YR,AD_U_ID,AD_DATE,CMP_NO,BRN_NO,
          BRN_YEAR,BRN_USR,AD_TRMNL_NM
        ) VALUES (
          :journalType,:requestNo,:requestSerial,TRUNC(SYSDATE),:batchValue,:referenceNo,
          0,0,0,0,0,:description,0,0,0,0,'منصة البناء الراقي',:documentType,
          :referenceToken,0,:oracleUserId,SYSDATE,1,1,:branchYear,1,SYS_CONTEXT('USERENV','HOST')
        )`, {
        journalType: JOURNAL_TYPE,
        requestNo,
        requestSerial,
        batchValue,
        referenceNo: input.referenceNo,
        description: input.description,
        documentType: JOURNAL_DOCUMENT_TYPE,
        referenceToken,
        oracleUserId: this.config.oracleUserId,
        branchYear: this.config.branchYear,
      });

      for (const line of prepared.lines) {
        const documentSequence = await this.nextDocumentSequence(connection);
        await connection.execute(`
          INSERT INTO ${schema}.IAS_RQ_JRNL_DTL (
            JV_TYPE,J_DOC_NO,J_SER,A_CODE,AC_CODE_DTL,AC_DTL_TYP,A_CY,J_DESC,J_AMT,
            J_AMT_F,AC_RATE,DOC_BRN_NO,RCRD_NO,RCRD_NO_ORD,DOC_DUE_DATE,REF_NO,
            DOC_SEQUENCE,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR
          ) VALUES (
            :journalType,:requestNo,:requestSerial,:accountCode,:analyticalAccountCode,
            :analyticalType,:currencyCode,:description,:journalAmount,:foreignAmount,
            :exchangeRate,1,:lineNo,:lineNo,TRUNC(SYSDATE),:referenceNo,
            :documentSequence,1,1,:branchYear,1
          )`, {
          journalType: JOURNAL_TYPE,
          requestNo,
          requestSerial,
          accountCode: line.accountCode,
          analyticalAccountCode: line.analyticalAccountCode,
          analyticalType: line.analyticalType,
          currencyCode: line.currency.code,
          description: line.description || input.description,
          journalAmount: line.journalAmount,
          foreignAmount: line.foreignAmount,
          exchangeRate: line.currency.rate,
          lineNo: line.lineNo,
          referenceNo: input.referenceNo,
          documentSequence,
          branchYear: this.config.branchYear,
        });
      }

      await connection.execute(`
        INSERT INTO ${schema}.S_APPRVD_MOV (
          LVL_NO,DOC_TYP,DOC_SER,DOC_NO,DOC_JV_TYP,DOC_DATE,DOC_AMT,
          APPRVD,ORDR_NO,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR,AD_U_ID,AD_DATE,AD_TRMNL_NM
        ) VALUES (
          1,:documentType,:requestSerial,:requestNo,:journalType,TRUNC(SYSDATE),
          :batchValue,0,1,1,1,:branchYear,1,:oracleUserId,SYSDATE,SYS_CONTEXT('USERENV','HOST')
        )`, {
        documentType: JOURNAL_DOCUMENT_TYPE,
        requestSerial,
        requestNo,
        journalType: JOURNAL_TYPE,
        batchValue,
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
  Ias20261JournalConflictError,
  Ias20261JournalWriter,
  buildJournalReference,
  buildJournalSerial,
};
