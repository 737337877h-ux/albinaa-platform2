import { MobileService } from './mobile.service';
import { CollectionsService } from '../collections/collections.service';
import * as orgTime from '../common/org-time';

function fixture() {
  const prisma:any={};
  for(const name of ['task','customer','followup','paymentPromise','collection','auditLog','reservation','currency','collectionMethod','followupType','followupResult','unit']) {
    prisma[name]={findMany:jest.fn().mockResolvedValue([])};
  }
  prisma.collector={findUnique:jest.fn().mockResolvedValue({id:'collector-1'}),findMany:jest.fn().mockResolvedValue([{id:'collector-1',oracleCollectorNo:1,user:{fullName:'المحصل الأول'}}])};
  prisma.oracleMovementSyncRun={findFirst:jest.fn().mockResolvedValue({id:'run'})};
  prisma.oracleCustomerMovementMirror={findMany:jest.fn().mockResolvedValue([{externalCustomerCode:'90001',collectorNo:'1',documentSerial:'',documentNumber:'7001',
    currencyCode:'YR',creditForeign:123400,debitForeign:0,creditLocal:772.857,debitLocal:0,documentDate:new Date('2026-10-25'),description:'دفعة من الحساب'}])};
  prisma.customer.findMany.mockResolvedValue([{id:'customer',name:'العميل التجريبي الأول',externalCustomerCode:'90001',assignments:[{collectorId:'collector-1'}]}]);
  const service=new MobileService(prisma);
  jest.spyOn(service,'findCustomers').mockResolvedValue([]);
  jest.spyOn(service as any,'operationsCustomerDirectory').mockResolvedValue([]);
  const actor:any={id:'user',organizationId:'org',permissions:['mobile.collections.view']};
  return {prisma,service,actor};
}

it('syncs direct Oracle receipt 7001 for the collector into the existing phone collection format',async()=>{
  const {service,actor}=fixture();const result=await service.sync(actor);
  expect(result.snapshot).toBe('full');
  expect(result.collections).toHaveLength(1);
  expect(result.collections[0]).toEqual(expect.objectContaining({
    id:'oracle-direct:7001|customer|YER|collector-1',customerId:'customer',customerName:'العميل التجريبي الأول',
    amount:123400,currencyCode:'YER',methodName:'سند قبض Oracle',collectedAt:'2026-10-25T00:00:00+03:00',notes:expect.stringContaining('7001'),
  }));
});

it('includes the direct receipt once in the collection-day activity and its YER total',async()=>{
  const {prisma,actor}=fixture();
  const day=jest.spyOn(orgTime,'orgDateOnly').mockReturnValue('2026-10-25');
  try {
    const result=await new CollectionsService(prisma,{} as never,{} as never,{} as never).todayActivity(actor);
    expect(result.day).toBe('2026-10-25');expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({receiptNumber:'7001',amount:123400,collector:{id:'collector-1'}});
    expect(result.totalsByCurrency).toEqual({YER:123400});
  } finally {day.mockRestore();}
});

it('keeps collection permissions and operations-only restrictions',async()=>{
  const {service,actor,prisma}=fixture();
  expect((await service.sync({...actor,permissions:[]})).collections).toEqual([]);
  expect(prisma.oracleMovementSyncRun.findFirst).not.toHaveBeenCalled();
  expect((await service.sync(actor,undefined,true)).collections).toEqual([]);
  expect(prisma.oracleMovementSyncRun.findFirst).not.toHaveBeenCalled();
});

it('replaces a request with a posted receipt only when its serial matches exactly',async()=>{
  const {service,actor,prisma}=fixture();const serial='12345678901234567890';
  const rows=await prisma.oracleCustomerMovementMirror.findMany();prisma.oracleCustomerMovementMirror.findMany.mockResolvedValue([{...rows[0],documentSerial:serial}]);
  prisma.auditLog.findMany.mockResolvedValue([{id:'audit',entityId:serial,createdAt:new Date('2026-10-25'),
    newValue:{kind:'voucher',requestKind:'receipt',requestSerial:serial,requestNo:'7001',amount:123400,currencyCode:'YR',platformCustomerId:'customer'}}]);
  const result=await service.sync(actor);
  expect(result.collections).toHaveLength(1);expect(result.collections[0].id).toContain('oracle-direct:');
});

it('does not count a request again when the final is already a recorded local collection',async()=>{
 const {service,actor,prisma}=fixture();const serial='202600000100092200000009001';
 const rows=await prisma.oracleCustomerMovementMirror.findMany();
 prisma.oracleCustomerMovementMirror.findMany.mockResolvedValue([{...rows[0],documentSerial:serial}]);
 prisma.collection.findMany.mockResolvedValue([{id:'local-final',customerId:'customer',currencyCode:'YER',amount:123400,
  status:'recorded',collectedAt:new Date('2026-10-25T08:00:00Z'),referenceNumber:serial,receiptNumber:'7001',
  customer:{id:'customer',name:'العميل التجريبي الأول',externalCustomerCode:'90001'},method:{name:'نقد'}}]);
 prisma.attachment={findMany:jest.fn().mockResolvedValue([])};
 prisma.gpsLog={findMany:jest.fn().mockResolvedValue([])};
 prisma.auditLog.findMany.mockResolvedValue([{id:'audit',entityId:serial,createdAt:new Date('2026-10-25'),
  newValue:{kind:'receipt',requestSerial:serial,requestNo:'93',amount:123400,currencyCode:'YR',platformCustomerId:'customer',platformCustomerCode:'90001'}}]);
 const result=await service.sync(actor);
 expect(result.collections).toHaveLength(1);expect(result.collections[0].id).toBe('local-final');
 const day=jest.spyOn(orgTime,'orgDateOnly').mockReturnValue('2026-10-25');
 try {
  const activity=await new CollectionsService(prisma,{} as never,{} as never,{} as never).todayActivity(actor);
  expect(activity.items).toHaveLength(1);expect(activity.totalsByCurrency).toEqual({YER:123400});
 }finally{day.mockRestore();}
});
