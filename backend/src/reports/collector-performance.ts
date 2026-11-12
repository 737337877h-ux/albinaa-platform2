import {BadRequestException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {FINANCIAL_COLLECTION_STATUSES} from '../common/financial-collection-status';
export function performanceRange(from:string,to:string){
 const valid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s??'')&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
 if(!valid(from)||!valid(to)||to<from)throw new BadRequestException('حدد فترة صحيحة من تاريخ إلى تاريخ');
 const gte=new Date(from+'T00:00:00+03:00'),lt=new Date(new Date(to+'T00:00:00+03:00').getTime()+86400000);
 if(lt.getTime()-gte.getTime()>366*86400000)throw new BadRequestException('الحد الأقصى للفترة 366 يومًا');
 return {gte,lt};
}
export function collectorPerformance(rows:any[]){
 const totals=new Map<string,Prisma.Decimal>(),groups=new Map<string,{collectorId:string;collectorName:string;currency:string;amount:Prisma.Decimal;receipts:number;customers:Set<string>}>(),seen=new Set<string>();
 for(const r of rows){
  if(!FINANCIAL_COLLECTION_STATUSES.includes(r.status)||new Prisma.Decimal(r.amount).lte(0))continue;
  if(r.id&&seen.has(r.id))continue;
  if(r.id)seen.add(r.id);
  const currency=r.currencyCode,id=r.collectorId+'|'+currency,amount=new Prisma.Decimal(r.amount).toDecimalPlaces(4);
  totals.set(currency,(totals.get(currency)??new Prisma.Decimal(0)).plus(amount));
  const group=groups.get(id)??{collectorId:r.collectorId,collectorName:r.collector.user.fullName,currency,amount:new Prisma.Decimal(0),receipts:0,customers:new Set<string>()};
  group.amount=group.amount.plus(amount);group.receipts++;group.customers.add(r.customerId);groups.set(id,group);
 }
 return {totals:[...totals].map(([currency,amount])=>({currency,amount:amount.toFixed(4)})),rows:[...groups.values()].sort((a,b)=>a.currency.localeCompare(b.currency)||b.amount.comparedTo(a.amount)).map(r=>({...r,amount:r.amount.toFixed(4),customers:r.customers.size,sharePercent:totals.get(r.currency)!.gt(0)?r.amount.div(totals.get(r.currency)!).mul(100).toFixed(2):null}))};
}

/** Calendar-day proration; a missing month remains unknown rather than a zero target. */
export function periodTarget(targets:Array<{month:Date;targetAmount:unknown}>,from:string,to:string):string|null {
 let total=new Prisma.Decimal(0);
 const end=new Date(to+'T00:00:00Z');
 for(let month=new Date(from.slice(0,7)+'-01T00:00:00Z');month<=end;month=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,1))){
  const key=month.toISOString().slice(0,7),target=targets.find(t=>t.month.toISOString().slice(0,7)===key);
  if(!target)return null;
  const days=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,0)).getUTCDate();
  const first=key===from.slice(0,7)?Number(from.slice(8)):1,last=key===to.slice(0,7)?Number(to.slice(8)):days;
  total=total.plus(new Prisma.Decimal(String(target.targetAmount)).mul(last-first+1).div(days));
 }
 return total.toFixed(4);
}
