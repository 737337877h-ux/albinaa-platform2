import {HrAttendanceService,scheduleFor} from './hr-attendance.service';
import {queueHrRequestNotification} from './hr-request-notifications';
import {HrAttendanceDisplayController} from './hr-attendance-display.controller';
describe('HR four punches and notifications',()=>{
 it('requires a valid individual break inside the shift, including overnight',()=>{
  const e={startTime:'08:00',endTime:'22:00',breakStartTime:'13:00',breakEndTime:'14:30',breakMinutes:90,workDays:[3]};
  expect(scheduleFor(e,'2026-09-16')?.fourPunches).toBe(true);
  expect(scheduleFor({...e,breakEndTime:'14:00'},'2026-09-16')?.fourPunches).toBe(false);
  expect(scheduleFor({...e,startTime:'22:00',endTime:'06:00',breakStartTime:'01:00',breakEndTime:'02:30'},'2026-09-16')?.fourPunches).toBe(true);
 });
 function punch(open:any,action:string){const tx:any={hrEmployee:{findFirst:jest.fn().mockResolvedValue({id:'employee',workMode:'field'})},hrAttendance:{findFirst:jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(open),updateMany:jest.fn().mockResolvedValue({count:1}),findUniqueOrThrow:jest.fn().mockResolvedValue({id:'record'})},auditLog:{create:jest.fn()}};return {tx,run:()=>new HrAttendanceService({$transaction:(f:any)=>f(tx)} as any,{get:()=>''} as any).punch({id:'user',organizationId:'org'} as any,{operationId:'operation',action,method:'location',latitude:15,longitude:44,accuracy:10,capturedAt:Date.now()} as any)};}
 it('prevents return before break, duplicate break and break in legacy records',async()=>{
  await expect(punch({schedule:{fourPunches:true},breakOut:null},'break_in').run()).rejects.toThrow();
  await expect(punch({schedule:{fourPunches:true},breakOut:new Date()},'break_out').run()).rejects.toThrow();
  await expect(punch({schedule:{}},'break_out').run()).rejects.toThrow();
 });
 it('updates return only while the record remains open and a break exists',async()=>{
  const {tx,run}=punch({id:'record',checkIn:new Date(Date.now()-3600000),schedule:{fourPunches:true},breakOut:new Date(Date.now()-60000)},'break_in');await run();
  expect(tx.hrAttendance.updateMany.mock.calls[0][0].where).toEqual({id:'record',checkOut:null,breakIn:null,breakOut:{not:null}});
 });
 it('queues notifications only for reviewers in the same organization excluding submitter',async()=>{
  const tx:any={user:{findMany:jest.fn().mockResolvedValue([{id:'reviewer'}])},notification:{create:jest.fn().mockResolvedValue({id:'notice'})},hrPushDelivery:{create:jest.fn()}};
  await queueHrRequestNotification(tx,{id:'request',submittedBy:'employee-user',kind:'leave',status:'pending'},{organizationId:'org'},'created');
  const where=tx.user.findMany.mock.calls[0][0].where;expect(where.organizationId).toBe('org');expect(where.id).toEqual({not:'employee-user'});
  expect(where.userRoles.some.role.rolePermissions.some.permission.code).toBe('hr.requests.review');
  expect(tx.hrPushDelivery.create.mock.calls[0][0].data.id).toBe('notice');
  expect(tx.notification.create.mock.calls[0][0].data.payload).not.toHaveProperty('reason');
 });
 it('addresses a decision to its original submitter',async()=>{
  const tx:any={user:{findMany:jest.fn().mockResolvedValue([])}};
  await queueHrRequestNotification(tx,{submittedBy:'original',kind:'advance',status:'approved'},{organizationId:'org'},'decided');
  expect(tx.user.findMany.mock.calls[0][0].where).toEqual({organizationId:'org',isActive:true,id:'original'});
 });
 it('refuses public QR without provisioned cookie, and refuses a revoked display',async()=>{
  const db:any={hrAttendanceDisplay:{findUnique:jest.fn().mockResolvedValue({revokedAt:new Date()})}};
  const attendance:any={qr:jest.fn()};const c=new HrAttendanceDisplayController(db,attendance);const response:any={setHeader:jest.fn()};
  await expect(c.display({headers:{}} as any,response)).rejects.toThrow();
  await expect(c.display({headers:{cookie:'albinaa_hr_display='+'a'.repeat(64)}} as any,response)).rejects.toThrow();expect(attendance.qr).not.toHaveBeenCalled();
 });
});
