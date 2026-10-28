import { HrPayrollService } from './hr-payroll.service';
describe('personal approved payslip',()=>{
 const user:any={id:'me',organizationId:'org'};
 const period:any={month:'2026-10'};
 it('uses the linked employee and projects only their approved amounts',async()=>{
  const db:any={hrEmployee:{findFirst:jest.fn().mockResolvedValue({id:'e1',fullName:'موظف',employeeNo:'1'})},hrPayrollApproval:{findFirst:jest.fn().mockResolvedValue({approvedAt:new Date(),snapshot:{workspaces:[{employee:{id:'other'},calculation:{net:'999'}},{employee:{id:'e1'},statement:{secret:'not public'},calculation:{currency:'YER',net:'100',privateReview:'secret'}}]}})}};
  const reader:any={read:jest.fn()};const r=await new HrPayrollService(db,reader).mine(user,period);
  expect(db.hrEmployee.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:{organizationId:'org',loginUserId:'me',active:true}}));
  expect(db.hrPayrollApproval.findFirst).toHaveBeenCalledWith({where:{organizationId:'org',month:'2026-10',status:'approved'}});
  expect(r.calculation?.net).toBe('100');expect(r.calculation).not.toHaveProperty('privateReview');expect(r).not.toHaveProperty('statement');expect(reader.read).not.toHaveBeenCalled();
 });
 it('does not expose drafts or records for an unlinked account',async()=>{
  const db:any={hrEmployee:{findFirst:jest.fn().mockResolvedValue(null)},hrPayrollApproval:{findFirst:jest.fn()}};
  await expect(new HrPayrollService(db,{} as any).mine(user,period)).rejects.toThrow('حساب الدخول');expect(db.hrPayrollApproval.findFirst).not.toHaveBeenCalled();
  db.hrEmployee.findFirst.mockResolvedValue({id:'e1'});db.hrPayrollApproval.findFirst.mockResolvedValue(null);
  expect((await new HrPayrollService(db,{} as any).mine(user,period)).calculation).toBeNull();
 });
});
