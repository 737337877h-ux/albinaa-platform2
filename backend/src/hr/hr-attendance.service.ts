import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { AttendancePunchDto } from './hr-attendance.dto';
import {TimePolicyDto} from './hr-time-policy.dto';
import {DEFAULT_TIME_RULE,dayCharge} from './hr-time-policy';
export const adenDate=(n:Date)=>new Date(n.getTime()+10800000).toISOString().slice(0,10);
export function validDay(s:string){const d=new Date(s+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)throw new BadRequestException('تاريخ غير صحيح');return d;}
export function scheduleFor(e:{startTime:string|null;endTime:string|null;workDays:number[];breakMinutes:number;breakStartTime?:string|null;breakEndTime?:string|null},day:string){
 validDay(day);if(!e.startTime||!e.endTime)return null;
 const start=new Date(`${day}T${e.startTime}:00+03:00`),end=new Date(`${day}T${e.endTime}:00+03:00`);
 if(end<=start)end.setUTCDate(end.getUTCDate()+1);
 const point=(time:string)=>{const p=new Date(`${day}T${time}:00+03:00`);if(p<start)p.setUTCDate(p.getUTCDate()+1);return p;};
 const bs=e.breakStartTime?point(e.breakStartTime):null,be=e.breakEndTime?point(e.breakEndTime):null;
 const split=!!bs&&!!be&&bs>start&&be>bs&&be<end&&(be.getTime()-bs.getTime())/60000===e.breakMinutes;
 return {start:start.toISOString(),end:end.toISOString(),workDay:e.workDays.includes(validDay(day).getUTCDay()),breakMinutes:e.breakMinutes,breakStart:split?bs!.toISOString():null,breakEnd:split?be!.toISOString():null,fourPunches:split};
}
export function workDayFor(e:{startTime:string|null;endTime:string|null},now:Date){let day=adenDate(now);const time=new Date(now.getTime()+10800000).toISOString().slice(11,16);if(e.startTime&&e.endTime&&e.endTime<=e.startTime&&time<e.endTime)day=adenDate(new Date(now.getTime()-86400000));return day;}
export function qrSign(secret:string,org:string,now:Date){const p=Buffer.from(JSON.stringify({org,exp:now.getTime()+45000,nonce:randomBytes(12).toString('hex')})).toString('base64url');return 'ALBINAA-HR.'+p+'.'+createHmac('sha256',secret).update('hr-attendance:'+p).digest('base64url');}
export function qrCheck(secret:string,token:string,org:string,now:Date){try{const [prefix,p,sig,...extra]=token.split('.');if(prefix!=='ALBINAA-HR'||extra.length||!p||!sig)throw Error();const expected=createHmac('sha256',secret).update('hr-attendance:'+p).digest();const got=Buffer.from(sig,'base64url');if(got.length!==expected.length||!timingSafeEqual(got,expected))throw Error();const value=JSON.parse(Buffer.from(p,'base64url').toString());if(value.org!==org||!Number.isFinite(value.exp)||value.exp<=now.getTime()||value.exp>now.getTime()+45000)throw Error();}catch{throw new BadRequestException('رمز الحضور غير صالح أو انتهى؛ امسح الرمز الحالي من المنصة');}}
@Injectable()
export class HrAttendanceService {
 constructor(private readonly db:PrismaService,private readonly config:ConfigService){}
 async policy(u:AuthUser){const p=await this.db.hrAttendancePolicy.findUnique({where:{organizationId:u.organizationId}});return {version:p?.version??1,rules:p?.payrollRules??[],defaults:DEFAULT_TIME_RULE};}
 async savePolicy(u:AuthUser,d:TimePolicyDto){
  validDay(d.effectiveFrom);const today=adenDate(new Date());
  if(d.effectiveFrom<'2026-10-01'||d.effectiveFrom<today.slice(0,7)+'-01')throw new BadRequestException('تاريخ السريان يجب أن يبدأ بشهر مفتوح، من أكتوبر 2026 فما بعد');
  if(d.reason.trim().length<3)throw new BadRequestException('اكتب سبب التعديل');
  return this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${u.organizationId+':payroll:'+d.effectiveFrom.slice(0,7)},0))::text`;
   if(await tx.hrPayrollApproval.findFirst({where:{organizationId:u.organizationId,status:'approved',month:{gte:d.effectiveFrom.slice(0,7)}}}))throw new ConflictException('توجد كشوف معتمدة تتأثر بتاريخ السريان');
   const old=await tx.hrAttendancePolicy.findUnique({where:{organizationId:u.organizationId}});if(!old||old.version!==d.version)throw new ConflictException('تغيرت الإعدادات؛ حدّث الصفحة');
   const {version,reason,...rule}=d;const rules=[...(Array.isArray(old.payrollRules)?old.payrollRules:[]).filter((r:any)=>r.effectiveFrom!==rule.effectiveFrom),rule];
   const changed=await tx.hrAttendancePolicy.updateMany({where:{organizationId:u.organizationId,version},data:{payrollRules:rules,version:{increment:1}}});if(!changed.count)throw new ConflictException('تغيرت الإعدادات؛ حدّث الصفحة');
   await tx.auditLog.create({data:{userId:u.id,action:'hr_time_policy_updated',entityTable:'hr_attendance_policies',entityId:u.organizationId,oldValue:old.payrollRules??[],newValue:{rules,reason}}});return {version:version+1,rules,defaults:DEFAULT_TIME_RULE};
  });
 }
 private secret(){const s=this.config.get<string>('JWT_ACCESS_SECRET');if(!s)throw new Error('Attendance signing key missing');return s;}
 qr(u:AuthUser){const now=new Date();return {token:qrSign(this.secret(),u.organizationId,now),expiresAt:new Date(now.getTime()+45000).toISOString(),refreshAfterSeconds:30,serverTime:now.toISOString()};}
 async mine(u:AuthUser){const e=await this.db.hrEmployee.findFirst({where:{organizationId:u.organizationId,loginUserId:u.id,active:true},select:{id:true,employeeNo:true,fullName:true,workMode:true,attendanceExempt:true,startTime:true,endTime:true,workDays:true,breakMinutes:true,breakStartTime:true,breakEndTime:true}});return {employee:e,serverTime:new Date().toISOString(),records:e?await this.db.hrAttendance.findMany({where:{employeeId:e.id},orderBy:{workDate:'desc'},take:31}):[],open:e?await this.db.hrAttendance.findFirst({where:{employeeId:e.id,checkOut:null}}):null};}
 private evidence(u:AuthUser,e:{workMode:string},d:AttendancePunchDto,now:Date){
  if(d.method==='qr'){qrCheck(this.secret(),d.token??'',u.organizationId,now);return {method:'qr',userId:u.id};}
  if(e.workMode==='office')throw new ForbiddenException('الحضور داخل المنشأة يتطلب مسح رمز الحضور');
  if(d.latitude==null||d.longitude==null||d.accuracy==null||d.capturedAt==null||Math.abs(now.getTime()-d.capturedAt)>120000)throw new BadRequestException('يلزم موقع حديث مع دقة القياس؛ حدّث الموقع وأعد المحاولة');
  if(d.mocked)throw new BadRequestException('لا يقبل تسجيل الحضور بموقع محاكى');
  return {method:'location',userId:u.id,latitude:d.latitude,longitude:d.longitude,accuracy:d.accuracy,capturedAt:d.capturedAt,needsLocationReview:d.accuracy>100};
 }
 async punch(u:AuthUser,d:AttendancePunchDto){
  const run=()=>this.db.$transaction(async tx=>{
   const e=await tx.hrEmployee.findFirst({where:{organizationId:u.organizationId,loginUserId:u.id,active:true}});if(!e)throw new ForbiddenException('حسابك غير مرتبط بموظف نشط');
   if(d.employeeId&&d.employeeId!==e.id)throw new ForbiddenException('الحركة تخص موظفًا آخر');
   if(e.attendanceExempt)throw new BadRequestException('الموظف معفى من تسجيل الحضور والانصراف');
   const opField={in:'inOperationId',out:'outOperationId',break_out:'breakOutOperationId',break_in:'breakInOperationId'}[d.action]!;
   const old=await tx.hrAttendance.findFirst({where:{OR:[{inOperationId:d.operationId},{outOperationId:d.operationId},{breakOutOperationId:d.operationId},{breakInOperationId:d.operationId}]}});
   if(old){if(old.employeeId!==e.id||(old as any)[opField]!==d.operationId)throw new ConflictException('معرّف العملية مستخدم');return old;}
   const receivedAt=new Date(),now=d.recordedAt===undefined?receivedAt:new Date(d.recordedAt);
   if(!Number.isFinite(now.getTime())||now.getTime()<=0||now.getTime()>receivedAt.getTime()+120000)throw new BadRequestException('وقت التسجيل غير صالح؛ تحقق من ساعة الهاتف');
   const evidence={...this.evidence(u,e,d,now),receivedAt:receivedAt.toISOString(),recordedAt:now.toISOString(),clientRecorded:d.recordedAt!==undefined,needsTimeReview:d.recordedAt!==undefined&&Math.abs(receivedAt.getTime()-now.getTime())>120000};
   const open=await tx.hrAttendance.findFirst({where:{employeeId:e.id,checkOut:null}});
   if(open&&d.action!=='in'&&now.getTime()<=Math.max(open.checkIn.getTime(),open.breakOut?.getTime()??0,open.breakIn?.getTime()??0))throw new BadRequestException('وقت الحركة يجب أن يلي آخر حركة حضور');
   let result;
   if(d.action==='break_out'||d.action==='break_in'){
    if(!open)throw new BadRequestException('سجل الحضور أولًا');
    if(!(open.schedule as any).fourPunches)throw new BadRequestException('هذا السجل يتبع جدول دخول وانصراف؛ الحركات الأربع تبدأ مع يوم جديد');
    if(d.action==='break_out'&&(open.breakOut||open.breakIn))throw new ConflictException('تم تسجيل الخروج للاستراحة');
    if(d.action==='break_in'&&(!open.breakOut||open.breakIn))throw new ConflictException('سجل الخروج للاستراحة أولًا أو حدّث السجل');
    const data=d.action==='break_out'?{breakOut:now,breakOutOperationId:d.operationId,breakOutEvidence:evidence}:{breakIn:now,breakInOperationId:d.operationId,breakInEvidence:evidence};
    const changed=await tx.hrAttendance.updateMany({where:{id:open.id,checkOut:null,...(d.action==='break_out'?{breakOut:null}:{breakIn:null,breakOut:{not:null}})},data});if(!changed.count)throw new ConflictException('تغير سجل الحضور؛ حدّث الشاشة');result=await tx.hrAttendance.findUniqueOrThrow({where:{id:open.id}});
   }else if(d.action==='out'){
    if(!open)throw new BadRequestException('لا يوجد حضور مفتوح لتسجيل الانصراف');
    const changed=await tx.hrAttendance.updateMany({where:{id:open.id,checkOut:null},data:{checkOut:now,outOperationId:d.operationId,outEvidence:evidence}});if(!changed.count)throw new ConflictException('تم تسجيل الانصراف؛ حدّث الشاشة');
    result=await tx.hrAttendance.findUniqueOrThrow({where:{id:open.id}});
   }else{
    if(open)throw new ConflictException('يوجد حضور مفتوح؛ سجل الانصراف أولًا');
    const day=workDayFor(e,now),schedule=scheduleFor(e,day);if(!schedule)throw new BadRequestException('جدول الدوام غير مكتمل؛ راجع المسؤول');
    if(await tx.hrAttendance.findUnique({where:{employeeId_workDate:{employeeId:e.id,workDate:validDay(day)}}}))throw new ConflictException('تم تسجيل دوام هذا اليوم بالفعل');
    result=await tx.hrAttendance.create({data:{employeeId:e.id,workDate:validDay(day),checkIn:now,inOperationId:d.operationId,inEvidence:evidence,schedule}});
   }
   await tx.auditLog.create({data:{userId:u.id,action:{in:'hr_checked_in',out:'hr_checked_out',break_out:'hr_break_out',break_in:'hr_break_in'}[d.action]!,entityTable:'hr_attendance',entityId:result.id,newValue:{time:now.toISOString(),receivedAt:receivedAt.toISOString(),method:d.method}}});return result;
  });
  try{return await run();}catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002'){const field={in:'inOperationId',out:'outOperationId',break_out:'breakOutOperationId',break_in:'breakInOperationId'}[d.action]!;const old=await this.db.hrAttendance.findFirst({where:{employee:{organizationId:u.organizationId,loginUserId:u.id},[field]:d.operationId}});if(old)return old;throw new ConflictException('سبق تسجيل الحركة؛ حدّث الشاشة');}throw e;}
 }
 async report(u:AuthUser,day:string){
  const date=validDay(day),now=new Date();const policy=await this.db.hrAttendancePolicy.findUnique({where:{organizationId:u.organizationId}});
  const employees=await this.db.hrEmployee.findMany({where:{organizationId:u.organizationId},include:{attendance:{where:{workDate:date}},requests:{where:{kind:'leave',status:'approved',startDate:{lte:date},endDate:{gte:date}},select:{id:true,leaveType:true,kind:true,status:true,startDate:true,endDate:true}}},orderBy:{employeeNo:'asc'}});
  const reviews=await this.db.hrAbsenceReview.findMany({where:{employeeId:{in:employees.map(e=>e.id)},workDate:date}});
  return {date:day,serverTime:now.toISOString(),startDate:policy?.startDate??null,rows:employees.map(e=>{
   const record=e.attendance[0]??null,schedule=(record?.schedule??scheduleFor(e,day)) as ReturnType<typeof scheduleFor>;
   const tracked=!!policy&&date>=policy.startDate&&day>=adenDate(e.createdAt);
   const status=record?(record.checkOut?'completed':'open'):!e.active?'inactive':e.attendanceExempt?'exempt':!tracked?'not_tracked':e.requests.length?'leave':!schedule?'missing_schedule':!schedule.workDay?'off':now<new Date(schedule.start)?'not_started':now<new Date(schedule.end)?'awaiting':'missing';
   const absenceReview=reviews.find(r=>r.employeeId===e.id)??null;const charge=dayCharge(e,day,schedule,record,e.requests,absenceReview,policy,now);
   return {charge,absenceReview,id:e.id,employeeNo:e.employeeNo,fullName:e.fullName,status,leaves:e.requests,record,schedule,lateMinutes:record&&schedule?.workDay?Math.max(0,Math.floor((record.checkIn.getTime()-new Date(schedule.start).getTime())/60000)):null,presenceMinutes:record?.checkOut?Math.floor((record.checkOut.getTime()-record.checkIn.getTime())/60000):null,needsReview:!!record&&([record.inEvidence,record.outEvidence,record.breakOutEvidence,record.breakInEvidence].some((v:any)=>v?.needsTimeReview)||(!record.checkOut&&!!schedule&&now>new Date(schedule.end))||(!!record.checkOut&&record.checkOut.getTime()-record.checkIn.getTime()>86400000)||e.requests.length>0||((record.schedule as any).fourPunches&&!!record.checkOut&&(!record.breakOut||!record.breakIn)))};
  })};
 }
}
