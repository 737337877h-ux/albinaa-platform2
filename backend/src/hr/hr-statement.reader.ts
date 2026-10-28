import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';

export type HrMovement={id:string;date:string;documentType:string;documentNumber:string;serial:string;description:string;currency:string;debit:string;credit:string};
export type HrStatement={month:string;kind:string;readAt:string;snapshotHash:string;total:number;items:HrMovement[];balances:{currency:string;opening:string;debit:string;credit:string;closing:string}[]};
export const fingerprint=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const currency=(v:string)=>({YR:'YER',SR:'SAR','$':'USD'}[v]??v);

export function parseHrStatement(data:any,month:string,kind:string,code:string):HrStatement {
 if(data?.schema!=='IAS20261'||data?.source!=='IAS_POST_DTL'||data?.mode!=='SELECT_ONLY'||data?.oracleWrite!=='NONE'||data?.coverageStart!=='2026-10-01'||!Array.isArray(data.rows)||!data.rows.length)throw new BadGatewayException('لم يؤكد المصدر صحة كشف الموظف');
 const total=Number(data.rows[0].TOTAL);
 if(Number(data.rows[0].ACCOUNT_EXISTS)<1||!Number.isFinite(Number(data.rows[0].ACCOUNT_EXISTS)))throw new BadGatewayException('رقم حساب الموظف غير موجود في Oracle؛ لا يُعامل كرصيد صفر');
 const raw=data.rows.filter((r:any)=>r.RN!=null);
 if(!Number.isSafeInteger(total)||total<0||total>5000||raw.length!==total)throw new BadGatewayException('كشف الموظف غير مكتمل؛ لا يمكن احتساب الراتب');
 const amount=(v:unknown)=>{
  if(v==null||! /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(v)))throw new BadGatewayException('مبلغ غير صالح في كشف الموظف');
  return new Prisma.Decimal(String(v));
 };
 const items=raw.map((r:any)=>{
  if(!String(r.DOCUMENT_DATE).startsWith(month+'-')||String(r.DOCUMENT_TYPE)==='0')throw new BadGatewayException('حركة خارج فترة الكشف');
  const row={date:String(r.DOCUMENT_DATE),documentType:String(r.DOCUMENT_TYPE),documentNumber:String(r.DOCUMENT_NUMBER??''),serial:String(r.DOCUMENT_SERIAL??''),description:String(r.DOC_DESC??''),currency:currency(String(r.A_CY)),debit:amount(r.DEBIT).toString(),credit:amount(r.CREDIT).toString()};
  return {id:fingerprint([code,kind,r.SOURCE_ROW,r.RECORD_NUMBER,r.BRANCH_NUMBER,row]),...row};
 });
 if(new Set(items.map(r=>r.id)).size!==items.length)throw new BadGatewayException('تكرار غير محسوم في كشف الموظف');
 const balances:HrStatement['balances']=[];
 for(const r of data.rows){
  if(r.CURRENCY==null||balances.some(b=>b.currency===currency(String(r.CURRENCY))))continue;
  if(Number(r.INVALID_CURRENCY)!==0)throw new BadGatewayException('إعداد عملة Oracle غير معروف؛ تعذر احتساب المبالغ');
  const c=currency(String(r.CURRENCY)),opening=amount(r.OPENING),debit=amount(r.TOTAL_DEBIT),credit=amount(r.TOTAL_CREDIT);
  const selected=items.filter(i=>i.currency===c);
  const sum=(k:'debit'|'credit')=>selected.reduce((a,i)=>a.plus(i[k]),new Prisma.Decimal(0));
  if(!sum('debit').eq(debit)||!sum('credit').eq(credit))throw new BadGatewayException('إجماليات الكشف لا تطابق التفاصيل');
  balances.push({currency:c,opening:opening.toString(),debit:debit.toString(),credit:credit.toString(),closing:opening.plus(debit).minus(credit).toString()});
 }
 return {month,kind,readAt:data.readAt,snapshotHash:fingerprint([month,kind,code,items,balances]),total,items,balances};
}

@Injectable()
export class HrStatementReader {
 constructor(private readonly config:ConfigService){}
 async read(month:string,kind:'salary'|'custody',code:string):Promise<HrStatement>{
  const base=this.config.get<string>('ORACLE_READ_API_URL')?.replace(/\/$/,''),key=this.config.get<string>('ORACLE_READ_API_KEY');
  if(!base||!key||this.config.get<string>('ORACLE_READ_SCHEMA')!=='IAS20261')throw new ServiceUnavailableException('بوابة كشف الموظفين غير مهيأة لقاعدة 2026');
  const params=new URLSearchParams({schema:'IAS20261',month,kind,code});
  let response:Response;
  try{response=await fetch(`${base}/hr/statement?${params}`,{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(30000)});}
  catch{throw new ServiceUnavailableException('تعذرت قراءة Oracle؛ لا تُعامل الحركات على أنها صفر');}
  if(!response.ok)throw new BadGatewayException(response.status===422?'الكشف يتجاوز الحد المسموح؛ لم تُستخدم بيانات جزئية':'تعذرت قراءة كشف الموظف من Oracle');
  return parseHrStatement(await response.json(),month,kind,code);
 }
}
