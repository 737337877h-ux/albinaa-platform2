import {Prisma} from '@prisma/client';
import {reconcileAdvances,summarizePayroll} from './hr-payroll-reconciliation';
import {calculatePayroll} from './hr-payroll.service';
const request:any={id:'r1',amount:new Prisma.Decimal('100.10'),currency:'YER',reason:'سلفة',createdAt:new Date(),reviewedAt:new Date(),version:2};
const movement={id:'m1',date:'2026-10-03',currency:'YER',debit:'100.10',credit:'0'};
const statement:any={month:'2026-10',items:[movement]};
const input:any={incentives:'0',deductions:'0',installments:'0',installmentsConfirmed:true,notes:'',reviews:[{id:'m1',action:'deduct',reason:'صرف مثبت',advanceRequestId:'r1'}]};
describe('payroll advance reconciliation',()=>{
 test('linking a request never adds its amount to the payroll deduction',()=>{
  expect(reconcileAdvances(statement,input,[request],[])[0].linkedAmount).toBe('100.10');
  const employee={active:true,salaries:[{effectiveFrom:new Date('2026-10-01'),baseSalary:'1000',fixedAllowance:'0',currency:'YER'}]};
  expect(calculatePayroll(employee,statement,input).net).toBe('899.90');
 });
 test('multiple debit rows must exactly equal the approved amount',()=>{
  const split={...statement,items:[{...movement,debit:'50.05'},{...movement,id:'m2',debit:'50.05'}]};
  expect(reconcileAdvances(split,{...input,reviews:[...input.reviews,{...input.reviews[0],id:'m2'}]},[request],[])[0].linkedAmount).toBe('100.10');
  expect(()=>reconcileAdvances(split,input,[request],[])).toThrow('يساوي');
 });
 test('rejects unrelated, previously linked, currency-mismatched or credit movement references',()=>{
  expect(()=>reconcileAdvances(statement,input,[],[])).toThrow();
  expect(()=>reconcileAdvances(statement,input,[request],[{month:'2026-11',inputs:input}])).toThrow('مرة أخرى');
  for(const change of [{currency:'SAR'},{credit:'1'},{debit:'0'}])expect(()=>reconcileAdvances({...statement,items:[{...movement,...change}]},input,[request],[])).toThrow();
 });
 test('approved but unlinked requests remain evidence gaps and never become automatic deductions',()=>{
  const r=reconcileAdvances(statement,{...input,reviews:[]},[request],[]);expect(r[0].linkedMonth).toBeNull();expect(r[0].linkedAmount).toBeNull();
 });
 test('monthly totals keep currencies separate and missing/failed rows visible',()=>{
  const s=summarizePayroll([{calculation:{currency:'YER',baseSalary:'100',net:'0.10'}},{calculation:{currency:'YER',baseSalary:'100',net:'0.20'}},{calculation:{currency:'SAR',baseSalary:'500',net:null}},{error:'Oracle unavailable'}]);
  expect(s.totals[0].net).toBe('0.30');expect(s.totals[1].incomplete).toBe(1);expect(s.failed).toBe(1);expect(s.calculated).toBe(2);
 });
});
