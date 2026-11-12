import {BadRequestException,ConflictException,ForbiddenException,Injectable,Logger,NotFoundException,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {AuthUser} from '../common/guards/jwt-auth.guard';
import {orgDateOnly} from '../common/org-time';
import {PrismaService} from '../prisma/prisma.service';
import {createQueuedNotification} from './push-outbox';
import {StaffBroadcastDto} from './employee-messages.dto';

export const STAFF_MESSAGE_KINDS=['staff_broadcast','staff_inactivity'] as const;
export function firstStaffName(name:string){return name.trim().split(/\s+/)[0]||'زميلنا';}
export function inactivityWindow(now:Date){const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Aden',hour:'2-digit',hourCycle:'h23'}).format(now));return hour>=9&&hour<20;}

@Injectable()
export class EmployeeMessagesService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;
  private running=false;
  private readonly logger=new Logger(EmployeeMessagesService.name);
  constructor(private readonly db:PrismaService){}
  onModuleInit(){this.timer=setInterval(()=>void this.runInactivity().catch(e=>this.logger.warn(e.message)),15*60*1000);this.timer.unref();}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  private require(actor:AuthUser,permission:string){if(!actor.permissions.includes(permission))throw new ForbiddenException('لا تملك صلاحية إرسال هذا التذكير أو الرسالة');}
  async recipients(actor:AuthUser){this.require(actor,'notifications.broadcast');return this.db.user.count({where:{organizationId:actor.organizationId,isActive:true}});}

  async remindCustomer(actor:AuthUser,customerId:string,operationId:string){
    this.require(actor,'customers.remind');
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`customer-reminder|${actor.organizationId}|${customerId}`},0))::text`;
      const customer=await tx.customer.findFirst({where:{id:customerId,organizationId:actor.organizationId,status:'active',mergedIntoId:null},select:{id:true,name:true}});
      if(!customer)throw new NotFoundException('العميل غير موجود أو خارج نطاق صلاحيتك');
      const assignment=await tx.customerAssignment.findFirst({where:{customerId,effectiveTo:null,collector:{active:true,user:{organizationId:actor.organizationId,isActive:true}}},orderBy:{effectiveFrom:'desc'},select:{collector:{select:{id:true,userId:true,user:{select:{fullName:true}}}}}});
      if(!assignment)throw new BadRequestException('لا يوجد محصّل نشط مسند لهذا العميل');
      const userId=assignment.collector.userId;
      const previous=await tx.notification.findFirst({where:{userId,kind:'customer_followup_reminder',AND:[{payload:{path:['customerId'],equals:customerId}},{OR:[{payload:{path:['operationId'],equals:operationId}},{createdAt:{gte:new Date(Date.now()-10*60*1000)}}]}]},select:{id:true}});
      if(previous)return {queued:false,alreadySent:true,notificationId:previous.id,collectorName:assignment.collector.user.fullName};
      const notification=await createQueuedNotification(tx,{userId,kind:'customer_followup_reminder',payload:{operationId,customerId,customerName:customer.name,message:`يرجى متابعة العميل ${customer.name}`,senderId:actor.id,href:`/customers/${customerId}`,route:'Customer360'}});
      await tx.auditLog.create({data:{userId:actor.id,action:'customer_followup_reminded',entityTable:'customers',entityId:customerId,newValue:{notificationId:notification.id,recipientId:userId,operationId}}});
      return {queued:true,alreadySent:false,notificationId:notification.id,collectorName:assignment.collector.user.fullName};
    });
  }

  async broadcast(actor:AuthUser,input:StaffBroadcastDto){
    this.require(actor,'notifications.broadcast');
    const title=input.title.trim(),message=input.message.trim();
    if(title.length<3||message.length<3)throw new BadRequestException('اكتب عنوانًا ونصًا واضحين للرسالة');
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`staff-broadcast|${actor.organizationId}|${input.operationId}`},0))::text`;
      const previous=await tx.auditLog.findFirst({where:{action:'staff_broadcast_sent',entityTable:'organizations',entityId:actor.organizationId,newValue:{path:['operationId'],equals:input.operationId}},select:{newValue:true}});
      if(previous){
        const value=previous.newValue as any;
        if(value.title!==title||value.message!==message)throw new ConflictException('استُخدم رقم العملية لرسالة مختلفة');
        return {queued:value.recipients,alreadySent:true};
      }
      const users=await tx.user.findMany({where:{organizationId:actor.organizationId,isActive:true},select:{id:true}});
      if(users.length>500)throw new BadRequestException('عدد المستلمين يتجاوز حد الدفعة؛ راجع المسؤول');
      for(const user of users)await createQueuedNotification(tx,{userId:user.id,kind:'staff_broadcast',payload:{title,message,operationId:input.operationId,popup:true,senderId:actor.id,href:'/notifications'}});
      await tx.auditLog.create({data:{userId:actor.id,action:'staff_broadcast_sent',entityTable:'organizations',entityId:actor.organizationId,newValue:{operationId:input.operationId,recipients:users.length,title,message}}});
      return {queued:users.length,alreadySent:false};
    },{timeout:30000});
  }

  /** Foreground device heartbeat is the usage source; background sync is not counted as user activity. */
  async runInactivity(now=new Date(),dryRun=false){
    if(this.running||!inactivityWindow(now))return {queued:0};
    this.running=true;
    let queued=0;
    try{
      const policies=await this.db.systemSetting.findMany({where:{key:'notifications.inactivity.policy'},select:{organizationId:true,value:true}});
      for(const policy of policies){
        const config=policy.value as any;
        if(!config?.enabled||!config.notBefore||!Number.isFinite(new Date(config.notBefore).getTime())||new Date(config.notBefore)>now)continue;
        const hours=Math.max(24,Math.min(168,Number(config.afterHours)||24));
        const users=await this.db.user.findMany({where:{organizationId:policy.organizationId,isActive:true},select:{id:true,fullName:true,lastLoginAt:true,hrEmployee:{select:{active:true,workDays:true}},deviceSessions:{select:{lastConnectedAt:true},orderBy:{lastConnectedAt:'desc'},take:1}}});
        const usage=await this.db.systemSetting.findMany({where:{organizationId:policy.organizationId,key:{startsWith:'mobile.lastForeground.'}},select:{key:true,value:true}});
        const foreground=new Map(usage.map(item=>[item.key.replace('mobile.lastForeground.',''),new Date(String((item.value as any)?.at??''))]));
        for(const user of users){
          const explicit=foreground.get(user.id);
          const last=explicit&&Number.isFinite(explicit.getTime())?explicit:user.deviceSessions[0]?.lastConnectedAt;
          if(!last||last>new Date(now.getTime()-hours*3600000)||user.hrEmployee?.active===false)continue;
          const day=orgDateOnly(now),dayIndex=new Date(day+'T12:00:00Z').getUTCDay();
          if(user.hrEmployee?.workDays?.length&&!user.hrEmployee.workDays.includes(dayIndex))continue;
          const result=await this.db.$transaction(async tx=>{
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`staff-inactivity|${user.id}|${day}`},0))::text`;
            const current=await tx.mobileDeviceSession.findFirst({where:{userId:user.id},orderBy:{lastConnectedAt:'desc'},select:{lastConnectedAt:true}});
            const active=await tx.user.findFirst({where:{id:user.id,organizationId:policy.organizationId,isActive:true},select:{id:true}});
            const recent=await tx.systemSetting.findUnique({where:{organizationId_key:{organizationId:policy.organizationId,key:`mobile.lastForeground.${user.id}`}},select:{value:true}});
            const stamp=recent?new Date(String((recent.value as any)?.at??'')):current?.lastConnectedAt;
            if(!active||!stamp||!Number.isFinite(stamp.getTime())||stamp>new Date(now.getTime()-hours*3600000))return false;
            const exists=await tx.notification.findFirst({where:{userId:user.id,kind:'staff_inactivity',createdAt:{gte:new Date(now.getTime()-24*3600000)}},select:{id:true}});
            if(exists)return false;
            if(!dryRun)await createQueuedNotification(tx,{userId:user.id,kind:'staff_inactivity',payload:{title:`ننتظر نشاطك يا ${firstStaffName(user.fullName)}`,message:`${firstStaffName(user.fullName)}، خطوة اليوم تصنع فرقًا. افتح التطبيق وابدأ بمتابعة أحد عملائك.`,route:'Main',href:'/dashboard',reminderDate:day}});
            return true;
          });
          if(result)queued++;
        }
      }
      return {queued,dryRun};
    }finally{this.running=false;}
  }
}
