import {PromisesService} from './promises.service';
describe('verified promise completion',()=>{
 const actor={id:'u',organizationId:'org',permissions:['promises.create']} as any;
 const before={id:'p1',customerId:'c1',status:'upcoming',expectedAmount:100.125,fulfilledAmount:0};
 function setup(accountClosure?:any){
  const reconcileForOrganization=jest.fn().mockResolvedValue({changes:[],planHash:'hash'});
  const service=new PromisesService({} as any,{} as any,{} as any,undefined,{reconcileForOrganization} as any,accountClosure);
  const find=jest.spyOn(service,'findOne').mockResolvedValue(before as any);
  return {service,find,reconcileForOrganization};
 }
 it('cannot complete without matched approved receipts',async()=>{
  const {service,reconcileForOrganization}=setup();
  expect(await service.completeVerified(actor,'p1')).toMatchObject({completed:false,status:'upcoming',remainingAmount:100.125,reason:expect.any(String)});
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
 it('requires explicit account-settlement mode and its preview before administrative closure',async()=>{
  const closure={preview:jest.fn().mockResolvedValue({canApply:true,planHash:'b'.repeat(64),reason:'settled',promises:[{id:'p1',dueDate:new Date('2026-09-24')}],evidence:[{currencyCode:'YER',balance:'0.0000'}]}),apply:jest.fn().mockResolvedValue({closed:true,completed:false})};
  const {service,reconcileForOrganization}=setup(closure);
  reconcileForOrganization.mockResolvedValue({allocations:[],changes:[],review:[],planHash:'hash'});
  expect(await service.previewCompletion(actor,'p1')).toMatchObject({mode:'account_settlement',canApply:true,completed:false});
  expect(closure.apply).not.toHaveBeenCalled();await service.completeVerified(actor,'p1');expect(closure.apply).not.toHaveBeenCalled();
  await service.completeVerified(actor,'p1','b'.repeat(64),'account_settlement');expect(closure.apply).toHaveBeenCalledWith(actor,'p1','b'.repeat(64));
 });

 it('previews an overlap with receipt evidence but makes no change before confirmation',async()=>{
  const {service,reconcileForOrganization}=setup();
  reconcileForOrganization.mockResolvedValue({planHash:'a'.repeat(64),changes:[{promiseId:'p1',status:'fulfilled',fulfilledAmount:'100.1250'}],
   allocations:[{promiseId:'p1',sourceId:'1617',receiptDate:'2026-10-06',amount:'100.1250',currencyCode:'YER'}],
   review:[{code:'overlap_selected_by_operator',promiseIds:['p1','p2']}]});
  expect(await service.previewCompletion(actor,'p1')).toMatchObject({canApply:true,willComplete:true,overlappingPromises:1,remainingAmount:'0.0000',receipts:[{reference:'1617',date:'2026-10-06',amount:'100.1250',currencyCode:'YER'}]});
  expect(reconcileForOrganization).toHaveBeenCalledTimes(1);
  expect(reconcileForOrganization.mock.calls[0][1]).toMatchObject({dryRun:true,manualPromiseId:'p1',promiseIds:['p1']});
 });

 it('rejects a stale manual preview and binds a confirmed one to the selected promise only',async()=>{
  const {service,find,reconcileForOrganization}=setup();
  reconcileForOrganization.mockResolvedValue({changes:[{promiseId:'p1'}],planHash:'new',review:[]});
  await expect(service.completeVerified(actor,'p1','old')).rejects.toThrow('تغيرت');
  expect(reconcileForOrganization).toHaveBeenCalledTimes(1);
  reconcileForOrganization.mockClear();find.mockResolvedValueOnce(before as any).mockResolvedValueOnce({...before,status:'fulfilled'} as any);
  await service.completeVerified(actor,'p1','new');
  expect(reconcileForOrganization.mock.calls[1][1]).toMatchObject({manualPromiseId:'p1',expectedPlanHash:'new',dryRun:false});
 });
});
