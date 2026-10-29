'use strict';

const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(value).digest('hex');

function text(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value.trim(), 'utf8') > max) throw new Error(`Invalid ${name}`);
  return value.trim();
}
function decimal(value, name, positive = false) {
  const raw = String(value ?? '');
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(raw) || (positive && !/[1-9]/.test(raw))) throw new Error(`Invalid ${name}`);
  return raw;
}
const scaled = value => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0')); };
function normalize(input) {
  if (!input || !Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 50) throw new Error('Invalid lines');
  const allowed = ['externalReference', 'customerCode', 'currencyCode', 'warehouseCode', 'notes', 'lines'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error('Unsupported quotation field');
  const lines = input.lines.map(line => {
    if (!line || Object.keys(line).some(key => !['itemCode','unitCode','quantity','price','discount'].includes(key))) throw new Error('Unsupported line field');
    const normalized = { itemCode: text(line.itemCode, 'item', 30), unitCode: text(line.unitCode, 'unit', 10),
      quantity: decimal(line.quantity, 'quantity', true), price: decimal(line.price, 'price', true),
      discount: decimal(line.discount ?? '0', 'discount') };
    if (scaled(normalized.discount) > scaled(normalized.price)) throw new Error('Discount exceeds unit price');
    return normalized;
  });
  const warehouseCode = text(String(input.warehouseCode ?? ''), 'warehouse', 10);
  if (!/^[1-9]\d{0,9}$/.test(warehouseCode)) throw new Error('Invalid warehouse');
  return { externalReference: text(input.externalReference, 'reference', 120),
    customerCode: text(input.customerCode, 'customer', 15), currencyCode: text(input.currencyCode, 'currency', 7),
    warehouseCode, notes: input.notes ? text(input.notes, 'notes', 1000) : null, lines };
}
function serialFor(number) {
  const raw = String(number);
  if (!/^[1-9]\d{0,24}$/.test(raw)) throw new Error('Invalid quotation number');
  return `202600000152${raw}`;
}

// Initial profile: branch 1/type 1, registered customer, ordinary items, no tax.
// Pool comes from the already identity-checked ALBINAA20261WRITER connection.
class Ias20261QuotationWriter {
  constructor(pool, config) {
    if (config.schema !== 'IAS20261' || config.branchYear !== 2026 || config.oracle.user !== 'ALBINAA20261WRITER') throw new Error('Invalid quotation writer configuration');
    this.pool = pool; this.config = config;
  }

  async prepare(connection, input) {
    const settings = await connection.execute(`SELECT AR_QUOT_SERIAL, NO_OF_DECIMAL_AR FROM IAS20261.IAS_PARA_AR`);
    if (settings.rows.length !== 1 || Number(settings.rows[0].AR_QUOT_SERIAL) !== 1) throw new Error('Unsupported quotation numbering settings');
    const tax = await connection.execute(`SELECT USE_VAT FROM IAS20261.IAS_PARA_GEN`);
    if (tax.rows.length !== 1 || tax.rows[0].USE_VAT == null || Number(tax.rows[0].USE_VAT) !== 0) throw new Error('Tax settings require a validated tax profile');
    const precision = Number(settings.rows[0].NO_OF_DECIMAL_AR);
    if (settings.rows[0].NO_OF_DECIMAL_AR == null || !Number.isInteger(precision) || precision < 0 || precision > 6) throw new Error('Invalid currency precision');
    const profile = await connection.execute(`SELECT TO_CHAR(SYSDATE,'YYYY') YEAR_VALUE FROM DUAL`);
    if (profile.rows[0]?.YEAR_VALUE !== '2026') throw new Error('Quotation date must be in 2026');
    const types = await connection.execute(`SELECT QT_TYPE FROM IAS20261.IAS_QUOT_TYPES WHERE QT_TYPE=1`);
    if (types.rows.length !== 1) throw new Error('Quotation type is unavailable');
    const customers = await connection.execute(`SELECT C_A_NAME FROM IAS20261.CUSTOMER WHERE C_CODE=:code AND NVL(INACTIVE,0)=0`, { code: input.customerCode });
    if (customers.rows.length !== 1) throw new Error('Customer is unavailable');
    const rates = await connection.execute(`SELECT TO_CHAR(CUR_RATE,'TM9','NLS_NUMERIC_CHARACTERS=''.,''') RATE FROM IAS20261.EX_RATE WHERE CUR_CODE=:code AND CUR_RATE>0`, { code: input.currencyCode });
    if (rates.rows.length !== 1) throw new Error('Currency is unavailable');
    const warehouses = await connection.execute(`SELECT W_CODE FROM IAS20261.WAREHOUSE_DETAILS WHERE W_CODE=TO_NUMBER(:code) AND NVL(INACTIVE,0)=0 AND NVL(NO_SALE,0)=0`, { code: input.warehouseCode });
    if (warehouses.rows.length !== 1) throw new Error('Warehouse is unavailable');
    const lines = [];
    for (const line of input.lines) {
      const result = await connection.execute(`SELECT TO_CHAR(P_SIZE,'TM9','NLS_NUMERIC_CHARACTERS=''.,''') PACKAGE_SIZE
        FROM IAS20261.ITEM_DETAILS WHERE I_CODE=:itemCode AND ITM_UNT=:unitCode
        AND NVL(INACTIVE,0)=0 AND NVL(NO_SALE,0)=0 AND P_SIZE>0`, { itemCode: line.itemCode, unitCode: line.unitCode });
      if (result.rows.length !== 1) throw new Error('Item/unit is unavailable or ambiguous');
      lines.push({ ...line, packageSize: result.rows[0].PACKAGE_SIZE });
    }
    const approvals = await connection.execute(`SELECT LVL_NO,LVL_NM,ORDR_NO
      FROM IAS20261.S_APPRVD_LVL WHERE DOC_TYP=52 ORDER BY ORDR_NO,LVL_NO`);
    if (!approvals.rows.length) throw new Error('Quotation approval levels are not configured');
    return { lines, precision, customerName: customers.rows[0].C_A_NAME, rate: rates.rows[0].RATE,
      approvalLevels: approvals.rows.map(row => ({ level: String(row.LVL_NO), name: row.LVL_NM, order: String(row.ORDR_NO), status: 'unapproved' })) };
  }

  async totals(connection, prepared) {
    const binds = { precision: prepared.precision };
    const convert = key => `TO_NUMBER(:${key},'999999999D999999','NLS_NUMERIC_CHARACTERS=''.,''')`;
    const parts = prepared.lines.map((line, index) => {
      binds[`q${index}`] = line.quantity; binds[`p${index}`] = line.price; binds[`d${index}`] = line.discount;
      return `SELECT ${convert(`q${index}`)} Q,${convert(`p${index}`)} P,${convert(`d${index}`)} D FROM DUAL`;
    });
    const result = await connection.execute(`SELECT
      TO_CHAR(ROUND(SUM(Q*P),:precision),'TM9','NLS_NUMERIC_CHARACTERS=''.,''') GROSS,
      TO_CHAR(ROUND(SUM(Q*D),:precision),'TM9','NLS_NUMERIC_CHARACTERS=''.,''') DISCOUNT,
      TO_CHAR(ROUND(SUM(Q*P),:precision)-ROUND(SUM(Q*D),:precision),'TM9','NLS_NUMERIC_CHARACTERS=''.,''') NET
      FROM (${parts.join(' UNION ALL ')})`, binds);
    return { gross: result.rows[0].GROSS, discount: result.rows[0].DISCOUNT, net: result.rows[0].NET };
  }

  async dryRun(raw) {
    const input = normalize(raw); const connection = await this.pool.getConnection();
    connection.callTimeout = this.config.oracle.callTimeout;
    try {
      await connection.execute('SET TRANSACTION READ ONLY');
      const prepared = await this.prepare(connection, input);
      const totals = await this.totals(connection, prepared);
      return { valid: true, mode: 'DRY_RUN', oracleWrite: 'NONE', schema: 'IAS20261', lines: prepared.lines, totals, approvalLevels: prepared.approvalLevels };
    } finally { try { await connection.rollback(); } finally { await connection.close(); } }
  }

  async createDraft(raw) {
    const input = normalize(raw);
    const key = `ALBQ:${digest(input.externalReference)}`;
    const marker = `${key}:${digest(JSON.stringify(input))}`;
    const connection = await this.pool.getConnection();
    connection.callTimeout = this.config.oracle.callTimeout;
    try {
      await connection.execute(`ALTER SESSION SET NLS_NUMERIC_CHARACTERS='.,'`);
      // Definer-rights helper locks only QUOTATION, never commits, and fails NOWAIT.
      await connection.execute('BEGIN IAS20261.ALBINAA_QUOTATION_LOCK; END;');
      const existing = await connection.execute(`SELECT TO_CHAR(QUOT_NO) DOCUMENT_NO,TO_CHAR(QUOT_SER) SERIAL,DOC_SER_EXTRNL MARKER
        FROM IAS20261.QUOTATION WHERE DOC_SER_EXTRNL LIKE :key`, { key: `${key}:%` });
      if (existing.rows.length) {
        if (existing.rows.length !== 1 || existing.rows[0].MARKER !== marker) throw new Error('Quotation reference conflict');
        await connection.rollback();
        return { created: false, schema: 'IAS20261', number: existing.rows[0].DOCUMENT_NO, serial: existing.rows[0].SERIAL };
      }
      const prepared = await this.prepare(connection, input);
      const next = await connection.execute(`SELECT TO_CHAR(NVL(MAX(QUOT_NO),0)+1) NUMBER_VALUE FROM IAS20261.QUOTATION WHERE BRN_NO=1`);
      const number = next.rows[0].NUMBER_VALUE, serial = serialFor(number);
      await connection.execute(`INSERT INTO IAS20261.QUOTATION
        (QT_TYPE,QUOT_NO,QUOT_SER,QUOT_DATE,QUOT_CUR,CUR_RATE,C_CODE,C_NAME,W_CODE,A_DESC,
         QUOT_AMT,DISC_AMT,DISC_AMT_MST,DISC_AMT_DTL,VAT_AMT,OTHR_AMT,APPROVED,PROCESSED,INACTIVE,
         CMP_NO,BRN_NO,BRN_YEAR,BRN_USR,AD_U_ID,AD_DATE,AD_TRMNL_NM,DOC_SER_EXTRNL)
        VALUES (1,:documentNo,:serial,TRUNC(SYSDATE),:currency,:rate,:customer,:name,:warehouse,:notes,
         0,0,0,0,0,0,0,0,0,1,1,2026,1,:userId,SYSDATE,SYS_CONTEXT('USERENV','HOST'),:marker)`,
      { documentNo: number, serial, currency: input.currencyCode, rate: prepared.rate, customer: input.customerCode,
        name: prepared.customerName, warehouse: input.warehouseCode, notes: input.notes,
        userId: this.config.oracleUserId, marker });
      for (const [index, line] of prepared.lines.entries()) {
        await connection.execute(`INSERT INTO IAS20261.QUOTATION_DETAIL
          (QT_TYPE,QUOT_NO,QUOT_SER,RCRD_NO,I_CODE,ITM_UNT,I_QTY,P_SIZE,P_QTY,I_PRICE,W_CODE,
           DIS_AMT_DTL,DIS_AMT_DTL2,DIS_AMT_DTL3,DIS_AMT_MST,DIS_AMT,VAT_AMT,FREE_QTY,
           DOC_SEQUENCE,EXPIRE_DATE,BATCH_NO,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR)
          VALUES (1,:documentNo,:serial,:lineNo,:itemCode,:unitCode,:quantity,:packageSize,
            TO_NUMBER(:quantity)*TO_NUMBER(:packageSize),:price,:warehouse,:discount,0,0,0,:discount,0,0,
            IAS20261.IAS_DOC_SEQ_OTHR.NEXTVAL,DATE '1900-01-01','0',1,1,2026,1)`,
        { documentNo: number, serial, lineNo: index+1, itemCode: line.itemCode, unitCode: line.unitCode,
          quantity: line.quantity, packageSize: line.packageSize, price: line.price,
          discount: line.discount, warehouse: input.warehouseCode });
      }
      await connection.execute(`UPDATE IAS20261.QUOTATION SET
        (QUOT_AMT,DISC_AMT_DTL,DISC_AMT)=(SELECT
          ROUND(NVL(SUM(I_QTY*I_PRICE),0),:precision),
          ROUND(NVL(SUM(I_QTY*NVL(DIS_AMT_DTL,0)),0),:precision),
          ROUND(NVL(SUM(I_QTY*NVL(DIS_AMT_DTL,0)),0),:precision)
          FROM IAS20261.QUOTATION_DETAIL WHERE QUOT_SER=:serial)
        WHERE QUOT_SER=:serial`, { precision: prepared.precision, serial });
      // Match ARST002's initial approval rows; never invoke its package, which also deletes prior rows.
      // Approval metadata is inserted atomically with the document, always APPRVD=0.
      for (const approval of prepared.approvalLevels) {
        await connection.execute(`INSERT INTO IAS20261.S_APPRVD_MOV
          (LVL_NO,DOC_TYP,DOC_SER,DOC_NO,DOC_JV_TYP,DOC_DATE,DOC_AMT,APPRVD,ORDR_NO,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR)
          VALUES (:approvalLevel,52,:serial,:documentNo,0,TRUNC(SYSDATE),0,0,:approvalOrder,1,1,2026,1)`,
        { approvalLevel: approval.level, serial, documentNo: number, approvalOrder: approval.order });
      }
      await connection.commit();
      return { created: true, schema: 'IAS20261', number, serial, status: 'unapproved', approvalLevels: prepared.approvalLevels };
    } catch (error) { await connection.rollback(); throw error; }
    finally { await connection.close(); }
  }
}
module.exports = { Ias20261QuotationWriter, normalize, serialFor };
