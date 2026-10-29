import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayrollInputDto } from './hr-payroll.dto';
import { HrStatement } from './hr-statement.reader';

export type ApprovedAdvance = {monthlyInstallment?:Prisma.Decimal|null;installmentStartMonth?:string|null;id:string;amount:Prisma.Decimal;currency:string|null;reason:string;createdAt:Date;reviewedAt:Date|null;version:number};
export type OtherPayroll = {month:string;inputs:unknown};

// Linking is evidence only: money always comes from the reviewed Oracle rows.
export function reconcileAdvances(statement:HrStatement, input:PayrollInputDto, requests:ApprovedAdvance[], otherDrafts:OtherPayroll[]){
 const byId=new Map(requests.map(r=>[r.id,r]));
 const movements=new Map(statement.items.map(r=>[r.id,r]));
 const linked=new Map<string,Prisma.Decimal>();
 const otherMonths=new Map<string,string>();
 for(const draft of otherDrafts){
  const reviews=(draft.inputs as PayrollInputDto)?.reviews??[];
  for(const review of reviews)if(review.advanceRequestId)otherMonths.set(review.advanceRequestId,draft.month);
 }
 for(const review of input.reviews){
  if(!review.advanceRequestId)continue;
  const request=byId.get(review.advanceRequestId),movement=movements.get(review.id);
  if(!request)throw new BadRequestException('طلب السلفة غير معتمد أو لا يخص الموظف والفترة');
  if(otherMonths.has(request.id))throw new BadRequestException(`طلب السلفة مرتبط بمسودة ${otherMonths.get(request.id)}؛ لا تربطه مرة أخرى`);
  if(!movement||review.action!==(request.monthlyInstallment?'exclude':'deduct')||review.reason.trim().length<3)throw new BadRequestException('اربط السلفة بحركة صرف: استبعاد أصل السلفة ذات الأقساط، أو خصم السلفة القديمة؛ مع كتابة السبب');
  if(movement.currency!==request.currency||new Prisma.Decimal(movement.debit).lte(0)||!new Prisma.Decimal(movement.credit).isZero())throw new BadRequestException('عملة أو اتجاه حركة الصرف لا يطابق طلب السلفة');
  linked.set(request.id,(linked.get(request.id)??new Prisma.Decimal(0)).plus(movement.debit));
 }
 for(const [id,amount] of linked)if(!amount.eq(byId.get(id)!.amount))throw new BadRequestException('مجموع حركات الصرف المرتبطة يجب أن يساوي مبلغ طلب السلفة؛ الصرف الجزئي يحتاج مراجعة مستقلة');
 return requests.map(r=>({...r,linkedMonth:linked.has(r.id)?statement.month:otherMonths.get(r.id)??null,linkedAmount:linked.get(r.id)?.toFixed(2)??null}));
}

export function summarizePayroll(rows:any[]){
 const totals=new Map<string,{currency:string;baseSalary:Prisma.Decimal;net:Prisma.Decimal;calculated:number;incomplete:number}>();
 for(const row of rows){
  const c=row.calculation;if(!c?.currency)continue;
  const total=totals.get(c.currency)??{currency:c.currency,baseSalary:new Prisma.Decimal(0),net:new Prisma.Decimal(0),calculated:0,incomplete:0};
  if(c.baseSalary!=null)total.baseSalary=total.baseSalary.plus(c.baseSalary);
  if(c.net!=null){total.net=total.net.plus(c.net);total.calculated++;}else total.incomplete++;
  totals.set(c.currency,total);
 }
 return {employees:rows.length,failed:rows.filter(r=>r.error).length,incomplete:rows.filter(r=>!r.error&&r.calculation.net==null).length,
  calculated:rows.filter(r=>!r.error&&r.calculation.net!=null).length,
  totals:[...totals.values()].map(r=>({...r,baseSalary:r.baseSalary.toFixed(2),net:r.net.toFixed(2)}))};
}
