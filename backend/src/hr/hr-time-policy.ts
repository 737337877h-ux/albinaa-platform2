// Payroll policy is versioned by effective month; attendance snapshots remain authoritative.
export const DEFAULT_TIME_RULE = {effectiveFrom:'2026-10-01',graceMinutes:15,returnGraceMinutes:15,daysDivisor:30,hoursDivisor:8,automaticAbsence:true,lateDeduction:true,monthlyLeaveDays:2.5};
export type TimeRule=typeof DEFAULT_TIME_RULE;
export function timeRule(policy:any,day:string):TimeRule|null {
 if(day<DEFAULT_TIME_RULE.effectiveFrom)return null;
 const rules=Array.isArray(policy?.payrollRules)?policy.payrollRules:[];
 return [...rules].filter((r:any)=>r.effectiveFrom<=day).sort((a:any,b:any)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0]??DEFAULT_TIME_RULE;
}
export function dayCharge(e:any,day:string,s:any,record:any,leaves:any[],review:any,policy:any,now:Date){
 const rule=timeRule(policy,day),result={absence:false,lateMinutes:0,morningMinutes:0,returnMinutes:0,needsReview:false,rule};
 const stamp=(v:any)=>new Date(v).getTime();
 if(!rule||!policy||!e.active||e.attendanceExempt||!s?.workDay||day<String(e.payrollStart instanceof Date?e.payrollStart.toISOString():e.payrollStart).slice(0,10)||stamp(day)<stamp(policy.startDate)||day<new Date(stamp(e.createdAt)+10800000).toISOString().slice(0,10)||review?.status==='excused')return result;
 if(leaves.some(r=>r.kind==='leave'&&r.status==='approved'&&day>=new Date(r.startDate).toISOString().slice(0,10)&&day<=new Date(r.endDate).toISOString().slice(0,10)))return result;
 if(!record){result.absence=now.getTime()>stamp(s.end)&&(rule.automaticAbsence||review?.status==='confirmed');return result;}
 if([record.inEvidence,record.breakInEvidence,record.outEvidence,record.breakOutEvidence].some(v=>v?.needsTimeReview||v?.needsLocationReview)){result.needsReview=true;return result;}
 if(stamp(record.checkIn)>now.getTime()){result.needsReview=true;return result;}
 const start=stamp(s.start),arrival=stamp(record.checkIn),end=stamp(s.end);
 let missing=Math.max(0,Math.floor((Math.min(arrival,end)-start)/60000));
 // A first arrival after lunch must not include scheduled rest or be charged twice.
 if(s.fourPunches&&s.breakStart&&s.breakEnd)missing-=Math.max(0,Math.floor((Math.min(arrival,stamp(s.breakEnd))-stamp(s.breakStart))/60000));
 result.morningMinutes=Math.max(0,missing-rule.graceMinutes);
 if(s.fourPunches&&arrival<stamp(s.breakStart)){
  if(record.breakIn&&!record.breakOut)result.needsReview=true;
  if(record.breakIn)result.returnMinutes=Math.max(0,Math.floor((Math.min(stamp(record.breakIn),end)-stamp(s.breakEnd))/60000)-rule.returnGraceMinutes);
  else if(now.getTime()>end)result.needsReview=true;
 }
 if(now.getTime()>end&&!record.checkOut)result.needsReview=true;
 // Early exits require a separate reviewed policy; do not silently invent a penalty.
 if(record.checkOut&&stamp(record.checkOut)<end)result.needsReview=true;
 if(record.breakOut&&s.breakStart&&stamp(record.breakOut)<stamp(s.breakStart))result.needsReview=true;
 result.lateMinutes=rule.lateDeduction?result.morningMinutes+result.returnMinutes:0;
 return result;
}
