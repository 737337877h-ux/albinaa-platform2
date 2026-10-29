import {BadRequestException,ConflictException,ForbiddenException,NotFoundException} from '@nestjs/common';
import {HrTasksService,taskTransition} from './hr-tasks.service';
describe('Employee task workflow',()=>{
 test('returned work can be resubmitted; approved work cannot change',()=>{
  expect(taskTransition('returned','submit')).toBe('submitted');
  expect(taskTransition('submitted','complete',4)).toBe('completed');
  for(const action of ['submit','complete','return','cancel'])expect(()=>taskTransition('completed',action,4)).toThrow(ConflictException);
 });
 test.each([undefined,0,6,2.5])('approval requires a valid rating: %s',rating=>expect(()=>taskTransition('submitted','complete',rating)).toThrow(BadRequestException));
 test('a return cannot secretly apply a rating',()=>expect(()=>taskTransition('submitted','return',4)).toThrow(BadRequestException));
 const user={id:'reviewer',organizationId:'org',permissions:['hr.tasks.manage']} as any;
 const dto={operationId:'op',action:'submit',note:'تم الإنجاز',version:1} as any;
 function setup(row:any){const tx={hrTaskAssignment:{findFirst:jest.fn().mockResolvedValue(row),updateMany:jest.fn()},auditLog:{create:jest.fn()}};return {tx,s:new HrTasksService({$transaction:(fn:any)=>fn(tx)} as any)};}
 test('another employee cannot submit someone else\'s work',async()=>{
  const {s,tx}=setup({employee:{loginUserId:'other',active:true}});
  await expect(s.action(user,'a',dto)).rejects.toBeInstanceOf(ForbiddenException);expect(tx.hrTaskAssignment.updateMany).not.toHaveBeenCalled();
 });
 test('a manager cannot approve their own assignment',async()=>{
  const {s}=setup({employee:{loginUserId:user.id,active:true}});
  await expect(s.action(user,'a',{...dto,action:'complete',rating:5})).rejects.toBeInstanceOf(ForbiddenException);
 });
 test('cross-organization identifiers are scoped before mutation',async()=>{
  const {s,tx}=setup(null);await expect(s.action(user,'foreign',dto)).rejects.toBeInstanceOf(NotFoundException);
  expect(tx.hrTaskAssignment.findFirst).toHaveBeenCalledWith({where:{id:'foreign',task:{organizationId:'org'}},include:{employee:true}});
 });
});
