import {PayrollInputDto} from './hr-payroll.dto';
// Effective-dated, per-employee policy. Historical drafts and source balances remain intact.
export function payrollBaseline(employee:any,month:string):string|null {
 const p=employee.profile??{},date=p.payrollResetFrom;
 return p.automaticOracleWithdrawals===true && /^\d{4}-(0[1-9]|1[0-2])-01$/.test(date??'') && month>=date.slice(0,7) ? date : null;
}
export function payrollInputs(employee:any,month:string,input:PayrollInputDto):PayrollInputDto {
 if(!payrollBaseline(employee,month))return input;
 return {...input,incentives:input.incentives??'0',deductions:input.deductions??'0',installments:'0',installmentsConfirmed:true,reviews:[]};
}
