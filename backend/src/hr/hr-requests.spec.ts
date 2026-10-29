import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { HrRequestsService, requestFields } from './hr-requests.service';
const user:any={id:'u',organizationId:'org',permissions:[]};
const input:any={id:'request',kind:'advance',amount:'123.45',currency:'YER',reason:'سبب الطلب'};
describe('HR employee requests',()=>{
 it('preserves decimal amounts and rejects zero or mixed fields',()=>{
  expect(requestFields(input).amount?.toFixed(2)).toBe('123.45');
  expect(()=>requestFields({...input,amount:'0'})).toThrow(BadRequestException);
  expect(()=>requestFields({...input,startDate:'2026-10-01'})).toThrow(BadRequestException);
 });
 it('rejects impossible or reversed leave dates',()=>{
  const leave:any={kind:'leave',reason:'مرضية',leaveType:'sick',startDate:'2026-02-30',endDate:'2026-03-01'};
  expect(()=>requestFields(leave)).toThrow(BadRequestException);
  expect(()=>requestFields({...leave,startDate:'2026-10-05',endDate:'2026-10-01'})).toThrow(BadRequestException);
 });
 it('requires an active employee login before submission',async()=>{
  const tx={hrEmployee:{findFirst:jest.fn().mockResolvedValue(null)}};
  const s=new HrRequestsService({$transaction:(f:any)=>f(tx)} as any);
  await expect(s.create(user,input)).rejects.toThrow(ForbiddenException);
  expect(tx.hrEmployee.findFirst).toHaveBeenCalledWith({where:{organizationId:'org',loginUserId:'u',active:true}});
 });
 it('scopes reviewer lists to the organization',async()=>{
  const findMany=jest.fn().mockResolvedValue([]);const employeeFind=jest.fn().mockResolvedValue([]);await new HrRequestsService({hrAttendancePolicy:{findUnique:jest.fn().mockResolvedValue(null)},hrRequest:{findMany},hrEmployee:{findMany:employeeFind}} as any).admin(user);expect(employeeFind.mock.calls[0][0].where).toEqual({organizationId:'org'});
  expect(findMany.mock.calls[0][0].where).toEqual({employee:{organizationId:'org'}});
 });
 function service(row:any,count=1){const tx={hrEmployee:{update:jest.fn().mockResolvedValue({})},user:{findMany:jest.fn().mockResolvedValue([])},hrRequest:{findFirst:jest.fn().mockResolvedValue(row),updateMany:jest.fn().mockResolvedValue({count}),findUniqueOrThrow:jest.fn().mockResolvedValue(row)},auditLog:{create:jest.fn()}};return {s:new HrRequestsService({$transaction:(f:any)=>f(tx)} as any),tx};}
 const row={status:'pending',submittedBy:'employee-user',employee:{loginUserId:'employee-user',active:true}};
 const decision:any={status:'approved',reason:'تمت المراجعة',version:1};
 it('rejects cross-organization access and unauthorized approvals',async()=>{
  await expect(service(null).s.decide(user,'id',decision)).rejects.toThrow(NotFoundException);
  await expect(service(row).s.decide(user,'id',decision)).rejects.toThrow(ForbiddenException);
 });
 it('prevents self approval even with review permissions',async()=>{
  await expect(service(row).s.decide({...user,id:'employee-user',permissions:['hr.requests.review']},'id',decision)).rejects.toThrow(ForbiddenException);
 });
 it('uses pending status and version atomically; rejects stale decisions',async()=>{
  const u={...user,permissions:['hr.requests.review']};const {s,tx}=service(row,0);
  await expect(s.decide(u,'id',decision)).rejects.toThrow(ConflictException);
  expect(tx.hrRequest.updateMany.mock.calls[0][0].where).toEqual({id:'id',status:'pending',version:1});expect(tx.auditLog.create).not.toHaveBeenCalled();
 });
 it('only allows the current employee to cancel pending requests',async()=>{
  await expect(service(row).s.decide(user,'id',{...decision,status:'cancelled'})).rejects.toThrow(ForbiddenException);
  const {s,tx}=service(row);await s.decide({...user,id:'employee-user'},'id',{...decision,status:'cancelled'});expect(tx.auditLog.create).toHaveBeenCalled();
 });
});
