import {HrTaskAttachmentsService} from './hr-task-attachments.service';
import {queueHrTaskNotification} from './hr-task-notifications';
import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {createHash} from 'crypto';
import {PrismaService} from '../prisma/prisma.service';
import {AuthUser} from '../common/guards/jwt-auth.guard';
import {HrTaskActionDto,HrTaskDto} from './hr-tasks.dto';
import {adenDate,validDay} from './hr-attendance.service';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function taskTransition(status:string,action:string,rating?:number){
 const allowed:Record<string,string[]>={submit:['assigned','returned'],complete:['submitted'],return:['submitted'],cancel:['assigned','returned','submitted']};
 if(!allowed[action]?.includes(status))throw new ConflictException('تغيرت حالة المهمة؛ حدّث القائمة');
 if(action==='complete'&&(!Number.isInteger(rating)||rating!<1||rating!>5))throw new BadRequestException('اختر تقييمًا من 1 إلى 5');
 if(action!=='complete'&&rating!=null)throw new BadRequestException('التقييم عند اعتماد الإنجاز فقط');
 return {submit:'submitted',complete:'completed',return:'returned',cancel:'cancelled'}[action]!;
}
@Injectable()
export class HrTasksService {
 constructor(private readonly db:PrismaService,private readonly files:HrTaskAttachmentsService=new HrTaskAttachmentsService(db)){}
 async mine(u:AuthUser){const employee=await this.db.hrEmployee.findFirst({where:{organizationId:u.organizationId,loginUserId:u.id,active:true},select:{id:true,fullName:true,employeeNo:true}});return {employee,today:adenDate(new Date()),assignments:employee?await this.db.hrTaskAssignment.findMany({where:{employeeId:employee.id,task:{organizationId:u.organizationId}},include:{task:true},orderBy:[{task:{dueDate:'asc'}},{id:'asc'}]}):[]};}
 async admin(u:AuthUser){return {today:adenDate(new Date()),employees:await this.db.hrEmployee.findMany({where:{organizationId:u.organizationId,active:true},select:{id:true,employeeNo:true,fullName:true,loginUserId:true},orderBy:{employeeNo:'asc'}}),tasks:await this.db.hrTask.findMany({where:{organizationId:u.organizationId},include:{assignments:{include:{employee:{select:{id:true,employeeNo:true,fullName:true,loginUserId:true}}}}},orderBy:[{dueDate:'desc'},{createdAt:'desc'}]})};}
 async create(u:AuthUser,d:HrTaskDto){
  if(d.title.trim().length<3)throw new BadRequestException('اكتب عنوانًا واضحًا للمهمة');const dueDate=validDay(d.dueDate);
  const fields={title:d.title.trim(),description:d.description.trim(),dueDate:d.dueDate,employeeIds:[...d.employeeIds].sort(),...(d.attachmentIds?.length?{attachmentIds:[...d.attachmentIds].sort()}:{})},creationHash=hash(fields);
  const run=()=>this.db.$transaction(async tx=>{
   const old=await tx.hrTask.findUnique({where:{id:d.id},include:{assignments:true}});if(old){if(old.organizationId!==u.organizationId||old.createdBy!==u.id||old.creationHash!==creationHash)throw new ConflictException('معرّف المهمة مستخدم لبيانات أخرى');return old;}
   const employees=await tx.hrEmployee.findMany({where:{id:{in:d.employeeIds},organizationId:u.organizationId,active:true,loginUserId:{not:null}},select:{id:true}});if(employees.length!==d.employeeIds.length)throw new BadRequestException('اختر موظفين نشطين مرتبطين بحسابات الدخول');
   const task=await tx.hrTask.create({data:{id:d.id,organizationId:u.organizationId,createdBy:u.id,title:fields.title,description:fields.description,dueDate,creationHash,assignments:{create:employees.map(e=>({employeeId:e.id}))}},include:{assignments:true}});
   await this.files.bind(tx,u,d.attachmentIds??[],'instruction',task.id);
   for(const assignment of task.assignments)await queueHrTaskNotification(tx,u.organizationId,u.id,task.id,assignment,'assigned');
   await tx.auditLog.create({data:{userId:u.id,action:'hr_task_created',entityTable:'hr_tasks',entityId:task.id,newValue:{attachmentIds:d.attachmentIds??[],employeeIds:d.employeeIds,dueDate:d.dueDate,title:fields.title}}});return task;
  });try{return await run();}catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')return run();throw e;}
 }
 async action(u:AuthUser,id:string,d:HrTaskActionDto){
  if(d.action!=='submit'&&d.attachmentIds?.length)throw new BadRequestException('المرفقات عند إرسال الإنجاز فقط');
  if(d.note.trim().length<3)throw new BadRequestException('اكتب ملاحظات الإنجاز أو المراجعة');const fingerprint=hash({actor:u.id,action:d.action,note:d.note.trim(),rating:d.rating??null,version:d.version,...(d.attachmentIds?.length?{attachmentIds:[...d.attachmentIds].sort()}:{})});
  return this.db.$transaction(async tx=>{
   const r=await tx.hrTaskAssignment.findFirst({where:{id,task:{organizationId:u.organizationId}},include:{employee:true}});if(!r)throw new NotFoundException();
   if(d.action==='submit'){if(r.employee.loginUserId!==u.id||!r.employee.active)throw new ForbiddenException('يمكن للموظف المسندة له المهمة إرسال إنجازها فقط');}
   else if(!u.permissions.includes('hr.tasks.manage')||r.employee.loginUserId===u.id)throw new ForbiddenException('يلزم مسؤول آخر مخول لمراجعة المهمة');
   if(r.lastOperationId===d.operationId){if(r.lastOperationHash!==fingerprint)throw new ConflictException('معرّف العملية مستخدم لبيانات مختلفة');return r;}
   const status=taskTransition(r.status,d.action,d.rating),now=new Date();
   const data=d.action==='submit'?{status,completionNote:d.note.trim(),submittedAt:now,rating:null}:{status,reviewNote:d.note.trim(),rating:d.action==='complete'?d.rating:null,reviewedBy:u.id,reviewedAt:now};
   const updated=await tx.hrTaskAssignment.updateMany({where:{id,version:d.version,status:r.status},data:{...data,version:{increment:1},lastOperationId:d.operationId,lastOperationHash:fingerprint}});
   if(!updated.count){const latest=await tx.hrTaskAssignment.findUniqueOrThrow({where:{id}});if(latest.lastOperationId===d.operationId&&latest.lastOperationHash===fingerprint)return latest;throw new ConflictException('تم تعديل المهمة؛ حدّث القائمة');}
   if(d.action==='submit')await this.files.bind(tx,u,d.attachmentIds??[],'completion',id,d.version+1);
   await queueHrTaskNotification(tx,u.organizationId,u.id,r.taskId,r,d.action as 'submit'|'complete'|'return'|'cancel');
   await tx.auditLog.create({data:{userId:u.id,action:'hr_task_'+d.action,entityTable:'hr_task_assignments',entityId:id,oldValue:{status:r.status,completionNote:r.completionNote,reviewNote:r.reviewNote,rating:r.rating},newValue:{attachmentIds:d.attachmentIds??[],status,note:d.note.trim(),rating:d.rating??null}}});return tx.hrTaskAssignment.findUniqueOrThrow({where:{id}});
  });
 }
}
