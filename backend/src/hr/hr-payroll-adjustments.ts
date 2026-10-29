import {payrollBaseline} from './hr-payroll-baseline';
import {Prisma} from '@prisma/client';
import {eligibleAbsence} from './hr-absence.service';
import {scheduleFor} from './hr-attendance.service';
import {dayCharge,DEFAULT_TIME_RULE} from './hr-time-policy';
export async function payrollAdjustments(db:any,employee:any,month:string){
 const start=new Date(month+'-01T00:00:00Z'),end=new Date(start);end.setUTCMonth(end.getUTCMonth()+1);
 const [absences,policy,leaves,attendance,approvals]=await Promise.all([
 db.hrAbsenceReview.findMany({where:{employeeId:employee.id,workDate:{gte:start,lt:end}},orderBy:{workDate:'asc'}}),
 db.hrAttendancePolicy.findUnique({where:{organizationId:employee.organizationId}}),
 db.hrRequest.findMany({where:{employeeId:employee.id,kind:'leave',status:'approved',startDate:{lt:end},endDate:{gte:start}},orderBy:{id:'asc'}}),
 db.hrAttendance.findMany({where:{employeeId:employee.id,workDate:{gte:start,lt:end}},orderBy:{workDate:'asc'}}),
 db.hrPayrollApproval.findMany({where:{organizationId:employee.organizationId,month:{lt:month},status:'approved'},select:{month:true,snapshot:true},orderBy:{month:'asc'}})
 ]);
 return {absences,policy,timePolicyVersion:DEFAULT_TIME_RULE.effectiveFrom+'-v1',leaves,attendance,previous:approvals.map((a:any)=>({month:a.month,workspace:a.snapshot.workspaces?.find((w:any)=>w.employee.id===employee.id)}))};
}
export function applyAdjustments(calculation:any,employee:any,month:string,ctx:any,advances:any[],links:any[],inputs:any,now=new Date()){
 const amount=(v:any)=>new Prisma.Decimal(v??0);
 const days:string[]=[],attendanceLines:any[]=[],attendanceReviewDays:string[]=[];
 let absenceDeduction=amount(0),lateDeduction=amount(0);
 const first=new Date(month+'-01T00:00:00Z');
 for(let dayDate=new Date(first);dayDate.getUTCMonth()===first.getUTCMonth();dayDate.setUTCDate(dayDate.getUTCDate()+1)){
  const day=dayDate.toISOString().slice(0,10),review=ctx.absences.find((r:any)=>new Date(r.workDate).toISOString().slice(0,10)===day);
  const record=ctx.attendance.find((r:any)=>new Date(r.workDate).toISOString().slice(0,10)===day);
  const schedule=record?.schedule??scheduleFor(employee,day);
  const charge=dayCharge(employee,day,schedule,record,ctx.leaves,review,ctx.policy,now);
  if(!charge.rule){if(review?.status==='confirmed'&&eligibleAbsence(employee,day,ctx.policy,ctx.leaves,ctx.attendance,now)){days.push(day);absenceDeduction=absenceDeduction.plus(amount(calculation.baseSalary).div(30));}continue;}
  if(charge.absence){days.push(day);const deduction=amount(calculation.baseSalary).div(charge.rule.daysDivisor);absenceDeduction=absenceDeduction.plus(deduction);attendanceLines.push({date:day,kind:'absence',amount:deduction.toFixed(2)});}
  if(charge.needsReview)attendanceReviewDays.push(day);
  if(charge.lateMinutes){const deduction=amount(calculation.baseSalary).div(charge.rule.daysDivisor).div(charge.rule.hoursDivisor).div(60).mul(charge.lateMinutes);lateDeduction=lateDeduction.plus(deduction);attendanceLines.push({date:day,kind:'late',minutes:charge.lateMinutes,morningMinutes:charge.morningMinutes,returnMinutes:charge.returnMinutes,amount:deduction.toFixed(2)});}
 }
 absenceDeduction=absenceDeduction.toDecimalPlaces(2);lateDeduction=lateDeduction.toDecimalPlaces(2);
 if(attendanceReviewDays.length){calculation.net=null;calculation.warnings.push('سجلات حضور تحتاج مراجعة قبل اعتماد الخصم: '+attendanceReviewDays.join('، '));}
 const lines:any[]=[];
 for(const request of (payrollBaseline(employee,month)?[]:advances)){
  if(!request.monthlyInstallment||!request.installmentStartMonth||request.installmentStartMonth>month)continue;
  const proven=links.some(l=>l.id===request.id&&l.linkedMonth===month&&l.linkedAmount!=null)||ctx.previous.some((p:any)=>p.workspace?.advanceLinks?.some((l:any)=>l.id===request.id&&l.linkedMonth===p.month&&l.linkedAmount!=null));
  if(!proven)continue;
  const paid=ctx.previous.reduce((sum:Prisma.Decimal,p:any)=>sum.plus((p.workspace?.calculation?.automaticInstallmentLines??[]).filter((l:any)=>l.requestId===request.id).reduce((a:Prisma.Decimal,l:any)=>a.plus(l.amount),amount(0))),amount(0));
  const remaining=Prisma.Decimal.max(0,amount(request.amount).minus(paid));
  if(!remaining.gt(0))continue;
  if(request.currency!==calculation.currency){calculation.net=null;calculation.warnings.push('عملة قسط السلفة تختلف عن الراتب');continue;}
  const value=Prisma.Decimal.min(remaining,amount(request.monthlyInstallment));
  lines.push({requestId:request.id,amount:value.toFixed(2),remainingAfter:remaining.minus(value).toFixed(2),currency:request.currency});
 }
 const automatic=lines.reduce((sum:Prisma.Decimal,l:any)=>sum.plus(l.amount),amount(0));
 const cap=amount(calculation.baseSalary).mul('0.10').toDecimalPlaces(2,Prisma.Decimal.ROUND_DOWN);
 if(automatic.plus(amount(inputs.installments)).gt(cap)){calculation.net=null;calculation.warnings.push('إجمالي الأقساط يتجاوز سقف 10% من الراتب الأساسي');}
 if(calculation.net!=null)calculation.net=amount(calculation.net).minus(absenceDeduction).minus(lateDeduction).minus(automatic).toFixed(2);
 if(calculation.net!=null&&amount(calculation.net).isNegative()&&!calculation.warnings.some((s:string)=>s.includes('سالب')))calculation.warnings.push('صافي المسودة سالب؛ يلزم مراجعة');
 return Object.assign(calculation,{absenceDays:days,absenceDeduction:absenceDeduction.toFixed(2),lateDeduction:lateDeduction.toFixed(2),attendanceLines,attendanceReviewDays,automaticInstallments:automatic.toFixed(2),automaticInstallmentLines:lines,installmentCap:cap.toFixed(2)});
}
