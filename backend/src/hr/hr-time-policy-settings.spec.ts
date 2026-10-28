import {HrAttendanceService} from './hr-attendance.service';
import {DEFAULT_TIME_RULE} from './hr-time-policy';
import {ConflictException,BadRequestException} from '@nestjs/common';
describe('attendance policy settings',()=>{
 const u:any={id:'admin',organizationId:'org'};
 function setup(approved=false,count=1){const old={version:3,payrollRules:[{...DEFAULT_TIME_RULE,effectiveFrom:'2098-10-01',graceMinutes:10}]};const tx={$queryRaw:jest.fn(),hrPayrollApproval:{findFirst:jest.fn().mockResolvedValue(approved?{}:null)},hrAttendancePolicy:{findUnique:jest.fn().mockResolvedValue(old),updateMany:jest.fn().mockResolvedValue({count})},auditLog:{create:jest.fn()}};return {tx,service:new HrAttendanceService({$transaction:(f:any)=>f(tx)} as any,{} as any)};}
 const dto={...DEFAULT_TIME_RULE,effectiveFrom:'2099-01-01',version:3,reason:'سياسة جديدة'};
 it('retains prior effective rules and scopes updates/audit to organization',async()=>{const {tx,service}=setup();const r=await service.savePolicy(u,dto);expect(r.rules).toHaveLength(2);expect(tx.hrAttendancePolicy.updateMany.mock.calls[0][0].where).toEqual({organizationId:'org',version:3});expect(tx.auditLog.create).toHaveBeenCalledTimes(1);});
 it('rejects stale versions and approved affected months',async()=>{await expect(setup().service.savePolicy(u,{...dto,version:2})).rejects.toThrow(ConflictException);await expect(setup(true).service.savePolicy(u,dto)).rejects.toThrow(ConflictException);await expect(setup(false,0).service.savePolicy(u,dto)).rejects.toThrow(ConflictException);});
 it('rejects retroactive and invalid calendar dates',async()=>{await expect(setup().service.savePolicy(u,{...dto,effectiveFrom:'2026-09-01'})).rejects.toThrow(BadRequestException);await expect(setup().service.savePolicy(u,{...dto,effectiveFrom:'2099-13-01'})).rejects.toThrow(BadRequestException);});
});
