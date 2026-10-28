import {Injectable,Logger,OnModuleInit,OnModuleDestroy} from '@nestjs/common';
import {PrismaService} from '../prisma/prisma.service';
import {pushMessage} from '../notifications/push-message';
import {pushDevicesForKind,pushSoundForDevice} from '../notifications/push-application';
type Target={deviceId?:string;ticketId?:string;state:'waiting'|'accepted'|'provider_delivered'|'failed';error?:string};
@Injectable()
export class HrPushService implements OnModuleInit,OnModuleDestroy {
 private timer?:ReturnType<typeof setInterval>;
 private running=false;
 private readonly logger=new Logger(HrPushService.name);
 constructor(private readonly db:PrismaService){}
 onModuleInit(){this.timer=setInterval(()=>void this.dispatch(),5000);this.timer.unref();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 private async expo(path:string,body:unknown){
  const response=await fetch('https://exp.host/--/api/v2/push/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(process.env.EXPO_ACCESS_TOKEN?{Authorization:`Bearer ${process.env.EXPO_ACCESS_TOKEN}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('ExpoHttp'+response.status);
  const result=await response.json() as any;
  if(!result.data)throw new Error('IncompletePushResponse');
  return result.data;
 }
 private async removeInvalid(target:Target,userId:string){
  if(target.deviceId&&target.error==='DeviceNotRegistered')await this.db.devicePushToken.deleteMany({where:{id:target.deviceId,userId}});
 }
 async dispatch(){
  if(this.running||process.env.PUSH_ENABLED!=='true')return;
  this.running=true;
  try{
   await this.db.hrPushDelivery.updateMany({where:{status:'queued',attempts:{gte:8}},data:{status:'failed'}});
   const rows=await this.db.hrPushDelivery.findMany({where:{status:{in:['queued','accepted']},nextAttempt:{lte:new Date()}},take:20,orderBy:{nextAttempt:'asc'}});
   for(const row of rows){
    const claim=await this.db.hrPushDelivery.updateMany({where:{id:row.id,status:row.status,nextAttempt:{lte:new Date()}},data:{nextAttempt:new Date(Date.now()+120000),...(row.status==='queued'?{attempts:{increment:1}}:{})}});
    if(!claim.count)continue;
    const previous=(row.result??{}) as any;
    let targets:Target[]=previous.targets??(previous.tickets??[]).map((t:any)=>({ticketId:t.id,state:t.status==='ok'?'accepted':'failed',error:t.error}));
    const acceptedAt=previous.acceptedAt??new Date().toISOString();
    try{
     const user=await this.db.user.findUnique({where:{id:row.userId},select:{isActive:true}});
     if(!user?.isActive){await this.db.hrPushDelivery.update({where:{id:row.id},data:{status:'inactive'}});continue;}
     if(row.status==='queued'){
      const registered=await this.db.devicePushToken.findMany({where:{userId:row.userId},select:{id:true,token:true,applicationId:true,notificationChannelId:true}});
      const devices=pushDevicesForKind(row.kind,registered,row.payload as Record<string,unknown>);
      if(!targets.length)targets=devices.map(d=>({deviceId:d.id,state:'waiting'}));
      if(!targets.length){await this.db.hrPushDelivery.update({where:{id:row.id},data:{status:row.attempts>=7?'failed':'queued',result:{error:'NoRegisteredDevice'},nextAttempt:new Date(Date.now()+300000)}});continue;}
      const payload=row.payload as any,content=pushMessage(row.kind,payload);
      const waiting=targets.filter(t=>t.state==='waiting');
      // Expo requires each send batch to belong to one project/application.
      const groups=[...new Set(waiting.map(t=>devices.find(d=>d.id===t.deviceId)?.applicationId??'com.albinaa.collector'))].map(app=>waiting.filter(t=>(devices.find(d=>d.id===t.deviceId)?.applicationId??'com.albinaa.collector')===app));
      for(const group of groups) for(let start=0;start<group.length;start+=100){
       const batch=group.slice(start,start+100).filter(t=>{if(devices.some(d=>d.id===t.deviceId))return true;t.state='failed';t.error='DeviceRemoved';return false;});
       if(!batch.length)continue;
       const data=await this.expo('send',batch.map(t=>{const device=devices.find(d=>d.id===t.deviceId)!;return {to:device.token,title:payload.title??content.title,body:payload.message??content.body,...pushSoundForDevice(device,row.kind),data:{...payload,kind:row.kind,notificationId:row.id}};}));
       if(!Array.isArray(data)||data.length!==batch.length)throw new Error('IncompletePushResponse');
       for(let i=0;i<batch.length;i++){
        const ticket=data[i],target=batch[i];
        if(ticket.status==='ok'&&ticket.id){target.state='accepted';target.ticketId=ticket.id;delete target.error;}
        else{target.error=ticket.details?.error??'InvalidPushTicket';target.state=['MessageRateExceeded','ProviderError'].includes(target.error!)&&row.attempts<7?'waiting':'failed';await this.removeInvalid(target,row.userId);}
       }
       // Persist accepted batches; a retry must not resend their notifications.
       await this.db.hrPushDelivery.update({where:{id:row.id},data:{result:{targets:targets as any,acceptedAt}}});
      }
     }
     const pending=targets.filter(t=>t.state==='accepted'&&t.ticketId);
     if(row.status==='accepted'&&pending.length){
      const receipts=await this.expo('getReceipts',{ids:pending.map(t=>t.ticketId)});
      for(const target of pending){const receipt=receipts[target.ticketId!];if(!receipt)continue;
       target.state=receipt.status==='ok'?'provider_delivered':'failed';
       if(receipt.status!=='ok'){target.error=receipt.details?.error??'ReceiptError';await this.removeInvalid(target,row.userId);}
      }
     }
     const hasWaiting=targets.some(t=>t.state==='waiting'),hasAccepted=targets.some(t=>t.state==='accepted'),hasFailed=targets.some(t=>t.state==='failed');
     // Provider receipts do not prove display or that the user read the notification.
     let status=hasWaiting?'queued':hasAccepted?'accepted':hasFailed?(targets.some(t=>t.state==='provider_delivered')?'partial_failed':'failed'):'provider_delivered';
     if(hasAccepted&&!hasWaiting&&Date.now()-Date.parse(acceptedAt)>24*60*60*1000)status='receipt_unknown';
     await this.db.hrPushDelivery.update({where:{id:row.id},data:{status,result:{targets:targets as any,acceptedAt},nextAttempt:new Date(Date.now()+(hasWaiting?Math.min(300000,15000*2**row.attempts):60000))}});
    }catch(error){
     const message=error instanceof Error?error.message:'PushFailure';
     const permanent=/^ExpoHttp4\d\d$/.test(message)&&message!=='ExpoHttp429';
     if(row.status==='queued'&&(row.attempts>=7||permanent))for(const t of targets)if(t.state==='waiting'){t.state='failed';t.error=message;}
     const waiting=targets.some(t=>t.state==='waiting'),accepted=targets.some(t=>t.state==='accepted');
     const expired=Date.now()-Date.parse(acceptedAt)>24*60*60*1000;
     const status=waiting?'queued':accepted?(expired?'receipt_unknown':'accepted'):row.status==='accepted'?'receipt_unknown':row.attempts>=7||permanent?'failed':'queued';
     await this.db.hrPushDelivery.update({where:{id:row.id},data:{status,result:{targets:targets as any,acceptedAt,error:message},nextAttempt:new Date(Date.now()+Math.min(300000,15000*2**row.attempts))}});
    }
   }
  }catch(error){this.logger.error('Notification delivery failed',error instanceof Error?error.message:'unknown');}
  finally{this.running=false;}
 }
}
