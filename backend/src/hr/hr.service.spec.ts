import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { HrService, validateSchedule } from './hr.service';
import { EmployeeDto } from './hr.dto';
import { HrController } from './hr.module';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';

const base:EmployeeDto={employeeNo:'10012',fullName:'موظف',jobTitle:'حارس',active:true,workMode:'field',attendanceExempt:true,breakMinutes:0,workDays:[6,0,1,2,3,4],notes:'',version:1};
const user:any={id:'u',organizationId:'org',permissions:['hr.read']};
describe('HR access and schedules',()=>{
 it('allows an attendance exemption without inventing shift times',()=>expect(()=>validateSchedule(base)).not.toThrow());
 it('requires shift times for attendance and rejects self reporting',()=>{
  expect(()=>validateSchedule({...base,attendanceExempt:false})).toThrow(BadRequestException);
  expect(()=>validateSchedule({...base,managerNo:'10012'})).toThrow(BadRequestException);
 });
 it('validates breaks for overnight shifts',()=>{
  expect(()=>validateSchedule({...base,attendanceExempt:false,startTime:'22:00',endTime:'06:00',breakMinutes:90})).not.toThrow();
  expect(()=>validateSchedule({...base,attendanceExempt:false,startTime:'22:00',endTime:'06:00',breakMinutes:480})).toThrow();
 });
 it('does not select salaries without the separate permission and scopes organization',async()=>{
  const findMany=jest.fn().mockResolvedValue([]),s=new HrService({hrEmployee:{findMany}} as any);
  await s.list(user);expect(findMany).toHaveBeenCalledWith(expect.objectContaining({where:{organizationId:'org'},include:undefined}));
  await s.list({...user,permissions:['hr.read','hr.salary.read']});expect(findMany.mock.calls[1][0].include.salaries).toBeDefined();
 });
 it('requires both read and salary management permissions to write salaries',()=>{
  expect(Reflect.getMetadata(PERMISSIONS_KEY,HrController.prototype.salary)).toEqual(['hr.read','hr.salary.read','hr.salary.manage']);
 });
 it('rejects cross-organization salary writes',async()=>{
  const tx={hrEmployee:{findFirst:jest.fn().mockResolvedValue(null)}};
  const s=new HrService({$transaction:(fn:any)=>fn(tx)} as any);
  await expect(s.salary(user,'other',{baseSalary:'100',currency:'YER',effectiveFrom:'2026-10-01',version:1})).rejects.toThrow(NotFoundException);
  expect(tx.hrEmployee.findFirst).toHaveBeenCalledWith({where:{id:'other',organizationId:'org'}});
 });
 it('rejects impossible dates before querying storage',async()=>{
  const s=new HrService({} as any);
  await expect(s.salary(user,'id',{baseSalary:'100',currency:'YER',effectiveFrom:'2026-02-30',version:1})).rejects.toThrow(BadRequestException);
 });
 it('rejects stale salary writes before persisting money',async()=>{
  const tx={hrEmployee:{findFirst:jest.fn().mockResolvedValue({id:'id'}),updateMany:jest.fn().mockResolvedValue({count:0})}};
  const s=new HrService({$transaction:(fn:any)=>fn(tx)} as any);
  await expect(s.salary(user,'id',{baseSalary:'100',currency:'YER',effectiveFrom:'2026-10-01',version:1})).rejects.toThrow(ConflictException);
 });
});
