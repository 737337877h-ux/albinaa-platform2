import {PromisesService} from './promises.service';
describe('verified promise completion',()=>{
 const actor={id:'u',organizationId:'org',permissions:['promises.create']} as any;
 const before={id:'p1',customerId:'c1',status:'upcoming',expectedAmount:100.125,fulfilledAmount:0};
 function setup(){
  const reconcileForOrganization=jest.fn().mockResolvedValue({changes:[],planHash:'hash'});
  const service=new PromisesService({} as any,{} as any,{} as any,undefined,{reconcileForOrganization} as any);
  const find=jest.spyOn(service,'findOne').mockResolvedValue(before as any);
  return {service,find,reconcileForOrganization};
 }
 it('cannot complete without matched approved receipts',async()=>{
  const {service,reconcileForOrganization}=setup();
  expect(await service.completeVerified(actor,'p1')).toEqual({completed:false,status:'upcoming',remainingAmount:100.125});
  expect(reconcileForOrganization).toHaveBeenCalledTimes(1);
  expect(reconcileForOrganization.mock.calls[0]).toEqual(['org',expect.objectContaining({dryRun:true,promiseIds:['p1'],customerIds:['c1'],actorId:'u',maxChanges:1})]);
 });
 it('applies only its preview hash and preserves partial/late settlement logic',async()=>{
  const {service,find,reconcileForOrganization}=setup();
  reconcileForOrganization.mockResolvedValue({changes:[{id:'p1'}],planHash:'verified-hash'});
  find.mockResolvedValueOnce(before as any).mockResolvedValueOnce({...before,status:'fulfilled',fulfilledAmount:100.125} as any);
  expect((await service.completeVerified(actor,'p1')).completed).toBe(true);
  expect(reconcileForOrganization.mock.calls[1][1]).toEqual(expect.objectContaining({dryRun:false,expectedPlanHash:'verified-hash'}));
 });
 it('checks permission and existing visibility before touching receipts',async()=>{
  const {service,find,reconcileForOrganization}=setup();
  await expect(service.completeVerified({...actor,permissions:[]},'p1')).rejects.toThrow('صلاحية');
  expect(find).not.toHaveBeenCalled();
  find.mockRejectedValue(new Error('not accessible'));
  await expect(service.completeVerified(actor,'foreign')).rejects.toThrow('not accessible');
  expect(reconcileForOrganization).not.toHaveBeenCalled();
 });
 it('leaves a cancelled promise unchanged',async()=>{
  const {service,find,reconcileForOrganization}=setup();find.mockResolvedValue({...before,status:'cancelled_approved'} as any);
  await expect(service.completeVerified(actor,'p1')).rejects.toThrow('ملغى');expect(reconcileForOrganization).not.toHaveBeenCalled();
 });
});
