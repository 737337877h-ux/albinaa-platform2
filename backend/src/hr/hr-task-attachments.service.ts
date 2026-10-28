import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {createHash} from 'crypto';
import JSZip from 'jszip';
import {IsIn,IsUUID} from 'class-validator';
import {PrismaService} from '../prisma/prisma.service';
import {AuthUser} from '../common/guards/jwt-auth.guard';
export class TaskAttachmentDto {@IsUUID() id!:string;@IsIn(['instruction','completion']) purpose!:'instruction'|'completion';@IsUUID() targetId!:string;}
export const taskAttachmentSelect={id:true,name:true,mime:true,size:true,purpose:true,taskId:true,assignmentId:true,submissionVersion:true,createdAt:true} as const;
export async function taskFileType(b:Buffer,name:string){
 const ext=name.split('.').pop()?.toLowerCase();
 if(['jpg','jpeg'].includes(ext??'')&&b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';
 if(ext==='png'&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(ext==='webp'&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP')return 'image/webp';
 if(ext==='pdf'&&b.subarray(0,5).toString()==='%PDF-')return 'application/pdf';
 if(ext==='xls'&&b.subarray(0,8).equals(Buffer.from([208,207,17,224,161,177,26,225])))return 'application/vnd.ms-excel';
 if(ext==='xlsx'&&b.subarray(0,2).toString()==='PK'){try{const zip=await JSZip.loadAsync(b);if(zip.file('[Content_Types].xml')&&zip.file('xl/workbook.xml'))return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';}catch{}}
 throw new BadRequestException('الملف غير مدعوم أو محتواه لا يطابق نوعه. اختر صورة JPG/PNG/WebP أو PDF أو Excel XLS/XLSX');
}
@Injectable()
export class HrTaskAttachmentsService {
 constructor(private readonly db:PrismaService){}
 async upload(u:AuthUser,d:TaskAttachmentDto,file:Express.Multer.File){
 if(!file?.buffer.length||file.buffer.length>10*1024*1024)throw new BadRequestException('حجم المرفق يجب أن يكون بين 1 بايت و10 ميجابايت');
 const decoded=Buffer.from(file.originalname,'latin1').toString('utf8');const original=/[^\u0000-\u00ff]/.test(file.originalname)||decoded.includes('�')?file.originalname:decoded;
 const name=original.replace(/[\x00-\x1f\/\\]/g,'_').slice(-180),mime=await taskFileType(file.buffer,name),digest=createHash('sha256').update(file.buffer).digest('hex');
 const run=()=>this.db.$transaction(async tx=>{
 if(d.purpose==='instruction'){if(!u.permissions.includes('hr.tasks.manage'))throw new ForbiddenException();}
 else {const a=await tx.hrTaskAssignment.findFirst({where:{id:d.targetId,task:{organizationId:u.organizationId},employee:{loginUserId:u.id,active:true}}});if(!a)throw new ForbiddenException('المهمة غير مسندة لحسابك');}
 await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${u.id+':task-uploads'},0))::text`;
 const old=await tx.hrTaskAttachment.findUnique({where:{id:d.id}});if(old){if(old.organizationId!==u.organizationId||old.uploadedBy!==u.id||old.targetId!==d.targetId||old.purpose!==d.purpose||old.digest!==digest||old.name!==name)throw new ConflictException('معرف المرفق مستخدم لملف آخر');return Object.fromEntries(Object.keys(taskAttachmentSelect).map(k=>[k,(old as any)[k]]));}
 if(d.purpose==='completion'){const current=await tx.hrTaskAssignment.findUniqueOrThrow({where:{id:d.targetId}});if(!['assigned','returned'].includes(current.status))throw new ConflictException('يمكن إرفاق الإنجاز قبل إرساله للمراجعة فقط');}
 const quota=await tx.hrTaskAttachment.aggregate({where:{uploadedBy:u.id,taskId:null,assignmentId:null},_sum:{size:true}});if((quota._sum.size??0)+file.buffer.length>100*1024*1024)throw new BadRequestException('المرفقات غير المرسلة تجاوزت 100 ميجابايت؛ احذف الملفات المؤقتة أو أرسل المهمة');
 return tx.hrTaskAttachment.create({data:{...d,organizationId:u.organizationId,uploadedBy:u.id,name,mime,digest,size:file.buffer.length,content:new Uint8Array(file.buffer)},select:taskAttachmentSelect});});
 try{return await run();}catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')return run();throw e;}
 }
 async bind(tx:Prisma.TransactionClient,u:AuthUser,ids:string[],purpose:string,targetId:string,version?:number){
 if(ids.length>5||new Set(ids).size!==ids.length)throw new BadRequestException('الحد الأقصى 5 مرفقات دون تكرار');
 if(!ids.length)return;
 const result=await tx.hrTaskAttachment.updateMany({where:{id:{in:ids},organizationId:u.organizationId,uploadedBy:u.id,purpose,targetId,taskId:null,assignmentId:null},data:purpose==='instruction'?{taskId:targetId}:{assignmentId:targetId,submissionVersion:version}});
 if(result.count!==ids.length)throw new BadRequestException('بعض المرفقات لا تخص هذه العملية أو سبق إرسالها');
 }
 async download(u:AuthUser,id:string){const a=await this.db.hrTaskAttachment.findFirst({where:{id,organizationId:u.organizationId},select:{...taskAttachmentSelect,uploadedBy:true}});if(!a)throw new NotFoundException();let allowed=false;
 if(!a.taskId&&!a.assignmentId)allowed=a.uploadedBy===u.id;
 else if(u.permissions.includes('hr.tasks.manage'))allowed=true;
 else if(a.assignmentId)allowed=!!await this.db.hrTaskAssignment.findFirst({where:{id:a.assignmentId,task:{organizationId:u.organizationId},employee:{loginUserId:u.id,active:true}}});
 else if(a.taskId)allowed=!!await this.db.hrTaskAssignment.findFirst({where:{taskId:a.taskId,task:{organizationId:u.organizationId},employee:{loginUserId:u.id,active:true}}});
 if(!allowed)throw new ForbiddenException('المرفق متاح للمسؤول والموظف المعني فقط');
 const file=await this.db.hrTaskAttachment.findUniqueOrThrow({where:{id}});return {name:file.name,mime:file.mime,base64:Buffer.from(file.content).toString('base64')};
 }
 async removeDraft(u:AuthUser,id:string){const result=await this.db.hrTaskAttachment.deleteMany({where:{id,organizationId:u.organizationId,uploadedBy:u.id,taskId:null,assignmentId:null}});if(!result.count)throw new ConflictException('المرفق مرسل أو غير متاح للحذف');return {ok:true};}
 async decorateMine(result:any){const ids=result.assignments.map((a:any)=>a.id),tasks=result.assignments.map((a:any)=>a.taskId);const files=await this.db.hrTaskAttachment.findMany({where:{OR:[{taskId:{in:tasks}},{assignmentId:{in:ids}}]},select:taskAttachmentSelect,orderBy:{createdAt:'asc'}});return {...result,assignments:result.assignments.map((a:any)=>({...a,attachments:files.filter(f=>f.assignmentId===a.id),task:{...a.task,attachments:files.filter(f=>f.taskId===a.taskId)}}))};}
 async decorateAdmin(result:any){const tasks=result.tasks.map((t:any)=>t.id),ids=result.tasks.flatMap((t:any)=>t.assignments.map((a:any)=>a.id));const files=await this.db.hrTaskAttachment.findMany({where:{OR:[{taskId:{in:tasks}},{assignmentId:{in:ids}}]},select:taskAttachmentSelect,orderBy:{createdAt:'asc'}});return {...result,tasks:result.tasks.map((t:any)=>({...t,attachments:files.filter(f=>f.taskId===t.id),assignments:t.assignments.map((a:any)=>({...a,attachments:files.filter(f=>f.assignmentId===a.id)}))}))};}
}
