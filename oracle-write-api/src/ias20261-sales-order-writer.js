'use strict';

const { createHash } = require('node:crypto');
const { assertSalesOrderProfile, salesOrderSerial, salesOrderReservationSerial,
  NEXT_ORDER_NUMBER_SQL, NEXT_RESERVATION_NUMBER_SQL } = require('./ias20261-sales-order-contract');
class SalesOrderValidationError extends Error { constructor(message) { super(message); this.name = 'SalesOrderValidationError'; } }
const hash = value => createHash('sha256').update(value).digest('hex');
const profile = Object.freeze({schema:'IAS20261',year:2026,branch:1,serialType:1});
const decimalSql = key => `TO_NUMBER(:${key},'999999999D999999','NLS_NUMERIC_CHARACTERS=''.,''')`;
function text(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value.trim(),'utf8') > max) throw new SalesOrderValidationError(`Invalid ${name}`);
  return value.trim();
}
function decimal(value, name, positive) {
  const raw = String(value ?? '');
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(raw) || (positive && !/[1-9]/.test(raw))) throw new SalesOrderValidationError(`Invalid ${name}`);
  const [whole,fraction=''] = raw.split('.');
  const result = `${BigInt(whole)}${fraction.replace(/0+$/,'') ? '.'+fraction.replace(/0+$/,'') : ''}`;
  return result;
}
function normalizeSalesOrder(input) {
  const allowed=['externalReference','orderKind','customerCode','customerName','currencyCode','orderDate','notes','lines'];
  if (!input || Array.isArray(input) || Object.keys(input).some(k=>!allowed.includes(k))) throw new SalesOrderValidationError('Unsupported sales-order field');
  if (!['cash','credit'].includes(input.orderKind)) throw new SalesOrderValidationError('Invalid order kind');
  if (input.orderKind==='cash' && input.customerCode) throw new SalesOrderValidationError('Cash orders use the customer name without a credit account');
  const customerCode=input.orderKind==='credit'?text(input.customerCode,'customer code',15):null;
  const reference=text(input.externalReference,'reference',120);
  if (!/^[a-zA-Z0-9:_-]+$/.test(reference)) throw new SalesOrderValidationError('Invalid reference');
  const orderDate=text(input.orderDate,'date',10);
  const date=new Date(`${orderDate}T00:00:00Z`);
  if (!/^2026-\d{2}-\d{2}$/.test(orderDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==orderDate) throw new SalesOrderValidationError('Invalid 2026 order date');
  if (!['YR','SR','$'].includes(input.currencyCode)) throw new SalesOrderValidationError('Invalid currency');
  if (!Array.isArray(input.lines) || input.lines.length<1 || input.lines.length>50) throw new SalesOrderValidationError('Invalid lines');
  const lines=input.lines.map(line=>{
    if (!line || Object.keys(line).some(k=>!['itemCode','itemName','unitCode','warehouseCode','quantity','unitPrice'].includes(k))) throw new SalesOrderValidationError('Unsupported line field');
    const warehouseCode=text(String(line.warehouseCode ?? ''),'warehouse',10);
    if(!/^[1-9]\d{0,9}$/.test(warehouseCode))throw new SalesOrderValidationError('Invalid warehouse');
    return {itemCode:text(line.itemCode,'item',30),unitCode:text(line.unitCode,'unit',10),warehouseCode,
      quantity:decimal(line.quantity,'quantity',true),unitPrice:decimal(line.unitPrice,'price',true)};
  });
  return {externalReference:reference,orderKind:input.orderKind,...(customerCode?{customerCode}:{}),
    customerName:input.orderKind==='cash'?text(input.customerName,'customer name',100):null,
    currencyCode:input.currencyCode,orderDate,notes:input.notes?text(input.notes,'notes',1000):null,lines};
}

class Ias20261SalesOrderWriter {
  constructor(pool,config) {
    if(config.schema!=='IAS20261'||config.branchYear!==2026||config.oracle.user!=='ALBINAA20261WRITER'||config.oracleUserId!==1)throw new SalesOrderValidationError('Invalid sales-order writer configuration');
    this.pool=pool;this.config=config;
  }
  async prepareCredit(connection,input,amount) {
    const customers=await connection.execute(`SELECT C_A_NAME,CREDIT_PERIOD,
      TO_CHAR(TO_DATE(:docDate,'YYYY-MM-DD')+NVL(CREDIT_PERIOD,0),'YYYY-MM-DD') DUE_DATE
      FROM IAS20261.CUSTOMER WHERE C_CODE=:code AND NVL(INACTIVE,0)=0
      AND NVL(INACTIVE_SALES,0)=0 AND NVL(BLK_LST,0)=0`,{docDate:input.orderDate,code:input.customerCode});
    const customer=customers.rows[0],period=Number(customer?.CREDIT_PERIOD??0);
    if(customers.rows.length!==1||!customer.C_A_NAME||!Number.isInteger(period)||period<0||period>3650)throw new SalesOrderValidationError('Customer credit profile is unavailable');
    const checked=await connection.execute(`SELECT IAS20261.ALBINAA_SO_CREDIT_CHECK(
      :code,:currency,TO_DATE(:docDate,'YYYY-MM-DD'),TO_NUMBER(:amount)) RESULT FROM DUAL`,
    {code:input.customerCode,currency:input.currencyCode,docDate:input.orderDate,amount});
    const result=checked.rows[0]?.RESULT;
    if(checked.rows.length!==1||result!=='OK'){
      const message=typeof result==='string'&&result.startsWith('BLOCK:')?result.slice(6):'تعذر تأكيد فحص الائتمان؛ لم يُحفظ الطلب';
      throw new SalesOrderValidationError(message);
    }
    return {customerName:customer.C_A_NAME,dueDate:customer.DUE_DATE};
  }
  async prepare(connection,input) {
    const query=async(sql,binds={})=>(await connection.execute(sql,binds)).rows;
    const ar=await query('SELECT AR_SORDER_SERIAL,NO_OF_DECIMAL_AR,SO_EXP_DATE_MANDTRY,USE_SO_RSRVD_TIME FROM IAS20261.IAS_PARA_AR');
    if(ar.length!==1)throw new SalesOrderValidationError('Ambiguous sales settings');
    assertSalesOrderProfile({...profile,serialType:ar[0].AR_SORDER_SERIAL});
    const precision=Number(ar[0].NO_OF_DECIMAL_AR);
    if(ar[0].NO_OF_DECIMAL_AR==null||!Number.isInteger(precision)||precision<0||precision>6)throw new SalesOrderValidationError('Invalid precision');
    if(Number(ar[0].SO_EXP_DATE_MANDTRY??0)!==0||Number(ar[0].USE_SO_RSRVD_TIME??0)!==0)throw new SalesOrderValidationError('Unsupported expiry/reservation settings');
    const tax=await query('SELECT USE_VAT FROM IAS20261.IAS_PARA_GEN');
    if(tax.length!==1||tax[0].USE_VAT==null||Number(tax[0].USE_VAT)!==0)throw new SalesOrderValidationError('Tax profile is not supported');
    const inv=await query('SELECT WTAVG_TYPE,USE_EXPIRE_DATE,USE_BATCH_NO FROM IAS20261.IAS_PARA_INV');
    if(inv.length!==1||Number(inv[0].WTAVG_TYPE)!==2||Number(inv[0].USE_EXPIRE_DATE)!==0||Number(inv[0].USE_BATCH_NO)!==0)throw new SalesOrderValidationError('Unsupported costing/lot profile');
    const date=await query("SELECT TO_CHAR(SYSDATE,'YYYY') Y FROM DUAL");
    if(date[0]?.Y!=='2026')throw new SalesOrderValidationError('Writer is restricted to 2026');
    if((await query('SELECT SO_TYPE FROM IAS20261.IAS_SORDER_TYPES WHERE SO_TYPE=1')).length!==1)throw new SalesOrderValidationError('Sales-order type is unavailable');
    const rate=await query("SELECT TO_CHAR(CUR_RATE,'TM9','NLS_NUMERIC_CHARACTERS=''.,''') RATE FROM IAS20261.EX_RATE WHERE CUR_CODE=:currency AND CUR_RATE>0",{currency:input.currencyCode});
    if(rate.length!==1)throw new SalesOrderValidationError('Currency is unavailable');
    const warehouses=new Set(input.lines.map(l=>l.warehouseCode));
    for(const warehouse of warehouses)if((await query('SELECT W_CODE FROM IAS20261.WAREHOUSE_DETAILS WHERE W_CODE=TO_NUMBER(:warehouse) AND NVL(INACTIVE,0)=0 AND NVL(NO_SALE,0)=0',{warehouse})).length!==1)throw new SalesOrderValidationError('Warehouse is unavailable');
    const lines=[];
    for(const line of input.lines){
      const item=await query("SELECT TO_CHAR(P_SIZE,'TM9','NLS_NUMERIC_CHARACTERS=''.,''') PACKAGE_SIZE FROM IAS20261.ITEM_DETAILS WHERE I_CODE=:item AND ITM_UNT=:unit AND NVL(INACTIVE,0)=0 AND NVL(NO_SALE,0)=0 AND P_SIZE>0",{item:line.itemCode,unit:line.unitCode});
      if(item.length!==1)throw new SalesOrderValidationError('Item/unit is unavailable');
      const cost=await query("SELECT TO_CHAR(NVL(I_CWTAVG,0),'TM9','NLS_NUMERIC_CHARACTERS=''.,''') COST FROM IAS20261.IAS_ITM_WCODE WHERE I_CODE=:item AND W_CODE=TO_NUMBER(:warehouse) AND P_SIZE=1",{item:line.itemCode,warehouse:line.warehouseCode});
      if(cost.length!==1)throw new SalesOrderValidationError('Item warehouse cost is unavailable');
      lines.push({...line,packageSize:item[0].PACKAGE_SIZE,cost:cost[0].COST});
    }
    const levels=await query('SELECT LVL_NO,LVL_NM,ORDR_NO FROM IAS20261.S_APPRVD_LVL WHERE DOC_TYP=53 ORDER BY ORDR_NO,LVL_NO');
    if(!levels.length)throw new SalesOrderValidationError('Sales-order approval levels are not configured');
    const binds={precision,rate:rate[0].RATE};
    const parts=lines.map((line,i)=>{binds[`q${i}`]=line.quantity;binds[`p${i}`]=line.unitPrice;return `SELECT ${decimalSql(`q${i}`)} Q,${decimalSql(`p${i}`)} P FROM DUAL`;});
    const totals=await query(`SELECT TO_CHAR(ROUND(SUM(Q*P),:precision),'TM9','NLS_NUMERIC_CHARACTERS=''.,''') AMOUNT,
      TO_CHAR(ROUND(SUM(Q*P),:precision)*TO_NUMBER(:rate),'TM9','NLS_NUMERIC_CHARACTERS=''.,''') APPROVAL_AMOUNT FROM (${parts.join(' UNION ALL ')})`,binds);
    const customer=input.orderKind==='credit'?await this.prepareCredit(connection,input,totals[0].AMOUNT):{customerName:input.customerName,dueDate:null};
    return {...customer,lines,precision,rate:rate[0].RATE,amount:totals[0].AMOUNT,approvalAmount:totals[0].APPROVAL_AMOUNT,
      approvalLevels:levels.map(l=>({level:String(l.LVL_NO),name:l.LVL_NM,order:String(l.ORDR_NO),status:'unapproved'}))};
  }
  async dryRun(raw) {
    const input=normalizeSalesOrder(raw),c=await this.pool.getConnection();c.callTimeout=this.config.oracle.callTimeout;
    try{await c.execute("ALTER SESSION SET NLS_NUMERIC_CHARACTERS='.,'");await c.execute('SET TRANSACTION READ ONLY');const p=await this.prepare(c,input);
      return {valid:true,mode:'DRY_RUN',oracleWrite:'NONE',schema:'IAS20261',amount:p.amount,readyLines:p.lines.length,totalLines:p.lines.length,approvalLevels:p.approvalLevels};
    }finally{try{await c.rollback();}finally{await c.close();}}
  }
  async createDraft(raw) {
    const input=normalizeSalesOrder(raw),key=`ALBS:${hash(input.externalReference)}`,marker=`${key}:${hash(JSON.stringify(input))}`;
    const c=await this.pool.getConnection();c.callTimeout=this.config.oracle.callTimeout;
    try {
      await c.execute("ALTER SESSION SET NLS_NUMERIC_CHARACTERS='.,'");
      await c.execute('BEGIN IAS20261.ALBINAA_SALES_ORDER_LOCK; END;');
      const existing=await c.execute("SELECT TO_CHAR(ORDER_NO) DOCUMENT_NO,TO_CHAR(ORDER_SER) SERIAL,DOC_SER_EXTRNL MARKER FROM IAS20261.SALES_ORDER WHERE DOC_SER_EXTRNL LIKE :key",{key:`${key}:%`});
      if(existing.rows.length){if(existing.rows.length!==1||existing.rows[0].MARKER!==marker)throw new SalesOrderValidationError('Sales-order reference conflict');await c.rollback();return {created:false,schema:'IAS20261',number:existing.rows[0].DOCUMENT_NO,serial:existing.rows[0].SERIAL};}
      const p=await this.prepare(c,input);
      const number=String((await c.execute(NEXT_ORDER_NUMBER_SQL)).rows[0].DOCUMENT_NO);
      const reservationNumber=String((await c.execute(NEXT_RESERVATION_NUMBER_SQL)).rows[0].DOCUMENT_NO);
      const serial=salesOrderSerial(profile,number),reservationSerial=salesOrderReservationSerial(profile,reservationNumber);
      const customerCode=input.customerCode??null,billType=input.orderKind==='credit'?4:1;
      const common={docNumber:number,serial,docDate:input.orderDate,customerCode,customerName:p.customerName,dueDate:p.dueDate,billType,currency:input.currencyCode,rate:p.rate,notes:input.notes,amount:p.amount,userId:this.config.oracleUserId,marker};
      await c.execute(`INSERT INTO IAS20261.SALES_ORDER
        (SO_TYPE,ORDER_NO,ORDER_SER,ORDER_DATE,C_CODE,C_NAME,BILL_DUE_DATE,ORDER_CUR,CUR_RATE,STOCK_RATE,BILL_DOC_TYPE,A_DESC,ORDER_AMT,
         APPROVED,PROCESED,INACTIVE,REPEAT_USE_IN_BILLS,PROCESS_OUT_FLG,DISC_AMT,DISC_AMT_MST,DISC_AMT_DTL,VAT_AMT,OTHR_AMT,
         CLC_VAT_PRICE_TYP,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR,AD_U_ID,AD_DATE,AD_TRMNL_NM,EXTERNAL_POST,DOC_SER_EXTRNL)
        VALUES(1,:docNumber,:serial,TO_DATE(:docDate,'YYYY-MM-DD'),:customerCode,:customerName,TO_DATE(:dueDate,'YYYY-MM-DD'),:currency,TO_NUMBER(:rate),1,:billType,:notes,TO_NUMBER(:amount),
         0,0,0,0,0,0,0,0,0,0,1,1,1,2026,1,:userId,SYSDATE,SYS_CONTEXT('USERENV','HOST'),0,:marker)`,common);
      await c.execute(`INSERT INTO IAS20261.IAS_RESERVE_MST
        (DOC_TYPE,DOC_NO,DOC_SER,DOC_NO_REF,DOC_TYPE_REF,DOC_SER_REF,C_CODE,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR,AD_U_ID,AD_DATE)
        VALUES(2,:reservationNumber,:reservationSerial,:docNumber,53,:serial,:customerCode,1,1,2026,1,:userId,SYSDATE)`,{reservationNumber,reservationSerial,docNumber:number,serial,customerCode,userId:this.config.oracleUserId});
      for(const [index,line]of p.lines.entries()){
        const binds={docNumber:number,serial,lineNo:index+1,item:line.itemCode,unit:line.unitCode,quantity:line.quantity,price:line.unitPrice,packageSize:line.packageSize,warehouse:line.warehouseCode,cost:line.cost};
        await c.execute(`INSERT INTO IAS20261.ORDER_DETAIL
          (SO_TYPE,ORDER_NO,ORDER_SER,RCRD_NO,I_CODE,ITM_UNT,I_QTY,I_PRICE,P_SIZE,P_QTY,W_CODE,STK_COST,DOC_SEQ,
           EXPIRE_DATE,BATCH_NO,RESERVED,RES_QTY,CANCELED,USE_ATTCH,DIS_AMT,DIS_AMT_DTL,DIS_AMT_DTL2,DIS_AMT_DTL3,DIS_AMT_MST,VAT_AMT,FREE_QTY,
           CMP_NO,BRN_NO,BRN_YEAR,BRN_USR)
          VALUES(1,:docNumber,:serial,:lineNo,:item,:unit,TO_NUMBER(:quantity),TO_NUMBER(:price),TO_NUMBER(:packageSize),
           TO_NUMBER(:quantity)*TO_NUMBER(:packageSize),TO_NUMBER(:warehouse),TO_NUMBER(:cost),IAS20261.IAS_DOC_SEQ_OTHR.NEXTVAL,
           DATE '1900-01-01','0',0,NULL,0,0,0,0,0,0,0,0,0,1,1,2026,1)`,binds);
        await c.execute(`INSERT INTO IAS20261.IAS_RESERVE_DTL
          (DOC_TYPE,DOC_NO,DOC_SER,DOC_NO_REF,DOC_TYPE_REF,DOC_SER_REF,C_CODE,RCRD_NO,I_CODE,ITM_UNT,W_CODE,
           EXPIRE_DATE,BATCH_NO,I_QTY,P_SIZE,P_QTY,CP_QTY,RESERVED,DOC_SEQUENCE,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR,AD_U_ID,AD_DATE)
          VALUES(2,:reservationNumber,:reservationSerial,:docNumber,53,:serial,:customerCode,:lineNo,:item,:unit,TO_NUMBER(:warehouse),
           DATE '1900-01-01','0',NULL,TO_NUMBER(:packageSize),0,0,0,NULL,1,1,2026,1,:userId,SYSDATE)`,
        {reservationNumber,reservationSerial,docNumber:number,serial,customerCode,lineNo:index+1,item:line.itemCode,unit:line.unitCode,warehouse:line.warehouseCode,packageSize:line.packageSize,userId:this.config.oracleUserId});
      }
      for(const level of p.approvalLevels)await c.execute(`INSERT INTO IAS20261.S_APPRVD_MOV
        (LVL_NO,DOC_TYP,DOC_SER,DOC_NO,DOC_JV_TYP,DOC_DATE,DOC_AMT,APPRVD,ORDR_NO,CMP_NO,BRN_NO,BRN_YEAR,BRN_USR)
        VALUES(:approvalLevel,53,:serial,:docNumber,:billType,TO_DATE(:docDate,'YYYY-MM-DD'),TO_NUMBER(:amount),0,:levelOrder,1,1,2026,1)`,
      {approvalLevel:level.level,serial,docNumber:number,billType,docDate:input.orderDate,amount:p.approvalAmount,levelOrder:level.order});
      await c.commit();return {created:true,schema:'IAS20261',number,serial,reservationNumber,reservationSerial,status:'unapproved',approvalLevels:p.approvalLevels};
    }catch(error){await c.rollback();throw error;}finally{await c.close();}
  }
}
module.exports={Ias20261SalesOrderWriter,normalizeSalesOrder};
