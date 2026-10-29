'use strict';

const REQUEST_TYPE = 1;
const APPROVAL_DOCUMENT_TYPE = 31;
const APPROVAL_LEVEL = 1;

function buildTransferSerial(branchYear, requestType, requestNo) {
  if (![branchYear, requestType, requestNo].every(Number.isSafeInteger)
      || branchYear < 1 || requestType < 1 || requestNo < 1) {
    throw new Error('Invalid transfer request serial components');
  }
  return `${branchYear}${String(requestType).padStart(6, '0')}${requestNo}`;
}

class Ias20261TransferWriter {
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
            'IAS_OUT_REQUEST_MST','IAS_OUT_REQUEST_DTL','S_APPRVD_MOV','IAS_DOC_SEQ_OTHR',
            'WAREHOUSE_DETAILS','ITEM_DETAILS','IAS_V_ITM_AVLQTY'
          )`, { schema: this.config.schema });
      const granted = new Set(result.rows.map((row) => `${row.TABLE_NAME}:${row.PRIVILEGE}`));
      const expected = [
        'IAS_OUT_REQUEST_MST:SELECT','IAS_OUT_REQUEST_MST:INSERT',
        'IAS_OUT_REQUEST_DTL:SELECT','IAS_OUT_REQUEST_DTL:INSERT',
        'S_APPRVD_MOV:INSERT','IAS_DOC_SEQ_OTHR:SELECT',
        'WAREHOUSE_DETAILS:SELECT','ITEM_DETAILS:SELECT','IAS_V_ITM_AVLQTY:SELECT',
      ];
      const missing = expected.filter((privilege) => !granted.has(privilege));
      if (missing.length) throw new Error(`ALBINAA20261WRITER is missing transfer privileges: ${missing.join(', ')}`);
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
    const warehouses = await connection.execute(`
      SELECT W_CODE FROM ${schema}.WAREHOUSE_DETAILS
      WHERE W_CODE IN (:sourceWarehouse,:destinationWarehouse)
        AND NVL(INACTIVE,0)=0`, {
      sourceWarehouse: input.sourceWarehouseCode,
      destinationWarehouse: input.destinationWarehouseCode,
    });
    if (warehouses.rows.length !== 2) throw new Error('One or both IAS20261 transfer warehouses are invalid');

    const keys = new Set();
    const lines = [];
    for (const [index, line] of input.lines.entries()) {
      const key = `${line.itemCode}|${line.unitCode}`;
      if (keys.has(key)) throw new Error(`Duplicate transfer item and unit on line ${index + 1}`);
      keys.add(key);
      const itemResult = await connection.execute(`
        SELECT P_SIZE FROM ${schema}.ITEM_DETAILS
        WHERE I_CODE=:itemCode AND ITM_UNT=:unitCode
          AND NVL(INACTIVE,0)=0 AND ROWNUM=1`, {
        itemCode: line.itemCode,
        unitCode: line.unitCode,
      });
      const item = itemResult.rows[0];
      if (!item || Number(item.P_SIZE) <= 0) throw new Error(`Invalid IAS20261 transfer item/unit on line ${index + 1}`);
      const stock = await connection.execute(`
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
      const sourceAvailable = Number(stock.rows[0]?.SOURCE_QTY || 0);
      const destinationAvailable = Number(stock.rows[0]?.DESTINATION_QTY || 0);
      if (sourceAvailable < line.quantity) {
        throw new Error(`Insufficient IAS20261 source stock on transfer line ${index + 1}`);
      }
      lines.push({
        ...line,
        lineNo: index + 1,
        packageSize: Number(item.P_SIZE),
        packageQuantity: line.quantity * Number(item.P_SIZE),
        sourceAvailable,
        destinationAvailable,
      });
    }
    return lines;
  }

  async dryRun(input) {
    if (!this.pool) throw new Error('IAS20261 transfer writer is not started');
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
        sourceWarehouseCode: String(input.sourceWarehouseCode),
        destinationWarehouseCode: String(input.destinationWarehouseCode),
        lines: lines.map((line) => ({
          itemCode: line.itemCode,
          unitCode: line.unitCode,
          quantity: line.quantity,
          packageSize: line.packageSize,
          packageQuantity: line.packageQuantity,
          sourceAvailable: line.sourceAvailable,
          destinationAvailable: line.destinationAvailable,
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
    if (!this.pool) throw new Error('IAS20261 transfer writer is not started');
    const connection = await this.pool.getConnection();
    connection.callTimeout = this.config.oracle.callTimeout;
    const schema = this.config.schema;
    const externalDocumentSerial = `ALBINAA:${input.externalReference}`;
    try {
      await connection.execute(`LOCK TABLE ${schema}.IAS_OUT_REQUEST_MST IN EXCLUSIVE MODE NOWAIT`);
      const existing = await connection.execute(`
        SELECT OUT_REQ_NO,OUT_REQ_SER FROM ${schema}.IAS_OUT_REQUEST_MST
        WHERE OUT_REQ_TYPE=:requestType AND DOC_SER_EXTRNL=:externalDocumentSerial
          AND ROWNUM=1`, { requestType: REQUEST_TYPE, externalDocumentSerial });
      if (existing.rows[0]) {
        await connection.rollback();
        return {
          created: false,
          requestNo: String(existing.rows[0].OUT_REQ_NO),
          requestSerial: String(existing.rows[0].OUT_REQ_SER),
          schema,
        };
      }

      const lines = await this.prepare(connection, input);
      const next = await connection.execute(`
        SELECT NVL(MAX(OUT_REQ_NO),0)+1 NEXT_REQUEST_NO
        FROM ${schema}.IAS_OUT_REQUEST_MST WHERE OUT_REQ_TYPE=:requestType`, {
        requestType: REQUEST_TYPE,
      });
      const requestNo = Number(next.rows[0].NEXT_REQUEST_NO);
      const requestSerial = buildTransferSerial(this.config.branchYear, REQUEST_TYPE, requestNo);

      await connection.execute(`
        INSERT INTO ${schema}.IAS_OUT_REQUEST_MST (
          OUT_REQ_TYPE,OUT_REQ_NO,OUT_REQ_SER,OUT_REQ_DATE,W_CODE,F_W_CODE,
          REQ_SIDE,DOC_DESC,PROCESSED,INACTIVE,APPROVED,AD_U_ID,AD_DATE,
          EXTERNAL_POST,DOC_SER_EXTRNL,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR,AD_TRMNL_NM,
          USE_REQ_MORE_ONCE
        ) VALUES (
          :requestType,:requestNo,:requestSerial,TRUNC(SYSDATE),
          :requestWarehouse,:fromWarehouse,:requestSide,:notes,
          0,0,0,:oracleUserId,SYSDATE,0,:externalDocumentSerial,
          1,1,:branchYear,1,SYS_CONTEXT('USERENV','HOST'),NULL
        )`, {
        requestType: REQUEST_TYPE,
        requestNo,
        requestSerial,
        requestWarehouse: input.destinationWarehouseCode,
        fromWarehouse: input.sourceWarehouseCode,
        requestSide: input.requestSide,
        notes: input.notes,
        oracleUserId: this.config.oracleUserId,
        externalDocumentSerial,
        branchYear: this.config.branchYear,
      });

      for (const line of lines) {
        const sequence = await connection.execute(`SELECT ${schema}.IAS_DOC_SEQ_OTHR.NEXTVAL DOC_SEQUENCE FROM DUAL`);
        await connection.execute(`
          INSERT INTO ${schema}.IAS_OUT_REQUEST_DTL (
            OUT_REQ_TYPE,OUT_REQ_NO,OUT_REQ_SER,I_CODE,ITM_UNT,I_QTY,P_SIZE,P_QTY,
            W_CODE,RCRD_NO,EXTERNAL_POST,USE_ATTCH,DOC_SEQUENCE,AVL_QTY,F_AVL_QTY,
            F_W_CODE,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR,RESERVED
          ) VALUES (
            :requestType,:requestNo,:requestSerial,:itemCode,:unitCode,:quantity,
            :packageSize,:packageQuantity,:requestWarehouse,:lineNo,0,0,:documentSequence,
            :destinationAvailable,:sourceAvailable,:fromWarehouse,
            1,1,:branchYear,1,0
          )`, {
          requestType: REQUEST_TYPE,
          requestNo,
          requestSerial,
          itemCode: line.itemCode,
          unitCode: line.unitCode,
          quantity: line.quantity,
          packageSize: line.packageSize,
          packageQuantity: line.packageQuantity,
          requestWarehouse: input.destinationWarehouseCode,
          fromWarehouse: input.sourceWarehouseCode,
          lineNo: line.lineNo,
          documentSequence: sequence.rows[0].DOC_SEQUENCE,
          sourceAvailable: line.sourceAvailable,
          destinationAvailable: line.destinationAvailable,
          branchYear: this.config.branchYear,
        });
      }

      await connection.execute(`
        INSERT INTO ${schema}.S_APPRVD_MOV (
          LVL_NO,DOC_TYP,DOC_SER,DOC_NO,DOC_JV_TYP,DOC_DATE,DOC_AMT,
          APPRVD,ORDR_NO,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR,AD_U_ID,AD_DATE,AD_TRMNL_NM
        ) VALUES (
          :approvalLevel,:documentType,:requestSerial,:requestNo,0,TRUNC(SYSDATE),0,
          0,1,1,1,:branchYear,1,:oracleUserId,SYSDATE,SYS_CONTEXT('USERENV','HOST')
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

module.exports = { Ias20261TransferWriter, buildTransferSerial };
