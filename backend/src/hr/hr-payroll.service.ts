import {payrollBaseline,payrollInputs} from './hr-payroll-baseline';
import {payrollAdjustments,applyAdjustments} from './hr-payroll-adjustments';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { HrStatement, HrStatementReader, fingerprint } from './hr-statement.reader';
import { ApprovePayrollDto, ReopenPayrollDto, HrPeriodDto, PayrollInputDto, SavePayrollDto } from './hr-payroll.dto';
import { reconcileAdvances, summarizePayroll } from './hr-payroll-reconciliation';

export const emptyPayrollInput:PayrollInputDto={incentives:null,deductions:null,installments:null,installmentsConfirmed:false,reviews:[],notes:''};
export function payrollMonthClosed(month:string,now:Date){const end=new Date(month+'-01T00:00:00Z');end.setUTCMonth(end.getUTCMonth()+1);return end.toISOString().slice(0,10)<=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Aden',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
const approvalMeta=(a:any)=>a?{id:a.id,revision:a.revision,status:a.status,reason:a.reason,approvedBy:a.approvedBy,approvedAt:a.approvedAt,reopenedBy:a.reopenedBy,reopenedAt:a.reopenedAt,reopenReason:a.reopenReason,version:a.version}:null;

export function calculatePayroll(employee:any,statement:HrStatement,input:PayrollInputDto,now=new Date()){
 const baseline=payrollBaseline(employee,statement.month);
 input=payrollInputs(employee,statement.month,input);
 const from=statement.month+'-01',next=new Date(from+'T00:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);
 const end=next.toISOString().slice(0,10);
 const salaries=[...employee.salaries].sort((a,b)=>String(b.effectiveFrom).localeCompare(String(a.effectiveFrom)));
 const date=(s:any)=>new Date(s.effectiveFrom).toISOString().slice(0,10);
 const salary=salaries.filter(s=>date(s)<=from).sort((a,b)=>date(b).localeCompare(date(a)))[0];
 const warnings:string[]=[];
 if(!employee.active)warnings.push('الموظف غير نشط؛ راجع استحقاق الفترة');
 if(!salary)warnings.push('لا يوجد راتب ساري في بداية الشهر');
 if(salaries.some(s=>date(s)>from&&date(s)<end))warnings.push('تغيّر الراتب أثناء الشهر؛ يلزم تحديد تسوية الفترة');
 if(salary?.fixedAllowance==null)warnings.push('البدل الثابت لم يُحدد؛ أدخل صفرًا في ملف الراتب إذا لا يوجد بدل');
 if(!input.installmentsConfirmed)warnings.push('الأقساط القديمة ما زالت تحتاج تأكيدًا');
 if(input.incentives==null)warnings.push('الحوافز لم تُحدد');
 if(input.deductions==null)warnings.push('الخصومات اليدوية لم تُحدد');
 if(input.installments==null)warnings.push('قسط الشهر لم يُحدد');
 const ids=new Set(statement.items.map(i=>i.id));
 if(new Set(input.reviews.map(r=>r.id)).size!==input.reviews.length)throw new BadRequestException('تكرر تصنيف الحركة');
 if(input.reviews.some(r=>!ids.has(r.id)))warnings.push('تغيّر كشف Oracle؛ بعض التصنيفات لم تعد تطابق الحركات');
 const reviews=new Map(input.reviews.map(r=>[r.id,r]));
 let withdrawals=new Prisma.Decimal(0),oracleInstallments=new Prisma.Decimal(0),unreviewed=0;
 for(const item of statement.items){
  if(baseline){
   if(item.currency!==salary?.currency){warnings.push('توجد حركة بعملة تختلف عن عملة الراتب؛ لا تحويل تلقائي');continue;}
   withdrawals=withdrawals.plus(item.debit).minus(item.credit);continue;
  }
  const review=reviews.get(item.id);
  if(!review||!review.reason.trim()){unreviewed++;continue;}
  if(review.action==='deduct'||review.action==='installment'){
   if(item.currency!==salary?.currency){warnings.push('توجد حركة مختارة بعملة تختلف عن عملة الراتب؛ لا تحويل تلقائي');continue;}
   if(review.action==='installment')oracleInstallments=oracleInstallments.plus(item.debit).minus(item.credit);
   else withdrawals=withdrawals.plus(item.debit).minus(item.credit);
  }
 }
 if(unreviewed)warnings.push(`${unreviewed} حركة لم تكتمل مراجعتها وكتابة سبب تصنيفها`);
 if(withdrawals.isNegative())warnings.push('السداد المختار يتجاوز المسحوبات المختارة؛ راجع ارتباطه بديون سابقة');
 const periodClosed=end<=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Aden',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if(!periodClosed)warnings.push('الشهر لم ينتهِ؛ الحركات المعروضة قد تتغير');
 const amount=(v:any)=>v==null?null:new Prisma.Decimal(v);
 const base=amount(salary?.baseSalary),allowance=amount(salary?.fixedAllowance),bonus=amount(input.incentives),deductions=amount(input.deductions),installments=amount(input.installments);
 let reasonsComplete=true;
 for(const [value,reason,label] of [[bonus,input.incentivesReason,'الحوافز'],[deductions,input.deductionsReason,'الخصومات'],[installments,input.installmentsReason,'الأقساط']] as const){
  if(value?.gt(0)&&(!reason||reason.trim().length<3)){warnings.push(`اكتب بيان ومرجع اعتماد ${label}`);reasonsComplete=false;}
 }
 const installmentMismatch=oracleInstallments.isNegative()||(installments!=null&&oracleInstallments.gt(installments));
 if(installmentMismatch)warnings.push('الأقساط المصنفة من Oracle لا تطابق قسط الشهر؛ راجع المبلغ والتصنيف');
 const complete=employee.active&&base!=null&&allowance!=null&&bonus!=null&&deductions!=null&&installments!=null&&unreviewed===0&&input.installmentsConfirmed&&reasonsComplete&&!installmentMismatch&&!warnings.some(w=>w.includes('عملة')||w.includes('تغيّر')||w.includes('السداد'));
 const net=complete?base!.plus(allowance!).plus(bonus!).minus(withdrawals).minus(deductions!).minus(installments!):null;
 if(net?.isNegative())warnings.push('صافي المسودة سالب؛ لا يحوّل تلقائيًا إلى مبلغ صرف أو دين');
 return {baselineDate:baseline,withdrawalMode:baseline?'oracle_auto':'reviewed',month:statement.month,currency:salary?.currency??null,baseSalary:base?.toFixed(2)??null,fixedAllowance:allowance?.toFixed(2)??null,
  incentives:bonus?.toFixed(2)??null,deductions:deductions?.toFixed(2)??null,installments:installments?.toFixed(2)??null,
  reviewedWithdrawals:withdrawals.toFixed(2),oracleInstallments:oracleInstallments.toFixed(2),net:net?.toFixed(2)??null,unreviewed,warnings,periodClosed,
  state:'draft',canApprove:false,readAt:statement.readAt};
}

@Injectable()
export class HrPayrollService {
 constructor(private readonly db:PrismaService,private readonly reader:HrStatementReader){}
 protected now(){return new Date();}
 private async monthLock(tx:Prisma.TransactionClient,org:string,month:string){await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${org+':payroll:'+month},0))::text`;}
 private approved(org:string,month:string,db:PrismaService|Prisma.TransactionClient=this.db){return db.hrPayrollApproval.findFirst({where:{organizationId:org,month,status:'approved'}});}
 async mine(user:AuthUser,q:HrPeriodDto){
  const employee=await this.db.hrEmployee.findFirst({where:{organizationId:user.organizationId,loginUserId:user.id,active:true},select:{id:true,employeeNo:true,fullName:true}});
  if(!employee)throw new NotFoundException('حساب الدخول غير مرتبط بموظف نشط');
  const approved=await this.approved(user.organizationId,q.month);
  const workspace=(approved?.snapshot as any)?.workspaces?.find((w:any)=>w.employee?.id===employee.id);
  const c=workspace?.calculation;
  // Personal access is identity-based, with no caller-supplied employee id and
  // no Oracle statement or colleagues' data. Only an approved snapshot is shown.
  const fields=['currency','baseSalary','fixedAllowance','incentives','deductions','installments','reviewedWithdrawals','absenceDays','absenceDeduction','lateDeduction','automaticInstallments','net'];
  return {employee,month:q.month,approvedAt:approved?.approvedAt??null,calculation:c?Object.fromEntries(fields.map(k=>[k,c[k]??null])):null};
 }
 async employee(user:AuthUser,id:string){
  const e=await this.db.hrEmployee.findFirst({where:{id,organizationId:user.organizationId},include:{salaries:{orderBy:{effectiveFrom:'desc'}}}});
  if(!e)throw new NotFoundException();return e;
 }
 async statement(user:AuthUser,id:string,q:HrPeriodDto){
  const e=await this.employee(user,id),kind=q.kind??'salary';
  let code=e.employeeNo;
  if(kind==='custody'){
   if(!q.detail||!Array.isArray(e.accountLinks)||!e.accountLinks.some((a:any)=>a.account==='116201001'&&a.detail===q.detail))throw new BadRequestException('العهدة غير مرتبطة بهذا الموظف');
   code=q.detail;
  }
  return this.reader.read(q.month,kind,code);
 }
 async workspace(user:AuthUser,id:string,q:HrPeriodDto){
  const approved=await this.approved(user.organizationId,q.month);
  if(approved){const w=(approved.snapshot as any).workspaces.find((w:any)=>w.employee.id===id);if(!w)throw new NotFoundException('الموظف غير مدرج في النسخة المعتمدة');return {...w,locked:true,approval:approvalMeta(approved)};}
  const employee=await this.employee(user,id);
  const statement=await this.reader.read(q.month,'salary',employee.employeeNo);
  const saved=await this.db.hrPayrollDraft.findUnique({where:{employeeId_month:{employeeId:id,month:q.month}}});
  const inputs=payrollInputs(employee,q.month,(saved?.inputs??emptyPayrollInput) as unknown as PayrollInputDto);
  const {advances,otherDrafts}=await this.advanceContext(this.db,id,q.month);
  const adjustments=await payrollAdjustments(this.db,employee,q.month);
  const snapshotHash=fingerprint([statement.snapshotHash,employee.version,employee.salaries,advances,otherDrafts,adjustments]);
  const calculation=calculatePayroll(employee,statement,inputs,this.now());
  let advanceLinks:any[]=[],advanceError:string|null=null;
  try{advanceLinks=payrollBaseline(employee,q.month)?[]:reconcileAdvances(statement,inputs,advances,otherDrafts);}catch(e){
   if(!(e instanceof BadRequestException))throw e;
   advanceError=e.message;calculation.net=null;calculation.warnings.push(e.message);
   advanceLinks=reconcileAdvances(statement,{...inputs,reviews:[]},advances,otherDrafts);
  }
  applyAdjustments(calculation,employee,q.month,adjustments,advances,advanceLinks,inputs,this.now());
  return {employee,statement,saved,inputs,snapshotHash,advanceLinks,advanceError,sourceChanged:!!saved&&saved.snapshotHash!==snapshotHash,calculation,locked:false,approval:null};
 }
 private async advanceContext(db:PrismaService|Prisma.TransactionClient,id:string,month:string){
  const end=new Date(month+'-01T00:00:00Z');end.setUTCMonth(end.getUTCMonth()+1);
  const advances=await db.hrRequest.findMany({where:{employeeId:id,kind:'advance',status:'approved',createdAt:{lt:end}},select:{id:true,amount:true,currency:true,reason:true,createdAt:true,reviewedAt:true,version:true,monthlyInstallment:true,installmentStartMonth:true},orderBy:{id:'asc'}});
  const otherDrafts=await db.hrPayrollDraft.findMany({where:{employeeId:id,month:{not:month}},select:{month:true,inputs:true},orderBy:{month:'asc'}});
  return {advances:advances.map(r=>({...r,amount:r.amount!})),otherDrafts};
 }
 private async liveMonthly(user:AuthUser,q:HrPeriodDto){
  const employees=await this.db.hrEmployee.findMany({where:{organizationId:user.organizationId,OR:[{active:true},{payrollDrafts:{some:{month:q.month}}}]},select:{id:true,employeeNo:true,fullName:true},orderBy:{employeeNo:'asc'}});
  const rows:any[]=[],workspaces:any[]=[];
  // Bound Oracle concurrency; one unavailable account must not become zero or hide other rows.
  for(let i=0;i<employees.length;i+=3){
   rows.push(...await Promise.all(employees.slice(i,i+3).map(async employee=>{
    try{const w=await this.workspace(user,employee.id,q);workspaces.push(w);return {employee,calculation:w.calculation,snapshotHash:w.snapshotHash,saved:w.saved?{version:w.saved.version,updatedAt:w.saved.updatedAt}:null,sourceChanged:w.sourceChanged,unlinkedAdvances:w.advanceLinks.filter((r:any)=>!r.linkedMonth).length,error:null};}
    catch(e){if(e instanceof Error)return {employee,calculation:null,error:'تعذرت قراءة أو مراجعة الكشف؛ افتح ملف الموظف للتفاصيل'};throw e;}
   })));
  }
  const blockers:string[]=[];
  if(!payrollMonthClosed(q.month,this.now()))blockers.push('لا يمكن اعتماد الشهر قبل انتهائه بتوقيت عدن');
  if(!rows.length)blockers.push('لا يوجد موظفون في الكشف');
  if(rows.some(r=>r.error||r.calculation?.net==null||r.calculation?.warnings.length))blockers.push('أكمل قراءة الكشوف وحسابها ومعالجة ملاحظاتها');
  if(rows.some(r=>!r.saved||r.sourceChanged))blockers.push('احفظ مراجعة جميع المسودات بعد آخر تغيير في المصدر');
  const reviewHash=fingerprint([q.month,rows.map(r=>[r.employee,r.saved?.version,r.snapshotHash,r.error,r.calculation?{...r.calculation,readAt:undefined}:null])]);
  return {report:{month:q.month,readAt:this.now().toISOString(),rows,summary:summarizePayroll(rows),reviewHash,canApprove:blockers.length===0,blockers},workspaces};
 }
 async monthly(user:AuthUser,q:HrPeriodDto){
  const history=await this.db.hrPayrollApproval.findMany({where:{organizationId:user.organizationId,month:q.month},orderBy:{revision:'desc'}});
  const approved=history.find(a=>a.status==='approved');
  if(approved)return {...(approved.snapshot as any).report,locked:true,approval:approvalMeta(approved),history:history.map(approvalMeta),canApprove:false,blockers:[]};
  const {report}=await this.liveMonthly(user,q);
  // An approval may have completed while the independent Oracle reads were running.
  const current=await this.approved(user.organizationId,q.month);if(current)return this.monthly(user,q);
  return {...report,locked:false,approval:null,history:history.map(approvalMeta)};
 }
 async revision(user:AuthUser,id:string){const a=await this.db.hrPayrollApproval.findFirst({where:{id,organizationId:user.organizationId}});if(!a)throw new NotFoundException();return {...(a.snapshot as any).report,locked:a.status==='approved',approval:approvalMeta(a),history:[],canApprove:false,blockers:[]};}
 async approve(user:AuthUser,q:HrPeriodDto,d:ApprovePayrollDto){
  if(!user.permissions.includes('hr.payroll.approve'))throw new ForbiddenException();
  if(d.reason.trim().length<3)throw new BadRequestException('اكتب بيان مراجعة واعتماد الكشف');
  const old=await this.db.hrPayrollApproval.findUnique({where:{id:d.operationId}});
  if(old){if(old.organizationId!==user.organizationId||old.month!==q.month||old.approvedBy!==user.id||old.reviewHash!==d.reviewHash||old.reason!==d.reason.trim())throw new ConflictException('معرّف الاعتماد مستخدم');return approvalMeta(old);}
  if(!payrollMonthClosed(q.month,this.now()))throw new BadRequestException('لا يمكن اعتماد الشهر قبل انتهائه بتوقيت عدن');
  if(await this.approved(user.organizationId,q.month))throw new ConflictException('الكشف معتمد ومقفل');
  const {report,workspaces}=await this.liveMonthly(user,q);
  if(!report.canApprove)throw new BadRequestException(report.blockers.join('؛ '));
  if(report.reviewHash!==d.reviewHash)throw new ConflictException('تغير الكشف منذ عرضه؛ حدّثه وراجعه قبل الاعتماد');
  return this.db.$transaction(async tx=>{
   await this.monthLock(tx,user.organizationId,q.month);
   const existing=await tx.hrPayrollApproval.findUnique({where:{id:d.operationId}});if(existing){if(existing.organizationId!==user.organizationId||existing.reviewHash!==d.reviewHash||existing.reason!==d.reason.trim()||existing.approvedBy!==user.id)throw new ConflictException();return approvalMeta(existing);}
   if(await this.approved(user.organizationId,q.month,tx))throw new ConflictException('الكشف معتمد ومقفل');
   const roster=await tx.hrEmployee.findMany({where:{organizationId:user.organizationId,OR:[{active:true},{payrollDrafts:{some:{month:q.month}}}]},select:{id:true}});
   if(fingerprint(roster.map(r=>r.id).sort())!==fingerprint(workspaces.map(w=>w.employee.id).sort()))throw new ConflictException('تغيرت قائمة الموظفين');
   for(const w of workspaces.sort((a,b)=>a.employee.id.localeCompare(b.employee.id))){
    await tx.$queryRaw`SELECT id FROM hr_employees WHERE id=${w.employee.id}::uuid FOR UPDATE`;
    const employee=await tx.hrEmployee.findUniqueOrThrow({where:{id:w.employee.id},include:{salaries:{orderBy:{effectiveFrom:'desc'}}}}),ctx=await this.advanceContext(tx,employee.id,q.month);
    const saved=await tx.hrPayrollDraft.findUnique({where:{employeeId_month:{employeeId:employee.id,month:q.month}}});
    if(saved?.version!==w.saved.version||fingerprint([w.statement.snapshotHash,employee.version,employee.salaries,ctx.advances,ctx.otherDrafts,await payrollAdjustments(tx,employee,q.month)])!==w.snapshotHash)throw new ConflictException('تغيرت إحدى المسودات أثناء الاعتماد؛ حدّث الكشف');
   }
   const last=await tx.hrPayrollApproval.aggregate({where:{organizationId:user.organizationId,month:q.month},_max:{revision:true}});
   const snapshot=JSON.parse(JSON.stringify({report,workspaces}));
   const result=await tx.hrPayrollApproval.create({data:{id:d.operationId,organizationId:user.organizationId,month:q.month,revision:(last._max.revision??0)+1,snapshot,reviewHash:d.reviewHash,reason:d.reason.trim(),approvedBy:user.id,approvedAt:this.now()}});
   await tx.auditLog.create({data:{userId:user.id,action:'hr_payroll_approved',entityTable:'hr_payroll_approvals',entityId:result.id,newValue:{month:q.month,revision:result.revision,reason:result.reason,reviewHash:d.reviewHash}}});return approvalMeta(result);
  },{timeout:15000});
 }
 async reopen(user:AuthUser,q:HrPeriodDto,d:ReopenPayrollDto){
  if(!user.permissions.includes('hr.payroll.approve'))throw new ForbiddenException();
  if(d.reason.trim().length<3)throw new BadRequestException('اكتب سبب إعادة فتح الكشف');
  return this.db.$transaction(async tx=>{
   await this.monthLock(tx,user.organizationId,q.month);
   const a=await tx.hrPayrollApproval.findFirst({where:{id:d.approvalId,organizationId:user.organizationId,month:q.month}});if(!a)throw new NotFoundException();
   if(a.reopenOperationId===d.operationId){if(a.reopenReason!==d.reason.trim()||a.reopenedBy!==user.id)throw new ConflictException();return approvalMeta(a);}
   if(a.status!=='approved'||a.version!==d.version)throw new ConflictException('تغيرت حالة الكشف؛ أعد تحميله');
   if(await tx.hrPayrollApproval.findFirst({where:{organizationId:user.organizationId,status:'approved',month:{gt:q.month}}}))throw new ConflictException('أعد فتح الأشهر اللاحقة أولًا؛ قد تعتمد أقساطها على هذا الشهر');
   const result=await tx.hrPayrollApproval.update({where:{id:a.id},data:{status:'reopened',version:{increment:1},reopenedBy:user.id,reopenedAt:this.now(),reopenReason:d.reason.trim(),reopenOperationId:d.operationId}});
   await tx.auditLog.create({data:{userId:user.id,action:'hr_payroll_reopened',entityTable:'hr_payroll_approvals',entityId:a.id,newValue:{reason:d.reason.trim(),revision:a.revision}}});return approvalMeta(result);
  });
 }
 async save(user:AuthUser,id:string,q:HrPeriodDto,d:SavePayrollDto){
  const workspace=await this.workspace(user,id,q);
  if(workspace.locked)throw new ConflictException('كشف الشهر معتمد ومقفل؛ أعد فتحه مع السبب قبل تعديل المسودة');
  if(workspace.snapshotHash!==d.snapshotHash)throw new ConflictException('تغيّرت بيانات الكشف أو الراتب؛ حدّث القراءة ثم راجع المسودة');
  const {snapshotHash,version,...rawInputs}=d;
  const inputs=payrollInputs(workspace.employee,q.month,rawInputs);
  const calculation=calculatePayroll(workspace.employee,workspace.statement,inputs);
  return this.db.$transaction(async tx=>{
   await this.monthLock(tx,user.organizationId,q.month);
   if(await this.approved(user.organizationId,q.month,tx))throw new ConflictException('كشف الشهر معتمد ومقفل');
   await tx.$queryRaw`SELECT id FROM hr_employees WHERE id=${id}::uuid FOR UPDATE`;
   const current=await tx.hrEmployee.findUniqueOrThrow({where:{id},include:{salaries:{orderBy:{effectiveFrom:'desc'}}}});
   const {advances,otherDrafts}=await this.advanceContext(tx,id,q.month);
   const adjustments=await payrollAdjustments(tx,current,q.month);
   if(fingerprint([workspace.statement.snapshotHash,current.version,current.salaries,advances,otherDrafts,adjustments])!==snapshotHash)throw new ConflictException('تغيّر الراتب أو ربط السلف أثناء الحفظ؛ حدّث القراءة');
   const links=payrollBaseline(current,q.month)?[]:reconcileAdvances(workspace.statement,inputs,advances,otherDrafts);
   applyAdjustments(calculation,current,q.month,adjustments,advances,links,inputs,this.now());
   const data={inputs:inputs as unknown as Prisma.InputJsonValue,calculation:calculation as unknown as Prisma.InputJsonValue,snapshotHash};
   const old=await tx.hrPayrollDraft.findUnique({where:{employeeId_month:{employeeId:id,month:q.month}}});
   let result;
   if(old){
    const changed=await tx.hrPayrollDraft.updateMany({where:{id:old.id,version},data:{...data,version:{increment:1}}});
    if(!changed.count)throw new ConflictException('عُدلت المسودة؛ أعد تحميلها');
    result=await tx.hrPayrollDraft.findUniqueOrThrow({where:{id:old.id}});
   }else{
    if(version!==0)throw new ConflictException('نسخة المسودة غير صحيحة');
    result=await tx.hrPayrollDraft.create({data:{...data,employeeId:id,month:q.month}});
   }
   await tx.auditLog.create({data:{userId:user.id,action:'hr_payroll_draft_saved',entityTable:'hr_payroll_drafts',entityId:result.id,newValue:{month:q.month,employeeId:id,version:result.version,snapshotHash},oldValue:old?{version:old.version}:Prisma.JsonNull}});
   return {...result,calculation};
  });
 }
}
