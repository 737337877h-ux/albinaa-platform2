import {TasksService} from './tasks.service';
describe('task completion ownership and concurrent updates',()=>{
 const actor={id:'u',organizationId:'org',permissions:['tasks.manage']} as any;
 function setup(task:any={id:'t1',customerId:'c1',status:'open'},count=1){
  const tx={task:{updateMany:jest.fn().mockResolvedValue({count})},followup:{create:jest.fn().mockResolvedValue({id:'f1'})}};
  const db={task:{findFirst:jest.fn().mockResolvedValue(task),updateMany:tx.task.updateMany},followupType:{upsert:jest.fn().mockResolvedValue({id:'type'})},followupResult:{upsert:jest.fn().mockResolvedValue({id:'result'})},$transaction:jest.fn(async cb=>cb(tx))};
  const service=new TasksService(db as any,{} as any,{log:jest.fn()} as any);
  jest.spyOn(service as any,'resolveCollector').mockResolvedValue({id:'collector'});
  return {db,tx,service};
 }
 it('scopes lookup and final update to the organization and assigned collector',async()=>{
  const {db,service}=setup();await service.completeWithResult(actor,'t1',{result:'no_answer'});
  expect(db.task.findFirst.mock.calls[0][0].where).toEqual({id:'t1',customer:{organizationId:'org'},assignedTo:'collector'});
  expect(db.task.updateMany.mock.calls[0][0].where).toEqual({id:'t1',status:'open',customer:{organizationId:'org'},assignedTo:'collector'});
 });
 it('does not create a duplicate followup when another request closes the task first',async()=>{
  const {tx,service}=setup(undefined,0);
  await expect(service.completeWithResult(actor,'t1',{result:'no_answer'})).rejects.toThrow('أُغلقت');
  expect(tx.followup.create).not.toHaveBeenCalled();
 });
 it('does not broaden access when the user has no collector record',async()=>{
  const {db,service}=setup(null);jest.spyOn(service as any,'resolveCollector').mockResolvedValue(null);
  await expect(service.completeWithResult(actor,'foreign',{result:'note'})).rejects.toThrow('صلاحيتك');
  expect(db.task.findFirst.mock.calls[0][0].where.assignedTo).toBe('00000000-0000-0000-0000-000000000000');
 });
});
