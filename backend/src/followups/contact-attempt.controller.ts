import { BadRequestException, Body, Controller, Injectable, Logger, OnModuleInit, OnModuleDestroy, Post, ForbiddenException } from '@nestjs/common';
import { IsDateString, IsIn, IsUUID, isUUID, ValidateBy } from 'class-validator';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireAnyPermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { orgDateOnly } from '../common/org-time';

// Older mobile releases use base36 timestamp/random keys. Preserve their retry identity.
const LEGACY_CONTACT_ID = /^[a-z0-9]{8,12}-[a-z0-9]{1,8}$/;
export function isContactOperationId(value: unknown): boolean {
 return typeof value === 'string' && (isUUID(value) || LEGACY_CONTACT_ID.test(value));
}
export function normalizeContactOperationId(value: string, organizationId: string, userId: string): string {
 if(!LEGACY_CONTACT_ID.test(value))return value;
 // UUID v5, with a fixed namespace and tenant/user scope, for deterministic retries.
 const namespace=Buffer.from('b1fa99274dfb5b6784a3d2677d79ccf0','hex');
 const bytes=createHash('sha1').update(namespace).update(JSON.stringify([organizationId,userId,value])).digest().subarray(0,16);
 bytes[6]=(bytes[6]&0x0f)|0x50; bytes[8]=(bytes[8]&0x3f)|0x80;
 const hex=bytes.toString('hex');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export class ContactAttemptDto {
 @ValidateBy({name:'isContactOperationId',validator:{validate:isContactOperationId,defaultMessage:()=> 'operationId must be a UUID or a legacy mobile operation ID'}}) operationId!: string;
 @IsUUID() customerId!: string;
 @IsIn(['call','sms','whatsapp']) channel!: string;
 @IsDateString() occurredAt!: string;
}
export function contactDueDate(at: Date) { const d=new Date(orgDateOnly(at)+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+7);return d; }

@Injectable()
export class ContactAttemptService implements OnModuleInit, OnModuleDestroy {
 private timer?: NodeJS.Timeout;
 private busy=false;
 private readonly logger=new Logger(ContactAttemptService.name);
 constructor(private readonly db:PrismaService){}
 onModuleInit(){this.timer=setInterval(()=>void this.process(),30000);this.timer.unref();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 private async snapshot(tx:any,customerId:string,userId:string,collectorId:string|null){
  const [followups,tasks,promises]=await Promise.all([
   tx.followup.findMany({where:{customerId,userId,deletedAt:null},orderBy:{followupAt:'desc'},take:100,select:{id:true,resultId:true,notes:true,nextFollowupDate:true,followupAt:true}}),
   tx.task.findMany({where:{customerId,OR:[{createdBy:userId},...(collectorId?[{assignedTo:collectorId}]:[])]},orderBy:{createdAt:'desc'},take:100,select:{id:true,status:true,createdAt:true,dueDate:true,priorityReason:true}}),
   collectorId?tx.paymentPromise.findMany({where:{customerId,collectorId},orderBy:{createdAt:'desc'},take:100,select:{id:true,status:true,createdAt:true,dueDate:true}}):[],
  ]);
  return {hash:createHash('sha256').update(JSON.stringify({followups,tasks,promises})).digest('hex'),latest:Math.max(0,...followups.map((x:any)=>+x.followupAt),...tasks.map((x:any)=>+x.createdAt),...promises.map((x:any)=>+x.createdAt))};
 }
 async register(actor:AuthUser,dto:ContactAttemptDto){
  const operationId=normalizeContactOperationId(dto.operationId,actor.organizationId,actor.id);
  const occurredAt=new Date(dto.occurredAt);
  if(+occurredAt>Date.now()+120000)throw new BadRequestException('توقيت المحاولة متقدم على وقت الخادم');
  const collector=await this.db.collector.findUnique({where:{userId:actor.id}});
  const customer=await this.db.customer.findFirst({where:{id:dto.customerId,organizationId:actor.organizationId,...(!actor.permissions.includes('customers.read_all')?{assignments:{some:{collectorId:collector?.id??'00000000-0000-0000-0000-000000000000',effectiveTo:null}}}:{})}});
  if(!customer)throw new ForbiddenException('العميل خارج نطاق صلاحيتك');
  return this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actor.id+dto.customerId},0))::text`;
   const prior=await tx.$queryRaw<any[]>`SELECT id,status FROM contact_attempts WHERE organization_id=${actor.organizationId}::uuid AND user_id=${actor.id}::uuid AND (id=${operationId}::uuid OR (customer_id=${dto.customerId}::uuid AND status='pending')) LIMIT 1`;
   if(prior[0])return prior[0];
   const assignment=await tx.customerAssignment.findFirst({where:{customerId:dto.customerId,effectiveTo:null},orderBy:{effectiveFrom:'desc'}});
   const taskCollector=assignment?.collectorId??null;
   const state=await this.snapshot(tx,dto.customerId,actor.id,taskCollector);
   const status=state.latest>=+occurredAt?'suppressed':'pending';
   await tx.$executeRaw`INSERT INTO contact_attempts(id,organization_id,user_id,customer_id,collector_id,channel,occurred_at,due_at,baseline,status) VALUES(${operationId}::uuid,${actor.organizationId}::uuid,${actor.id}::uuid,${dto.customerId}::uuid,${taskCollector}::uuid,${dto.channel},${occurredAt},now()+interval '10 minutes',${state.hash},${status})`;
   return {id:operationId,status};
  });
 }
 async process(){
  if(this.busy)return;this.busy=true;
  try{
   for(let n=0;n<50;n++){
    const found=await this.db.$transaction(async tx=>{
     const rows=await tx.$queryRaw<any[]>`SELECT * FROM contact_attempts WHERE status='pending' AND due_at<=now() ORDER BY due_at FOR UPDATE SKIP LOCKED LIMIT 1`;
     const event=rows[0];if(!event)return false;
     const user=await tx.user.findFirst({where:{id:event.user_id,organizationId:event.organization_id,isActive:true}});
     const customer=await tx.customer.findFirst({where:{id:event.customer_id,organizationId:event.organization_id}});
     const state=await this.snapshot(tx,event.customer_id,event.user_id,event.collector_id);
     let status='suppressed';
     if(user&&customer&&state.hash===event.baseline){
      const current=await tx.customerAssignment.findFirst({where:{customerId:event.customer_id,effectiveTo:null},orderBy:{effectiveFrom:'desc'}});
      const collectorId=event.collector_id??current?.collectorId??null;
      // Do not assign follow-ups to a former collector after reassignment.
      if(!event.collector_id||current?.collectorId===event.collector_id){
       const type=await tx.followupType.upsert({where:{organizationId_name:{organizationId:event.organization_id,name:'محاولة تواصل تلقائية'}},update:{},create:{organizationId:event.organization_id,name:'محاولة تواصل تلقائية'}});
       const result=await tx.followupResult.upsert({where:{organizationId_name:{organizationId:event.organization_id,name:'لم تُسجل نتيجة التواصل'}},update:{},create:{organizationId:event.organization_id,name:'لم تُسجل نتيجة التواصل'}});
       const due=contactDueDate(event.occurred_at);
       await tx.followup.create({data:{customerId:event.customer_id,userId:event.user_id,typeId:type.id,resultId:result.id,followupAt:event.occurred_at,nextFollowupDate:due,notes:`تسجيل تلقائي بعد مهلة 10 دقائق دون متابعة أو مهمة أو وعد. فتح ${event.channel==='call'?'الاتصال':event.channel==='sms'?'الرسائل النصية':'واتساب'}؛ لا يؤكد الرد أو إرسال الرسالة. مرجع: ${event.id}`}});
       const existing=await tx.task.findFirst({where:{customerId:event.customer_id,assignedTo:collectorId,status:'open',dueDate:due}});
       if(!existing)await tx.task.create({data:{customerId:event.customer_id,assignedTo:collectorId,createdBy:event.user_id,taskType:'followup_due',dueDate:due,priorityReason:'متابعة تلقائية بعد محاولة تواصل دون نتيجة مسجلة'}});
       status='completed';
      }
     }
     await tx.$executeRaw`UPDATE contact_attempts SET status=${status},finished_at=now() WHERE id=${event.id}::uuid`;
     return true;
    });
    if(!found)break;
   }
  }catch{this.logger.error('Contact attempt processing failed; pending records retained for retry');}
  finally{this.busy=false;}
 }
}

@Controller('followups/contact-attempts')
export class ContactAttemptController {
 constructor(private readonly service:ContactAttemptService){}
 @Post() @RequireAnyPermissions('customers.read','mobile.customers.view')
 create(@CurrentUser() actor:AuthUser,@Body() dto:ContactAttemptDto){return this.service.register(actor,dto);}
}
