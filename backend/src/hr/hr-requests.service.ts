import {leaveBalance} from './hr-profile.service';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { HrDecisionDto, HrLoginDto, HrRequestDto } from './hr-requests.dto';
import {queueHrRequestNotification} from './hr-request-notifications';

export function requestFields(d:HrRequestDto){
 if(d.reason.trim().length<3)throw new BadRequestException('اكتب سبب الطلب');
 if(d.kind==='advance'){
  if(!d.amount||!d.currency||new Prisma.Decimal(d.amount).lte(0)||d.startDate||d.endDate||d.leaveType)throw new BadRequestException('حدد مبلغ السلفة وعملتها فقط');
  return {kind:d.kind,reason:d.reason.trim(),amount:new Prisma.Decimal(d.amount),currency:d.currency,startDate:null,endDate:null,leaveType:null};
 }
 const date=(v?:string)=>{const n=new Date((v??'')+'T00:00:00Z');if(!v||!Number.isFinite(n.getTime())||n.toISOString().slice(0,10)!==v)throw new BadRequestException('تاريخ إجازة غير صحيح');return n;};
 const startDate=date(d.startDate),endDate=date(d.endDate);
 if(endDate<startDate||!d.leaveType||d.amount!=null||d.currency!=null)throw new BadRequestException('راجع فترة الإجازة ونوعها');
 return {kind:d.kind,reason:d.reason.trim(),amount:null,currency:null,startDate,endDate,leaveType:d.leaveType};
}
const employeeSelect={id:true,employeeNo:true,fullName:true,active:true,loginUserId:true,version:true} as const;
@Injectable()
export class HrRequestsService {
 constructor(private readonly db:PrismaService){}
 async mine(u:AuthUser){
  const employee=await this.db.hrEmployee.findFirst({where:{organizationId:u.organizationId,loginUserId:u.id,active:true},select:employeeSelect});
  return {employee,requests:employee?await this.db.hrRequest.findMany({where:{employeeId:employee.id},orderBy:{createdAt:'desc'}}):[]};
 }
 async admin(u:AuthUser){const policy=await this.db.hrAttendancePolicy.findUnique({where:{organizationId:u.organizationId}});const rows=await this.db.hrRequest.findMany({where:{employee:{organizationId:u.organizationId}},include:{employee:{select:employeeSelect}},orderBy:{createdAt:'desc'}});const employees=await this.db.hrEmployee.findMany({where:{organizationId:u.organizationId},include:{requests:{where:{kind:'leave',status:'approved'}}}});const withBalances=rows.map(r=>{const e=employees.find(e=>e.id===r.employeeId)!;return {...r,leaveBalance:leaveBalance(e.profile,e.requests,e.workDays,{policy,payrollStart:e.payrollStart})};});if(!u.permissions.includes('hr.salary.read'))return withBalances;const salaries=await this.db.hrSalary.findMany({where:{employee:{organizationId:u.organizationId}},orderBy:{effectiveFrom:'desc'}});return withBalances.map(r=>({...r,salaryHistory:salaries.filter(s=>s.employeeId===r.employeeId).map(s=>({effectiveFrom:s.effectiveFrom,baseSalary:s.baseSalary,currency:s.currency,installmentCap:s.baseSalary.mul('0.10').toFixed(2)}))}));}
 async links(u:AuthUser){return {employees:await this.db.hrEmployee.findMany({where:{organizationId:u.organizationId},select:employeeSelect,orderBy:{employeeNo:'asc'}}),users:await this.db.user.findMany({where:{organizationId:u.organizationId,isActive:true},select:{id:true,username:true,fullName:true},orderBy:{fullName:'asc'}})};}
 async link(u:AuthUser,id:string,d:HrLoginDto){
  try{return await this.db.$transaction(async tx=>{
   const e=await tx.hrEmployee.findFirst({where:{id,organizationId:u.organizationId}});if(!e)throw new NotFoundException();
   if(d.userId&&!await tx.user.findFirst({where:{id:d.userId,organizationId:u.organizationId,isActive:true}}))throw new BadRequestException('حساب الدخول غير متاح');
   const changed=await tx.hrEmployee.updateMany({where:{id,version:d.version},data:{loginUserId:d.userId??null,version:{increment:1}}});
   if(!changed.count)throw new ConflictException('حدّث قائمة الموظفين ثم أعد المحاولة');
   await tx.auditLog.create({data:{userId:u.id,action:'hr_login_linked',entityTable:'hr_employees',entityId:id,oldValue:{loginUserId:e.loginUserId},newValue:{loginUserId:d.userId??null}}});
   return {ok:true};
  });}catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')throw new ConflictException('الحساب مرتبط بموظف آخر');throw e;}
 }
 async create(u:AuthUser,d:HrRequestDto){
  const fields=requestFields(d);
  const run=()=>this.db.$transaction(async tx=>{
   const employee=await tx.hrEmployee.findFirst({where:{organizationId:u.organizationId,loginUserId:u.id,active:true}});
   if(!employee)throw new ForbiddenException('اطلب من الإدارة ربط حسابك بملف الموظف النشط');
   const existing=await tx.hrRequest.findUnique({where:{id:d.id}});
   if(existing){
    const same=existing.employeeId===employee.id&&existing.submittedBy===u.id&&existing.kind===fields.kind&&existing.reason===fields.reason&&String(existing.amount??'')===String(fields.amount??'')&&existing.currency===fields.currency&&existing.leaveType===fields.leaveType&&existing.startDate?.getTime()===fields.startDate?.getTime()&&existing.endDate?.getTime()===fields.endDate?.getTime();
    if(!same)throw new ConflictException('معرّف الطلب مستخدم لبيانات مختلفة');return existing;
   }
   const r=await tx.hrRequest.create({data:{id:d.id,employeeId:employee.id,submittedBy:u.id,...fields}});
   await queueHrRequestNotification(tx,r,employee,'created');
   await tx.auditLog.create({data:{userId:u.id,action:'hr_request_submitted',entityTable:'hr_requests',entityId:r.id,newValue:{kind:r.kind,employeeId:employee.id}}});
   return r;
  });
  try{return await run();}catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')return run();throw e;}
 }
 async decide(u:AuthUser,id:string,d:HrDecisionDto){
  if(d.reason.trim().length<3)throw new BadRequestException('اكتب سبب القرار');
  return this.db.$transaction(async tx=>{
   const r=await tx.hrRequest.findFirst({where:{id,employee:{organizationId:u.organizationId}},include:{employee:true}});if(!r)throw new NotFoundException();
   const self=r.employee.loginUserId===u.id;
   if(d.status==='cancelled'){if(!self)throw new ForbiddenException('يمكن للموظف إلغاء طلبه فقط');}
   else if(!u.permissions.includes('hr.requests.review')||self||r.submittedBy===u.id)throw new ForbiddenException('يلزم مسؤول آخر مخول لمراجعة الطلب');
   if(d.status==='approved'&&!r.employee.active)throw new BadRequestException('الموظف غير نشط');
   let plan:Partial<{monthlyInstallment:Prisma.Decimal;installmentStartMonth:string}>={};
   if(d.status==='approved'&&r.kind==='advance'){
    if(!d.monthlyInstallment||!d.installmentStartMonth)throw new BadRequestException('حدد قسط السلفة وشهر بداية الاستقطاع من شاشة الطلبات');
    await tx.$queryRaw`SELECT id FROM hr_employees WHERE id=${r.employeeId}::uuid FOR UPDATE`;
    const salary=await tx.hrSalary.findFirst({where:{employeeId:r.employeeId,effectiveFrom:{lte:new Date(d.installmentStartMonth+'-01T00:00:00Z')}},orderBy:{effectiveFrom:'desc'}});
    const installment=new Prisma.Decimal(d.monthlyInstallment);
    if(!salary||salary.currency!==r.currency)throw new BadRequestException('لا يوجد راتب ساري بنفس عملة السلفة');
    const existing=await tx.hrRequest.findMany({where:{employeeId:r.employeeId,kind:'advance',status:'approved',monthlyInstallment:{not:null}}});
    const history=await tx.hrPayrollApproval.findMany({where:{organizationId:u.organizationId,status:'approved'},select:{snapshot:true}});
    const paid=new Map<string,Prisma.Decimal>();for(const h of history)for(const w of (h.snapshot as any).workspaces??[])if(w.employee.id===r.employeeId)for(const line of w.calculation.automaticInstallmentLines??[])paid.set(line.requestId,(paid.get(line.requestId)??new Prisma.Decimal(0)).plus(line.amount));
    const reserved=existing.reduce((total,a)=>total.plus(Prisma.Decimal.min(a.monthlyInstallment!,Prisma.Decimal.max(0,a.amount!.minus(paid.get(a.id)??0)))),new Prisma.Decimal(0));
    if(installment.lte(0)||installment.gt(r.amount!)||reserved.plus(installment).gt(salary.baseSalary.mul('0.10')))throw new BadRequestException('مجموع الأقساط المعتمدة يتجاوز 10% من الراتب الأساسي أو مبلغ القسط غير صحيح');
    plan={monthlyInstallment:installment,installmentStartMonth:d.installmentStartMonth};
   }
   if(d.status==='approved')await tx.hrEmployee.update({where:{id:r.employeeId},data:{version:{increment:1}}});
   const result=await tx.hrRequest.updateMany({where:{id,status:'pending',version:d.version},data:{...plan,status:d.status,decisionReason:d.reason.trim(),reviewedBy:u.id,reviewedAt:new Date(),version:{increment:1}}});
   if(!result.count)throw new ConflictException('تغيرت حالة الطلب؛ حدّث القائمة');
   await queueHrRequestNotification(tx,{...r,status:d.status},r.employee,'decided');
   await tx.auditLog.create({data:{userId:u.id,action:'hr_request_decided',entityTable:'hr_requests',entityId:id,oldValue:{status:r.status},newValue:{status:d.status,reason:d.reason.trim()}}});
   return tx.hrRequest.findUniqueOrThrow({where:{id}});
  });
 }
}
