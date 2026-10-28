import {HrPushService} from './hr-push.service';
describe('durable push delivery',()=>{
 let previous:string|undefined;
 beforeEach(()=>{previous=process.env.PUSH_ENABLED;process.env.PUSH_ENABLED='true';});
 afterEach(()=>{jest.restoreAllMocks();if(previous===undefined)delete process.env.PUSH_ENABLED;else process.env.PUSH_ENABLED=previous;});
 function setup(overrides:any={}){
  const row:any={id:'n',userId:'u',kind:'hr_task_assigned',payload:{title:'مهمة',message:'اختبار'},status:'queued',attempts:0,result:null,...overrides};
  const db:any={hrPushDelivery:{findMany:jest.fn().mockResolvedValue([row]),updateMany:jest.fn().mockResolvedValue({count:1}),update:jest.fn().mockImplementation(async({data}:any)=>{Object.assign(row,data);return row;})},user:{findUnique:jest.fn().mockResolvedValue({isActive:true})},devicePushToken:{findMany:jest.fn().mockResolvedValue([{id:'d',token:'ExpoPushToken[test]'}]),deleteMany:jest.fn()}};
  return {db,row,service:new HrPushService(db)};
 }
 const response=(data:any)=>({ok:true,json:async()=>({data})} as Response);
 it('separates Expo projects into independent send batches',async()=>{
  const {service,row,db}=setup({kind:'sync_failed'});
  db.devicePushToken.findMany.mockResolvedValue([{id:'c',token:'collector-token',applicationId:'com.albinaa.collector'},{id:'o',token:'operations-token',applicationId:'com.alraqi.operations'}]);
  const f=jest.spyOn(global,'fetch').mockResolvedValueOnce(response([{status:'ok',id:'c-ticket'}])).mockResolvedValueOnce(response([{status:'ok',id:'o-ticket'}]));
  await service.dispatch();
  expect(f).toHaveBeenCalledTimes(2);
  expect(f.mock.calls.map(call=>JSON.parse((call[1] as any).body).map((m:any)=>m.to))).toEqual([['collector-token'],['operations-token']]);
  expect(row.result.targets).toEqual(expect.arrayContaining([expect.objectContaining({deviceId:'c',ticketId:'c-ticket'}),expect.objectContaining({deviceId:'o',ticketId:'o-ticket'})]));
 });
 it('queues provider receipt tracking after an accepted ticket',async()=>{const {service,row}=setup();const f=jest.spyOn(global,'fetch').mockResolvedValue(response([{status:'ok',id:'ticket'}]));await service.dispatch();expect(row.status).toBe('accepted');expect(row.result.targets[0]).toMatchObject({deviceId:'d',ticketId:'ticket',state:'accepted'});expect(JSON.parse((f.mock.calls[0][1] as any).body)[0].data).toMatchObject({kind:'hr_task_assigned',notificationId:'n'});});
 it('checks receipts without sending the message again',async()=>{const {service,row}=setup({status:'accepted',result:{targets:[{deviceId:'d',ticketId:'ticket',state:'accepted'}]}});const f=jest.spyOn(global,'fetch').mockResolvedValue(response({ticket:{status:'ok'}}));await service.dispatch();expect(row.status).toBe('provider_delivered');expect(f.mock.calls[0][0]).toContain('getReceipts');});
 it('surfaces FCM InvalidCredentials from a receipt',async()=>{const {service,row}=setup({status:'accepted',result:{targets:[{deviceId:'d',ticketId:'ticket',state:'accepted'}]}});jest.spyOn(global,'fetch').mockResolvedValue(response({ticket:{status:'error',details:{error:'InvalidCredentials'}}}));await service.dispatch();expect(row.status).toBe('failed');expect(row.result.targets[0].error).toBe('InvalidCredentials');});
 it('removes only the rejected device belonging to that user',async()=>{const {service,row,db}=setup();jest.spyOn(global,'fetch').mockResolvedValue(response([{status:'error',details:{error:'DeviceNotRegistered'}}]));await service.dispatch();expect(row.status).toBe('failed');expect(db.devicePushToken.deleteMany).toHaveBeenCalledWith({where:{id:'d',userId:'u'}});});
 it('ends no-device retries instead of silently stranding queued rows',async()=>{const {service,row,db}=setup({attempts:7});db.devicePushToken.findMany.mockResolvedValue([]);await service.dispatch();expect(row.status).toBe('failed');expect(row.result.error).toBe('NoRegisteredDevice');});
 it('retries only unaccepted devices after partial delivery',async()=>{const {service,row,db}=setup({result:{targets:[{deviceId:'old',ticketId:'old-ticket',state:'accepted'},{deviceId:'d',state:'waiting'}]}});db.devicePushToken.findMany.mockResolvedValue([{id:'old',token:'old-token'},{id:'d',token:'retry-token'}]);const f=jest.spyOn(global,'fetch').mockResolvedValue(response([{status:'ok',id:'new-ticket'}]));await service.dispatch();expect(JSON.parse((f.mock.calls[0][1] as any).body).map((m:any)=>m.to)).toEqual(['retry-token']);expect(row.result.targets).toHaveLength(2);});
 it('does not misreport HTTP 200 with an error ticket as success',async()=>{const {service,row}=setup();jest.spyOn(global,'fetch').mockResolvedValue(response([{status:'error',details:{error:'InvalidCredentials'}}]));await service.dispatch();expect(row.status).toBe('failed');});
 it('does not deliver to an inactive account',async()=>{const {service,row,db}=setup();db.user.findUnique.mockResolvedValue({isActive:false});const f=jest.spyOn(global,'fetch');await service.dispatch();expect(row.status).toBe('inactive');expect(f).not.toHaveBeenCalled();});
 it('honors the push feature switch',async()=>{process.env.PUSH_ENABLED='false';const {service,db}=setup();await service.dispatch();expect(db.hrPushDelivery.findMany).not.toHaveBeenCalled();});
 it('bounds network retry and records the failure',async()=>{const {service,row}=setup({attempts:7});jest.spyOn(global,'fetch').mockRejectedValue(new Error('network unavailable'));await service.dispatch();expect(row.status).toBe('failed');expect(row.result.error).toBe('network unavailable');});
});
