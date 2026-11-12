import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {PrismaService} from '../prisma/prisma.service';
import {orgDateOnly,orgYear} from '../common/org-time';

type Check={id:string;title:string;status:'ready'|'review';message:string;checkedAt?:Date|null};
@Injectable()
export class YearReadinessService {
 constructor(private readonly db:PrismaService,private readonly config:ConfigService){}
 private async gateway(schema:string){
  const base=this.config.get<string>('ORACLE_READ_API_URL')?.trim().replace(/\/$/,''),key=this.config.get<string>('ORACLE_READ_API_KEY');
  if(!base)return {ready:false,readOnly:false};
  try{
   const response=await fetch(`${base}/health`,{headers:key?{Authorization:`Bearer ${key}`}:{},signal:AbortSignal.timeout(3500)});
   const data=await response.json() as any;
   return {ready:response.ok&&data.status==='ok'&&data.mode==='SELECT_ONLY'&&data.schema===schema,readOnly:data.mode==='SELECT_ONLY'};
  }catch{return {ready:false,readOnly:false};}
 }
 async inspect(organizationId:string){
  const schema=this.config.get<string>('ORACLE_READ_SCHEMA')?.trim().toUpperCase()||'IAS20261';
  const customer=await this.db.oracleCustomerSyncRun.findFirst({where:{organizationId,sourceSchema:schema,status:'published'},orderBy:{startedAt:'desc'},select:{publishedAt:true,startedAt:true}});
  const inventory=await this.db.oracleInventoryActiveSnapshot.findUnique({where:{organizationId_sourceSchema:{organizationId,sourceSchema:schema}},select:{activatedAt:true}});
  const movements=await this.db.oracleMovementSyncRun.findFirst({where:{organizationId,sourceSchema:schema,status:'published'},orderBy:{startedAt:'desc'},select:{publishedAt:true,startedAt:true}});
  const policy=await this.db.hrAttendancePolicy.findUnique({where:{organizationId},select:{startDate:true,version:true}});
  const gateway=await this.gateway(schema),attendance=policy?.startDate.toISOString().slice(0,10)==='2027-01-01';
  const currentYear=Number(/^IAS(\d{4})\d*$/.exec(schema)?.[1]??0)||null;
  const checks:Check[]=[
   {id:'current-gateway',title:'بوابة المصدر الحالي',status:gateway.ready?'ready':'review',message:gateway.ready?'الاتصال متاح للقراءة فقط والمصدر مطابق للإعداد':'تحتاج البوابة إلى مراجعة الاتصال أو تطابق المصدر'},
   {id:'customers',title:'لقطة العملاء والأرصدة الحالية',status:customer?'ready':'review',message:customer?'توجد لقطة منشورة للمصدر الحالي':'لم تُعثر على لقطة منشورة للمصدر الحالي',checkedAt:customer?.publishedAt??customer?.startedAt},
   {id:'inventory',title:'لقطة المخزون الحالية',status:inventory?'ready':'review',message:inventory?'توجد لقطة مخزون فعالة':'تحتاج لقطة المخزون الفعالة إلى مراجعة',checkedAt:inventory?.activatedAt},
   {id:'movements',title:'لقطة الحركات الحالية',status:movements?'ready':'review',message:movements?'توجد لقطة حركات منشورة':'تحتاج لقطة الحركات إلى مراجعة',checkedAt:movements?.publishedAt??movements?.startedAt},
   {id:'attendance',title:'بداية احتساب الحضور والخصومات',status:attendance?'ready':'review',message:attendance?'مضبوطة على 1 يناير 2027':`البداية الحالية: ${policy?.startDate.toISOString().slice(0,10)??'غير محددة'}؛ تحتاج مراجعة`},
   {id:'numbering',title:'ترقيم السندات عند بداية السنة',status:orgYear(new Date('2026-12-31T21:00:00Z'))===2027?'ready':'review',message:'يعتمد ترقيم المنصة على سنة عدن، مع تسلسل مستقل لكل فرع وسنة'},
   {id:'next-source',title:'اعتماد مصدر Oracle لسنة 2027',status:'review',message:'يلزم تحديد المصدر الفعلي وفحص صلاحية قراءته واعتماد ربطه. فحص الجاهزية لا يبدّل مصدر التشغيل'},
   {id:'continuity',title:'مطابقة الأرصدة والحجوزات والكشوف',status:'review',message:'راجع الأرصدة الافتتاحية لكل عملة والحجوزات المتبقية واستمرارية الكشوف والتحصيل بين السنتين قبل التحويل'},
   {id:'staff',title:'استمرارية الرواتب والإجازات',status:'review',message:'راجع استحقاقات الرواتب والمسحوبات والأقساط ورصيد الإجازات المستمر، مع اعتماد التسويات الافتتاحية اللازمة'},
   {id:'mobile',title:'اختبار التطبيقين على الهاتف',status:'review',message:'اختبر تاريخ بداية السنة والتحصيلات والوعود والمزامنة والصلاحيات على النسختين قبل اعتماد الانتقال'},
  ];
  return {targetYear:2027,currentSource:schema,currentSourceYear:currentYear,checkedAt:new Date(),organizationDate:orgDateOnly(),ready:false,sourceChanged:false,oracleWriteAttempted:false,attendanceStart:policy?.startDate??null,checks};
 }
}
