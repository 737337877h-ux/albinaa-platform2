import { calculatePayroll, emptyPayrollInput } from './hr-payroll.service';
import { parseHrStatement } from './hr-statement.reader';
const movement={id:'a',date:'2026-10-03',documentType:'3',documentNumber:'1',serial:'12345678901234567890',description:'سلفة',currency:'YER',debit:'10000',credit:'0'};
const statement:any={month:'2026-10',kind:'salary',readAt:'2026-11-01T00:00:00Z',snapshotHash:'s',total:1,items:[movement],balances:[]};
const employee:any={active:true,salaries:[{effectiveFrom:new Date('2026-10-01'),baseSalary:'100000',fixedAllowance:'1000',currency:'YER'}]};
const input:any={incentives:'500',deductions:'200',installments:'100',incentivesReason:'حافز معتمد',deductionsReason:'خصم معتمد',installmentsReason:'قسط قديم متحقق',installmentsConfirmed:true,reviews:[{id:'a',action:'deduct',reason:'سلفة تخص الشهر'}],notes:''};
describe('payroll drafts',()=>{
 it('uses reviewed monthly flows once and never authorizes payment',()=>{
  const r=calculatePayroll(employee,statement,input,new Date('2026-11-02'));
  expect(r.net).toBe('91200.00');expect(r.canApprove).toBe(false);expect(r.state).toBe('draft');expect(r.periodClosed).toBe(true);
 });
 it('does not treat missing inputs or old installments as zero',()=>{
  const r=calculatePayroll(employee,statement,emptyPayrollInput);
  expect(r.net).toBeNull();expect(r.unreviewed).toBe(1);expect(r.warnings.length).toBeGreaterThan(3);
 });
 it('cannot silently combine currencies or unreviewed credits',()=>{
  expect(calculatePayroll(employee,{...statement,items:[{...movement,currency:'SAR'}]},input).net).toBeNull();
  expect(calculatePayroll(employee,{...statement,items:[{...movement,debit:'0',credit:'100'}]},input).net).toBeNull();
 });
 it('requires reasons and detects stale and duplicated review entries',()=>{
  expect(calculatePayroll(employee,statement,{...input,reviews:[{id:'a',action:'exclude',reason:''}]}).net).toBeNull();
  expect(calculatePayroll(employee,statement,{...input,reviews:[...input.reviews,{id:'old',action:'exclude',reason:'قديم'}]}).net).toBeNull();
  expect(()=>calculatePayroll(employee,statement,{...input,reviews:[...input.reviews,...input.reviews]})).toThrow();
 });
 it('uses the salary effective at month start and flags mid-month changes',()=>{
  const e={...employee,salaries:[{...employee.salaries[0],effectiveFrom:new Date('2026-11-01'),baseSalary:'200000'},...employee.salaries]};
  expect(calculatePayroll(e,statement,input).baseSalary).toBe('100000.00');
  expect(calculatePayroll({...e,salaries:[...e.salaries,{...e.salaries[0],effectiveFrom:new Date('2026-10-15')}]},statement,input).net).toBeNull();
 });
 it('marks future periods provisional even with fully entered amounts',()=>{
  const r=calculatePayroll(employee,statement,input,new Date('2026-09-16'));
  expect(r.periodClosed).toBe(false);expect(r.warnings).toContain('الشهر لم ينتهِ؛ الحركات المعروضة قد تتغير');
 });
 it('counts an Oracle installment inside the entered total exactly once',()=>{
  const r=calculatePayroll(employee,statement,{...input,installments:'10000',reviews:[{id:'a',action:'installment',reason:'قسط من الإجمالي'}]});
  expect(r.reviewedWithdrawals).toBe('0.00');expect(r.oracleInstallments).toBe('10000.00');expect(r.net).toBe('91300.00');
  expect(calculatePayroll(employee,statement,{...input,reviews:[{id:'a',action:'installment',reason:'قسط من الإجمالي'}]}).net).toBeNull();
 });
 it('requires evidence for positive manual amounts and blocks inactive employee net',()=>{
  expect(calculatePayroll(employee,statement,{...input,incentivesReason:''}).net).toBeNull();
  expect(calculatePayroll({...employee,active:false},statement,input).net).toBeNull();
 });
});
describe('Oracle HR response verification',()=>{
 const envelope={schema:'IAS20261',source:'IAS_POST_DTL',mode:'SELECT_ONLY',oracleWrite:'NONE',coverageStart:'2026-10-01',readAt:'2026-11-01'};
 const row={TOTAL:'1',ACCOUNT_EXISTS:'1',CURRENCY:'YR',INVALID_CURRENCY:'0',OPENING:'0',TOTAL_DEBIT:'.5',TOTAL_CREDIT:'0',A_CY:'YR',SOURCE_ROW:'physical-row',DOCUMENT_DATE:'2026-10-01',DOCUMENT_TYPE:'3',DOCUMENT_NUMBER:'1',DOCUMENT_SERIAL:'12345678901234567890',RN:'1',DEBIT:'.5',CREDIT:'0'};
 it('keeps currency amounts and long serials without precision loss',()=>{
  const r=parseHrStatement({...envelope,rows:[row]},'2026-10','salary','10001');expect(r.items[0].debit).toBe('0.5');expect(r.items[0].serial).toBe(row.DOCUMENT_SERIAL);expect(r.balances[0].currency).toBe('YER');
 });
 it('distinguishes no movements from missing accounts and incomplete responses',()=>{
  expect(parseHrStatement({...envelope,rows:[{TOTAL:0,ACCOUNT_EXISTS:1}]},'2026-10','salary','10001').total).toBe(0);
  expect(()=>parseHrStatement({...envelope,rows:[{TOTAL:0,ACCOUNT_EXISTS:0}]},'2026-10','salary','10001')).toThrow();
  expect(()=>parseHrStatement({...envelope,rows:[{...row,TOTAL:'2'}]},'2026-10','salary','10001')).toThrow();
 });
 it('rejects opening rows, misreconciled totals and unknown currency configuration',()=>{
  for(const change of [{DOCUMENT_TYPE:'0'},{TOTAL_DEBIT:'99'},{INVALID_CURRENCY:'1'}])expect(()=>parseHrStatement({...envelope,rows:[{...row,...change}]},'2026-10','salary','10001')).toThrow();
 });
});

describe('effective platform baseline',()=>{
 const e={...employee,profile:{payrollResetFrom:'2026-11-01',automaticOracleWithdrawals:true}};
 const nov={...statement,month:'2026-11',items:[{...movement,date:'2026-11-03'},{...movement,id:'credit',date:'2026-11-04',debit:'0',credit:'2500'}],total:2,balances:[{currency:'YER',opening:'900000',closing:'907500'}]};
 it('automatically nets monthly Oracle flows and excludes opening balances and duplicate installment inputs',()=>{
  const result=calculatePayroll(e,nov,{...emptyPayrollInput,installments:'10000'},new Date('2026-12-02'));
  expect(result).toMatchObject({reviewedWithdrawals:'7500.00',net:'93500.00',unreviewed:0,installments:'0.00',baselineDate:'2026-11-01',withdrawalMode:'oracle_auto'});
  expect(result.warnings).toEqual([]);
 });
 it('preserves October review requirements and refuses currency mixing',()=>{
  expect(calculatePayroll(e,statement,emptyPayrollInput).unreviewed).toBe(1);
  expect(calculatePayroll(e,{...nov,items:[{...nov.items[0],currency:'SAR'}]},emptyPayrollInput).net).toBeNull();
 });
 it('keeps future months provisional and never treats unavailable statements as zero',()=>{
  expect(calculatePayroll(e,nov,emptyPayrollInput,new Date('2026-10-19')).periodClosed).toBe(false);
  expect(()=>calculatePayroll(e,null as any,emptyPayrollInput)).toThrow();
 });
});
