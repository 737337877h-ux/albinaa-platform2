'use strict';

const crypto = require('node:crypto');

const INVENTORY_COUNT_TYPES = new Set([1, 2]);

class Ias20261InventoryConflictError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'Ias20261InventoryConflictError';
    this.code = code;
  }
}

function buildInventoryReference(externalReference) {
  return `A${crypto.createHash('sha256').update(externalReference, 'utf8').digest('hex').slice(0, 14).toUpperCase()}`;
}

function buildInventorySerial(branchYear, inventoryType, documentNo) {
  if (![branchYear, inventoryType, documentNo].every(Number.isSafeInteger)
      || branchYear < 1 || inventoryType < 1 || documentNo < 1) {
    throw new Error('Invalid inventory serial components');
  }
  return `${branchYear}${String(inventoryType).padStart(6, '0')}33${documentNo}`;
}

class Ias20261InventoryWriter {
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
      if (identity.rows[0]?.SESSION_USER !== 'ALBINAA20261INVWRITER') {
        throw new Error('Oracle session is not ALBINAA20261INVWRITER');
      }
      const result = await connection.execute(`
        SELECT TABLE_NAME,PRIVILEGE
        FROM USER_TAB_PRIVS
        WHERE OWNER=:schema AND TABLE_NAME IN (
          'IAS_INV_TYPES','IAS_PRIV_INV_TYPE','WAREHOUSE_DETAILS','ITEM_DETAILS',
          'IAS_V_ITM_AVLQTY','MASTER_INV','DETAIL_INV'
        )`, { schema: this.config.schema });
      const granted = new Set(result.rows.map((row) => `${row.TABLE_NAME}:${row.PRIVILEGE}`));
      const expected = [
        'IAS_INV_TYPES:SELECT','IAS_PRIV_INV_TYPE:SELECT','WAREHOUSE_DETAILS:SELECT',
        'ITEM_DETAILS:SELECT','IAS_V_ITM_AVLQTY:SELECT','MASTER_INV:SELECT',
        'MASTER_INV:INSERT','DETAIL_INV:SELECT','DETAIL_INV:INSERT',
      ];
      const missing = expected.filter((privilege) => !granted.has(privilege));
      if (missing.length) {
        throw new Error(`ALBINAA20261INVWRITER is missing IAS20261 inventory privileges: ${missing.join(', ')}`);
      }
      const forbidden = [...granted].filter((privilege) => /:(UPDATE|DELETE|ALTER|EXECUTE)$/.test(privilege));
      if (forbidden.length) {
        throw new Error(`ALBINAA20261INVWRITER has forbidden IAS20261 inventory privileges: ${forbidden.join(', ')}`);
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

  async prepare(connection, input) {
    const schema = this.config.schema;
    if (!INVENTORY_COUNT_TYPES.has(input.inventoryType)) throw new Error('IAS20261 inventory type is invalid');
    const typeResult = await connection.execute(`
      SELECT T.INV_TYPE,T.INV_NAME,NVL(P.ADD_FLAG,0) ADD_ALLOWED
      FROM ${schema}.IAS_INV_TYPES T
      LEFT JOIN ${schema}.IAS_PRIV_INV_TYPE P
        ON P.INV_TYPE=T.INV_TYPE AND P.U_ID=:oracleUserId
      WHERE T.INV_TYPE=:inventoryType AND ROWNUM=1`, {
      inventoryType: input.inventoryType,
      oracleUserId: this.config.oracleUserId,
    });
    const inventoryType = typeResult.rows[0];
    if (!inventoryType) throw new Error('IAS20261 inventory type does not exist');
    if (Number(inventoryType.ADD_ALLOWED) !== 1) {
      throw new Error(`Oracle user ${this.config.oracleUserId} cannot add this IAS20261 inventory type`);
    }

    const warehouseResult = await connection.execute(`
      SELECT W_CODE FROM ${schema}.WAREHOUSE_DETAILS
      WHERE W_CODE=:warehouseCode AND NVL(INACTIVE,0)=0 AND ROWNUM=1`, {
      warehouseCode: input.warehouseCode,
    });
    if (!warehouseResult.rows[0]) throw new Error('Invalid IAS20261 inventory warehouse');

    const keys = new Set();
    const lines = [];
    for (const [index, line] of input.lines.entries()) {
      const key = `${line.itemCode}|${line.unitCode}|${line.batchNo}`;
      if (keys.has(key)) throw new Error(`Duplicate inventory item/unit/batch on line ${index + 1}`);
      keys.add(key);
      const itemResult = await connection.execute(`
        SELECT I_NAME,I_E_NAME,P_SIZE FROM ${schema}.ITEM_DETAILS
        WHERE I_CODE=:itemCode AND ITM_UNT=:unitCode AND NVL(INACTIVE,0)=0 AND ROWNUM=1`, {
        itemCode: line.itemCode,
        unitCode: line.unitCode,
      });
      const item = itemResult.rows[0];
      if (!item || Number(item.P_SIZE) <= 0) throw new Error(`Invalid IAS20261 inventory item/unit on line ${index + 1}`);
      const availableResult = await connection.execute(`
        SELECT NVL(SUM(AVL_QTY),0) AVAILABLE_QUANTITY
        FROM ${schema}.IAS_V_ITM_AVLQTY
        WHERE I_CODE=:itemCode AND ITM_UNT=:unitCode AND W_CODE=:warehouseCode`, {
        itemCode: line.itemCode,
        unitCode: line.unitCode,
        warehouseCode: input.warehouseCode,
      });
      const packageSize = Number(item.P_SIZE);
      lines.push({
        ...line,
        lineNo: index + 1,
        warehouseCode: input.warehouseCode,
        itemNameAr: item.I_NAME,
        itemNameEn: item.I_E_NAME,
        packageSize,
        packageQuantity: line.countedQuantity * packageSize,
        availableQuantity: Number(availableResult.rows[0]?.AVAILABLE_QUANTITY ?? 0),
      });
    }
    return {
      inventoryType: { code: String(inventoryType.INV_TYPE), nameAr: inventoryType.INV_NAME },
      warehouseCode: String(input.warehouseCode),
      lines,
    };
  }

  async dryRun(input) {
    if (!this.pool) throw new Error('IAS20261 inventory writer is not started');
    const connection = await this.pool.getConnection();
    connection.callTimeout = this.config.oracle.callTimeout;
    try {
      await connection.execute('SET TRANSACTION READ ONLY');
      const prepared = await this.prepare(connection, input);
      await connection.rollback();
      return {
        valid: true,
        saveAllowed: true,
        mode: 'DRY_RUN',
        oracleWrite: 'NONE',
        schema: this.config.schema,
        inventoryType: prepared.inventoryType,
        warehouseCode: prepared.warehouseCode,
        description: input.description,
        lines: prepared.lines.map((line) => ({
          lineNo: line.lineNo,
          itemCode: line.itemCode,
          itemNameAr: line.itemNameAr,
          itemNameEn: line.itemNameEn,
          unitCode: line.unitCode,
          warehouseCode: String(line.warehouseCode),
          countedQuantity: line.countedQuantity,
          packageSize: line.packageSize,
          packageQuantity: line.packageQuantity,
          availableQuantity: line.availableQuantity,
          differenceQuantity: line.countedQuantity - line.availableQuantity,
          batchNo: line.batchNo,
          expireDate: line.expireDate,
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
    if (!this.pool) throw new Error('IAS20261 inventory writer is not started');
    const connection = await this.pool.getConnection();
    connection.callTimeout = this.config.oracle.callTimeout;
    const schema = this.config.schema;
    const referenceNo = buildInventoryReference(input.externalReference);
    try {
      await connection.execute(`LOCK TABLE ${schema}.MASTER_INV IN EXCLUSIVE MODE NOWAIT`);
      const existing = await connection.execute(`
        SELECT INV_NO,TO_CHAR(INV_SER,'FM99999999999999999999999999999999999999') INV_SER
        FROM ${schema}.MASTER_INV
        WHERE INV_TYPE=:inventoryType AND REF_NO=:referenceNo AND ROWNUM=1`, {
        inventoryType: input.inventoryType,
        referenceNo,
      });
      if (existing.rows[0]) {
        await connection.rollback();
        return {
          created: false,
          documentNo: String(existing.rows[0].INV_NO),
          documentSerial: existing.rows[0].INV_SER,
          inventoryType: String(input.inventoryType),
          schema,
        };
      }

      await connection.execute(`LOCK TABLE ${schema}.DETAIL_INV IN EXCLUSIVE MODE NOWAIT`);
      const prepared = await this.prepare(connection, input);
      const next = await connection.execute(`
        SELECT NVL(MAX(INV_NO),0)+1 NEXT_DOCUMENT_NO
        FROM ${schema}.MASTER_INV WHERE INV_TYPE=:inventoryType`, { inventoryType: input.inventoryType });
      const documentNo = Number(next.rows[0].NEXT_DOCUMENT_NO);
      if (!Number.isSafeInteger(documentNo) || documentNo < 1) {
        throw new Ias20261InventoryConflictError('INVALID_DOCUMENT_NUMBER', 'تعذر إنشاء رقم مستند الجرد في IAS20261');
      }
      const documentSerial = buildInventorySerial(this.config.branchYear, input.inventoryType, documentNo);
      await connection.execute(`
        INSERT INTO ${schema}.MASTER_INV (
          INV_TYPE,INV_NO,INV_DATE,ANNUAL,INV_DESC,REF_NO,USE_ATTACH_INV,
          BRN_NO,BRN_YEAR,CMP_NO,BRN_USR,AD_DATE,AD_U_ID,INV_SER,MACHINE_NO,
          AD_TRMNL_NM,UP_TRMNL_NM,UP_CNT,PR_REP,EXTERNAL_POST,PROCESSED
        ) VALUES (
          :inventoryType,:documentNo,TRUNC(SYSDATE),0,:description,:referenceNo,0,
          1,:branchYear,1,1,SYSDATE,:oracleUserId,:documentSerial,NULL,
          SYS_CONTEXT('USERENV','HOST'),NULL,NULL,NULL,0,0
        )`, {
        inventoryType: input.inventoryType,
        documentNo,
        description: input.description,
        referenceNo,
        branchYear: this.config.branchYear,
        oracleUserId: this.config.oracleUserId,
        documentSerial,
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
          lineNo: line.lineNo,
          itemCode: line.itemCode,
          unitCode: line.unitCode,
          warehouseCode: line.warehouseCode,
          countedQuantity: line.countedQuantity,
          documentNo,
          inventoryType: input.inventoryType,
          documentSerial,
          expireDate: line.expireDate,
          batchNo: line.batchNo,
          availableQuantity: line.availableQuantity,
          packageSize: line.packageSize,
          packageQuantity: line.packageQuantity,
          branchYear: this.config.branchYear,
        });
      }
      await connection.commit();
      return {
        created: true,
        documentNo: String(documentNo),
        documentSerial,
        inventoryType: String(input.inventoryType),
        lineCount: prepared.lines.length,
        schema,
        status: 'draft',
        oracleWrite: 'INSERT_ONLY',
        processed: false,
        externalPost: false,
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
  Ias20261InventoryConflictError,
  Ias20261InventoryWriter,
  buildInventoryReference,
  buildInventorySerial,
};
