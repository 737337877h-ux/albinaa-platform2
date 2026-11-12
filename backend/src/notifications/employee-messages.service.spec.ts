import {EmployeeMessagesService,inactivityWindow,firstStaffName} from './employee-messages.service';

describe('authorized staff messaging',()=>{
 const actor={id:'sender',organizationId:'org',permissions:['customers.remind','notifications.broadcast']} as any;
 let db:any,tx:any,service:EmployeeMessagesService;
 beforeEach(()=>{
  tx={
   $queryRaw:jest.fn(),
   customer:{findFirst:jest.fn().mockResolvedValue({id:'c1',name:'عميل تجريبي'})},
   customerAssignment:{findFirst:jest.fn().mockResolvedValue({collector:{userId:'collector',user:{fullName:'موظف تجريبي'}}})},
   notification:{findFirst:jest.fn().mockResolvedValue(null),create:jest.fn(async({data})=>({id:'n1',...data}))},
   hrPushDelivery:{create:jest.fn()},
   auditLog:{create:jest.fn(),findFirst:jest.fn().mockResolvedValue(null)},
   user:{findMany:jest.fn().mockResolvedValue([{id:'u1'},{id:'u2'}]),findFirst:jest.fn().mockResolvedValue({id:'u1'})},
   mobileDeviceSession:{findFirst:jest.fn().mockResolvedValue({lastConnectedAt:new Date('2026-11-10T09:00:00Z')})},
   systemSetting:{findUnique:jest.fn().mockResolvedValue(null)},
  };
  db={...tx,$transaction:jest.fn(async cb=>cb(tx))};service=new EmployeeMessagesService(db);
 });
 it('denies both sends without the independent permissions',async()=>{
  await expect(service.remindCustomer({...actor,permissions:[]},'c1','operation1')).rejects.toThrow('صلاحية');
  await expect(service.broadcast({...actor,permissions:[]},{operationId:'operation1',title:'عنوان',message:'رسالة'})).rejects.toThrow('صلاحية');
  expect(db.$transaction).not.toHaveBeenCalled();
 });
 it('uses the current active assignment in the same organization and creates an outbox entry',async()=>{
  await service.remindCustomer(actor,'c1','operation1');
  expect(tx.customer.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({organizationId:'org',mergedIntoId:null})}));
  expect(tx.customerAssignment.findFirst.mock.calls[0][0].where).toEqual(expect.objectContaining({effectiveTo:null,collector:{active:true,user:{organizationId:'org',isActive:true}}}));
  expect(tx.notification.create.mock.calls[0][0].data).toEqual(expect.objectContaining({userId:'collector',kind:'customer_followup_reminder',payload:expect.objectContaining({customerId:'c1',route:'Customer360'})}));
  expect(tx.hrPushDelivery.create).toHaveBeenCalledTimes(1);
  expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
 });
 it('does not send for an inaccessible customer or missing assignment',async()=>{
  tx.customer.findFirst.mockResolvedValueOnce(null);
  await expect(service.remindCustomer(actor,'foreign','operation1')).rejects.toThrow('العميل');
  tx.customerAssignment.findFirst.mockResolvedValueOnce(null);
  await expect(service.remindCustomer(actor,'c1','operation2')).rejects.toThrow('مسند');
  expect(tx.notification.create).not.toHaveBeenCalled();
 });
 it('deduplicates a recent nudge, including retries',async()=>{
  tx.notification.findFirst.mockResolvedValue({id:'old'});
  expect(await service.remindCustomer(actor,'c1','operation1')).toEqual(expect.objectContaining({alreadySent:true,notificationId:'old'}));
  expect(tx.notification.create).not.toHaveBeenCalled();
 });
 it('broadcasts only to active users in the sender organization, once per operation',async()=>{
  const input={operationId:'operation1',title:'عنوان',message:'رسالة للموظفين'};
  expect(await service.broadcast(actor,input)).toEqual({queued:2,alreadySent:false});
  expect(tx.user.findMany).toHaveBeenCalledWith({where:{organizationId:'org',isActive:true},select:{id:true}});
  expect(tx.hrPushDelivery.create).toHaveBeenCalledTimes(2);
  tx.auditLog.findFirst.mockResolvedValue({newValue:{...input,recipients:2}});
  expect(await service.broadcast(actor,input)).toEqual({queued:2,alreadySent:true});
  await expect(service.broadcast(actor,{...input,message:'محتوى مختلف'})).rejects.toThrow('مختلفة');
  expect(tx.hrPushDelivery.create).toHaveBeenCalledTimes(2);
 });
 it('respects the daylight window in Aden and uses only the first name',()=>{
  expect(inactivityWindow(new Date('2026-11-12T05:59:00Z'))).toBe(false);
  expect(inactivityWindow(new Date('2026-11-12T06:00:00Z'))).toBe(true);
  expect(inactivityWindow(new Date('2026-11-12T17:00:00Z'))).toBe(false);
  expect(firstStaffName('  محمد   أحمد علي ')).toBe('محمد');
 });
 function inactivePolicy(){
  db.systemSetting.findMany=jest.fn(async({where})=>where.key==='notifications.inactivity.policy'?[{organizationId:'org',value:{enabled:true,notBefore:'2026-11-11T00:00:00Z',afterHours:24}}]:[{key:'mobile.lastForeground.u1',value:{at:'2026-11-10T09:00:00Z'}}]);
  db.user.findMany=jest.fn().mockResolvedValue([{id:'u1',fullName:'محمد أحمد علي',hrEmployee:{active:true,workDays:[4]},deviceSessions:[{lastConnectedAt:new Date('2026-11-12T08:00:00Z')}]}]);
  tx.systemSetting.findUnique.mockResolvedValue({value:{at:'2026-11-10T09:00:00Z'}});
 }
 it('uses foreground usage, not recent background sync; dry run never sends',async()=>{
  inactivePolicy();
  expect(await service.runInactivity(new Date('2026-11-12T09:00:00Z'),true)).toEqual({queued:1,dryRun:true});
  expect(tx.notification.create).not.toHaveBeenCalled();
  await service.runInactivity(new Date('2026-11-12T09:00:00Z'));
  const payload=tx.notification.create.mock.calls[0][0].data.payload;
  expect(payload.message).toContain('محمد،');expect(payload.message).not.toContain('أحمد');
 });
 it('skips recent use, an earlier daily reminder, and a day off',async()=>{
  inactivePolicy();tx.systemSetting.findUnique.mockResolvedValue({value:{at:'2026-11-12T08:00:00Z'}});
  expect((await service.runInactivity(new Date('2026-11-12T09:00:00Z'))).queued).toBe(0);
  tx.systemSetting.findUnique.mockResolvedValue(null);tx.notification.findFirst.mockResolvedValue({id:'already'});
  expect((await service.runInactivity(new Date('2026-11-12T09:00:00Z'))).queued).toBe(0);
  tx.notification.findFirst.mockResolvedValue(null);
  expect((await service.runInactivity(new Date('2026-11-13T09:00:00Z'))).queued).toBe(0);
  expect(tx.notification.create).not.toHaveBeenCalled();
 });
});
