import {payrollMonthClosed,HrPayrollService} from './hr-payroll.service';
import {payrollCsv} from './hr-payroll-export';
describe('payroll approval boundaries',()=>{
 test('closes the month at Aden midnight, never from a client date',()=>{
  expect(payrollMonthClosed('2026-10',new Date('2026-10-31T20:59:59Z'))).toBe(false);
  expect(payrollMonthClosed('2026-10',new Date('2026-10-31T21:00:00Z'))).toBe(true);
 });
 test('requires a specific approval permission before database access',async()=>{
  const s=new HrPayrollService({} as any,{} as any);
  await expect(s.approve({permissions:[]} as any,{month:'2026-10'},{operationId:'id',reviewHash:'hash',reason:'تمت المراجعة'})).rejects.toThrow();
  await expect(s.reopen({permissions:[]} as any,{month:'2026-10'},{operationId:'id',approvalId:'a',version:1,reason:'تصحيح'})).rejects.toThrow();
 });
 test('CSV escapes formulas and preserves missing amounts rather than inventing zero',()=>{
  const csv=payrollCsv({month:'2026-10',rows:[{employee:{employeeNo:'10001',fullName:'=HYPERLINK("bad")'},calculation:null,error:'تعذرت القراءة'}]});
  expect(csv.content).toContain("'=HYPERLINK");expect(csv.content).toContain('تعذرت القراءة');expect(csv.content).toContain('مسودة غير معتمدة');expect(csv.content).not.toContain('0.00');
 });
});
