import {YearReadinessService} from './year-readiness.service';
describe('read-only 2027 preparation',()=>{
 let db:any,service:YearReadinessService,fetcher:jest.SpyInstance;
 beforeEach(()=>{
  db={oracleCustomerSyncRun:{findFirst:jest.fn().mockResolvedValue({publishedAt:new Date('2026-11-13')})},oracleInventoryActiveSnapshot:{findUnique:jest.fn().mockResolvedValue({activatedAt:new Date('2026-11-13')})},oracleMovementSyncRun:{findFirst:jest.fn().mockResolvedValue({publishedAt:new Date('2026-11-13')})},hrAttendancePolicy:{findUnique:jest.fn().mockResolvedValue({startDate:new Date('2027-01-01'),version:3})}};
  const config={get:(key:string)=>({ORACLE_READ_SCHEMA:'IAS20261',ORACLE_READ_API_URL:'https://oracle.invalid',ORACLE_READ_API_KEY:'test'} as any)[key]};
  service=new YearReadinessService(db,config as any);
  fetcher=jest.spyOn(global,'fetch').mockResolvedValue({ok:true,json:async()=>({status:'ok',mode:'SELECT_ONLY',schema:'IAS20261'})} as any);
 });
 afterEach(()=>jest.restoreAllMocks());
 it('reports current checks but never claims an unapproved next-year source is ready',async()=>{
  const result=await service.inspect('org');
  expect(result).toMatchObject({targetYear:2027,currentSource:'IAS20261',currentSourceYear:2026,ready:false,sourceChanged:false,oracleWriteAttempted:false});
  expect(result.checks.find(c=>c.id==='numbering')?.status).toBe('ready');
  expect(result.checks.find(c=>c.id==='attendance')?.status).toBe('ready');
  expect(result.checks.find(c=>c.id==='next-source')?.status).toBe('review');
  expect(db.oracleCustomerSyncRun.findFirst.mock.calls[0][0].where.organizationId).toBe('org');
  expect(db.oracleInventoryActiveSnapshot.findUnique.mock.calls[0][0].where.organizationId_sourceSchema).toEqual({organizationId:'org',sourceSchema:'IAS20261'});
  expect(fetcher.mock.calls.map(call=>call[0])).toEqual(['https://oracle.invalid/health']);
 });
 it('does not approve an incorrect or unavailable read gateway',async()=>{
  fetcher.mockResolvedValue({ok:true,json:async()=>({status:'ok',mode:'SELECT_ONLY',schema:'other'})} as any);
  expect((await service.inspect('org')).checks.find(c=>c.id==='current-gateway')?.status).toBe('review');
  fetcher.mockRejectedValue(Error('offline'));
  expect((await service.inspect('org')).ready).toBe(false);
 });
});
