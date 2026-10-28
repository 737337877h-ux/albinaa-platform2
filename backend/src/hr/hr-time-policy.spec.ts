import {dayCharge,timeRule,DEFAULT_TIME_RULE} from './hr-time-policy';
import {scheduleFor} from './hr-attendance.service';
import {applyAdjustments} from './hr-payroll-adjustments';
const employee={active:true,attendanceExempt:false,createdAt:'2026-09-01',payrollStart:'2026-10-01',startTime:'06:30',endTime:'22:00',breakMinutes:60,breakStartTime:'13:00',breakEndTime:'14:00',workDays:[0,1,2,3,4,6]};
const policy={startDate:'2026-09-16'},date='2026-10-04',now=new Date('2026-10-04T23:00:00+03:00');
const at=(t:string)=>new Date(date+'T'+t+':00+03:00');
const record=(t='06:50')=>({workDate:date,checkIn:at(t),breakOut:at('13:00'),breakIn:at('14:25'),checkOut:at('22:00')});
const charge=(r:any,leaves:any[]=[],review:any=null,p:any=policy)=>dayCharge(employee,date,scheduleFor(employee,date),r,leaves,review,p,now);
describe('effective attendance deduction policy',()=>{
 it('charges only excess grace for both starts',()=>expect(charge(record())).toMatchObject({absence:false,morningMinutes:5,returnMinutes:10,lateMinutes:15,needsReview:false}));
 it('keeps grace boundaries inclusive',()=>expect(charge({...record('06:45'),breakIn:at('14:15')}).lateMinutes).toBe(0));
 it('excludes approved leave inclusively; charges following workdays until attendance',()=>{
  const leave={kind:'leave',status:'approved',startDate:'2026-10-01',endDate:'2026-10-03'};
  expect(charge(null,[leave]).absence).toBe(true);
  expect(charge(null,[{...leave,endDate:date}]).absence).toBe(false);
  expect(charge(record('08:00'),[leave])).toMatchObject({absence:false,morningMinutes:75});
 });
 it('never charges rest, Friday, exempt, excused or future days as absence',()=>{
  expect(charge(null,[],{status:'excused'}).absence).toBe(false);
  expect(dayCharge({...employee,attendanceExempt:true},date,scheduleFor(employee,date),null,[],null,policy,now).absence).toBe(false);
  expect(dayCharge(employee,'2026-10-02',scheduleFor(employee,'2026-10-02'),null,[],null,policy,now).absence).toBe(false);
  expect(dayCharge(employee,date,scheduleFor(employee,date),null,[],null,policy,at('12:00')).absence).toBe(false);
 });
 it('avoids charging lunch or afternoon lateness twice on first afternoon arrival',()=>{
  expect(charge({...record('14:30'),breakOut:null,breakIn:null})).toMatchObject({morningMinutes:405,returnMinutes:0,absence:false,needsReview:false});
 });
 it('holds unresolved offline time, missing return and early exits for review',()=>{
  expect(charge({...record(),inEvidence:{needsTimeReview:true}})).toMatchObject({needsReview:true,lateMinutes:0});
  expect(charge({...record(),breakIn:null}).needsReview).toBe(true);
  expect(charge({...record(),checkOut:at('20:00')}).needsReview).toBe(true);
 });
 it('selects rule by date and never applies before October',()=>{
  const p={...policy,payrollRules:[{...DEFAULT_TIME_RULE,effectiveFrom:'2026-11-01',graceMinutes:10}]};
  expect(timeRule(p,'2026-09-30')).toBeNull();expect(timeRule(p,date)?.graceMinutes).toBe(15);expect(timeRule(p,'2026-11-01')?.graceMinutes).toBe(10);
  expect(charge(null,[],null,{...policy,payrollRules:[{...DEFAULT_TIME_RULE,automaticAbsence:false}]}).absence).toBe(false);
 });
 it('separates late from absence and calculates 30 minutes as 250 for salary 120000',()=>{
  const e={...employee,createdAt:date,payrollStart:date};
  const ctx={policy,absences:[],leaves:[],attendance:[{...record('07:15'),breakIn:at('14:00')}],previous:[]};
  const c=applyAdjustments({baseSalary:'120000',net:'120000',currency:'YER',warnings:[]},e,'2026-10',ctx,[],[],{installments:0},now);
  expect(c.absenceDeduction).toBe('0.00');expect(c.lateDeduction).toBe('250.00');expect(c.net).toBe('119750.00');
 });
});
