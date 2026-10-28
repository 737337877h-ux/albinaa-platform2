'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {Ias20261SalesOrderWriter,normalizeSalesOrder}=require('../src/ias20261-sales-order-writer');
const config={schema:'IAS20261',branchYear:2026,oracleUserId:1,oracle:{user:'ALBINAA20261WRITER',callTimeout:1000}};
const input={externalReference:'test-order-1',orderKind:'cash',customerName:'عميل',currencyCode:'YR',orderDate:'2026-09-17',
  lines:[{itemCode:'230800105004',unitCode:'سيخ',warehouseCode:'101',quantity:'12',unitPrice:'1500'}]};
function fixture(failure,existing=[]){
  const calls=[];
  const c={execute:async(sql,binds)=>{
    calls.push({sql,binds});
    if(sql.startsWith('INSERT')){
      const used=[...new Set([...sql.matchAll(/:(\w+)/g)].map(m=>m[1]))].sort();
      assert.deepEqual(Object.keys(binds).sort(),used);
      assert.ok(Object.values(binds).every(v=>v!==undefined),'all bound values must be defined');
    }
    if(failure&&sql.includes(failure))throw new Error('simulated failure');
    if(sql.includes('DOC_SER_EXTRNL LIKE'))return {rows:existing};
    if(sql.includes('MAX(TO_NUMBER(ORDER_NO))'))return {rows:[{DOCUMENT_NO:'2284'}]};
    if(sql.includes('MAX(DOC_NO)'))return {rows:[{DOCUMENT_NO:'1577'}]};
    return {rows:[]};
  },commit:async()=>{calls.push({sql:'COMMIT'});if(failure==='COMMIT')throw new Error('simulated failure');},
  rollback:async()=>calls.push({sql:'ROLLBACK'}),close:async()=>calls.push({sql:'CLOSE'})};
  const writer=new Ias20261SalesOrderWriter({getConnection:async()=>c},config);
  writer.prepare=async(_c,value)=>({customerName:value.orderKind==='credit'?'Oracle customer':value.customerName,dueDate:value.orderKind==='credit'?'2026-10-17':null,lines:value.lines.map(l=>({...l,packageSize:'1',cost:'47.617726'})),
    rate:'.0071428571428571',amount:'18000',approvalAmount:'128.5714285714278',approvalLevels:[{level:'1',name:'عام',order:'1'}]});
  return {writer,calls};
}
test('credit without a customer code is rejected before opening any connection',async()=>{
  const writer=new Ias20261SalesOrderWriter({getConnection:()=>assert.fail('must not connect')},config);
  await assert.rejects(writer.createDraft({...input,orderKind:'credit'}),/customer code/);
});
test('credit customer and payment kind are carried through header, reservation and approval',async()=>{
  const {writer,calls}=fixture();
  await writer.createDraft({...input,orderKind:'credit',customerCode:'10001',customerName:'Untrusted display name'});
  const header=calls.find(c=>c.sql.startsWith('INSERT INTO IAS20261.SALES_ORDER'));
  assert.equal(header.binds.customerCode,'10001');assert.equal(header.binds.customerName,'Oracle customer');
  assert.equal(header.binds.billType,4);assert.equal(header.binds.dueDate,'2026-10-17');
  for(const table of ['IAS_RESERVE_MST','IAS_RESERVE_DTL'])assert.equal(calls.find(c=>c.sql.startsWith(`INSERT INTO IAS20261.${table}`)).binds.customerCode,'10001');
  assert.equal(calls.find(c=>c.sql.startsWith('INSERT INTO IAS20261.S_APPRVD_MOV')).binds.billType,4);
});
test('credit validation uses only the restricted function and propagates unavailable/blocked results',async()=>{
  for(const result of ['OK','BLOCK:limit exceeded',null,'', 'unexpected']){
    const calls=[];
    const c={execute:async(sql,binds)=>{calls.push({sql,binds});return {rows:sql.includes('FROM IAS20261.CUSTOMER')?
      [{C_A_NAME:'Customer',CREDIT_PERIOD:'0',DUE_DATE:'2026-09-17'}]:[{RESULT:result}]};}};
    const writer=new Ias20261SalesOrderWriter({},config);
    const run=writer.prepareCredit(c,normalizeSalesOrder({...input,orderKind:'credit',customerCode:'10001'}),'80000');
    if(result==='OK')assert.equal((await run).customerName,'Customer');else await assert.rejects(run);
    assert.ok(calls.every(c=>c.sql.startsWith('SELECT')));
    assert.ok(calls[1].sql.includes('IAS20261.ALBINAA_SO_CREDIT_CHECK'));
    assert.deepEqual(calls[1].binds,{code:'10001',currency:'YR',docDate:'2026-09-17',amount:'80000'});
  }
});
test('credit checker failure rolls back before allocating any document or sequence',async()=>{
  const {writer,calls}=fixture();writer.prepare=async()=>{throw new Error('checker unavailable');};
  await assert.rejects(writer.createDraft({...input,orderKind:'credit',customerCode:'10001'}),/checker unavailable/);
  assert.ok(!calls.some(c=>/INSERT|NEXTVAL|MAX\(/.test(c.sql)));
  assert.deepEqual(calls.slice(-2).map(c=>c.sql),['ROLLBACK','CLOSE']);
});
test('credit checker transport/database failure is not treated as approval',async()=>{
  const writer=new Ias20261SalesOrderWriter({},config);
  const c={execute:async sql=>{if(sql.includes('FROM IAS20261.CUSTOMER'))return {rows:[{C_A_NAME:'Customer',CREDIT_PERIOD:0,DUE_DATE:'2026-09-17'}]};throw Error('ORA-00904 checker missing');}};
  await assert.rejects(writer.prepareCredit(c,normalizeSalesOrder({...input,orderKind:'credit',customerCode:'10001'}),'80000'),/checker missing/);
});
test('reject unsupported fields, invalid dates, zero quantities and imprecise decimal input',()=>{
  assert.throws(()=>normalizeSalesOrder({...input,approved:true}));
  assert.throws(()=>normalizeSalesOrder({...input,orderDate:'2026-02-30'}));
  assert.throws(()=>normalizeSalesOrder({...input,customerCode:'10009'}));
  for(const quantity of ['0','-1','1e3','0.0000001',Infinity])assert.throws(()=>normalizeSalesOrder({...input,lines:[{...input.lines[0],quantity}]}));
  assert.equal(normalizeSalesOrder({...input,lines:[{...input.lines[0],quantity:'012.000000'}]}).lines[0].quantity,'12');
});
test('lock precedes independent numbering; details, reservation and approval commit atomically',async()=>{
  const {writer,calls}=fixture();const result=await writer.createDraft(input);
  assert.equal(result.serial,'2026000001532284');assert.equal(result.reservationSerial,'202620000011577');
  const lock=calls.findIndex(c=>c.sql.includes('ALBINAA_SALES_ORDER_LOCK'));
  assert.ok(lock>=0&&lock<calls.findIndex(c=>c.sql.includes('MAX(')));
  assert.equal(calls.filter(c=>c.sql.includes('NEXTVAL')).length,1);
  const inserts=calls.filter(c=>c.sql.startsWith('INSERT'));
  assert.equal(inserts.length,5);
  assert.equal(inserts.at(-1).binds.amount,'128.5714285714278');
  assert.ok(inserts.some(c=>c.sql.includes('NULL,TO_NUMBER(:packageSize),0,0,0,NULL')));
  assert.deepEqual(calls.slice(-2).map(c=>c.sql),['COMMIT','CLOSE']);
});
for(const table of ['SALES_ORDER','ORDER_DETAIL','IAS_RESERVE_MST','IAS_RESERVE_DTL','S_APPRVD_MOV']){
  test(`failure inserting ${table} rolls back and closes without commit`,async()=>{
    const {writer,calls}=fixture(`INSERT INTO IAS20261.${table}`);
    await assert.rejects(writer.createDraft(input),/simulated failure/);
    assert.ok(!calls.some(c=>c.sql==='COMMIT'));
    assert.deepEqual(calls.slice(-2).map(c=>c.sql),['ROLLBACK','CLOSE']);
  });
}
test('repeated request returns original order; changed payload with same key cannot create another',async()=>{
  const hash=s=>createHash('sha256').update(s).digest('hex');const normalized=normalizeSalesOrder(input);
  const marker=`ALBS:${hash(normalized.externalReference)}:${hash(JSON.stringify(normalized))}`;
  const {writer,calls}=fixture(null,[{DOCUMENT_NO:'2284',SERIAL:'2026000001532284',MARKER:marker}]);
  writer.prepare=()=>assert.fail('replay should not revalidate current stock/settings');
  assert.equal((await writer.createDraft(input)).created,false);
  assert.ok(!calls.some(c=>/INSERT|NEXTVAL|MAX\(/.test(c.sql)));
  await assert.rejects(writer.createDraft({...input,notes:'changed'}),/reference conflict/);
});
test('lock failure never allocates numbers or inserts',async()=>{
  const {writer,calls}=fixture('ALBINAA_SALES_ORDER_LOCK');
  await assert.rejects(writer.createDraft(input));
  assert.ok(!calls.some(c=>/INSERT|NEXTVAL|MAX\(/.test(c.sql)));
});
test('dry run is read-only with no lock, sequence or commit',async()=>{
  const {writer,calls}=fixture();assert.equal((await writer.dryRun(input)).oracleWrite,'NONE');
  assert.ok(calls.some(c=>c.sql==='SET TRANSACTION READ ONLY'));
  assert.ok(!calls.some(c=>/INSERT|UPDATE|DELETE|NEXTVAL|ALBINAA_SALES_ORDER_LOCK|COMMIT/.test(c.sql)));
});
test('failed commit closes connection so retry must reconcile persisted idempotency marker',async()=>{
  const {writer,calls}=fixture('COMMIT');await assert.rejects(writer.createDraft(input));
  assert.equal(calls.at(-1).sql,'CLOSE');
});
