'use strict';

const crypto = require('node:crypto');

const REQUEST_TYPE = 1;
const APPROVAL_DOCUMENT_TYPE = 40;
const APPROVAL_LEVEL = 1;

function buildRequestSerial(branchYear, requestType, requestNo) {
  if (![branchYear, requestType, requestNo].every(Number.isSafeInteger) || requestNo < 1) {
    throw new Error('Invalid request serial components');
  }
  return `${branchYear}${String(requestType).padStart(6, '0')}${requestNo}`;
}

function buildReference(externalReference) {
  return `A${crypto.createHash('sha256').update(externalReference, 'utf8').digest('hex').slice(0, 14).toUpperCase()}`;
}

class Ias20261PurchaseWriter {
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
            'P_REQUEST','P_REQUEST_DETAIL','S_APPRVD_MOV','IAS_DOC_SEQ_OTHR',
            'WAREHOUSE_DETAILS','ITEM_DETAILS'
          )`, { schema: this.config.schema });
      const granted = new Set(result.rows.map((row) => `${row.TABLE_NAME}:${row.PRIVILEGE}`));
      const expected = [
        'P_REQUEST:SELECT','P_REQUEST:INSERT',
        'P_REQUEST_DETAIL:SELECT','P_REQUEST_DETAIL:INSERT',
        'S_APPRVD_MOV:INSERT','IAS_DOC_SEQ_OTHR:SELECT',
        'WAREHOUSE_DETAILS:SELECT','ITEM_DETAILS:SELECT',
      ];
      const missing = expected.filter((privilege) => !granted.has(privilege));
      if (missing.length) throw new Error(`ALBINAA20261WRITER is missing IAS20261 privileges: ${missing.join(', ')}`);
      const forbidden = [...granted].filter((privilege) => /:(UPDATE|DELETE|ALTER|EXECUTE)$/.test(privilege));
      if (forbidden.length) throw new Error(`ALBINAA20261WRITER has forbidden IAS20261 privileges: ${forbidden.join(', ')}`);
    } finally {
      await connection.rollback();
      await connection.close();
    }
  }

  async close() {
    if (this.pool) await this.pool.close(10);
    this.pool = null;
  }

  async prepare(connection, input) {
    const schema = this.config.schema;
    const warehouseResult = await connection.execute(`
      SELECT W_CODE FROM ${schema}.WAREHOUSE_DETAILS
      WHERE W_CODE=:warehouseCode AND NVL(INACTIVE,0)=0 AND ROWNUM=1`, {
      warehouseCode: input.warehouseCode,
    });
    if (!warehouseResult.rows[0]) throw new Error('IAS20261 purchase-request warehouse is invalid');

    const keys = new Set();
    const lines = [];
    for (const [index, line] of input.lines.entries()) {
      const key = `${line.itemCode}|${line.unitCode}`;
      if (keys.has(key)) throw new Error(`Duplicate purchase item and unit on line ${index + 1}`);
      keys.add(key);
      const itemResult = await connection.execute(`
        SELECT P_SIZE FROM ${schema}.ITEM_DETAILS
        WHERE I_CODE=:itemCode AND ITM_UNT=:unitCode AND NVL(INACTIVE,0)=0 AND ROWNUM=1`, {
        itemCode: line.itemCode,
        unitCode: line.unitCode,
      });
      const item = itemResult.rows[0];
      if (!item || Number(item.P_SIZE) <= 0) throw new Error(`Invalid IAS20261 purchase item/unit on line ${index + 1}`);
      lines.push({
        ...line,
        lineNo: index + 1,
        packageSize: Number(item.P_SIZE),
        packageQuantity: line.quantity * Number(item.P_SIZE),
      });
    }
    return lines;
  }

  async dryRun(input) {
    if (!this.pool) throw new Error('IAS20261 purchase writer is not started');
    const connection = await this.pool.getConnection();
    connection.callTimeout = this.config.oracle.callTimeout;
    try {
      await connection.execute('SET TRANSACTION READ ONLY');
      const lines = await this.prepare(connection, input);
      await connection.rollback();
      return {
        valid: true,
        mode: 'DRY_RUN',
        oracleWrite: 'NONE',
        schema: this.config.schema,
        saveAllowed: true,
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

  async createDraft(input) {
    if (!this.pool) throw new Error('IAS20261 purchase writer is not started');
    const connection = await this.pool.getConnection();
    connection.callTimeout = this.config.oracle.callTimeout;
    const schema = this.config.schema;
    const referenceNo = buildReference(input.externalReference);
    try {
      await connection.execute(`LOCK TABLE ${schema}.P_REQUEST IN EXCLUSIVE MODE NOWAIT`);
      const existing = await connection.execute(`
        SELECT PR_NO,PR_SER FROM ${schema}.P_REQUEST
        WHERE PR_TYPE=:requestType AND REF_NO=:referenceNo AND ROWNUM=1`, {
        requestType: REQUEST_TYPE,
        referenceNo,
      });
      if (existing.rows[0]) {
        await connection.rollback();
        return {
          created: false,
          requestNo: String(existing.rows[0].PR_NO),
          requestSerial: String(existing.rows[0].PR_SER),
          schema,
        };
      }

      const lines = await this.prepare(connection, input);
      const next = await connection.execute(`
        SELECT NVL(MAX(PR_NO),0)+1 NEXT_REQUEST_NO
        FROM ${schema}.P_REQUEST WHERE PR_TYPE=:requestType`, { requestType: REQUEST_TYPE });
      const requestNo = Number(next.rows[0].NEXT_REQUEST_NO);
      const requestSerial = buildRequestSerial(this.config.branchYear, REQUEST_TYPE, requestNo);

      await connection.execute(`
        INSERT INTO ${schema}.P_REQUEST (
          PR_TYPE,PR_NO,PR_SER,PR_DATE,HRCHY_NO,PR_DESC,SIDE_REQ,REQ_AVL_DATE,
          PR_SELECTED,APPROVED,INACTIVE,REF_NO,AD_U_ID,AD_DATE,
          CMP_NO,BRN_NO,BRN_YEAR,BRN_USR,AD_TRMNL_NM
        ) VALUES (
          :requestType,:requestNo,:requestSerial,TRUNC(SYSDATE),
          NULL,:notes,:requestSide,TO_DATE(:requiredDate,'YYYY-MM-DD'),
          0,0,0,:referenceNo,:oracleUserId,SYSDATE,
          1,1,:branchYear,1,SYS_CONTEXT('USERENV','HOST')
        )`, {
        requestType: REQUEST_TYPE,
        requestNo,
        requestSerial,
        notes: input.notes,
        requestSide: input.requestSide,
        requiredDate: input.requiredDate,
        referenceNo,
        oracleUserId: this.config.oracleUserId,
        branchYear: this.config.branchYear,
      });

      for (const line of lines) {
        const sequence = await connection.execute(`SELECT ${schema}.IAS_DOC_SEQ_OTHR.NEXTVAL DOC_SEQUENCE FROM DUAL`);
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
          requestType: REQUEST_TYPE,
          requestNo,
          requestSerial,
          itemCode: line.itemCode,
          quantity: line.quantity,
          unitCode: line.unitCode,
          packageSize: line.packageSize,
          packageQuantity: line.packageQuantity,
          warehouseCode: input.warehouseCode,
          lineNo: line.lineNo,
          documentSequence: sequence.rows[0].DOC_SEQUENCE,
          branchYear: this.config.branchYear,
        });
      }

      await connection.execute(`
        INSERT INTO ${schema}.S_APPRVD_MOV (
          LVL_NO,DOC_TYP,DOC_SER,DOC_NO,DOC_JV_TYP,DOC_DATE,DOC_AMT,
          APPRVD,ORDR_NO,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR,AD_U_ID,AD_DATE,AD_TRMNL_NM
        ) VALUES (
          :approvalLevel,:documentType,:requestSerial,:requestNo,0,
          TRUNC(SYSDATE),0,0,1,1,1,:branchYear,1,
          :oracleUserId,SYSDATE,SYS_CONTEXT('USERENV','HOST')
        )`, {
        approvalLevel: APPROVAL_LEVEL,
        documentType: APPROVAL_DOCUMENT_TYPE,
        requestSerial,
        requestNo,
        branchYear: this.config.branchYear,
        oracleUserId: this.config.oracleUserId,
      });

      await connection.commit();
      return {
        created: true,
        requestNo: String(requestNo),
        requestSerial: String(requestSerial),
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

module.exports = { Ias20261PurchaseWriter, buildReference, buildRequestSerial };
