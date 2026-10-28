import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { EmployeeDto, SalaryDto } from './hr.dto';

export function validateSchedule(d: EmployeeDto) {
 if(d.managerNo===d.employeeNo) throw new BadRequestException('الموظف لا يكون مسؤولًا مباشرًا عن نفسه؛ اترك المسؤول فارغًا للمدير الأعلى');
 if(d.attendanceExempt) return;
 if(!d.startTime || !d.endTime) throw new BadRequestException('حدد بداية الدوام ونهايته');
 const minutes=(v:string)=>Number(v.slice(0,2))*60+Number(v.slice(3));
 const duration=(minutes(d.endTime)-minutes(d.startTime)+1440)%1440;
 if(duration===0 || d.breakMinutes>=duration) throw new BadRequestException('مدة الراحة يجب أن تكون أقل من مدة الدوام');
 if(d.breakStartTime||d.breakEndTime){
  if(!d.breakStartTime||!d.breakEndTime)throw new BadRequestException('حدد بداية الاستراحة ونهايتها');
  const bs=(minutes(d.breakStartTime)-minutes(d.startTime)+1440)%1440,be=(minutes(d.breakEndTime)-minutes(d.startTime)+1440)%1440;
  if(bs<=0||be<=bs||be>=duration||be-bs!==d.breakMinutes)throw new BadRequestException('الاستراحة يجب أن تقع داخل الدوام وتطابق مدة الراحة');
 }
}

@Injectable()
export class HrService {
 constructor(private readonly db:PrismaService) {}
 list(user:AuthUser) {
  return this.db.hrEmployee.findMany({where:{organizationId:user.organizationId},orderBy:{employeeNo:'asc'},
   include:user.permissions.includes('hr.salary.read')?{salaries:{orderBy:{effectiveFrom:'desc'}}}:undefined});
 }
 async save(user:AuthUser,d:EmployeeDto,id?:string) {
  validateSchedule(d);
  if(!id && d.version!==0) throw new BadRequestException('نسخة إنشاء غير صحيحة');
  return this.db.$transaction(async tx=>{
   const old=id?await tx.hrEmployee.findFirst({where:{id,organizationId:user.organizationId}}):null;
   if(id&&!old) throw new NotFoundException();
   if(d.managerNo && !(await tx.hrEmployee.findFirst({where:{organizationId:user.organizationId,employeeNo:d.managerNo,active:true}}))) throw new BadRequestException('المسؤول المباشر غير موجود أو غير نشط');
   if(old&&old.employeeNo!==d.employeeNo) throw new BadRequestException('رقم الموظف المرتبط بـOracle لا يمكن تغييره');
   const {version,...fields}=d;
   const data={...fields,managerNo:d.managerNo||null,startTime:d.attendanceExempt?null:d.startTime,endTime:d.attendanceExempt?null:d.endTime};
   let result;
   if(id){
    const changed=await tx.hrEmployee.updateMany({where:{id,organizationId:user.organizationId,version},data:{...data,version:{increment:1}}});
    if(!changed.count) throw new ConflictException('تم تعديل البيانات؛ حدّث الصفحة ثم حاول مجددًا');
    result=await tx.hrEmployee.findUniqueOrThrow({where:{id}});
   }else{
    if(await tx.hrEmployee.findUnique({where:{organizationId_employeeNo:{organizationId:user.organizationId,employeeNo:d.employeeNo}}})) throw new ConflictException('رقم الموظف موجود');
    result=await tx.hrEmployee.create({data:{...data,organizationId:user.organizationId,payrollStart:new Date('2026-10-01T00:00:00Z')}});
   }
   await tx.auditLog.create({data:{userId:user.id,action:id?'hr_employee_updated':'hr_employee_created',entityTable:'hr_employees',entityId:result.id,oldValue:old?JSON.parse(JSON.stringify(old)):Prisma.JsonNull,newValue:JSON.parse(JSON.stringify(result))}});
   return result;
  });
 }
 async salary(user:AuthUser,id:string,d:SalaryDto) {
  const date=new Date(d.effectiveFrom+'T00:00:00Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==d.effectiveFrom||d.effectiveFrom<'2026-10-01') throw new BadRequestException('تاريخ سريان غير صحيح؛ البداية 1 أكتوبر 2026');
  return this.db.$transaction(async tx=>{
   const employee=await tx.hrEmployee.findFirst({where:{id,organizationId:user.organizationId}});
   if(!employee) throw new NotFoundException();
   const updated=await tx.hrEmployee.updateMany({where:{id,organizationId:user.organizationId,version:d.version},data:{version:{increment:1}}});
   if(!updated.count) throw new ConflictException('تم تعديل البيانات؛ حدّث الصفحة');
   const where={employeeId_effectiveFrom:{employeeId:id,effectiveFrom:date}};
   const old=await tx.hrSalary.findUnique({where});
   const data={baseSalary:d.baseSalary,fixedAllowance:d.fixedAllowance??null,currency:d.currency};
   const result=await tx.hrSalary.upsert({where,create:{...data,employeeId:id,effectiveFrom:date},update:data});
   await tx.auditLog.create({data:{userId:user.id,action:'hr_salary_saved',entityTable:'hr_salaries',entityId:result.id,oldValue:old?JSON.parse(JSON.stringify(old)):Prisma.JsonNull,newValue:JSON.parse(JSON.stringify(result))}});
   return result;
  });
 }
}
