import { PromiseAccountClosureService } from './promise-account-closure.service';
const now=new Date('2026-11-16T00:00:00Z');
const actor={id:'u',organizationId:'org',permissions:['promises.create','customers.read_all']} as any;
function fixture(){
 const promises=[{id:'p',customerId:'c',collectorId:'col',currencyCode:'YER',status:'unfulfilled',dueDate:new Date('2026-09-24'),createdAt:new Date('2026-09-16'),expectedAmount:'15000',fulfilledAmount:null,missedDueDate:null,statusReason:'تأخر سابق'}];
 const balances:any[]=[{currencyCode:'YER',accountingBalance:'0',updatedAt:new Date('2026-11-15T22:00:00Z'),lastImportJobId:'import',lastImportJob:{importedAt:new Date('2026-11-15T22:00:00Z')}}],ledger:any[]=[];
 const tx={$executeRawUnsafe:jest.fn(),$queryRaw:jest.fn(),collector:{findUnique:jest.fn().mockResolvedValue({id:'col'})},
 paymentPromise:{findFirst:jest.fn(async({where}:any)=>where.collectorId&&where.collectorId!=='col'?null:{...promises[0],customer:{id:'c',status:'active',customerType:'customer',mergedIntoId:null}}),findMany:jest.fn(async()=>promises),updateMany:jest.fn().mockResolvedValue({count:1})},
 customerBalance:{findMany:jest.fn(async()=>balances)},operationalLedger:{findMany:jest.fn(async()=>ledger)},currency:{findMany:jest.fn().mockResolvedValue([{code:'YER'},{code:'SAR'}])},
 task:{findMany:jest.fn().mockResolvedValue([{id:'t',sourcePromiseId:'p',status:'escalated',taskType:'promise_due'}]),updateMany:jest.fn()},auditLog:{create:jest.fn()}};
 return {service:new PromiseAccountClosureService({$transaction:jest.fn(async(fn:any)=>fn(tx))} as any),tx,promises,balances,ledger};
}
describe('settled-account promise follow-up closure',()=>{
 it('previews scoped old promises without any writes',async()=>{
  const {service,tx}=fixture();const plan=await service.preview(actor,'p',now);expect(plan.canApply).toBe(true);
  expect(plan.promises.map(p=>p.id)).toEqual(['p']);expect(tx.paymentPromise.updateMany).not.toHaveBeenCalled();expect(tx.auditLog.create).not.toHaveBeenCalled();
  expect(tx.paymentPromise.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({customer:{organizationId:'org'}})}));
 });
 it('preserves actual fulfillment and lateness while closing reviewed tasks with an audit',async()=>{
  const {service,tx}=fixture();const plan=await service.preview(actor,'p',now);expect(await service.apply(actor,'p',plan.planHash,now)).toMatchObject({completed:false,closed:true,closedCount:1,status:'closed_settled'});
  const data=tx.paymentPromise.updateMany.mock.calls[0][0].data;expect(data.status).toBe('closed_settled');expect(data.missedDueDate.toISOString()).toContain('2026-09-24');expect(data).not.toHaveProperty('fulfilledAmount');expect(data).not.toHaveProperty('settlementDate');
  expect(tx.task.updateMany).toHaveBeenCalledWith({where:{id:{in:['t']},status:{in:['open','escalated']}},data:{status:'done'}});
  expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({action:'promise_followup_closed_after_settlement',oldValue:{status:'unfulfilled'},newValue:{fulfilledAmountUnchanged:true}});
 });
 it('rejects a changed balance before writing',async()=>{
  const {service,tx,balances}=fixture();const plan=await service.preview(actor,'p',now);balances[0].accountingBalance='0.0001';
  await expect(service.apply(actor,'p',plan.planHash,now)).rejects.toThrow('تغير');expect(tx.paymentPromise.updateMany).not.toHaveBeenCalled();
 });
 it('never offsets positive debt with another currency or ignores post-import debt',async()=>{
  const {service,balances,ledger}=fixture();balances[0].accountingBalance='-1000';balances.push({...balances[0],currencyCode:'SAR',accountingBalance:'0.0001'});
  expect((await service.preview(actor,'p',now)).canApply).toBe(false);balances.pop();balances[0].accountingBalance='0';
  ledger.push({id:'l',currencyCode:'YER',amountSigned:'0.0001',createdAt:new Date('2026-11-15T23:00:00Z')});expect((await service.preview(actor,'p',now)).canApply).toBe(false);
 });
 it('requires complete recent balance provenance',async()=>{
  for(const kind of ['no-import','stale','unknown-ledger']){const {service,balances,ledger}=fixture();
   if(kind==='no-import')balances[0].lastImportJob=null;if(kind==='stale')balances[0].updatedAt=new Date('2026-11-13');
   if(kind==='unknown-ledger')ledger.push({id:'x',currencyCode:'USD',amountSigned:'1',createdAt:now});
   expect((await service.preview(actor,'p',now)).canApply).toBe(false);
  }
 });
 it('rejects missing permission, another collector, and a concurrent status change',async()=>{
  const {service,tx}=fixture();await expect(service.preview({...actor,permissions:[]},'p',now)).rejects.toThrow('صلاحية');
  tx.collector.findUnique.mockResolvedValue({id:'other'});await expect(service.preview({...actor,permissions:['promises.create']},'p',now)).rejects.toThrow('نطاق');
  const plan=await service.preview(actor,'p',now);tx.paymentPromise.updateMany.mockResolvedValue({count:0});
  await expect(service.apply(actor,'p',plan.planHash,now)).rejects.toThrow('تغير');expect(tx.auditLog.create).not.toHaveBeenCalled();
 });
});
