import {BadRequestException,ConflictException,Injectable,NotFoundException} from '@nestjs/common';
import {PrismaService} from '../prisma/prisma.service';
import {AuthUser} from '../common/guards/jwt-auth.guard';
import {HrAbsenceDto} from './hr-profile.dto';
import {adenDate,scheduleFor,validDay} from './hr-attendance.service';
export function eligibleAbsence(e:any,day:string,policy:any,leaves:any[],attendance:any[],now=new Date()){
 const date=validDay(day),schedule=scheduleFor(e,day);
 return !!(e.active&&!e.attendanceExempt&&policy&&date>=new Date(policy.startDate)&&date>=new Date(e.payrollStart)&&day>=adenDate(new Date(e.createdAt))&&schedule?.workDay&&now>new Date(schedule.end)&&!attendance.some(a=>new Date(a.workDate).getTime()===date.getTime())&&!leaves.some(r=>r.kind==='leave'&&r.status==='approved'&&new Date(r.startDate)<=date&&new Date(r.endDate)>=date));
}
@Injectable()
export class HrAbsenceService {
 constructor(private readonly db:PrismaService){}
 async review(u:AuthUser,id:string,d:HrAbsenceDto){const date=validDay(d.date);if(d.reason.trim().length<3)throw new BadRequestException('اكتب سبب المراجعة');return this.db.$transaction(async tx=>{
 await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${u.organizationId+':payroll:'+d.date.slice(0,7)},0))::text`;
 if(await tx.hrPayrollApproval.findFirst({where:{organizationId:u.organizationId,month:d.date.slice(0,7),status:'approved'}}))throw new ConflictException('مسير الشهر معتمد؛ أعد فتحه أولًا');
 const e=await tx.hrEmployee.findFirst({where:{id,organizationId:u.organizationId},include:{requests:{where:{kind:'leave',status:'approved'}},attendance:{where:{workDate:date}}}});if(!e)throw new NotFoundException();
 const policy=await tx.hrAttendancePolicy.findUnique({where:{organizationId:u.organizationId}});
 if(d.status==='confirmed'&&!eligibleAbsence(e,d.date,policy,e.requests,e.attendance))throw new BadRequestException('اليوم غير مؤهل لغياب يوم كامل: راجع الدوام والإجازة والإعفاء وتاريخ بدء المتابعة');
 const old=await tx.hrAbsenceReview.findUnique({where:{employeeId_workDate:{employeeId:id,workDate:date}}});
 if((old?.version??0)!==d.version)throw new ConflictException('تغيرت المراجعة؛ أعد التحميل');
 await tx.hrEmployee.update({where:{id},data:{version:{increment:1}}});
 const data={status:d.status,reason:d.reason.trim(),reviewedBy:u.id,reviewedAt:new Date()};
 const r=old?await tx.hrAbsenceReview.update({where:{id:old.id},data:{...data,version:{increment:1}}}):await tx.hrAbsenceReview.create({data:{...data,employeeId:id,workDate:date}});
 await tx.auditLog.create({data:{userId:u.id,action:'hr_absence_reviewed',entityTable:'hr_absence_reviews',entityId:r.id,newValue:{date:d.date,...data,reviewedAt:data.reviewedAt.toISOString()}}});return r;
 });}
}
